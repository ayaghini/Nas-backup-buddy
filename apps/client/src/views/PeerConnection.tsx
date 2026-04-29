import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  generateAuthorizeOwnerKeyPlan,
  generateOwnerSshKey,
  getTailscaleDetail,
  initializeKopiaSftpRepository,
  parseOwnerBundle,
  pickDirectory,
  pickFile,
  planHostSetup,
  probeRemoteTarget,
  tailscaleConnect,
  tailscalePingPeer,
  verifySftpTarget,
} from '../lib/tauri-bridge';
import { loadPersistedConfig, savePersistedConfig } from '../lib/persistence';
import type {
  BackupTarget,
  BackupTargetStatus,
  HostAllocation,
  HostAllocationStatus,
  HostSetupPlan,
  HostSetupStep,
  OwnerAccessRequest,
  OwnerSshKey,
  PeerBundle,
  RemoteTargetProbeResponse,
  SftpRepositoryInitResult,
  SftpVerifyResult,
  TailscaleConnectResult,
  TailscaleDetail,
  TailscalePingResult,
} from '../lib/types';

type Section = 'network' | 'host' | 'owner' | 'advanced';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genMatchId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `match-${rand}`;
}

/** Serialise a HostSetupPlan's bundle to paste-friendly text. */
function bundleText(plan: HostSetupPlan): string {
  const b = plan.owner_bundle;
  return [
    `connection_name: ${b.connection_name}`,
    `match_id:         ${b.match_id}`,
    `overlay_provider: ${b.overlay_provider}`,
    `overlay_host:     ${b.overlay_host}`,
    `sftp_user:        ${b.sftp_username}`,
    `sftp_port:        ${b.sftp_port}`,
    `sftp_path:        ${b.sftp_path}`,
    `quota_gb:         ${b.quota_gb}`,
    '',
    `# ${b.host_key_fingerprint_note}`,
    b.compatibility_note ? `# ${b.compatibility_note}` : null,
  ].filter(l => l !== null).join('\n');
}

/** Serialise an Owner Access Request to paste-friendly text. */
function accessRequestText(r: OwnerAccessRequest): string {
  return [
    `match_id:        ${r.match_id}`,
    `connection_name: ${r.connection_name}`,
    `public_key:      ${r.public_key}`,
    `fingerprint:     ${r.fingerprint}`,
  ].join('\n');
}

/** Parse a pasted Owner Access Request (key: value lines). */
function parseAccessRequest(text: string): OwnerAccessRequest | null {
  const map: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const colon = t.indexOf(':');
    if (colon < 0) continue;
    const key = t.slice(0, colon).trim().toLowerCase().replace(/ /g, '_');
    const value = t.slice(colon + 1).trim();
    map[key] = value;
  }
  const match_id = map['match_id'];
  const public_key = map['public_key'];
  if (!match_id || !public_key) return null;
  return {
    match_id,
    connection_name: map['connection_name'] ?? '',
    public_key,
    fingerprint: map['fingerprint'] ?? 'manual-import',
  };
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
    >
      <ClipboardCopy size={11} />
      {copied ? 'Copied' : label}
    </button>
  );
}

