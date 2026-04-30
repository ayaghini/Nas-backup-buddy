// Peer tab — data-owner side of the NAS Backup Buddy SFTP backup exchange.
//
// Flow: import host invite → generate owner response → verify SFTP → create/connect repo.
// Persists non-secret state under the "peerTabState" key in app-config.json.
// Private key contents and backup passwords never leave the Rust side.

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileInput,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import type { HostAgentInviteBundle } from '../lib/host-agent-types';
import type { RemoteTargetProbeResponse, SftpRepositoryInitResult, SftpVerifyResult } from '../lib/types';
import {
  generateOwnerSshKey,
  hasKopiaPassword,
  initializeKopiaSftpRepository,
  pickJsonFile,
  probeRemoteTarget,
  readTextFile,
  runRealSftpBackupFromConfig,
  savePicker,
  verifySftpTarget,
  writeTextFile,
} from '../lib/tauri-bridge';
import { formatBytes } from '../lib/host-agent-types';

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown; }
}
function isTauri() {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

// ── Persisted state ───────────────────────────────────────────────────────────

interface PeerTabState {
  inviteJson: string;
  manualSftpHost: string;
  ownerDeviceLabel: string;
  ownerPublicKey: string;
  privateKeyPathRef: string;
  responseJson: string;
  hostKeyConfirmedForAllocId: string;
  lastPhase: PeerPhase;
  lastProbeStatus: string;
  lastSftpStatus: string;
  lastRepoMessage: string;
}

type PeerPhase =
  | 'needs_invite'
  | 'invite_invalid'
  | 'needs_key'
  | 'response_ready'
  | 'waiting_for_host'
  | 'sftp_verified'
  | 'repo_ready'
  | 'backup_ready'
  | 'blocked';

async function loadPeerState(): Promise<Partial<PeerTabState>> {
  if (!isTauri()) return {};
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<Record<string, unknown>>('load_app_config');
    const s = raw['peerTabState'];
    if (typeof s === 'object' && s !== null) return s as Partial<PeerTabState>;
  } catch { /* no-op */ }
  return {};
}

async function savePeerState(patch: Partial<PeerTabState>): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const existing = await invoke<Record<string, unknown>>('load_app_config');
    const prev = (typeof existing['peerTabState'] === 'object' && existing['peerTabState'] !== null)
      ? existing['peerTabState'] as object : {};
    const merged = { ...existing, peerTabState: { ...prev, ...patch } };
    await invoke<void>('save_app_config', { config: merged });
  } catch { /* non-fatal */ }
}

// ── Invite bundle parser ──────────────────────────────────────────────────────

interface ParseResult {
  ok: boolean;
  error?: string;
  invite?: HostAgentInviteBundle;
  sftpHost?: string;
}

