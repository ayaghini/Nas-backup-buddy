// Peer tab — owner-side peer matching with multi-peer support.
//
// Each peer goes through: invite → response → connect (TCP probe + SFTP verify + repo) → backup.
// All peers persist via AppContext (savedPeers → app-config.json).
// Session-only live state (probe/sftp/repo results) lives in a per-peer Map in local state.

import { useState, useEffect, useCallback, useRef } from 'react';
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
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import type { HostAgentInviteBundle } from '../lib/host-agent-types';
import type { PeerPhase, RemoteTargetProbeResponse, SavedPeer, SftpRepositoryInitResult, SftpVerifyResult } from '../lib/types';
import {
  generateOwnerSshKey,
  hasKopiaPassword,
  initializeKopiaSftpRepository,
  pickJsonFile,
  probeRemoteTarget,
  readTextFile,
  runRealSftpBackupFromConfig,
  savePicker,
  submitPeerResponse,
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

// ── Per-peer session state (not persisted) ────────────────────────────────────

interface PeerSession {
  probeResult: RemoteTargetProbeResponse | null;
  sftpResult: SftpVerifyResult | null;
  repoResult: SftpRepositoryInitResult | null;
  backupResult: { success: boolean; message: string } | null;
  probing: boolean;
  verifying: boolean;
  repoConnecting: boolean;
  backupRunning: boolean;
  generatingKey: boolean;
  submitting: boolean;
  submitResult: { ok: boolean; message: string } | null;
  keyError: string;
  previousSessionNote: { sftpStatus: string; repoReady: boolean } | null;
}

const EMPTY_SESSION: PeerSession = {
  probeResult: null, sftpResult: null, repoResult: null, backupResult: null,
  probing: false, verifying: false, repoConnecting: false, backupRunning: false,
  generatingKey: false, submitting: false, submitResult: null,
  keyError: '', previousSessionNote: null,
};

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
  if (o['kind'] !== 'nasbb.host_invite') return { ok: false, error: `kind must be "nasbb.host_invite".` };
  for (const field of ['matchId', 'allocId', 'expiresAt'] as const) {
    if (typeof o[field] !== 'string' || !(o[field] as string).trim())
      return { ok: false, error: `Missing required field: ${field}.` };
  }
  const sftp = o['sftp'] as Record<string, unknown> | undefined;
  if (!sftp) return { ok: false, error: 'Missing sftp object.' };
  for (const field of ['username', 'path'] as const) {
    if (typeof sftp[field] !== 'string' || !(sftp[field] as string).trim())
      return { ok: false, error: `Missing required sftp.${field}.` };
  }
  const port = sftp['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, error: `sftp.port must be 1–65535, got ${port}.` };
  const expiresAt = o['expiresAt'] as string;
  if (Number.isNaN(new Date(expiresAt).getTime()))
    return { ok: false, error: `expiresAt is not a valid date.` };
  if (new Date(expiresAt).getTime() < Date.now())
    return { ok: false, error: `Invite expired ${expiresAt}. Ask the host for a fresh invite.` };
  const overlay = o['overlay'] as Record<string, unknown> | undefined;
  const sftpHost = ((sftp['host'] as string | undefined) ?? '').trim()
    || ((overlay?.['host'] as string | undefined) ?? '').trim();
  return { ok: true, invite: raw as HostAgentInviteBundle, sftpHost };
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

const PHASE_COLOR: Record<PeerPhase, string> = {
  needs_invite:     'bg-slate-700 text-slate-300',
  invite_invalid:   'bg-red-800/60 text-red-200',
  needs_key:        'bg-amber-800/60 text-amber-200',
  response_ready:   'bg-sky-800/60 text-sky-200',
  waiting_for_host: 'bg-amber-800/60 text-amber-200',
  sftp_verified:    'bg-sky-800/60 text-sky-200',
  repo_ready:       'bg-emerald-800/60 text-emerald-200',
  blocked:          'bg-red-800/60 text-red-200',
};

function PhaseBadge({ phase }: { phase: PeerPhase }) {
  const label = phase.replace(/_/g, ' ');
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PHASE_COLOR[phase]}`}>{label}</span>;
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
    >
      <ClipboardCopy size={11} />{copied ? 'Copied!' : label}
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

// ── Phase derivation ──────────────────────────────────────────────────────────

function derivePhase(peer: SavedPeer, session: PeerSession): PeerPhase {
  if (!peer.inviteJson) return 'needs_invite';
  let parsed: ParseResult;
  try { parsed = parseHostInviteBundle(JSON.parse(peer.inviteJson) as unknown); }
  catch { return 'invite_invalid'; }
  if (!parsed.ok) return 'invite_invalid';
  if (!peer.ownerPublicKey) return 'needs_key';
  const sftp = session.sftpResult;
  if (sftp?.status === 'ok' || sftp?.status === 'quota_warning') {
    if (session.repoResult?.initialized || session.repoResult?.already_existed) return 'repo_ready';
    if (peer.lastRepoMessage) return 'repo_ready';
    return 'sftp_verified';
  }
  if (sftp?.status === 'auth_failed') return 'waiting_for_host';
  if (sftp) return 'blocked';
  if (peer.lastRepoMessage) return 'repo_ready';
  if (peer.lastSftpStatus === 'ok' || peer.lastSftpStatus === 'quota_warning') return 'sftp_verified';
  if (peer.lastSftpStatus === 'auth_failed') return 'waiting_for_host';
  return 'response_ready';
}

// ── Main component ────────────────────────────────────────────────────────────

export function Peer() {
  const navigate = useNavigate();
  const { savedPeers, upsertSavedPeer, removeSavedPeer, updateRemoteRepositoryState, refreshReadiness, updateKopiaRepositoryFromBackup, wizardConfigs } = useApp();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, PeerSession>>({});
  const [openSection, setOpenSection] = useState<SectionId>('invite');
  const [hasPassword, setHasPassword] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const appMode = isTauri() ? 'tauri' : 'browser';

  // Pick the first peer by default when peers load.
  // Also seed previousSessionNote from persistence so the Connect banner fires.
  useEffect(() => {
    if (savedPeers.length === 0) return;
    if (!selectedId) setSelectedId(savedPeers[0].id);
    // For every peer that has persisted SFTP/repo state but no live session yet,
    // seed previousSessionNote so the user sees what happened last session.
    setSessions(prev => {
      const next = { ...prev };
      for (const p of savedPeers) {
        if (next[p.id]) continue; // already has session
        if (!p.lastSftpStatus && !p.lastRepoMessage) continue;
        next[p.id] = {
          ...EMPTY_SESSION,
          previousSessionNote: {
            sftpStatus: p.lastSftpStatus || 'unknown',
            repoReady: !!p.lastRepoMessage,
          },
        };
      }
      return next;
    });
  }, [savedPeers, selectedId]);

  useEffect(() => {
    hasKopiaPassword().then(setHasPassword);
  }, []);

  // ── Session helpers ────────────────────────────────────────────────────────

  const getSession = useCallback((id: string): PeerSession =>
    sessions[id] ?? { ...EMPTY_SESSION }, [sessions]);

  const patchSession = useCallback((id: string, patch: Partial<PeerSession>) => {
    setSessions(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_SESSION), ...patch } }));
  }, []);

  // ── Selected peer ──────────────────────────────────────────────────────────

  const peer = selectedId ? (savedPeers.find(p => p.id === selectedId) ?? null) : null;
  const session = selectedId ? getSession(selectedId) : EMPTY_SESSION;

  // Parse invite from current peer's inviteJson
  const parseResult: ParseResult | null = peer?.inviteJson
    ? (() => { try { return parseHostInviteBundle(JSON.parse(peer.inviteJson) as unknown); } catch { return { ok: false, error: 'Invalid JSON.' }; } })()
    : null;
  const invite = parseResult?.ok ? parseResult.invite ?? null : null;

  const effectiveSftpHost = peer ? (peer.manualSftpHost.trim() || peer.sftpHost) : '';
  const inviteUsesMagicDns = (peer?.sftpHost ?? '').endsWith('.ts.net');
  const isHostKeyConfirmed = invite ? peer?.hostKeyConfirmedForAllocId === invite.allocId : false;

  const phase: PeerPhase = peer ? derivePhase(peer, session) : 'needs_invite';

  // Derive which section to open by default for a given peer/phase.
  function defaultSection(p: SavedPeer): SectionId {
    const s = sessions[p.id] ?? EMPTY_SESSION;
    const ph = derivePhase(p, s);
    if (ph === 'needs_invite' || ph === 'invite_invalid') return 'invite';
    if (ph === 'needs_key' || ph === 'response_ready') return 'response';
    if (ph === 'waiting_for_host' || ph === 'sftp_verified') return 'connect';
    if (ph === 'repo_ready' || ph === 'blocked') return 'backup';
    return 'invite';
  }

  // ── Create new peer ────────────────────────────────────────────────────────

  function createNewPeer() {
    const id = `peer_${Date.now().toString(36)}`;
    const newPeer: SavedPeer = {
      id, matchId: '', allocId: '', connectionName: 'New peer',
      inviteJson: '', sftpHost: '', manualSftpHost: '',
      sftpPort: 22, sftpUsername: '', sftpPath: '',
      ownerDeviceLabel: 'Owner device', ownerPublicKey: '',
      privateKeyRef: '', responseJson: '',
      hostKeyConfirmedForAllocId: '', phase: 'needs_invite',
      lastProbeStatus: '', lastSftpStatus: '', lastRepoMessage: '',
      createdAt: new Date().toISOString(), connectedAt: null,
    };
    upsertSavedPeer(newPeer);
    setSelectedId(id);
    setOpenSection('invite');
  }

  // ── Invite handling ────────────────────────────────────────────────────────

  function applyInviteText(text: string) {
    if (!peer) return;
    if (!text.trim()) {
      upsertSavedPeer({ ...peer, inviteJson: '', sftpHost: '', matchId: '', allocId: '', connectionName: peer.connectionName, sftpPort: 22, sftpUsername: '', sftpPath: '', phase: 'needs_invite' });
      patchSession(peer.id, { sftpResult: null, repoResult: null, probeResult: null });
      return;
    }
    let parsed: ParseResult;
    try { parsed = parseHostInviteBundle(JSON.parse(text) as unknown); }
    catch { parsed = { ok: false, error: 'Invalid JSON.' }; }

    if (parsed.ok && parsed.invite) {
      const inv = parsed.invite;
      const sftp = inv.sftp as { username: string; path: string; port: number; host?: string };
      upsertSavedPeer({
        ...peer,
        inviteJson: text,
        matchId: inv.matchId,
        allocId: inv.allocId,
        connectionName: inv.connectionName || peer.connectionName,
        sftpHost: parsed.sftpHost ?? '',
        manualSftpHost: parsed.sftpHost ? '' : peer.manualSftpHost,
        sftpPort: sftp.port,
        sftpUsername: sftp.username,
        sftpPath: sftp.path,
        ownerPublicKey: '',
        privateKeyRef: '',
        responseJson: '',
        phase: 'needs_key',
        lastProbeStatus: '', lastSftpStatus: '', lastRepoMessage: '',
      });
      patchSession(peer.id, { sftpResult: null, repoResult: null, probeResult: null, submitResult: null, previousSessionNote: null });
    } else {
      upsertSavedPeer({ ...peer, inviteJson: text, phase: 'invite_invalid' });
    }
  }

  async function handleFileImport() {
    if (!peer) return;
    const path = await pickJsonFile();
    if (!path) return;
    try { applyInviteText(await readTextFile(path)); }
    catch (e) { /* parse error handled by applyInviteText */ void e; }
  }

  // ── Generate response ──────────────────────────────────────────────────────

  const generateRef = useRef(false);
  async function handleGenerateKey() {
    if (!peer || !invite || generateRef.current) return;
    generateRef.current = true;
    patchSession(peer.id, { generatingKey: true, keyError: '' });
    try {
      const key = await generateOwnerSshKey(invite.matchId);
      const response = {
        bundleVersion: 1, kind: 'nasbb.owner_access_response' as const,
        matchId: invite.matchId, allocId: invite.allocId,
        ownerDeviceLabel: peer.ownerDeviceLabel,
        ownerPublicKey: key.public_key,
        requestedSftpUsername: invite.sftp.username,
        createdAt: new Date().toISOString(),
      };
      const json = JSON.stringify(response, null, 2);
      upsertSavedPeer({ ...peer, ownerPublicKey: key.public_key, privateKeyRef: key.private_key_path_or_ref, responseJson: json, phase: 'response_ready' });
      patchSession(peer.id, { generatingKey: false });
      setOpenSection('response');
    } catch (e) {
      patchSession(peer.id, { generatingKey: false, keyError: e instanceof Error ? e.message : String(e) });
    } finally {
      generateRef.current = false;
    }
  }

  function handleDeviceLabelChange(label: string) {
    if (!peer || !invite) return;
    const updatedPeer = { ...peer, ownerDeviceLabel: label };
    if (peer.ownerPublicKey) {
      const response = {
        bundleVersion: 1, kind: 'nasbb.owner_access_response' as const,
        matchId: invite.matchId, allocId: invite.allocId,
        ownerDeviceLabel: label, ownerPublicKey: peer.ownerPublicKey,
        requestedSftpUsername: invite.sftp.username, createdAt: new Date().toISOString(),
      };
      updatedPeer.responseJson = JSON.stringify(response, null, 2);
    }
    upsertSavedPeer(updatedPeer);
  }

  // ── Auto-submit response ───────────────────────────────────────────────────

  async function handleAutoSubmit() {
    if (!peer || !invite?.peerApi || !peer.ownerPublicKey) return;
    patchSession(peer.id, { submitting: true, submitResult: null });
    try {
      await submitPeerResponse(
        invite.peerApi.submitUrl, invite.peerApi.token,
        invite.matchId, invite.allocId,
        peer.ownerDeviceLabel, peer.ownerPublicKey, invite.sftp.username,
      );
      patchSession(peer.id, { submitting: false, submitResult: { ok: true, message: 'Response sent to host automatically.' } });
    } catch (e) {
      patchSession(peer.id, { submitting: false, submitResult: { ok: false, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ── Export response ────────────────────────────────────────────────────────

  async function handleExportResponse() {
    if (!peer?.responseJson) return;
    const path = await savePicker(invite ? `owner-response-${invite.matchId}.json` : 'owner-access-response.json');
    if (!path) return;
    try { await writeTextFile(path, peer.responseJson); }
    catch (e) { alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Host key confirm ───────────────────────────────────────────────────────

  function handleConfirmHostKey(checked: boolean) {
    if (!peer || !invite) return;
    upsertSavedPeer({ ...peer, hostKeyConfirmedForAllocId: checked ? invite.allocId : '' });
  }

  // ── TCP probe ──────────────────────────────────────────────────────────────

  async function handleProbe() {
    if (!peer || !invite || !effectiveSftpHost) return;
    patchSession(peer.id, { probing: true });
    try {
      const result = await probeRemoteTarget(effectiveSftpHost, invite.sftp.port);
      patchSession(peer.id, { probing: false, probeResult: result });
      upsertSavedPeer({ ...peer, lastProbeStatus: result.status });
      updateRemoteRepositoryState(result.status === 'tcp_port_reachable' ? 'reachable' : 'unreachable', result.status === 'tcp_port_reachable' ? 0 : -1);
    } catch { patchSession(peer.id, { probing: false }); }
  }

  // ── SFTP verify ───────────────────────────────────────────────────────────

  async function handleVerify() {
    if (!peer || !invite || !effectiveSftpHost || !isHostKeyConfirmed) return;
    patchSession(peer.id, { verifying: true, previousSessionNote: null });
    try {
      const result = await verifySftpTarget(effectiveSftpHost, invite.sftp.port, invite.sftp.username, invite.sftp.path, peer.privateKeyRef || null);

      const strip = (fp: string) => fp.replace(/^SHA256:/i, '');
      const inviteFps = [invite.hostKey?.fingerprintSha256, ...(invite.hostKey?.alternateFingerprints ?? [])].filter(Boolean).map(fp => strip(fp!));
      const actualFp = result.host_fingerprint ? strip(result.host_fingerprint) : null;
      if (inviteFps.length > 0 && actualFp && !inviteFps.includes(actualFp)) {
        const mismatch: SftpVerifyResult = { ...result, status: 'host_key_mismatch', message: `Host key mismatch — got ${result.host_fingerprint}.` };
        patchSession(peer.id, { verifying: false, sftpResult: mismatch });
        upsertSavedPeer({ ...peer, lastSftpStatus: 'host_key_mismatch' });
        updateRemoteRepositoryState('unreachable', -1);
        refreshReadiness();
        return;
      }

      patchSession(peer.id, { verifying: false, sftpResult: result });
      upsertSavedPeer({ ...peer, lastSftpStatus: result.status });
      const ok = result.status === 'ok' || result.status === 'quota_warning';
      updateRemoteRepositoryState(ok ? 'reachable' : result.status === 'auth_failed' ? 'auth_failed' : 'unreachable', ok ? 0 : -1);
      refreshReadiness();
    } catch { patchSession(peer.id, { verifying: false }); }
  }

  // ── Kopia repo connect ────────────────────────────────────────────────────

  async function handleRepoConnect() {
    if (!peer || !invite || !effectiveSftpHost || !hasPassword) return;
    patchSession(peer.id, { repoConnecting: true });
    try {
      const result = await initializeKopiaSftpRepository(effectiveSftpHost, invite.sftp.username, invite.sftp.path, invite.sftp.port, peer.privateKeyRef || null);
      const connectedAt = (result.initialized || result.already_existed) ? new Date().toISOString() : peer.connectedAt;
      patchSession(peer.id, { repoConnecting: false, repoResult: result });
      upsertSavedPeer({ ...peer, lastRepoMessage: result.message, phase: 'repo_ready', connectedAt });
      updateRemoteRepositoryState('reachable', 0);
      refreshReadiness();
      setOpenSection('backup');
    } catch (e) {
      patchSession(peer.id, { repoConnecting: false, repoResult: { initialized: false, already_existed: false, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  // Find the wizard config whose overlay_host matches this peer, fall back to last config.
  const matchingConfig = effectiveSftpHost
    ? (wizardConfigs.find(c => c.overlay_host === effectiveSftpHost) ?? wizardConfigs[wizardConfigs.length - 1] ?? null)
    : (wizardConfigs[wizardConfigs.length - 1] ?? null);
  const sourceFolders = matchingConfig?.source_folders ?? [];
  const canRunBackup = phase === 'repo_ready' && sourceFolders.length > 0 && invite != null && !!effectiveSftpHost;

  async function handleRunBackup() {
    if (!peer || !invite || !canRunBackup) return;
    patchSession(peer.id, { backupRunning: true, backupResult: null });
    try {
      const result = await runRealSftpBackupFromConfig(sourceFolders, effectiveSftpHost, invite.sftp.username, invite.sftp.path, invite.sftp.port, peer.privateKeyRef || null);
      patchSession(peer.id, { backupRunning: false, backupResult: { success: result.success, message: result.success ? `Snapshot ${result.snapshot_id}` : result.log_line } });
      if (result.success) {
        updateKopiaRepositoryFromBackup({ timestamp: result.timestamp });
        updateRemoteRepositoryState('reachable', 0);
        refreshReadiness();
      }
    } catch (e) {
      patchSession(peer.id, { backupRunning: false, backupResult: { success: false, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ── Delete peer ───────────────────────────────────────────────────────────

  function handleDeletePeer(id: string) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    removeSavedPeer(id);
    setConfirmDeleteId(null);
    if (selectedId === id) {
      const remaining = savedPeers.filter(p => p.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  // ── Next-step hint ────────────────────────────────────────────────────────

  const nextStep = (() => {
    switch (phase) {
      case 'needs_invite':     return 'Paste or import the Host Invite Bundle JSON from your storage host.';
      case 'invite_invalid':   return 'Fix the invite JSON or ask your host for a fresh invite.';
      case 'needs_key':        return 'Generate your SSH key and send the Owner Access Response to the host.';
      case 'response_ready':   return invite?.peerApi ? 'Click "Auto-Submit to Host", or copy it manually.' : 'Send the response JSON to your host → Host → Allocations.';
      case 'waiting_for_host': return 'Host has not imported your response yet. Ask them, then re-run SFTP verify.';
      case 'sftp_verified':    return 'SFTP verified. Create or connect the Kopia repository in the Connect section.';
      case 'repo_ready':       return sourceFolders.length > 0 ? 'Repository ready. Run backup.' : 'Repository ready. Add source folders in Setup Wizard, then run backup.';
      case 'blocked':          return 'A blocker was detected — see Connect section.';
    }
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Network size={16} className="text-sky-400" />
          <h1 className="text-sm font-semibold text-slate-100">Peer</h1>
          {peer && <PhaseBadge phase={phase} />}
          {appMode === 'browser' && (
            <span className="ml-auto text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} /> browser/mock mode
            </span>
          )}
        </div>
        {peer && <p className="text-xs text-slate-500 mt-1">{nextStep}</p>}
      </div>

      {/* Peer list + Add button */}
      <div className="border-b border-slate-800 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {savedPeers.map(p => (
          <div key={p.id} className="flex-shrink-0 relative group">
            <button
              onClick={() => { setSelectedId(p.id); setOpenSection(defaultSection(p)); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                selectedId === p.id
                  ? 'border-sky-600 bg-sky-600/15 text-sky-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                p.phase === 'repo_ready' ? 'bg-emerald-400' :
                p.phase === 'blocked' || p.phase === 'invite_invalid' ? 'bg-red-400' :
                'bg-amber-400'
              }`} />
              <span className="max-w-[120px] truncate">{p.connectionName || p.matchId || 'New peer'}</span>
            </button>
            {/* Delete button appears on hover */}
            <button
              onClick={() => handleDeletePeer(p.id)}
              className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 rounded-full bg-slate-600 hover:bg-red-700 items-center justify-center"
              title="Delete peer"
            >
              <XCircle size={10} className="text-white" />
            </button>
            {confirmDeleteId === p.id && (
              <div className="absolute top-8 left-0 z-20 bg-slate-800 border border-red-700/50 rounded px-2 py-1.5 text-xs text-red-300 whitespace-nowrap shadow-lg">
                Delete {p.connectionName || 'this peer'}?{' '}
                <button className="underline text-red-200" onClick={() => handleDeletePeer(p.id)}>Yes</button>
                {' '}<button className="text-slate-400" onClick={() => setConfirmDeleteId(null)}>No</button>
              </div>
            )}
          </div>
        ))}
        <button
          onClick={createNewPeer}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-dashed border-slate-700 text-slate-500 hover:border-sky-600 hover:text-sky-400 transition-colors"
        >
          <Plus size={12} /> Add peer
        </button>
      </div>

      {/* Empty state */}
      {savedPeers.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <Network size={32} className="text-slate-700" />
          <p className="text-sm text-slate-400">No peer connections yet.</p>
          <p className="text-xs text-slate-500 max-w-sm">
            Ask your storage host to generate an invite in their <strong>Host</strong> tab, then click "Add peer" to import it.
          </p>
          <button onClick={createNewPeer} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-sm text-white">
            <Plus size={14} /> Add first peer
          </button>
        </div>
      )}

      {/* Peer detail */}
      {peer && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">

            {/* ── 1 · Invite ───────────────────────────────────────────── */}
            <Section
              id="invite"
              label="1 · Invite"
              badge={!parseResult ? { label: 'no invite', ok: null } : parseResult.ok ? { label: 'valid', ok: true } : { label: 'invalid', ok: false }}
              open={openSection === 'invite'}
              onToggle={id => setOpenSection(id)}
            >
              <p className="text-xs text-slate-400">Paste the Host Invite Bundle JSON from your storage host, or import it from a file.</p>

              <textarea
                className="w-full h-36 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-200 font-mono resize-none focus:outline-none focus:border-sky-600"
                placeholder='{"bundleVersion":1,"kind":"nasbb.host_invite",...}'
                value={peer.inviteJson}
                onChange={e => applyInviteText(e.target.value)}
                spellCheck={false}
              />

              <div className="flex items-center gap-2">
                {appMode === 'tauri' && (
                  <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200" onClick={handleFileImport}>
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
                  {new Date(invite.expiresAt).getTime() < Date.now() && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300">
                      <XCircle size={11} className="flex-shrink-0" />
                      Invite expired — ask the host for a fresh one.
                    </div>
                  )}
                  <Row label="Connection name" value={invite.connectionName} />
                  <Row label="Match ID" value={invite.matchId} />
                  <Row label="SFTP host" value={peer.sftpHost || '(missing — use override)'} />
                  <Row label="SFTP port" value={String(invite.sftp.port)} />
                  <Row label="SFTP username" value={invite.sftp.username} />
                  <Row label="SFTP path" value={invite.sftp.path} />
                  {invite.quota?.quotaBytes && <Row label="Quota" value={formatBytes(invite.quota.quotaBytes)} />}
                  <Row label="Expires" value={invite.expiresAt} />
                  {invite.hostKey?.fingerprintSha256 && <Row label="Host key (SHA256)" value={invite.hostKey.fingerprintSha256} />}
                  {inviteUsesMagicDns && (
                    <div className="text-xs text-amber-400 flex gap-1 items-start pt-1">
                      <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                      MagicDNS name — use the host's 100.x Tailscale IP in the override if cross-account.
                    </div>
                  )}
                  <div className="space-y-1 pt-1">
                    <label className="text-xs text-slate-400">Host address override (optional)</label>
                    <input
                      className={`w-full bg-slate-900 border rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-600 ${!peer.sftpHost ? 'border-amber-700' : 'border-slate-700'}`}
                      placeholder="100.x.y.z"
                      value={peer.manualSftpHost}
                      onChange={e => { upsertSavedPeer({ ...peer, manualSftpHost: e.target.value }); patchSession(peer.id, { probeResult: null, sftpResult: null, repoResult: null }); }}
                    />
                    <p className="text-xs text-slate-500">Shared Tailscale IPv4 if MagicDNS won't resolve cross-account.</p>
                    {!effectiveSftpHost && (
                      <p className="text-xs text-red-400 flex gap-1 items-center"><XCircle size={11} />No host address — enter an override above.</p>
                    )}
                  </div>
                </div>
              )}
            </Section>

            {/* ── 2 · Response ────────────────────────────────────────── */}
            <Section
              id="response"
              label="2 · Response"
              badge={peer.ownerPublicKey ? { label: 'generated', ok: true } : { label: 'pending', ok: null }}
              open={openSection === 'response'}
              onToggle={id => setOpenSection(id)}
              dimmed={!parseResult?.ok}
            >
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Owner device label</label>
                <input
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-600"
                  value={peer.ownerDeviceLabel}
                  onChange={e => handleDeviceLabelChange(e.target.value)}
                  placeholder="e.g. Home Mac mini"
                  disabled={!invite}
                />
              </div>

              {peer.ownerPublicKey && (
                <div className="space-y-1">
                  <span className="text-xs text-slate-400">Your public key (safe to share)</span>
                  <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono break-all">{peer.ownerPublicKey}</div>
                  {peer.privateKeyRef && <p className="text-xs text-slate-500">Key ref: <span className="font-mono">{peer.privateKeyRef}</span></p>}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50"
                  onClick={handleGenerateKey}
                  disabled={!invite || session.generatingKey}
                >
                  {session.generatingKey ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                  {peer.ownerPublicKey ? 'Regenerate response' : 'Generate response'}
                </button>
                {session.keyError && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={11} />{session.keyError}</span>}
              </div>

              {peer.responseJson && (
                <div className="space-y-2">
                  <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono max-h-40 overflow-y-auto">
                    <pre className="whitespace-pre-wrap break-all">{peer.responseJson}</pre>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {invite?.peerApi && appMode === 'tauri' && (
                      <button
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                        onClick={handleAutoSubmit}
                        disabled={session.submitting || session.submitResult?.ok === true}
                      >
                        {session.submitting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        {session.submitResult?.ok ? 'Sent!' : 'Auto-Submit to Host'}
                      </button>
                    )}
                    <CopyBtn text={peer.responseJson} label="Copy response" />
                    {appMode === 'tauri' && (
                      <button className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200" onClick={handleExportResponse}>
                        <Download size={11} /> Export
                      </button>
                    )}
                  </div>
                  {session.submitResult && (
                    <span className={`flex items-center gap-1 text-xs ${session.submitResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {session.submitResult.ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
                      {session.submitResult.message}
                    </span>
                  )}
                  <p className="text-xs text-slate-400">
                    {invite?.peerApi
                      ? 'Auto-submit sends directly to the host, or copy/export manually.'
                      : 'Send this JSON to your host → Host → Allocations.'}
                  </p>
                </div>
              )}
            </Section>

            {/* ── 3 · Connect ─────────────────────────────────────────── */}
            <Section
              id="connect"
              label="3 · Connect"
              badge={
                session.repoResult?.initialized || session.repoResult?.already_existed || peer.lastRepoMessage
                  ? { label: 'repo ready', ok: true }
                  : session.sftpResult?.status === 'ok' ? { label: 'SFTP ok', ok: true }
                  : session.sftpResult?.status === 'quota_warning' ? { label: 'SFTP ok (low space)', ok: true }
                  : session.sftpResult?.status === 'auth_failed' ? { label: 'waiting for host', ok: null }
                  : session.sftpResult ? { label: 'verify failed', ok: false }
                  : { label: 'pending', ok: null }
              }
              open={openSection === 'connect'}
              onToggle={id => setOpenSection(id)}
              dimmed={!peer.ownerPublicKey}
            >
              {/* Previous session note */}
              {session.previousSessionNote && !session.sftpResult && (
                <div className="px-2 py-1.5 rounded bg-slate-800/60 border border-slate-700 text-xs text-slate-400 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-amber-400" />
                  Last session: SFTP {session.previousSessionNote.sftpStatus}
                  {session.previousSessionNote.repoReady ? ', repository connected.' : '.'}
                  {' '}Re-run SFTP verify.
                </div>
              )}

              {/* Host key confirm */}
              {invite?.hostKey?.fingerprintSha256 && (
                <div className="rounded bg-amber-900/20 border border-amber-800/40 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs text-amber-200 font-medium">Verify host key out-of-band</p>
                      <p className="text-xs text-amber-300/80 font-mono break-all">{invite.hostKey.fingerprintSha256}</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" className="rounded" checked={!!isHostKeyConfirmed} onChange={e => handleConfirmHostKey(e.target.checked)} disabled={!peer.ownerPublicKey} />
                    I have verified this fingerprint with my host
                  </label>
                </div>
              )}
              {!invite?.hostKey?.fingerprintSha256 && peer.ownerPublicKey && (
                <div className="rounded bg-slate-800/40 border border-slate-700 p-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" className="rounded" checked={!!isHostKeyConfirmed} onChange={e => handleConfirmHostKey(e.target.checked)} />
                    No host key in invite — I accept the risk and want to proceed
                  </label>
                </div>
              )}

              {/* TCP probe */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400 font-medium w-24">TCP probe</span>
                <button
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                  onClick={handleProbe}
                  disabled={!effectiveSftpHost || session.probing || !peer.ownerPublicKey}
                >
                  {session.probing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Probe
                </button>
                {session.probeResult && (
                  <span className={`flex items-center gap-1 text-xs ${session.probeResult.status === 'tcp_port_reachable' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {session.probeResult.status === 'tcp_port_reachable' ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                    {session.probeResult.message}
                  </span>
                )}
              </div>

              {/* SFTP verify */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400 font-medium w-24">SFTP verify</span>
                  <button
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                    onClick={handleVerify}
                    disabled={!isHostKeyConfirmed || session.verifying || !peer.ownerPublicKey || !effectiveSftpHost}
                  >
                    {session.verifying ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    Verify
                  </button>
                  {!isHostKeyConfirmed && peer.ownerPublicKey && <span className="text-xs text-amber-400">Confirm host key first</span>}
                  {session.sftpResult && (
                    <span className={`flex items-center gap-1 text-xs ${session.sftpResult.status === 'ok' || session.sftpResult.status === 'quota_warning' ? 'text-emerald-400' : session.sftpResult.status === 'auth_failed' ? 'text-amber-400' : 'text-red-400'}`}>
                      {session.sftpResult.status === 'ok' || session.sftpResult.status === 'quota_warning' ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                      {session.sftpResult.message}
                    </span>
                  )}
                </div>
                {session.sftpResult?.status === 'auth_failed' && (
                  <p className="text-xs text-amber-400 ml-28">Auth failed — ask host to import the Owner Access Response, then retry.</p>
                )}
                {session.sftpResult?.free_bytes != null && (
                  <p className="text-xs text-slate-500 ml-28">Free space: {formatBytes(session.sftpResult.free_bytes)}</p>
                )}
              </div>

              {/* Repository */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400 font-medium w-24">Repository</span>
                {!hasPassword && (
                  <button className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white" onClick={() => navigate('/recovery')}>
                    <KeyRound size={11} /> Set password first
                  </button>
                )}
                {hasPassword && (
                  <button
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50"
                    onClick={handleRepoConnect}
                    disabled={(session.sftpResult?.status !== 'ok' && session.sftpResult?.status !== 'quota_warning') || session.repoConnecting}
                  >
                    {session.repoConnecting ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />}
                    Create / connect
                  </button>
                )}
                {(session.repoResult || peer.lastRepoMessage) && (
                  <span className={`flex items-center gap-1 text-xs ${session.repoResult?.initialized || session.repoResult?.already_existed || peer.lastRepoMessage ? 'text-emerald-400' : 'text-red-400'}`}>
                    {session.repoResult?.initialized || session.repoResult?.already_existed || peer.lastRepoMessage ? <CheckCircle size={11} /> : <XCircle size={11} />}
                    {session.repoResult?.message ?? peer.lastRepoMessage}
                  </span>
                )}
              </div>
            </Section>

            {/* ── 4 · Backup ──────────────────────────────────────────── */}
            <Section
              id="backup"
              label="4 · Backup"
              badge={session.backupResult?.success ? { label: 'snapshot done', ok: true } : { label: 'pending', ok: null }}
              open={openSection === 'backup'}
              onToggle={id => setOpenSection(id)}
              dimmed={phase !== 'repo_ready'}
            >
              {sourceFolders.length === 0 ? (
                <div className="text-xs text-amber-400 flex gap-1 items-start">
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                  No source folders. Add them in{' '}
                  <button className="underline text-sky-400 ml-1" onClick={() => navigate('/setup')}>Setup Wizard</button>.
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-slate-400">Source folders:</p>
                  {sourceFolders.map(f => <p key={f} className="text-xs font-mono text-slate-300 truncate">{f}</p>)}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-50"
                  onClick={handleRunBackup}
                  disabled={!canRunBackup || session.backupRunning}
                >
                  {session.backupRunning ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Run backup
                </button>
                {session.backupResult && (
                  <span className={`flex items-center gap-1 text-xs ${session.backupResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {session.backupResult.success ? <CheckCircle size={11} /> : <XCircle size={11} />}
                    {session.backupResult.message}
                  </span>
                )}
              </div>
            </Section>

            {/* Delete peer (bottom) */}
            <div className="pt-2 flex justify-end">
              {confirmDeleteId === peer.id ? (
                <span className="text-xs text-red-400">
                  Delete this peer permanently?{' '}
                  <button className="underline" onClick={() => handleDeletePeer(peer.id)}>Delete</button>
                  {' '}<button className="text-slate-400" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                </span>
              ) : (
                <button
                  onClick={() => handleDeletePeer(peer.id)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 hover:bg-red-900/20 px-2 py-1 rounded transition-colors"
                >
                  <Trash2 size={11} /> Remove peer
                </button>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ── Section accordion ─────────────────────────────────────────────────────────

function Section({
  id, label, badge, open, onToggle, dimmed = false, children,
}: {
  id: SectionId;
  label: string;
  badge: { label: string; ok: boolean | null };
  open: boolean;
  onToggle: (id: SectionId) => void;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  const badgeCls = badge.ok === true ? 'bg-emerald-800/60 text-emerald-200'
    : badge.ok === false ? 'bg-red-800/60 text-red-200'
    : 'bg-slate-700 text-slate-300';
  return (
    <div className={`rounded border overflow-hidden transition-opacity ${dimmed ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
      <button
        className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors ${open ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300 hover:bg-slate-800/30'}`}
        onClick={() => onToggle(id)}
      >
        <span className="flex-1 text-left font-medium">{label}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeCls}`}>{badge.label}</span>
        {open ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-800 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