function Field({
  label, value, onChange, placeholder, hint, textarea = false, readOnly = false,
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; hint?: string; textarea?: boolean; readOnly?: boolean;
}) {
  const cls = `w-full rounded border ${readOnly ? 'border-slate-800 bg-slate-950 opacity-70' : 'border-slate-700 bg-slate-800'} px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none`;
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      {textarea
        ? <textarea rows={3} value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly} className={`${cls} resize-none`} />
        : <input value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly} className={cls} />}
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    draft:                 'bg-slate-800 text-slate-500',
    space_planned:         'bg-sky-500/10 text-sky-400',
    waiting_for_owner_key: 'bg-amber-500/10 text-amber-400',
    owner_key_received:    'bg-violet-500/10 text-violet-400',
    authorized:            'bg-emerald-500/10 text-emerald-400',
    retired:               'bg-slate-800 text-slate-600',
    invite_imported:       'bg-sky-500/10 text-sky-400',
    access_request_sent:   'bg-amber-500/10 text-amber-400',
    sftp_verified:         'bg-violet-500/10 text-violet-400',
    repo_connected:        'bg-emerald-500/10 text-emerald-400',
    error:                 'bg-red-500/10 text-red-400',
  };
  const labels: Record<string, string> = {
    draft:                 'Draft',
    space_planned:         'Space planned',
    waiting_for_owner_key: 'Waiting for key',
    owner_key_received:    'Key received',
    authorized:            'Authorized',
    retired:               'Retired',
    invite_imported:       'Invite imported',
    access_request_sent:   'Request sent',
    sftp_verified:         'SFTP verified',
    repo_connected:        'Repo connected',
    error:                 'Error',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cfg[status] ?? cfg.draft}`}>
      {labels[status] ?? status}
    </span>
  );
}

function SectionCard({
  id, title, icon, active, onOpen, children,
}: {
  id: Section; title: string; icon: React.ReactNode;
  active: boolean; onOpen: (id: Section) => void; children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <button onClick={() => onOpen(id)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/40">
        {icon}
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</span>
        {active ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
      </button>
      {active && <div className="space-y-4 border-t border-slate-800 p-4">{children}</div>}
    </div>
  );
}

function CommandStepCard({ step, index }: { step: HostSetupStep; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded border border-slate-800 bg-slate-950 p-2">
      <summary className="cursor-pointer text-xs text-slate-300">
        {index + 1}. {step.label}{step.requires_root ? <span className="ml-2 rounded bg-amber-500/10 px-1 text-amber-400">root</span> : null}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-sky-300/80">{step.display_command}</pre>
      {step.note && <p className="mt-2 text-xs text-slate-500">{step.note}</p>}
    </details>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function PeerConnection() {
  const { wizardConfigs, masterPasswordSet, updateRemoteRepositoryState, refreshReadiness } = useApp();
  const [params, setParams] = useSearchParams();
  const initialSection = (params.get('section') as Section | null) ?? 'network';
  const [openSection, setOpenSection] = useState<Section>(
    ['network', 'host', 'owner', 'advanced'].includes(initialSection) ? initialSection : 'network',
  );

  const sourceFolders = wizardConfigs.flatMap(c => c.source_folders);

  // ── Persisted state ───────────────────────────────────────────────────────
  const [hostAllocations, setHostAllocations] = useState<HostAllocation[]>([]);
  const [backupTargets, setBackupTargets] = useState<BackupTarget[]>([]);
  const [ownerSshKeys, setOwnerSshKeys] = useState<OwnerSshKey[]>([]);

  // ── Network section ───────────────────────────────────────────────────────
  const [tailscale, setTailscale] = useState<TailscaleDetail | null>(null);
  const [loadingNetwork, setLoadingNetwork] = useState(false);
  const [peerToPing, setPeerToPing] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<TailscalePingResult | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<TailscaleConnectResult | null>(null);

  // ── Host Spaces section ───────────────────────────────────────────────────
  const [hostConnectionName, setHostConnectionName] = useState('');
  const [hostMatchId, setHostMatchId] = useState(() => genMatchId());
  const [hostPath, setHostPath] = useState('');
  const [hostQuota, setHostQuota] = useState('500');
  const [hostUser, setHostUser] = useState('');
  const [hostPort, setHostPort] = useState('22');
  const [hostOverlay, setHostOverlay] = useState('');
  const [hostPlan, setHostPlan] = useState<HostSetupPlan | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [generatingHost, setGeneratingHost] = useState(false);

  // Import owner access request for a specific host allocation
  const [importingForAlloc, setImportingForAlloc] = useState<string | null>(null);
  const [accessRequestText_, setAccessRequestText_] = useState('');
  const [accessRequestError, setAccessRequestError] = useState<string | null>(null);
  const [authorizePlan, setAuthorizePlan] = useState<HostSetupStep[] | null>(null);
  const [generatingAuth, setGeneratingAuth] = useState(false);

  // ── Backup Targets section ────────────────────────────────────────────────
  const [ownerConnectionName, setOwnerConnectionName] = useState('');
  const [ownerMatchId, setOwnerMatchId] = useState('');
  const [ownerKeyError, setOwnerKeyError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [manualPrivateKey, setManualPrivateKey] = useState('');
  const [manualPublicKey, setManualPublicKey] = useState('');
  const [bundlePasteText, setBundlePasteText] = useState('');
  const [bundle, setBundle] = useState<PeerBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [probeResult, setProbeResult] = useState<RemoteTargetProbeResponse | null>(null);
  const [verifyResult, setVerifyResult] = useState<SftpVerifyResult | null>(null);
  const [initResult, setInitResult] = useState<SftpRepositoryInitResult | null>(null);
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);

  // ── Per-allocation expand state (Show commands) ───────────────────────────
  const [expandedAllocCommands, setExpandedAllocCommands] = useState<Set<string>>(new Set());

  // ── Per-target independent action state ───────────────────────────────────
  const [targetBusy, setTargetBusy] = useState<Record<string, string | null>>({});
  const [targetPingResults, setTargetPingResults] = useState<Record<string, TailscalePingResult>>({});
  const [targetProbeResults, setTargetProbeResults] = useState<Record<string, RemoteTargetProbeResponse>>({});
  const [targetVerifyResults, setTargetVerifyResults] = useState<Record<string, SftpVerifyResult>>({});
  const [targetInitResults, setTargetInitResults] = useState<Record<string, SftpRepositoryInitResult>>({});

  const tailscaleLocalRef = useRef('');

  function setSection(section: Section) {
    setOpenSection(section);
    setParams({ section });
  }

  async function refreshTailscale() {
    setLoadingNetwork(true);
    try {
      const detail = await getTailscaleDetail();
      setTailscale(detail);
      const local = detail.self_dns_name ?? detail.self_ips[0] ?? '';
      if (local) {
        tailscaleLocalRef.current = local;
        if (!hostOverlay) setHostOverlay(local);
      }
    } finally {
      setLoadingNetwork(false);
    }
  }

  useEffect(() => {
    loadPersistedConfig().then(saved => {
      setHostAllocations(saved.hostAllocations ?? []);
      setBackupTargets(saved.backupTargets ?? []);
      setOwnerSshKeys(saved.ownerSshKeys ?? []);
      if (saved.overlayMeta?.local_address && !hostOverlay) setHostOverlay(saved.overlayMeta.local_address);
    }).catch(() => {});
    void refreshTailscale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(next: Partial<{
    hostAllocations: HostAllocation[];
    backupTargets: BackupTarget[];
    ownerSshKeys: OwnerSshKey[];
  }>) {
    await savePersistedConfig(next);
  }

  // ── Host Spaces handlers ──────────────────────────────────────────────────

  function hostPathOverlapError(): string | null {
    const path = hostPath.trim();
    if (!path) return null;
    if (sourceFolders.some(s => path === s || path.startsWith(`${s}/`) || s.startsWith(`${path}/`)))
      return 'Hosted path must not overlap any source folder.';
    if (hostAllocations.some(a => {
      if (a.id === `host-${hostMatchId}`) return false; // editing same
      return path === a.hosted_path || path.startsWith(`${a.hosted_path}/`) || a.hosted_path.startsWith(`${path}/`);
    })) return 'Hosted path must not overlap another hosted allocation.';
    return null;
  }

  async function generateHostPlan() {
    setHostError(null);
    setHostPlan(null);
    // Fast UI pre-check (convenience only — backend is source of truth)
    const overlap = hostPathOverlapError();
    if (overlap) { setHostError(overlap); return; }
    if (!hostConnectionName.trim()) { setHostError('Connection name is required.'); return; }
    if (!hostMatchId.trim()) { setHostError('Match ID is required.'); return; }
    if (!hostPath.trim()) { setHostError('Hosted storage path is required.'); return; }
    if (!hostOverlay.trim()) { setHostError('This device Tailscale address is required.'); return; }
    setGeneratingHost(true);
    try {
      // Other active allocation paths (excluding this one if editing)
      const currentId = `host-${hostMatchId.trim()}`;
      const otherHostedPaths = hostAllocations
        .filter(a => a.id !== currentId && a.status !== 'retired')
        .map(a => a.hosted_path)
        .filter(Boolean);

      const plan = await planHostSetup({
        connection_name: hostConnectionName.trim(),
        hosted_path: hostPath.trim(),
        quota_gb: parseInt(hostQuota, 10) || 0,
        match_id: hostMatchId.trim(),
        sftp_username: hostUser.trim(),
        sftp_port: parseInt(hostPort, 10) || 22,
        owner_public_key: '',
        source_folders: sourceFolders,
        overlay_provider: 'tailscale',
        existing_hosted_paths: otherHostedPaths,
      }, hostOverlay.trim());
      setHostPlan(plan);
      const alloc: HostAllocation = {
        id: currentId,
        connection_name: hostConnectionName.trim(),
        match_id: hostMatchId.trim(),
        hosted_path: hostPath.trim(),
        quota_gb: parseInt(hostQuota, 10) || 0,
        sftp_username: plan.owner_bundle.sftp_username,
        sftp_port: parseInt(hostPort, 10) || 22,
        overlay_host: hostOverlay.trim(),
        owner_public_key: '',
        status: 'space_planned',
        host_invite_bundle: bundleText(plan),
        setup_steps: plan.steps,
        owner_bundle: plan.owner_bundle,
      };
      const next = [...hostAllocations.filter(a => a.id !== currentId), alloc];
      setHostAllocations(next);
      await persist({ hostAllocations: next });
    } catch (e: unknown) {
      setHostError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingHost(false);
    }
  }

  function resetHostForm() {
    setHostConnectionName('');
    setHostMatchId(genMatchId());
    setHostPath('');
    setHostQuota('500');
    setHostUser('');
    setHostPort('22');
    setHostPlan(null);
    setHostError(null);
  }

  async function importAccessRequestForAlloc(alloc: HostAllocation) {
    setAccessRequestError(null);
    const req = parseAccessRequest(accessRequestText_);
    if (!req) { setAccessRequestError('Could not parse access request — expected match_id and public_key lines.'); return; }
    if (req.match_id !== alloc.match_id) { setAccessRequestError(`Match ID mismatch: expected "${alloc.match_id}", got "${req.match_id}".`); return; }
    // Store the key and update status
    const updated: HostAllocation = { ...alloc, owner_public_key: req.public_key, status: 'owner_key_received' };
    const next = hostAllocations.map(a => a.id === alloc.id ? updated : a);
    setHostAllocations(next);
    await persist({ hostAllocations: next });
    // Generate authorization plan
    setGeneratingAuth(true);
    setAuthorizePlan(null);
    try {
      const steps = await generateAuthorizeOwnerKeyPlan(alloc.sftp_username, req.public_key, alloc.sftp_port);
      setAuthorizePlan(steps);
    } catch (e: unknown) {
      setAccessRequestError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingAuth(false);
    }
  }

  async function markAuthorized(alloc: HostAllocation) {
    const updated: HostAllocation = { ...alloc, status: 'authorized' };
    const next = hostAllocations.map(a => a.id === alloc.id ? updated : a);
    setHostAllocations(next);
    await persist({ hostAllocations: next });
    setImportingForAlloc(null);
    setAuthorizePlan(null);
    setAccessRequestText_('');
  }

  async function deleteHostAlloc(id: string) {
    const next = hostAllocations.filter(a => a.id !== id);
    setHostAllocations(next);
    await persist({ hostAllocations: next });
  }

  async function retireHostAlloc(id: string) {
    const next = hostAllocations.map(a =>
      a.id === id ? { ...a, status: 'retired' as HostAllocationStatus } : a,
    );
    setHostAllocations(next);
    await persist({ hostAllocations: next });
  }

  function editHostAlloc(alloc: HostAllocation) {
    setHostConnectionName(alloc.connection_name);
    setHostMatchId(alloc.match_id);
    setHostPath(alloc.hosted_path);
    setHostQuota(String(alloc.quota_gb));
    setHostUser(alloc.sftp_username.startsWith('nasbb-') ? '' : alloc.sftp_username);
    setHostPort(String(alloc.sftp_port));
    setHostOverlay(alloc.overlay_host);
    setHostPlan(null);
    setHostError(null);
    // Restore persisted plan if available — use the saved owner_bundle so bundleText is correct.
    if (alloc.setup_steps && alloc.setup_steps.length > 0 && alloc.owner_bundle) {
      setHostPlan({ steps: alloc.setup_steps, platform: '', owner_bundle: alloc.owner_bundle });
    }
  }

  // ── Backup Targets handlers ───────────────────────────────────────────────

  async function generateKey() {
    if (!ownerMatchId.trim()) return;
    setGeneratingKey(true);
    setOwnerKeyError(null);
    try {
      const key = await generateOwnerSshKey(ownerMatchId.trim());
      const normalized: OwnerSshKey = {
        match_id: key.match_id,
        public_key: key.public_key,
        fingerprint: key.fingerprint,
        private_key_path_or_ref: key.private_key_path_or_ref,
      };
      const next = [...ownerSshKeys.filter(k => k.match_id !== normalized.match_id), normalized];
      setOwnerSshKeys(next);
      setManualPublicKey(normalized.public_key);
      setSshKeyPath(normalized.private_key_path_or_ref);
      await persist({ ownerSshKeys: next });
    } catch (e: unknown) {
      setOwnerKeyError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingKey(false);
    }
  }

  async function chooseExistingKey() {
    const selected = await pickFile();
    if (selected) { setManualPrivateKey(selected); setSshKeyPath(selected); }
  }

  async function saveManualKey() {
    if (!ownerMatchId.trim() || !manualPublicKey.trim()) return;
    const key: OwnerSshKey = {
      match_id: ownerMatchId.trim(),
      public_key: manualPublicKey.trim(),
      fingerprint: 'manual-import',
      private_key_path_or_ref: manualPrivateKey.trim(),
    };
    const next = [...ownerSshKeys.filter(k => k.match_id !== key.match_id), key];
    setOwnerSshKeys(next);
    await persist({ ownerSshKeys: next });
  }

  async function importBundle() {
    setBundleError(null);
    try {
      const parsed = await parseOwnerBundle(bundlePasteText);
      setBundle(parsed);
      setOwnerMatchId(parsed.match_id);
      setOwnerConnectionName(parsed.connection_name ?? parsed.match_id);
      setPeerToPing(parsed.overlay_host);
      const matchingKey = ownerSshKeys.find(k => k.match_id === parsed.match_id);
      if (matchingKey) setSshKeyPath(matchingKey.private_key_path_or_ref);
    } catch (e: unknown) {
      setBundleError(e instanceof Error ? e.message : String(e));
    }
  }

  async function probeOwnerTarget() {
    if (!bundle) return;
    setOwnerBusy('probe');
    try {
      const result = await probeRemoteTarget(bundle.overlay_host, bundle.sftp_port);
      setProbeResult(result);
      updateRemoteRepositoryState(result.status === 'tcp_port_reachable' ? 'reachable' : result.status, result.status === 'tcp_port_reachable' ? 0 : -1);
    } finally { setOwnerBusy(null); }
  }

  async function verifyOwnerTarget() {
    if (!bundle) return;
    setOwnerBusy('verify');
    try {
      const result = await verifySftpTarget(bundle.overlay_host, bundle.sftp_port, bundle.sftp_user, bundle.sftp_path, sshKeyPath.trim() || null);
      setVerifyResult(result);
      updateRemoteRepositoryState(result.status === 'ok' ? 'reachable' : result.status, result.status === 'ok' ? 0 : -1);
      if (result.status === 'ok') {
        upsertTarget(bundle, 'sftp_verified');
      }
    } finally { setOwnerBusy(null); }
  }

  async function connectRepository() {
    if (!bundle) return;
    setOwnerBusy('connect');
    try {
      const result = await initializeKopiaSftpRepository(bundle.overlay_host, bundle.sftp_user, bundle.sftp_path, bundle.sftp_port, sshKeyPath.trim() || null);
      setInitResult(result);
      if (result.initialized) {
        updateRemoteRepositoryState('reachable', 0);
        refreshReadiness();
        upsertTarget(bundle, 'repo_connected');
      }
    } finally { setOwnerBusy(null); }
  }

  function upsertTarget(b: PeerBundle, status: BackupTargetStatus) {
    const activeKey = ownerSshKeys.find(k => k.match_id === b.match_id);
    const id = `target-${b.match_id}`;
    const target: BackupTarget = {
      id,
      connection_name: ownerConnectionName || b.connection_name || b.match_id,
      match_id: b.match_id,
      overlay_host: b.overlay_host,
      sftp_user: b.sftp_user,
      sftp_port: b.sftp_port,
      sftp_path: b.sftp_path,
      quota_gb: b.quota_gb,
      ssh_key_ref: sshKeyPath,
      public_key: activeKey?.public_key ?? manualPublicKey,
      public_key_fingerprint: activeKey?.fingerprint ?? '',
      status,
      verify_status: verifyResult?.status ?? 'not_verified',
      repo_init_status: status === 'repo_connected' ? 'connected' : 'pending',
    };
    const next = [...backupTargets.filter(t => t.id !== id), target];
    setBackupTargets(next);
    persist({ backupTargets: next });
  }

  async function deleteTarget(id: string) {
    const next = backupTargets.filter(t => t.id !== id);
    setBackupTargets(next);
    await persist({ backupTargets: next });
  }

  async function retireTarget(id: string) {
    const next = backupTargets.map(t =>
      t.id === id ? { ...t, status: 'retired' as BackupTargetStatus } : t,
    );
    setBackupTargets(next);
    await persist({ backupTargets: next });
  }

  function editTarget(t: BackupTarget) {
    setOwnerConnectionName(t.connection_name);
    setOwnerMatchId(t.match_id);
    setSshKeyPath(t.ssh_key_ref);
    setManualPublicKey(t.public_key);
    setBundle({
      overlay_provider: 'tailscale',
      overlay_host: t.overlay_host,
      sftp_user: t.sftp_user,
      sftp_port: t.sftp_port,
      sftp_path: t.sftp_path,
      quota_gb: t.quota_gb,
      match_id: t.match_id,
      connection_name: t.connection_name,
      host_key_fingerprint_note: '',
      compatibility_note: '',
    });
    setPeerToPing(t.overlay_host);
    setSection('owner');
  }

  // Per-target actions — operate on the saved target directly, not the global form state.

  async function pingTargetById(t: BackupTarget) {
    setTargetBusy(p => ({ ...p, [t.id]: 'ping' }));
    try {
      const r = await tailscalePingPeer(t.overlay_host);
      setTargetPingResults(p => ({ ...p, [t.id]: r }));
    } finally { setTargetBusy(p => ({ ...p, [t.id]: null })); }
  }

  async function probeTargetById(t: BackupTarget) {
    setTargetBusy(p => ({ ...p, [t.id]: 'probe' }));
    try {
      const r = await probeRemoteTarget(t.overlay_host, t.sftp_port);
      setTargetProbeResults(p => ({ ...p, [t.id]: r }));
    } finally { setTargetBusy(p => ({ ...p, [t.id]: null })); }
  }

  async function verifySftpById(t: BackupTarget) {
    setTargetBusy(p => ({ ...p, [t.id]: 'verify' }));
    try {
      const r = await verifySftpTarget(t.overlay_host, t.sftp_port, t.sftp_user, t.sftp_path, t.ssh_key_ref || null);
      setTargetVerifyResults(p => ({ ...p, [t.id]: r }));
      if (r.status === 'ok') {
        const next = backupTargets.map(bt =>
          bt.id === t.id ? { ...bt, status: 'sftp_verified' as BackupTargetStatus, verify_status: r.status } : bt,
        );
        setBackupTargets(next);
        await persist({ backupTargets: next });
      }
    } finally { setTargetBusy(p => ({ ...p, [t.id]: null })); }
  }

  async function connectRepoById(t: BackupTarget) {
    setTargetBusy(p => ({ ...p, [t.id]: 'connect' }));
    try {
      const r = await initializeKopiaSftpRepository(t.overlay_host, t.sftp_user, t.sftp_path, t.sftp_port, t.ssh_key_ref || null);
      setTargetInitResults(p => ({ ...p, [t.id]: r }));
      if (r.initialized) {
        const next = backupTargets.map(bt =>
          bt.id === t.id ? { ...bt, status: 'repo_connected' as BackupTargetStatus, repo_init_status: 'connected' } : bt,
        );
        setBackupTargets(next);
        updateRemoteRepositoryState('reachable', 0);
        refreshReadiness();
        await persist({ backupTargets: next });
      }
    } finally { setTargetBusy(p => ({ ...p, [t.id]: null })); }
  }

  function targetAccessRequest(t: BackupTarget): OwnerAccessRequest | null {
    if (!t.public_key) return null;
    const key = ownerSshKeys.find(k => k.match_id === t.match_id);
    return {
      match_id: t.match_id,
      connection_name: t.connection_name,
      public_key: t.public_key,
      fingerprint: key?.fingerprint ?? (t.public_key_fingerprint || 'see key ref'),
    };
  }

  function resetOwnerForm() {
    setOwnerConnectionName('');
    setOwnerMatchId('');
    setBundlePasteText('');
    setBundle(null);
    setBundleError(null);
    setProbeResult(null);
    setVerifyResult(null);
    setInitResult(null);
    setSshKeyPath('');
    setManualPublicKey('');
    setManualPrivateKey('');
  }

  const activeKey = ownerSshKeys.find(k => k.match_id === ownerMatchId.trim());
  const canVerifyOwner = !!bundle && !!sshKeyPath.trim();
  const accessRequest: OwnerAccessRequest | null = (bundle && (activeKey || manualPublicKey)) ? {
    match_id: bundle.match_id,
    connection_name: ownerConnectionName || bundle.match_id,
    public_key: activeKey?.public_key ?? manualPublicKey,
    fingerprint: activeKey?.fingerprint ?? 'manual-import',
  } : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Network size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Peer Connection</h1>
        <span className="text-xs text-slate-500">Tailscale + host spaces + backup targets</span>
      </div>

      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-300/80">
        Set up the private overlay path first, then choose what this machine does:
        offer encrypted storage to a peer (Host Spaces), back up to a peer (Backup Targets), or both.
      </div>

      {/* ── 1. Network Status ────────────────────────────────────────────── */}
      <SectionCard id="network" title="1. Network Status" icon={<Wifi size={14} className="text-sky-400" />} active={openSection === 'network'} onOpen={setSection}>
        <div className="flex items-start justify-between gap-3 rounded border border-slate-800 bg-slate-950 p-3">
          <div className="space-y-1 text-xs">
            <div className={tailscale?.setup_state === 'ready' ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
              {loadingNetwork ? 'Detecting Tailscale…' : tailscale?.status_message ?? 'Not checked yet.'}
            </div>
            <div className="text-slate-500 space-y-0.5">
              {tailscale?.cli_path && <div>CLI: <code>{tailscale.cli_path}</code>{tailscale.on_path && <span className="ml-1 text-emerald-500/70">(on PATH)</span>}</div>}
              {tailscale?.self_dns_name && <div>MagicDNS: <code className="text-sky-300/70">{tailscale.self_dns_name}</code></div>}
              {tailscale?.self_ips[0] && <div>IP: <code className="text-sky-300/70">{tailscale.self_ips[0]}</code></div>}
              {tailscale?.tailnet_name && <div>Tailnet: <code>{tailscale.tailnet_name}</code></div>}
              {tailscale?.peer_count ? <div>Peers visible: {tailscale.peer_count}</div> : null}
              {tailscale?.last_checked_at && <div className="text-slate-600">Last checked: {tailscale.last_checked_at}</div>}
            </div>
          </div>
          <button onClick={refreshTailscale} disabled={loadingNetwork} className="flex items-center gap-1 rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40 flex-shrink-0">
            <RefreshCw size={11} className={loadingNetwork ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {tailscale?.setup_state !== 'ready' && tailscale?.setup_state !== undefined && (
          <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/80 space-y-2">
            <div className="font-medium">Tailscale is not ready</div>
            {tailscale.setup_state === 'not_installed' && <p>Install from <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-sky-400 underline">tailscale.com/download</a> and sign in via the app.</p>}
            {tailscale.setup_state === 'installed_needs_login' && <p>Tailscale is installed but not connected. Click Connect to run <code>tailscale up</code> and bring the overlay online.</p>}
            {tailscale.setup_state === 'installed_cli_not_accessible' && <p>Tailscale CLI is not on PATH. Use Preferences → "Install CLI" or create a symlink, then Refresh.</p>}
            {(tailscale.setup_state === 'installed_needs_login' || tailscale.setup_state === 'error') && tailscale.cli_accessible && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  disabled={connecting}
                  onClick={async () => {
                    setConnecting(true);
                    setConnectResult(null);
                    try {
                      const r = await tailscaleConnect();
                      setConnectResult(r);
                      if (r.success) await refreshTailscale();
                    } finally { setConnecting(false); }
                  }}
                  className="flex items-center gap-1 rounded bg-sky-700 px-3 py-1.5 text-xs text-white hover:bg-sky-600 disabled:opacity-40"
                >
                  {connecting ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />}
                  {connecting ? 'Connecting…' : 'Connect (tailscale up)'}
                </button>
                {connectResult && (
                  <span className={`text-xs ${connectResult.success ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {connectResult.message}
                    {connectResult.needs_auth && connectResult.auth_url && (
                      <span> — <a href={connectResult.auth_url} target="_blank" rel="noreferrer" className="text-sky-400 underline">authenticate</a></span>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Peer Tailscale address to test" value={peerToPing} onChange={setPeerToPing} placeholder="peer.tailnet.ts.net or 100.x.x.x" />
          </div>
          <button
            disabled={!peerToPing.trim() || pinging || !tailscale?.cli_accessible}
            onClick={async () => {
              setPinging(true); setPingResult(null);
              try { setPingResult(await tailscalePingPeer(peerToPing.trim())); } finally { setPinging(false); }
            }}
            className="mt-5 flex h-8 items-center justify-center gap-1 rounded bg-sky-700 text-xs text-white hover:bg-sky-600 disabled:opacity-40"
          >
            {pinging ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />} Tailscale ping
          </button>
        </div>
        {pingResult && (
          <div className={`rounded border p-2 text-xs ${pingResult.reachable ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
            {pingResult.message}
            {pingResult.latency_ms != null && <span className="ml-2 text-slate-500">{pingResult.latency_ms} ms</span>}
            {pingResult.via && <span className="ml-2 text-slate-500">via {pingResult.via}</span>}
          </div>
        )}
      </SectionCard>

      {/* ── 2. Host Spaces ───────────────────────────────────────────────── */}
      <SectionCard id="host" title="2. Host Spaces" icon={<Server size={14} className="text-violet-400" />} active={openSection === 'host'} onOpen={setSection}>
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 text-xs text-violet-300/80">
          Allocate space for a peer without needing their SSH key upfront. Generate a Host Invite Bundle, send it to the data owner, then import their Access Request to authorize their key.
        </div>

        {/* Host space form */}
        <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">New Host Space</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Connection name *" value={hostConnectionName} onChange={setHostConnectionName} placeholder="e.g. Alice's backup" hint="Human-readable label for this peer." />
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-300">Match ID</label>
              <div className="flex gap-2">
                <input value={hostMatchId} readOnly className="flex-1 rounded border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-400 opacity-70" />
                <button onClick={() => setHostMatchId(genMatchId())} className="rounded bg-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-600" title="Regenerate">↺</button>
                <CopyButton text={hostMatchId} />
              </div>
              <p className="text-xs text-slate-600">Auto-generated stable identifier.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-medium text-slate-300">Hosted storage path *</label>
              <div className="flex gap-2">
                <input value={hostPath} onChange={e => setHostPath(e.target.value)} placeholder="/mnt/nasbb/match-abc123" className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-200" />
                <button onClick={async () => { const d = await pickDirectory(); if (d) setHostPath(d); }} className="flex items-center gap-1 rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"><HardDrive size={11} /> Browse</button>
              </div>
              <p className="text-xs text-slate-600">Must not overlap source folders or another hosted allocation.</p>
            </div>
            <Field label="Quota (GB)" value={hostQuota} onChange={setHostQuota} placeholder="500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="This device Tailscale address *" value={hostOverlay} onChange={setHostOverlay} placeholder="this-device.tailnet.ts.net" /></div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="SFTP username" value={hostUser} onChange={setHostUser} placeholder="auto" hint="Optional." />
              <Field label="SFTP port" value={hostPort} onChange={setHostPort} placeholder="22" />
            </div>
          </div>
          {hostError && <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">{hostError}</div>}
          <button disabled={generatingHost} onClick={generateHostPlan} className="w-full rounded bg-violet-700 px-4 py-2 text-xs text-white hover:bg-violet-600 disabled:opacity-40">
            {generatingHost ? 'Generating…' : 'Generate Host Space Plan'}
          </button>
        </div>

        {/* Generated plan + invite bundle */}
        {hostPlan && (
          <div className="space-y-3">
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300/80">
              Review these display-only commands before running them as admin/root.
            </div>
            {hostPlan.steps.map((step, i) => <CommandStepCard key={i} step={step} index={i} />)}
            <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-300">Host Invite Bundle</span>
                <CopyButton text={bundleText(hostPlan)} label="Copy bundle" />
              </div>
              <p className="text-xs text-slate-500">Send this to the data owner. Contains no secrets.</p>
              <pre className="whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-sky-300/80">{bundleText(hostPlan)}</pre>
            </div>
            <button onClick={resetHostForm} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
              <Plus size={11} /> Add another host space
            </button>
          </div>
        )}

        {/* Saved host allocations */}
        {hostAllocations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Host Spaces</h3>
            {hostAllocations.map(alloc => (
              <div key={alloc.id} className={`rounded border bg-slate-950 p-3 space-y-2 ${alloc.status === 'retired' ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-slate-200">{alloc.connection_name || alloc.match_id}</span>
                      <StatusBadge status={alloc.status} />
                    </div>
                    <div className="text-xs text-slate-500">
                      <code>{alloc.match_id}</code> · {alloc.quota_gb} GB · <code>{alloc.hosted_path}</code>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 flex-shrink-0 justify-end">
                    <CopyButton text={alloc.host_invite_bundle} label="Invite" />
                    {(alloc.setup_steps?.length ?? 0) > 0 && (
                      <button
                        onClick={() => setExpandedAllocCommands(prev => {
                          const next = new Set(prev);
                          if (next.has(alloc.id)) { next.delete(alloc.id); } else { next.add(alloc.id); }
                          return next;
                        })}
                        className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
                      >
                        {expandedAllocCommands.has(alloc.id) ? 'Hide commands' : 'Show commands'}
                      </button>
                    )}
                    <button onClick={() => { setImportingForAlloc(a => a === alloc.id ? null : alloc.id); setAccessRequestText_(''); setAccessRequestError(null); setAuthorizePlan(null); }}
                      className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">
                      {importingForAlloc === alloc.id ? 'Cancel' : 'Import Access Request'}
                    </button>
                    {alloc.status === 'owner_key_received' && authorizePlan && importingForAlloc === alloc.id && (
                      <button onClick={() => markAuthorized(alloc)} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600">
                        Mark authorized
                      </button>
                    )}
                    <button onClick={() => editHostAlloc(alloc)} className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600" title="Load into form">
                      Edit
                    </button>
                    {alloc.status !== 'retired' && (
                      <button onClick={() => retireHostAlloc(alloc.id)} className="rounded px-2 py-1 text-xs text-slate-500 hover:text-amber-400" title="Retire">
                        Retire
                      </button>
                    )}
                    <button onClick={() => deleteHostAlloc(alloc.id)} className="rounded p-1 text-slate-600 hover:text-red-400" title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Show commands (persisted) */}
                {expandedAllocCommands.has(alloc.id) && (alloc.setup_steps?.length ?? 0) > 0 && (
                  <div className="border-t border-slate-800 pt-2 space-y-1">
                    <div className="text-xs text-slate-500 mb-1">Setup commands (review before running as admin):</div>
                    {alloc.setup_steps!.map((step, i) => <CommandStepCard key={i} step={step} index={i} />)}
                  </div>
                )}

                {/* Import owner access request */}
                {importingForAlloc === alloc.id && (
                  <div className="border-t border-slate-800 pt-2 space-y-2">
                    <p className="text-xs text-slate-500">
                      Paste the Owner Access Request sent by the data owner (match_id + public_key).
                    </p>
                    <textarea
                      rows={4}
                      value={accessRequestText_}
                      onChange={e => setAccessRequestText_(e.target.value)}
                      placeholder={'match_id:        match-abc123\nconnection_name: Their connection\npublic_key:      ssh-ed25519 AAAA...\nfingerprint:     SHA256:...'}
                      className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-200 resize-none"
                    />
                    {accessRequestError && <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">{accessRequestError}</div>}
                    <button
                      disabled={!accessRequestText_.trim() || generatingAuth}
                      onClick={() => importAccessRequestForAlloc(alloc)}
                      className="flex items-center gap-1 rounded bg-violet-700 px-3 py-1.5 text-xs text-white hover:bg-violet-600 disabled:opacity-40"
                    >
                      {generatingAuth ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                      {generatingAuth ? 'Generating…' : 'Import & Generate Authorize Plan'}
                    </button>

                    {authorizePlan && authorizePlan.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-emerald-300">
                          <CheckCircle size={12} /> Access request imported — run these steps to authorize the owner:
                        </div>
                        {authorizePlan.map((step, i) => <CommandStepCard key={i} step={step} index={i} />)}
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <Info size={11} /> After running the steps, click Mark authorized above.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 3. Backup Targets ────────────────────────────────────────────── */}
      <SectionCard id="owner" title="3. Backup Targets" icon={<ShieldCheck size={14} className="text-emerald-400" />} active={openSection === 'owner'} onOpen={setSection}>
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300/80">
          Generate your SSH key first, copy the Owner Access Request to the host, wait for them to authorize it, then proceed with SFTP verification and Kopia connect.
        </div>

        {/* Key generation */}
        <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">SSH Key for This Match</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Match ID (from the host's invite)" value={ownerMatchId} onChange={setOwnerMatchId} placeholder="match-abc123" /></div>
            <button disabled={!ownerMatchId.trim() || generatingKey} onClick={generateKey}
              className="mt-5 flex h-8 items-center justify-center gap-1 rounded bg-emerald-700 text-xs text-white hover:bg-emerald-600 disabled:opacity-40">
              {generatingKey ? <Loader2 size={11} className="animate-spin" /> : <KeyRound size={11} />} Generate key
            </button>
          </div>
          {ownerKeyError && <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300">{ownerKeyError}</div>}

          {(activeKey || manualPublicKey) && (
            <div className="rounded border border-slate-800 bg-slate-900 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-medium">Public key (share with host)</span>
                <CopyButton text={activeKey?.public_key ?? manualPublicKey} />
              </div>
              <code className="break-all text-sky-300/80 text-xs">{activeKey?.public_key ?? manualPublicKey}</code>
              {activeKey && <div className="text-slate-600">Private key ref: <code>{activeKey.private_key_path_or_ref}</code></div>}
            </div>
          )}

          <details className="rounded border border-slate-800 p-3">
            <summary className="cursor-pointer text-xs text-slate-500">Fallback: use an existing SSH key</summary>
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input value={manualPrivateKey} onChange={e => { setManualPrivateKey(e.target.value); setSshKeyPath(e.target.value); }} placeholder="/home/user/.ssh/id_ed25519"
                  className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-200" />
                <button onClick={chooseExistingKey} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200">Choose key</button>
              </div>
              <Field label="Public key" value={manualPublicKey} onChange={setManualPublicKey} placeholder="ssh-ed25519 AAAA..." textarea />
              <button onClick={saveManualKey} disabled={!ownerMatchId.trim() || !manualPublicKey.trim()}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40">Save key ref</button>
            </div>
          </details>
        </div>

        {/* Owner Access Request */}
        {accessRequest && (
          <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-violet-300">Owner Access Request</span>
              <CopyButton text={accessRequestText(accessRequest)} label="Copy request" />
            </div>
            <p className="text-xs text-slate-500">Send this to the Storage Host. They will import it and generate the authorization plan.</p>
            <pre className="whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-sky-300/80">{accessRequestText(accessRequest)}</pre>
          </div>
        )}

        {/* Import host invite bundle */}
        <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Import Host Invite Bundle</h3>
          <Field label="Paste Host Invite Bundle" value={bundlePasteText} onChange={setBundlePasteText}
            placeholder={'connection_name: Alice storage\nmatch_id:         match-abc123\noverlay_host:     host.tailnet.ts.net\n...'} textarea />
          <button onClick={importBundle} disabled={!bundlePasteText.trim()} className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
            Import bundle
          </button>
          {bundleError && <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">{bundleError}</div>}
        </div>

        {/* Connection actions */}
        {bundle && (
          <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">{ownerConnectionName || bundle.match_id}</span>
              <span className="text-slate-500"><code>{bundle.overlay_host}</code> · {bundle.sftp_user}:{bundle.sftp_path} · {bundle.quota_gb} GB</span>
            </div>
            <Field label="SSH private key path/ref" value={sshKeyPath} onChange={setSshKeyPath} placeholder="generated key path or SSH agent key" />

            {!masterPasswordSet && (
              <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300">
                <AlertTriangle size={11} /> Set Recovery Key before connecting the Kopia repository.
              </div>
            )}

            <div className="rounded border border-sky-500/15 bg-sky-500/5 p-2 text-xs text-sky-300/70">
              <Info size={11} className="inline mr-1" />
              Send the Owner Access Request above to the host and wait for authorization before running SFTP Verify.
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={probeOwnerTarget} disabled={ownerBusy === 'probe'}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40">
                {ownerBusy === 'probe' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}Probe TCP
              </button>
              <button onClick={verifyOwnerTarget} disabled={!canVerifyOwner || ownerBusy === 'verify'}
                className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white hover:bg-sky-600 disabled:opacity-40">
                {ownerBusy === 'verify' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}Verify SFTP
              </button>
              <button onClick={connectRepository} disabled={!canVerifyOwner || !masterPasswordSet || ownerBusy === 'connect'}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-40">
                {ownerBusy === 'connect' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}Create / connect Kopia repo
              </button>
            </div>

            {probeResult && <div className={`text-xs p-2 rounded border ${probeResult.status === 'tcp_port_reachable' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>TCP: {probeResult.message}</div>}
            {verifyResult && <div className={`text-xs p-2 rounded border ${verifyResult.status === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>SFTP: {verifyResult.message}</div>}
            {initResult && <div className={`text-xs p-2 rounded border ${initResult.initialized ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-red-500/20 bg-red-500/5 text-red-300'}`}>Kopia: {initResult.message}</div>}
          </div>
        )}

        {bundle && (
          <button onClick={resetOwnerForm} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
            <Plus size={11} /> Add another backup target
          </button>
        )}

        {/* Saved backup targets */}
        {backupTargets.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Backup Targets</h3>
            {backupTargets.map(t => {
              const busy = targetBusy[t.id] ?? null;
              const pingR = targetPingResults[t.id];
              const probeR = targetProbeResults[t.id];
              const verifyR = targetVerifyResults[t.id];
              const initR = targetInitResults[t.id];
              const req = targetAccessRequest(t);
              const canVerify = !!t.ssh_key_ref;
              return (
                <div key={t.id} className={`rounded border bg-slate-950 p-3 space-y-2 text-xs ${t.status === 'retired' ? 'border-slate-800/50 opacity-60' : 'border-slate-800'}`}>
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-200">{t.connection_name || t.match_id}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-slate-500"><code>{t.overlay_host}</code> · <code>{t.sftp_user}</code> · {t.quota_gb} GB</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {req && <CopyButton text={accessRequestText(req)} label="Access req" />}
                      <button onClick={() => editTarget(t)} className="rounded bg-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-600">Edit</button>
                      {t.status !== 'retired'
                        ? <button onClick={() => retireTarget(t.id)} className="rounded px-2 py-1 text-slate-500 hover:text-amber-400">Retire</button>
                        : <button onClick={() => deleteTarget(t.id)} className="rounded p-1 text-slate-600 hover:text-red-400"><Trash2 size={12} /></button>
                      }
                    </div>
                  </div>

                  {/* Action buttons — operate on saved target, not the global form */}
                  {t.status !== 'retired' && (
                    <div className="flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
                      <button onClick={() => pingTargetById(t)} disabled={busy === 'ping'}
                        className="rounded bg-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-600 disabled:opacity-40">
                        {busy === 'ping' ? <Loader2 size={10} className="animate-spin inline mr-1" /> : <Zap size={10} className="inline mr-1" />}Tailscale ping
                      </button>
                      <button onClick={() => probeTargetById(t)} disabled={busy === 'probe'}
                        className="rounded bg-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-600 disabled:opacity-40">
                        {busy === 'probe' ? <Loader2 size={10} className="animate-spin inline mr-1" /> : null}Probe TCP
                      </button>
                      <button onClick={() => verifySftpById(t)} disabled={!canVerify || busy === 'verify'}
                        className="rounded bg-sky-700 px-2 py-1 text-white hover:bg-sky-600 disabled:opacity-40">
                        {busy === 'verify' ? <Loader2 size={10} className="animate-spin inline mr-1" /> : null}Verify SFTP
                      </button>
                      <button onClick={() => connectRepoById(t)} disabled={!canVerify || !masterPasswordSet || busy === 'connect'}
                        className="rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-600 disabled:opacity-40" title={!masterPasswordSet ? 'Set Recovery Key first' : ''}>
                        {busy === 'connect' ? <Loader2 size={10} className="animate-spin inline mr-1" /> : null}Connect repo
                      </button>
                    </div>
                  )}

                  {/* Per-target results */}
                  {(pingR || probeR || verifyR || initR) && (
                    <div className="space-y-1 border-t border-slate-800 pt-1">
                      {pingR && <div className={`p-1.5 rounded border ${pingR.reachable ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
                        Ping: {pingR.message}{pingR.latency_ms != null && <span className="ml-2 text-slate-500">{pingR.latency_ms} ms</span>}
                      </div>}
                      {probeR && <div className={`p-1.5 rounded border ${probeR.status === 'tcp_port_reachable' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
                        TCP: {probeR.message}
                      </div>}
                      {verifyR && <div className={`p-1.5 rounded border ${verifyR.status === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
                        SFTP: {verifyR.message}
                      </div>}
                      {initR && <div className={`p-1.5 rounded border ${initR.initialized ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-red-500/20 bg-red-500/5 text-red-300'}`}>
                        Kopia: {initR.message}
                      </div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── 4. Advanced / Legacy ─────────────────────────────────────────── */}
      <SectionCard id="advanced" title="4. Advanced / Legacy" icon={<Info size={14} className="text-amber-400" />} active={openSection === 'advanced'} onOpen={setSection}>
        <div className="space-y-2 text-xs leading-relaxed text-slate-500">
          <p>Tailscale is the active v1 overlay path. <strong className="text-slate-400">Headscale, WireGuard, and custom addresses</strong> remain future/advanced options not exposed in this flow.</p>
          <p><strong className="text-slate-400">Syncthing</strong> is not the default v1 backup transport. Kopia over SFTP is the default path. Syncthing backend code remains for developer experiments only and is hidden from normal setup.</p>
        </div>
      </SectionCard>
    </div>
  );
}