function parseHostInviteBundle(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Not a JSON object.' };
  const o = raw as Record<string, unknown>;

  if (o['bundleVersion'] !== 1) return { ok: false, error: `bundleVersion must be 1, got ${o['bundleVersion']}.` };
  if (o['kind'] !== 'nasbb.host_invite') return { ok: false, error: `kind must be "nasbb.host_invite", got "${o['kind']}".` };

  for (const field of ['matchId', 'allocId', 'expiresAt'] as const) {
    if (typeof o[field] !== 'string' || !(o[field] as string).trim()) {
      return { ok: false, error: `Missing required field: ${field}.` };
    }
  }

  const sftp = o['sftp'] as Record<string, unknown> | undefined;
  if (!sftp || typeof sftp !== 'object') return { ok: false, error: 'Missing sftp object.' };

  for (const field of ['username', 'path'] as const) {
    if (typeof sftp[field] !== 'string' || !(sftp[field] as string).trim()) {
      return { ok: false, error: `Missing required sftp.${field}.` };
    }
  }

  const port = sftp['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: `sftp.port must be an integer 1–65535, got ${port}.` };
  }

  const quota = o['quota'] as Record<string, unknown> | undefined;
  if (quota && typeof quota['quotaBytes'] === 'number' && quota['quotaBytes'] <= 0) {
    return { ok: false, error: 'quota.quotaBytes must be positive.' };
  }

  const expiresAt = o['expiresAt'] as string;
  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) {
    return { ok: false, error: `expiresAt is not a valid date: "${expiresAt}".` };
  }
  if (expiryMs < Date.now()) {
    return { ok: false, error: `Invite expired ${expiresAt}. Ask the host for a fresh invite.` };
  }

  const overlay = o['overlay'] as Record<string, unknown> | undefined;
  const sftpHost = ((sftp['host'] as string | undefined) ?? '').trim()
    || ((overlay?.['host'] as string | undefined) ?? '').trim();

  return { ok: true, invite: raw as HostAgentInviteBundle, sftpHost };
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: 'green' | 'amber' | 'red' | 'slate' | 'sky' }) {
  const cls: Record<string, string> = {
    green: 'bg-emerald-800/60 text-emerald-200',
    amber: 'bg-amber-800/60 text-amber-200',
    red:   'bg-red-800/60 text-red-200',
    slate: 'bg-slate-700 text-slate-300',
    sky:   'bg-sky-800/60 text-sky-200',
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls[color]}`}>{label}</span>;
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
    >
      <ClipboardCopy size={11} />
      {copied ? 'Copied!' : label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="text-slate-500 w-36 flex-shrink-0">{label}</span>
      <span className="text-slate-200 break-all">{value}</span>
    </div>
  );
}

type SectionId = 'invite' | 'response' | 'connect' | 'backup';

function SectionHeader({
  id, label, badge, open, onToggle,
}: {
  id: SectionId;
  label: string;
  badge?: { label: string; color: 'green' | 'amber' | 'red' | 'slate' | 'sky' };
  open: boolean;
  onToggle: (id: SectionId) => void;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors ${
        open ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300 hover:bg-slate-800/30 hover:text-slate-100'
      }`}
      onClick={() => onToggle(id)}
    >
      <span className="flex-1 text-left font-medium">{label}</span>
      {badge && <Badge label={badge.label} color={badge.color} />}
      {open ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Peer() {
  const navigate = useNavigate();
  const { updateRemoteRepositoryState, refreshReadiness, updateKopiaRepositoryFromBackup, wizardConfig } = useApp();

  // ── Local state ────────────────────────────────────────────────────────────
  const [loaded, setLoaded] = useState(false);

  // Invite
  const [inviteText, setInviteText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [invite, setInvite] = useState<HostAgentInviteBundle | null>(null);
  const [sftpHost, setSftpHost] = useState('');
  const [manualSftpHost, setManualSftpHost] = useState('');

  // Response
  const [deviceLabel, setDeviceLabel] = useState('Owner device');
  const [ownerPublicKey, setOwnerPublicKey] = useState('');
  const [privateKeyRef, setPrivateKeyRef] = useState('');
  const [responseJson, setResponseJson] = useState('');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [keyError, setKeyError] = useState('');

  // Connect
  const [hostKeyConfirmedForAllocId, setHostKeyConfirmedForAllocId] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<RemoteTargetProbeResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [sftpResult, setSftpResult] = useState<SftpVerifyResult | null>(null);
  const [repoConnecting, setRepoConnecting] = useState(false);
  const [repoResult, setRepoResult] = useState<SftpRepositoryInitResult | null>(null);
  const [hasPassword, setHasPassword] = useState(false);

  // Backup
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<{ success: boolean; message: string } | null>(null);

  // Previous-session note: shown when persistence had sftp/repo state but we don't restore it live.
  const [previousSessionNote, setPreviousSessionNote] = useState<{ sftpStatus: string; repoReady: boolean } | null>(null);

  // UI
  const [openSection, setOpenSection] = useState<SectionId>('invite');
  const appMode = isTauri() ? 'tauri' : 'browser';

  // Host resolved from invite; user override wins so cross-account Tailscale DNS
  // failures can be repaired without asking the host to issue a new invite.
  const effectiveSftpHost = manualSftpHost.trim() || sftpHost;
  const inviteUsesMagicDns = sftpHost.endsWith('.ts.net');

  // ── Derived phase ──────────────────────────────────────────────────────────
  const phase = ((): PeerPhase => {
    if (!parseResult) return 'needs_invite';
    if (!parseResult.ok) return 'invite_invalid';
    if (!ownerPublicKey) return 'needs_key';
    if (sftpResult?.status === 'ok' || sftpResult?.status === 'quota_warning') {
      if (repoResult?.initialized || repoResult?.already_existed) return 'repo_ready';
      return 'sftp_verified';
    }
    if (sftpResult?.status === 'auth_failed') return 'waiting_for_host';
    if (sftpResult) return 'blocked';
    return 'response_ready';
  })();

  // ── Load persisted state ───────────────────────────────────────────────────
  useEffect(() => {
    loadPeerState().then(s => {
      if (s.inviteJson) {
        setInviteText(s.inviteJson);
        try {
          const parsed = parseHostInviteBundle(JSON.parse(s.inviteJson) as unknown);
          setParseResult(parsed);
          if (parsed.ok && parsed.invite) {
            setInvite(parsed.invite);
            setSftpHost(parsed.sftpHost ?? '');
          }
        } catch { /* ignore parse failures on restore */ }
      }
      if (s.manualSftpHost) setManualSftpHost(s.manualSftpHost);
      if (s.ownerDeviceLabel) setDeviceLabel(s.ownerDeviceLabel);
      if (s.ownerPublicKey) setOwnerPublicKey(s.ownerPublicKey);
      if (s.privateKeyPathRef) setPrivateKeyRef(s.privateKeyPathRef);
      if (s.responseJson) setResponseJson(s.responseJson);
      if (s.hostKeyConfirmedForAllocId) setHostKeyConfirmedForAllocId(s.hostKeyConfirmedForAllocId);
      if (s.lastProbeStatus) setProbeResult({ status: s.lastProbeStatus, method: 'tcp_connect', latency_ms: null, message: s.lastProbeStatus });
      // Don't restore sftpResult/repoResult as live state — SFTP connections are session-scoped
      // and the host key / auth state may have changed since last session. Show a note instead.
      if (s.lastSftpStatus || s.lastRepoMessage) {
        setPreviousSessionNote({ sftpStatus: s.lastSftpStatus ?? 'unknown', repoReady: !!s.lastRepoMessage });
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    hasKopiaPassword().then(setHasPassword);
  }, []);

  // ── Parse invite text ──────────────────────────────────────────────────────
  const applyInviteText = useCallback((text: string) => {
    setInviteText(text);
    if (!text.trim()) { setParseResult(null); setInvite(null); setSftpHost(''); return; }
    let parsed: ParseResult;
    try {
      parsed = parseHostInviteBundle(JSON.parse(text) as unknown);
    } catch {
      parsed = { ok: false, error: 'Invalid JSON.' };
    }
    setParseResult(parsed);
    if (parsed.ok && parsed.invite) {
      setInvite(parsed.invite);
      setSftpHost(parsed.sftpHost ?? '');
      // Clear the manual override when the new invite already has a host — stale
      // overrides would otherwise silently shadow the invite's host.
      if (parsed.sftpHost) {
        setManualSftpHost('');
      }
      // Reset downstream state when a new invite is imported
      setOwnerPublicKey('');
      setPrivateKeyRef('');
      setResponseJson('');
      setProbeResult(null);
      setSftpResult(null);
      setRepoResult(null);
      void savePeerState({
        inviteJson: text,
        manualSftpHost: parsed.sftpHost ? '' : undefined,
        ownerPublicKey: '',
        privateKeyPathRef: '',
        responseJson: '',
        lastProbeStatus: '',
        lastSftpStatus: '',
        lastRepoMessage: '',
        lastPhase: 'needs_key',
      });
    } else {
      void savePeerState({ inviteJson: text, lastPhase: parsed.ok ? 'invite_invalid' : 'invite_invalid' });
    }
  }, []);

  // ── Import from file ───────────────────────────────────────────────────────
  const handleFileImport = useCallback(async () => {
    const path = await pickJsonFile();
    if (!path) return;
    try {
      const text = await readTextFile(path);
      applyInviteText(text);
    } catch (e) {
      setParseResult({ ok: false, error: `Cannot read file: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [applyInviteText]);

  // ── Generate/reuse owner SSH key ───────────────────────────────────────────
  const handleGenerateKey = useCallback(async () => {
    if (!invite) return;
    setGeneratingKey(true);
    setKeyError('');
    try {
      const key = await generateOwnerSshKey(invite.matchId);
      setOwnerPublicKey(key.public_key);
      setPrivateKeyRef(key.private_key_path_or_ref);

      const response = {
        bundleVersion: 1,
        kind: 'nasbb.owner_access_response' as const,
        matchId: invite.matchId,
        allocId: invite.allocId,
        ownerDeviceLabel: deviceLabel,
        ownerPublicKey: key.public_key,
        requestedSftpUsername: invite.sftp.username,
        createdAt: new Date().toISOString(),
      };
      const json = JSON.stringify(response, null, 2);
      setResponseJson(json);

      void savePeerState({
        ownerPublicKey: key.public_key,
        privateKeyPathRef: key.private_key_path_or_ref,
        responseJson: json,
        ownerDeviceLabel: deviceLabel,
        lastPhase: 'response_ready',
      });
      setOpenSection('response');
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingKey(false);
    }
  }, [invite, deviceLabel]);

  // Rebuild response JSON when device label changes (only if key already generated)
  const handleDeviceLabelChange = useCallback((label: string) => {
    setDeviceLabel(label);
    void savePeerState({ ownerDeviceLabel: label });
    if (!invite || !ownerPublicKey) return;
    const response = {
      bundleVersion: 1,
      kind: 'nasbb.owner_access_response' as const,
      matchId: invite.matchId,
      allocId: invite.allocId,
      ownerDeviceLabel: label,
      ownerPublicKey,
      requestedSftpUsername: invite.sftp.username,
      createdAt: new Date().toISOString(),
    };
    const json = JSON.stringify(response, null, 2);
    setResponseJson(json);
    void savePeerState({ responseJson: json });
  }, [invite, ownerPublicKey]);

  // ── Export response ────────────────────────────────────────────────────────
  const handleExportResponse = useCallback(async () => {
    if (!responseJson) return;
    const defaultName = invite ? `owner-response-${invite.matchId}.json` : 'owner-access-response.json';
    const path = await savePicker(defaultName);
    if (!path) return;
    try {
      await writeTextFile(path, responseJson);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [responseJson, invite]);

  // ── Host key confirmation ──────────────────────────────────────────────────
  const isHostKeyConfirmed = invite ? hostKeyConfirmedForAllocId === invite.allocId : false;

  const handleConfirmHostKey = useCallback((checked: boolean) => {
    if (!invite) return;
    const confirmed = checked ? invite.allocId : '';
    setHostKeyConfirmedForAllocId(confirmed);
    void savePeerState({ hostKeyConfirmedForAllocId: confirmed });
  }, [invite]);

  // ── TCP probe ──────────────────────────────────────────────────────────────
  const handleProbe = useCallback(async () => {
    if (!effectiveSftpHost || !invite) return;
    setProbing(true);
    try {
      const result = await probeRemoteTarget(effectiveSftpHost, invite.sftp.port);
      setProbeResult(result);
      void savePeerState({ lastProbeStatus: result.status });
      const sharedStatus = result.status === 'tcp_port_reachable' ? 'reachable' : 'unreachable';
      updateRemoteRepositoryState(sharedStatus, result.status === 'tcp_port_reachable' ? 0 : -1);
    } finally {
      setProbing(false);
    }
  }, [effectiveSftpHost, invite, updateRemoteRepositoryState]);

  // ── SFTP verify ───────────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (!invite || !effectiveSftpHost || !isHostKeyConfirmed) return;
    setVerifying(true);
    setPreviousSessionNote(null);
    try {
      const result = await verifySftpTarget(
        effectiveSftpHost,
        invite.sftp.port,
        invite.sftp.username,
        invite.sftp.path,
        privateKeyRef || null,
      );

      // Compare actual server fingerprint against what the invite advertised.
      // Normalize by stripping the 'SHA256:' prefix — Go and Rust both emit the full form.
      const inviteFp = invite.hostKey?.fingerprintSha256?.replace(/^SHA256:/i, '') ?? null;
      const actualFp = result.host_fingerprint?.replace(/^SHA256:/i, '') ?? null;
      if (inviteFp && actualFp && inviteFp !== actualFp) {
        const mismatchResult: SftpVerifyResult = {
          ...result,
          status: 'host_key_mismatch',
          message: `Host key mismatch — expected ${invite.hostKey!.fingerprintSha256}, got ${result.host_fingerprint}.`,
        };
        setSftpResult(mismatchResult);
        void savePeerState({ lastSftpStatus: 'host_key_mismatch' });
        updateRemoteRepositoryState('unreachable', -1);
        refreshReadiness();
        return;
      }

      setSftpResult(result);
      void savePeerState({ lastSftpStatus: result.status });
      const sftpOk = result.status === 'ok' || result.status === 'quota_warning';
      const sharedStatus = sftpOk ? 'reachable' : result.status === 'auth_failed' ? 'auth_failed' : 'unreachable';
      updateRemoteRepositoryState(sharedStatus, sftpOk ? 0 : -1);
      refreshReadiness();
      // Stay on 'connect' so the user can see and click "Create/connect repository".
    } finally {
      setVerifying(false);
    }
  }, [invite, effectiveSftpHost, isHostKeyConfirmed, privateKeyRef, updateRemoteRepositoryState, refreshReadiness]);

  // ── Kopia repo create/connect ─────────────────────────────────────────────
  const handleRepoConnect = useCallback(async () => {
    if (!invite || !effectiveSftpHost || !hasPassword) return;
    setRepoConnecting(true);
    try {
      const result = await initializeKopiaSftpRepository(
        effectiveSftpHost,
        invite.sftp.username,
        invite.sftp.path,
        invite.sftp.port,
        privateKeyRef || null,
      );
      setRepoResult(result);
      void savePeerState({ lastRepoMessage: result.message, lastPhase: 'repo_ready' });
      updateRemoteRepositoryState('reachable', 0);
      refreshReadiness();
      setOpenSection('backup');
    } catch (e) {
      setRepoResult({ initialized: false, already_existed: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRepoConnecting(false);
    }
  }, [invite, effectiveSftpHost, hasPassword, privateKeyRef, updateRemoteRepositoryState, refreshReadiness]);

  // ── Backup ────────────────────────────────────────────────────────────────
  const sourceFolders = wizardConfig?.source_folders ?? [];
  const canRunBackup = phase === 'repo_ready' && sourceFolders.length > 0 && invite != null && effectiveSftpHost !== '';

  const handleRunBackup = useCallback(async () => {
    if (!invite || !effectiveSftpHost || !canRunBackup) return;
    setBackupRunning(true);
    setBackupResult(null);
    try {
      const result = await runRealSftpBackupFromConfig(
        sourceFolders,
        effectiveSftpHost,
        invite.sftp.username,
        invite.sftp.path,
        invite.sftp.port,
        privateKeyRef || null,
      );
      setBackupResult({ success: result.success, message: result.success ? `Snapshot ${result.snapshot_id}` : result.log_line });
      if (result.success) {
        updateKopiaRepositoryFromBackup({ timestamp: result.timestamp });
        updateRemoteRepositoryState('reachable', 0);
        refreshReadiness();
      }
    } catch (e) {
      setBackupResult({ success: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBackupRunning(false);
    }
  }, [invite, effectiveSftpHost, sourceFolders, privateKeyRef, canRunBackup, updateKopiaRepositoryFromBackup, updateRemoteRepositoryState, refreshReadiness]);

  // ── Section toggle ────────────────────────────────────────────────────────
  const toggleSection = useCallback((id: SectionId) => {
    setOpenSection(prev => prev === id ? id : id);
  }, []);

  if (!loaded) return null;

  // ── Next step ─────────────────────────────────────────────────────────────
  const nextStep = (() => {
    switch (phase) {
      case 'needs_invite':     return 'Paste or import the Host Invite Bundle JSON from your storage host.';
      case 'invite_invalid':   return 'Fix the invite JSON or ask your host for a fresh invite.';
      case 'needs_key':        return 'Generate your SSH key and copy the Owner Access Response to the host.';
      case 'response_ready':   return 'Send the response JSON to your host and ask them to import it in Host → Allocations.';
      case 'waiting_for_host': return 'Host has not yet imported your response. Ask them to import it, then re-run SFTP verify.';
      case 'sftp_verified':    return 'SFTP verified. Create or connect the Kopia SFTP repository in the Connect section.';
      case 'repo_ready':       return sourceFolders.length > 0 ? 'Run backup.' : 'Repository ready. Add source folders in Backup Plan, then run backup.';
      case 'backup_ready':     return 'Run backup.';
      case 'blocked':          return 'A blocker was detected — see Connect section for details.';
    }
  })();

  const phaseColor: Record<PeerPhase, 'green' | 'amber' | 'red' | 'slate' | 'sky'> = {
    needs_invite:    'slate',
    invite_invalid:  'red',
    needs_key:       'amber',
    response_ready:  'sky',
    waiting_for_host:'amber',
    sftp_verified:   'sky',
    repo_ready:      'green',
    backup_ready:    'green',
    blocked:         'red',
  };

  // ── Invite section badge ───────────────────────────────────────────────────
  const inviteBadge = !parseResult ? { label: 'no invite', color: 'slate' as const }
    : parseResult.ok ? { label: 'valid', color: 'green' as const }
    : { label: 'invalid', color: 'red' as const };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Network size={16} className="text-sky-400" />
          <h1 className="text-sm font-semibold text-slate-100">Peer</h1>
          <Badge label={phase.replace(/_/g, ' ')} color={phaseColor[phase]} />
          {appMode === 'browser' && (
            <span className="ml-auto text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} /> browser/mock mode
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">{nextStep}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">

          {/* ── Section 1: Invite ─────────────────────────────────────────── */}
          <div className="rounded border border-slate-800 overflow-hidden">
            <SectionHeader id="invite" label="1 · Invite" badge={inviteBadge} open={openSection === 'invite'} onToggle={toggleSection} />
            {openSection === 'invite' && (
              <div className="px-4 pb-4 pt-3 border-t border-slate-800 space-y-3">
                <p className="text-xs text-slate-400">
                  Paste the Host Invite Bundle JSON from your storage host, or import it from a file.
                </p>

                <textarea
                  className="w-full h-36 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-200 font-mono resize-none focus:outline-none focus:border-sky-600"
                  placeholder='{"bundleVersion":1,"kind":"nasbb.host_invite",...}'
                  value={inviteText}
                  onChange={e => applyInviteText(e.target.value)}
                  spellCheck={false}
                />

                <div className="flex items-center gap-2">
                  {appMode === 'tauri' && (
                    <button
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                      onClick={handleFileImport}
                    >
                      <FileInput size={12} /> Import from file
                    </button>
                  )}
                  {parseResult && (
                    <span className={`flex items-center gap-1 text-xs ${parseResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {parseResult.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      {parseResult.ok ? 'Valid invite' : parseResult.error}
                    </span>
                  )}
                </div>

                {invite && (
                  <div className="rounded bg-slate-900/60 border border-slate-700 p-3 space-y-1.5">
                    <Row label="Connection name" value={invite.connectionName} />
                    <Row label="Match ID" value={invite.matchId} />
                    <Row label="Allocation ID" value={invite.allocId} />
                    <Row label="Invite SFTP host" value={sftpHost || '(missing)'} />
                    {manualSftpHost.trim() && (
                      <Row label="Using host override" value={manualSftpHost.trim()} />
                    )}
                    <Row label="SFTP port" value={String(invite.sftp.port)} />
                    <Row label="SFTP username" value={invite.sftp.username} />
                    <Row label="SFTP path" value={invite.sftp.path} />
                    {invite.overlay && <Row label="Overlay" value={`${invite.overlay.provider} · ${invite.overlay.host}`} />}
                    {invite.quota?.quotaBytes && <Row label="Quota" value={formatBytes(invite.quota.quotaBytes)} />}
                    <Row label="Expires" value={invite.expiresAt} />
                    {invite.hostKey?.fingerprintSha256 && (
                      <Row label="Host key (SHA256)" value={invite.hostKey.fingerprintSha256} />
                    )}
                    {invite.hostKey?.verificationNote && (
                      <div className="text-xs text-amber-400 flex gap-1 items-start pt-1">
                        <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                        {invite.hostKey.verificationNote}
                      </div>
                    )}
                    {inviteUsesMagicDns && (
                      <div className="text-xs text-amber-400 flex gap-1 items-start pt-1">
                        <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                        This invite uses a Tailscale MagicDNS name. If this device is in a different Tailscale account, use the host's shared 100.x IP in the override below.
                      </div>
                    )}
                    <div className="space-y-1.5 pt-1">
                      <label className="text-xs text-slate-400">Host override (optional)</label>
                      <input
                        className={`w-full bg-slate-900 border rounded px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-600 ${!sftpHost ? 'border-amber-700' : 'border-slate-700'}`}
                        placeholder="Use the host's shared Tailscale IPv4, e.g. 100.x.y.z"
                        value={manualSftpHost}
                        onChange={e => {
                          const value = e.target.value;
                          setManualSftpHost(value);
                          setProbeResult(null);
                          setSftpResult(null);
                          setRepoResult(null);
                          setPreviousSessionNote(null);
                          void savePeerState({ manualSftpHost: value, lastProbeStatus: '', lastSftpStatus: '', lastRepoMessage: '' });
                        }}
                      />
                      <div className="text-xs text-slate-500">
                        If TCP probe cannot resolve the invite host, ask the host for the shared device's Tailscale IPv4 and enter it here.
                      </div>
                      {!effectiveSftpHost && (
                        <div className="text-xs text-red-400 flex gap-1 items-start">
                          <XCircle size={11} className="mt-0.5 flex-shrink-0" />
                          No host address — cannot probe or verify until one is provided.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: Response ───────────────────────────────────────── */}
          <div className={`rounded border overflow-hidden ${phase === 'needs_invite' || phase === 'invite_invalid' ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
            <SectionHeader
              id="response"
              label="2 · Response"
              badge={ownerPublicKey ? { label: 'generated', color: 'green' } : { label: 'pending', color: 'slate' }}
              open={openSection === 'response'}
              onToggle={toggleSection}
            />
            {openSection === 'response' && (
              <div className="px-4 pb-4 pt-3 border-t border-slate-800 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Owner device label</label>
                  <input
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-600"
                    value={deviceLabel}
                    onChange={e => handleDeviceLabelChange(e.target.value)}
                    placeholder="e.g. Mira Mac mini"
                    disabled={!invite}
                  />
                </div>

                {ownerPublicKey && (
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">Your public key (safe to share)</span>
                    <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono break-all">
                      {ownerPublicKey}
                    </div>
                    {privateKeyRef && (
                      <p className="text-xs text-slate-500">Private key reference: <span className="font-mono">{privateKeyRef}</span></p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleGenerateKey}
                    disabled={!invite || generatingKey}
                  >
                    {generatingKey ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                    {ownerPublicKey ? 'Regenerate response' : 'Generate response'}
                  </button>
                  {keyError && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={11} />{keyError}</span>}
                </div>

                {responseJson && (
                  <div className="space-y-2">
                    <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono max-h-40 overflow-y-auto">
                      <pre className="whitespace-pre-wrap break-all">{responseJson}</pre>
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyBtn text={responseJson} label="Copy response" />
                      {appMode === 'tauri' && (
                        <button
                          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                          onClick={handleExportResponse}
                        >
                          <Download size={11} /> Export response
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Send this JSON to your host and ask them to import it in <strong className="text-slate-200">Host → Allocations</strong>.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Section 3: Connect ────────────────────────────────────────── */}
          <div className={`rounded border overflow-hidden ${!ownerPublicKey ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
            <SectionHeader
              id="connect"
              label="3 · Connect"
              badge={
                repoResult?.initialized || repoResult?.already_existed ? { label: 'repo ready', color: 'green' } :
                sftpResult?.status === 'ok' ? { label: 'SFTP ok', color: 'sky' } :
                sftpResult?.status === 'quota_warning' ? { label: 'SFTP ok (low space)', color: 'amber' } :
                sftpResult?.status === 'auth_failed' ? { label: 'waiting for host', color: 'amber' } :
                sftpResult ? { label: 'verify failed', color: 'red' as const } :
                { label: 'pending', color: 'slate' }
              }
              open={openSection === 'connect'}
              onToggle={toggleSection}
            />
            {openSection === 'connect' && (
              <div className="px-4 pb-4 pt-3 border-t border-slate-800 space-y-4">

                {/* Previous-session note — shown when we have persisted state but haven't re-verified this session */}
                {previousSessionNote && !sftpResult && (
                  <div className="px-2 py-1.5 rounded bg-slate-800/60 border border-slate-700 text-xs text-slate-400 flex items-start gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-amber-400" />
                    Last session: SFTP {previousSessionNote.sftpStatus}
                    {previousSessionNote.repoReady ? ', repository connected' : ''}.
                    Re-run SFTP verify to continue this session.
                  </div>
                )}

                {/* Host key confirmation */}
                {invite?.hostKey?.fingerprintSha256 && (
                  <div className="rounded bg-amber-900/20 border border-amber-800/40 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <ShieldCheck size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs text-amber-200 font-medium">Host key verification required</p>
                        <p className="text-xs text-amber-300/80 font-mono break-all">{invite.hostKey.fingerprintSha256}</p>
                        <p className="text-xs text-amber-400/70">{invite.hostKey.verificationNote}</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={isHostKeyConfirmed}
                        onChange={e => handleConfirmHostKey(e.target.checked)}
                        disabled={!ownerPublicKey}
                      />
                      I have verified this fingerprint out-of-band with my host
                    </label>
                  </div>
                )}
                {!invite?.hostKey?.fingerprintSha256 && ownerPublicKey && (
                  <div className="rounded bg-slate-800/40 border border-slate-700 p-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={isHostKeyConfirmed}
                        onChange={e => handleConfirmHostKey(e.target.checked)}
                      />
                      No host key fingerprint in invite — I accept the risk and want to proceed
                    </label>
                  </div>
                )}

                {/* TCP probe */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-medium w-24">Probe TCP</span>
                    <button
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                      onClick={handleProbe}
                      disabled={!effectiveSftpHost || probing || !ownerPublicKey}
                    >
                      {probing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                      Probe TCP
                    </button>
                    {probeResult && (
                      <span className={`flex items-center gap-1 text-xs ${probeResult.status === 'tcp_port_reachable' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {probeResult.status === 'tcp_port_reachable' ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                        {probeResult.message}
                      </span>
                    )}
                  </div>
                  {probeResult?.message.toLowerCase().includes('cannot resolve') && (
                    <p className="text-xs text-amber-400">
                      The invite host is not resolving on this device. For a shared Tailscale device from another account, use the host's 100.x Tailscale IPv4 in the Invite section override.
                    </p>
                  )}
                  {!effectiveSftpHost && ownerPublicKey && (
                    <p className="text-xs text-amber-400">Enter the host address in the Invite section to enable probing.</p>
                  )}
                </div>

                {/* SFTP verify */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-medium w-24">Verify SFTP</span>
                    <button
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                      onClick={handleVerify}
                      disabled={!isHostKeyConfirmed || verifying || !ownerPublicKey || !effectiveSftpHost}
                    >
                      {verifying ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Verify SFTP
                    </button>
                    {!isHostKeyConfirmed && ownerPublicKey && (
                      <span className="text-xs text-amber-400">Confirm host key fingerprint first</span>
                    )}
                    {sftpResult && (
                      <span className={`flex items-center gap-1 text-xs ${
                        sftpResult.status === 'ok' ? 'text-emerald-400' :
                        sftpResult.status === 'quota_warning' ? 'text-amber-400' :
                        sftpResult.status === 'auth_failed' ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {(sftpResult.status === 'ok' || sftpResult.status === 'quota_warning') ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                        {sftpResult.message}
                      </span>
                    )}
                  </div>
                  {sftpResult?.status === 'auth_failed' && (
                    <p className="text-xs text-amber-400">
                      Auth failed — the host has not yet imported your response, or there is a key mismatch.
                      Ask the host to import the Owner Access Response in Host → Allocations, then retry.
                    </p>
                  )}
                  {sftpResult?.status === 'host_key_mismatch' && (
                    <p className="text-xs text-red-400">
                      Host key mismatch — verify the fingerprint out-of-band with your host before proceeding.
                    </p>
                  )}
                  {sftpResult?.free_bytes != null && (
                    <p className="text-xs text-slate-500">Remote free space: {formatBytes(sftpResult.free_bytes)}</p>
                  )}
                  {sftpResult?.status === 'quota_warning' && (
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={11} /> Less than 1 GiB free on host — backup may fail if it needs more space. Ask your host to free up storage.
                    </p>
                  )}
                </div>

                {/* Kopia repo create/connect */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-medium w-24">Repository</span>
                    {!hasPassword && (
                      <button
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white"
                        onClick={() => navigate('/recovery')}
                      >
                        <KeyRound size={11} /> Set Kopia password first
                      </button>
                    )}
                    {hasPassword && (
                      <button
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50"
                        onClick={handleRepoConnect}
                        disabled={(sftpResult?.status !== 'ok' && sftpResult?.status !== 'quota_warning') || repoConnecting}
                      >
                        {repoConnecting ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />}
                        Create/connect repository
                      </button>
                    )}
                    {repoResult && (
                      <span className={`flex items-center gap-1 text-xs ${repoResult.initialized || repoResult.already_existed ? 'text-emerald-400' : 'text-red-400'}`}>
                        {repoResult.initialized || repoResult.already_existed ? <CheckCircle size={11} /> : <XCircle size={11} />}
                        {repoResult.message}
                      </span>
                    )}
                  </div>
                  {(sftpResult?.status !== 'ok' && sftpResult?.status !== 'quota_warning') && hasPassword && ownerPublicKey && (
                    <p className="text-xs text-slate-500">Run SFTP verify successfully before creating the repository.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Section 4: Backup ─────────────────────────────────────────── */}
          <div className={`rounded border overflow-hidden ${phase !== 'repo_ready' ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
            <SectionHeader
              id="backup"
              label="4 · Backup"
              badge={backupResult?.success ? { label: 'snapshot done', color: 'green' } : { label: 'pending', color: 'slate' }}
              open={openSection === 'backup'}
              onToggle={toggleSection}
            />
            {openSection === 'backup' && (
              <div className="px-4 pb-4 pt-3 border-t border-slate-800 space-y-3">
                {sourceFolders.length === 0 && (
                  <div className="text-xs text-amber-400 flex gap-1 items-start">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                    No source folders configured. Add them in{' '}
                    <button className="underline text-sky-400 ml-1" onClick={() => navigate('/backup')}>Backup Plan</button>.
                  </div>
                )}
                {sourceFolders.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">Source folders:</p>
                    {sourceFolders.map(f => (
                      <p key={f} className="text-xs font-mono text-slate-300 truncate">{f}</p>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50"
                    onClick={handleRunBackup}
                    disabled={!canRunBackup || backupRunning}
                  >
                    {backupRunning ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Run backup
                  </button>
                  {backupResult && (
                    <span className={`flex items-center gap-1 text-xs ${backupResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                      {backupResult.success ? <CheckCircle size={11} /> : <XCircle size={11} />}
                      {backupResult.message}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
