import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight, ClipboardPaste,
  Info, Loader2, Lock, RefreshCw, Server, Shield, ShieldCheck, Wifi, XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  initializeKopiaSftpRepository,
  parseOwnerBundle,
  planKopiaSftpRepository,
  probeRemoteTarget,
  verifySftpTarget,
} from '../lib/tauri-bridge';
import type { FingerprintStatus, RemoteTargetProbeResponse, SftpRepositoryInitResult, SftpVerifyResult, SftpVerifyStatus } from '../lib/types';
import { loadPersistedConfig, savePersistedConfig } from '../lib/persistence';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  tailscale: 'Tailscale',
  headscale: 'Headscale',
  wire_guard: 'WireGuard',
  custom_reachable_address: 'Custom address',
  not_configured: 'Not configured',
};

const OVERLAY_HOST_HINTS: Record<string, string> = {
  tailscale: 'Tailscale MagicDNS hostname (peer-name.tailnet.ts.net) or 100.x.x.x address.',
  headscale: 'Your peer\'s Headscale overlay address.',
  wire_guard: 'WireGuard tunnel IP (e.g. 10.99.0.x).',
  custom_reachable_address: 'The address your peer provided — ensure it\'s on a controlled private network.',
  not_configured: 'Your peer\'s overlay hostname or IP.',
};

function sftpVerifyStatusToHealth(status: SftpVerifyStatus): string {
  switch (status) {
    case 'ok': return 'reachable';
    case 'quota_warning': return 'quota_warning';
    case 'auth_failed': return 'auth_failed';
    case 'host_key_mismatch': return 'host_key_mismatch';
    case 'unreachable': return 'unreachable';
    case 'path_not_found': return 'error';
    case 'write_test_failed': return 'error';
    case 'error': return 'error';
    default: return 'error';
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function FingerprintBadge({ status }: { status: FingerprintStatus }) {
  const cfg: Record<FingerprintStatus, { cls: string; label: string }> = {
    new:           { cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20',          label: 'New — saved' },
    matching:      { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Fingerprint OK' },
    changed:       { cls: 'bg-red-500/10 text-red-400 border-red-500/20',           label: 'Fingerprint CHANGED' },
    not_available: { cls: 'bg-slate-800 text-slate-500 border-slate-700',           label: 'No fingerprint' },
  };
  const { cls, label } = cfg[status] ?? cfg.not_available;
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${cls}`}>{label}</span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, method }: { status: string; method?: string }) {
  const isTcpOnly = method === 'tcp_connect';

  const styles: Record<string, string> = {
    not_configured: 'bg-slate-800 text-slate-400 border-slate-700',
    tcp_port_reachable: isTcpOnly
      ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    reachable: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    unreachable: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    auth_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
    host_key_mismatch: 'bg-red-500/10 text-red-400 border-red-500/20',
    quota_warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    error: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    path_not_found: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    write_test_failed: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  const labels: Record<string, string> = {
    not_configured: 'Not configured',
    tcp_port_reachable: isTcpOnly ? 'TCP port open' : 'Reachable',
    reachable: 'Reachable',
    unreachable: 'Unreachable',
    auth_failed: 'Auth failed',
    host_key_mismatch: 'Host key mismatch',
    quota_warning: 'Quota warning',
    error: 'Error',
    ok: 'SFTP verified',
    path_not_found: 'Path not found',
    write_test_failed: 'Write test failed',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${styles[status] ?? styles.not_configured}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Field input ───────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text', hint, readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono ${readOnly ? 'opacity-60 cursor-default' : ''}`}
      />
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function PeerStorage() {
  const { wizardConfigs, masterPasswordSet, updateRemoteRepositoryState, refreshReadiness } = useApp();

  // Connection settings (pre-filled by bundle import or typed manually)
  const [overlayHost, setOverlayHost] = useState('');
  const [sftpUser, setSftpUser] = useState('');
  const [sftpPort, setSftpPort] = useState('22');
  const [sftpPath, setSftpPath] = useState('');
  const [sshKeyPath, setSshKeyPath] = useState('');

  // Bundle-derived metadata (non-secret, not needed for connection itself)
  const [overlayProvider, setOverlayProvider] = useState('not_configured');
  const [quotaGb, setQuotaGb] = useState(0);
  const [matchId, setMatchId] = useState('');
  const [hostKeyFingerprintNote, setHostKeyFingerprintNote] = useState('');
  const [compatibilityNote, setCompatibilityNote] = useState('');

  // Bundle import state
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleText, setBundleText] = useState('');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [bundleParsed, setBundleParsed] = useState(false);
  const [bundleParsing, setBundleParsing] = useState(false);

  // TCP probe state
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<RemoteTargetProbeResponse | null>(null);

  // SFTP verify state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SftpVerifyResult | null>(null);

  // Repository init state
  const [initializing, setInitializing] = useState(false);
  const [initResult, setInitResult] = useState<SftpRepositoryInitResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Planned commands
  const [commandPlan, setCommandPlan] = useState<{ label: string; display_command: string }[]>([]);

  const sourceCount = wizardConfigs.flatMap(c => c.source_folders).length;

  // Restore persisted bundle fields on mount; also prefill peer address from overlayMeta
  useEffect(() => {
    loadPersistedConfig().then(saved => {
      const b = saved.sftpBundleFields;
      if (b) {
        if (b.overlayHost) setOverlayHost(b.overlayHost);
        if (b.sftpUser) setSftpUser(b.sftpUser);
        if (b.sftpPort) setSftpPort(b.sftpPort);
        if (b.sftpPath) setSftpPath(b.sftpPath);
        if (b.overlayProvider) setOverlayProvider(b.overlayProvider);
        if (b.quotaGb) setQuotaGb(b.quotaGb);
        if (b.matchId) setMatchId(b.matchId);
        if (b.hostKeyFingerprintNote) setHostKeyFingerprintNote(b.hostKeyFingerprintNote);
        if (b.compatibilityNote) setCompatibilityNote(b.compatibilityNote);
        setBundleParsed(true);
      }
      // If overlay host is still empty after bundle restore, fill from overlayMeta
      const om = saved.overlayMeta;
      if (om?.peer_address && !b?.overlayHost) {
        setOverlayHost(om.peer_address);
      }
    }).catch(() => {});
  }, []);

  async function handleParseBundle() {
    if (!bundleText.trim()) return;
    setBundleError(null);
    setBundleParsed(false);
    setBundleParsing(true);
    try {
      const b = await parseOwnerBundle(bundleText.trim());
      setOverlayHost(b.overlay_host);
      setSftpUser(b.sftp_user);
      setSftpPort(String(b.sftp_port));
      setSftpPath(b.sftp_path);
      setOverlayProvider(b.overlay_provider);
      setQuotaGb(b.quota_gb);
      setMatchId(b.match_id);
      setHostKeyFingerprintNote(b.host_key_fingerprint_note);
      setCompatibilityNote(b.compatibility_note);
      setBundleParsed(true);
      // Reset probe/verify results when bundle changes
      setProbeResult(null);
      setVerifyResult(null);
      // Persist non-secret bundle fields
      await savePersistedConfig({
        sftpBundleFields: {
          overlayHost: b.overlay_host,
          sftpUser: b.sftp_user,
          sftpPort: String(b.sftp_port),
          sftpPath: b.sftp_path,
          overlayProvider: b.overlay_provider,
          quotaGb: b.quota_gb,
          matchId: b.match_id,
          hostKeyFingerprintNote: b.host_key_fingerprint_note,
          compatibilityNote: b.compatibility_note,
        },
      });
    } catch (e: unknown) {
      setBundleError(e instanceof Error ? e.message : String(e));
    } finally {
      setBundleParsing(false);
    }
  }

  async function handleProbe() {
    if (!overlayHost.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await probeRemoteTarget(overlayHost.trim(), parseInt(sftpPort) || 22);
      setProbeResult(result);
      const sharedStatus = result.status === 'tcp_port_reachable' ? 'reachable' : result.status;
      updateRemoteRepositoryState(sharedStatus, result.status === 'tcp_port_reachable' ? 0 : -1);
    } finally {
      setProbing(false);
    }
  }

  async function handleVerify() {
    if (!overlayHost.trim() || !sftpUser.trim() || !sftpPath.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await verifySftpTarget(
        overlayHost.trim(),
        parseInt(sftpPort) || 22,
        sftpUser.trim(),
        sftpPath.trim(),
        sshKeyPath.trim() || null,
      );
      setVerifyResult(result);
      const healthStatus = sftpVerifyStatusToHealth(result.status);
      updateRemoteRepositoryState(healthStatus, result.status === 'ok' ? 0 : -1);
    } finally {
      setVerifying(false);
    }
  }

  async function handleLoadPlan() {
    const plans = await planKopiaSftpRepository(
      overlayHost, sftpUser, sftpPath, parseInt(sftpPort) || 22, 'kopia',
    );
    setCommandPlan(plans);
  }

  async function handleConnect() {
    if (!overlayHost.trim() || !sftpUser.trim() || !sftpPath.trim()) return;
    setInitializing(true);
    setInitResult(null);
    setInitError(null);
    try {
      const result = await initializeKopiaSftpRepository(
        overlayHost.trim(),
        sftpUser.trim(),
        sftpPath.trim(),
        parseInt(sftpPort) || 22,
        sshKeyPath.trim() || null,
      );
      setInitResult(result);
      if (result.initialized) {
        updateRemoteRepositoryState('reachable', 0);
        refreshReadiness();
        await savePersistedConfig({ syncthingConfigured: false });
      }
    } catch (e: unknown) {
      setInitError(e instanceof Error ? e.message : String(e));
      updateRemoteRepositoryState('error', -1);
    } finally {
      setInitializing(false);
    }
  }

  const canConnect =
    overlayHost.trim() !== '' &&
    sftpUser.trim() !== '' &&
    sftpPath.trim() !== '' &&
    !initializing;

  const tcpProbeSucceeded = probeResult?.status === 'tcp_port_reachable';
  const sftpVerified = verifyResult?.status === 'ok';
  const sftpConnected = initResult?.initialized === true;

  const overlayHostHint = OVERLAY_HOST_HINTS[overlayProvider] ?? OVERLAY_HOST_HINTS['not_configured'];

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Server size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Peer Storage</h1>
        <span className="text-xs text-slate-500 ml-1">SFTP remote repository over overlay network</span>
      </div>

      {/* Architecture summary */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Shield size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-300/80 space-y-1 leading-relaxed">
          <p>
            <strong>Default v1 backup path.</strong> Kopia encrypts your data locally, then writes it
            directly to your matched peer&rsquo;s SFTP storage over a private overlay network
            (Tailscale, Headscale, or WireGuard). Your plaintext data never leaves your machine.
          </p>
          <p>
            The peer receives only encrypted blobs and cannot read filenames, contents, or your
            backup password.
          </p>
        </div>
      </div>

      {sourceCount === 0 && (
        <div className="flex items-center gap-2 p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
          <AlertTriangle size={12} className="flex-shrink-0" />
          No source folders configured. Complete the Setup Wizard first to select what to back up.
        </div>
      )}

      {/* ── Bundle Import ──────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setBundleOpen(v => !v)}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-slate-800/40 transition-colors"
        >
          <ClipboardPaste size={13} className="text-sky-400 flex-shrink-0" />
          <span className="flex-1 text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Import Owner Connection Bundle
          </span>
          {bundleParsed && !bundleOpen && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle size={11} /> Imported
            </span>
          )}
          {bundleOpen
            ? <ChevronDown size={12} className="text-slate-500" />
            : <ChevronRight size={12} className="text-slate-500" />}
        </button>

        {bundleOpen && (
          <div className="border-t border-slate-800 p-4 space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Paste the Owner Connection Bundle text your matched peer generated in their
              <strong className="text-slate-400"> Host Setup</strong> tab. All fields are
              non-secret — no passwords or private keys are in the bundle.
            </p>

            <textarea
              value={bundleText}
              onChange={e => { setBundleText(e.target.value); setBundleError(null); setBundleParsed(false); }}
              rows={8}
              placeholder={
                'overlay_provider: tailscale\n' +
                'overlay_host:     peer-name.tailnet.ts.net\n' +
                'sftp_user:        nasbb-match-abc123\n' +
                'sftp_port:        22\n' +
                'sftp_path:        /repository\n' +
                'quota_gb:         500\n' +
                'match_id:         match-abc123\n\n' +
                '# Verify via: ssh-keyscan -p 22 peer-name.tailnet.ts.net | ssh-keygen -lf -'
              }
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-700 focus:outline-none focus:border-sky-500 resize-none"
            />

            {bundleError && (
              <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
                <XCircle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{bundleError}</span>
              </div>
            )}

            {bundleParsed && !bundleError && (
              <div className="flex items-center gap-2 p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-300">
                <CheckCircle size={12} />
                Bundle imported — connection fields populated below.
                {matchId && <span className="text-emerald-400/70 ml-1">(match: {matchId})</span>}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={handleParseBundle}
                disabled={bundleParsing || !bundleText.trim()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white transition-colors"
              >
                {bundleParsing ? <Loader2 size={11} className="animate-spin" /> : <ClipboardPaste size={11} />}
                {bundleParsing ? 'Parsing…' : 'Parse and import'}
              </button>
              <span className="text-xs text-slate-600">
                Fields are validated and saved locally. Secrets are never in the bundle.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Connection settings ────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Overlay + SFTP Connection
          </h3>
          {overlayProvider !== 'not_configured' && (
            <span className="text-xs px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
              {PROVIDER_LABELS[overlayProvider] ?? overlayProvider}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field
              label="Overlay host / address"
              value={overlayHost}
              onChange={setOverlayHost}
              placeholder="peer-name.tailnet.example or 100.x.x.x"
              hint={overlayHostHint}
            />
          </div>
          <Field
            label="SFTP port"
            value={sftpPort}
            onChange={setSftpPort}
            placeholder="22"
            hint="Default is 22."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="SFTP username"
            value={sftpUser}
            onChange={setSftpUser}
            placeholder="nasbb-match-1"
            hint="Isolated account created by your peer."
          />
          <Field
            label="SFTP remote path"
            value={sftpPath}
            onChange={setSftpPath}
            placeholder="/srv/nasbb/matches/match-1/repository"
            hint="Quota-bound path on the peer."
          />
        </div>

        <Field
          label="SSH key file path (optional)"
          value={sshKeyPath}
          onChange={setSshKeyPath}
          placeholder="/home/user/.ssh/id_ed25519"
          hint="Path to your SSH private key. Leave blank to use the SSH agent. The key file is read locally — never sent to any server."
        />

        {/* Extra metadata from bundle */}
        {bundleParsed && (quotaGb > 0 || hostKeyFingerprintNote) && (
          <div className="space-y-2 pt-1 border-t border-slate-800">
            {quotaGb > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Info size={10} className="flex-shrink-0 text-sky-400/50" />
                <span>Quota allocated by peer: <strong className="text-slate-400">{quotaGb} GB</strong></span>
              </div>
            )}
            {hostKeyFingerprintNote && (
              <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-xs text-sky-300/70">
                <Info size={11} className="flex-shrink-0 mt-0.5" />
                <span>{hostKeyFingerprintNote}</span>
              </div>
            )}
            {compatibilityNote && (
              <div className="flex items-start gap-2 p-2 rounded border border-slate-700 bg-slate-800/40 text-xs text-slate-500">
                <Info size={10} className="flex-shrink-0 mt-0.5" />
                <span>{compatibilityNote}</span>
              </div>
            )}
          </div>
        )}

        {/* Security note */}
        <div className="flex items-start gap-2 p-2.5 rounded border border-slate-700 bg-slate-800/40 text-xs text-slate-500">
          <Lock size={11} className="flex-shrink-0 mt-0.5 text-sky-400/60" />
          <span>
            The SFTP username, remote path, and SSH key are used locally only.
            Your backup encryption password (set in Recovery Key) is passed to Kopia via environment
            variable — never included in command arguments or logs.
          </span>
        </div>
      </div>

      {/* ── Overlay/TCP Reachable probe ────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Overlay/TCP Reachable
          </h3>
          <button
            onClick={handleProbe}
            disabled={probing || !overlayHost.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 transition-colors"
          >
            {probing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {probing ? 'Probing…' : 'Probe TCP'}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Tests TCP connectivity to the overlay host on the SFTP port. No secrets are used.
          Confirms the overlay network is up and the TCP port is open.
          <strong className="text-slate-400"> SSH/SFTP authentication is not verified by this probe</strong> —
          use SFTP Verification below for a full auth check.
        </p>

        {probeResult && (
          <div className={`flex items-start gap-2.5 p-2.5 rounded border text-xs ${
            tcpProbeSucceeded
              ? 'border-sky-500/20 bg-sky-500/5 text-sky-300/80'
              : 'border-amber-500/20 bg-amber-500/5 text-amber-300/80'
          }`}>
            {tcpProbeSucceeded
              ? <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge status={probeResult.status} method={probeResult.method} />
                {probeResult.latency_ms != null && (
                  <span className="text-slate-500">{probeResult.latency_ms} ms</span>
                )}
                {probeResult.method === 'tcp_connect' && (
                  <span className="text-slate-600 italic">TCP only — SSH auth not checked</span>
                )}
              </div>
              <p className="text-slate-400">{probeResult.message}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── SFTP Verification ─────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            SFTP Verification
          </h3>
          <button
            onClick={handleVerify}
            disabled={verifying || !overlayHost.trim() || !sftpUser.trim() || !sftpPath.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white transition-colors"
          >
            {verifying ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
            {verifying ? 'Verifying…' : 'Verify SFTP'}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Uses the <code className="text-slate-400">sftp</code> CLI (part of openssh-client) to
          verify SSH authentication, confirm the remote path exists, and test write access by
          creating and removing a temporary directory.
          No backup password is used. SSH key is passed as a file path only.
        </p>

        <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-xs text-sky-300/70">
          <Info size={11} className="flex-shrink-0 mt-0.5" />
          <span>
            Uses native libssh2 — no external <code className="text-sky-200">sftp</code> binary required.
            On first connection the host key fingerprint is saved locally (TOFU).
            On repeat connections the fingerprint is compared — a change blocks the connection.
          </span>
        </div>

        {verifyResult && (
          <div className={`rounded border text-xs overflow-hidden ${
            sftpVerified || verifyResult.status === 'quota_warning'
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : verifyResult.status === 'auth_failed' || verifyResult.status === 'host_key_mismatch'
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}>
            {/* Main result row */}
            <div className="flex items-start gap-2.5 p-2.5">
              {sftpVerified || verifyResult.status === 'quota_warning'
                ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5 text-emerald-400" />
                : verifyResult.status === 'auth_failed' || verifyResult.status === 'host_key_mismatch'
                ? <XCircle size={13} className="flex-shrink-0 mt-0.5 text-red-400" />
                : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-400" />}
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={verifyResult.status} />
                  <FingerprintBadge status={verifyResult.fingerprint_status} />
                  {verifyResult.write_test_passed && (
                    <span className="text-emerald-400/70">Write test ✓</span>
                  )}
                </div>
                <p className={
                  sftpVerified || verifyResult.status === 'quota_warning'
                    ? 'text-emerald-300/80'
                    : verifyResult.status === 'auth_failed' || verifyResult.status === 'host_key_mismatch'
                    ? 'text-red-300/80'
                    : 'text-amber-300/80'
                }>{verifyResult.message}</p>
              </div>
            </div>

            {/* Fingerprint detail */}
            {verifyResult.host_fingerprint && (
              <div className="border-t border-slate-800/60 px-3 py-2 flex items-start gap-2 bg-slate-900/40">
                <ShieldCheck size={10} className="flex-shrink-0 mt-0.5 text-slate-500" />
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="text-slate-500">Host key fingerprint</div>
                  <code className="text-sky-300/70 text-xs break-all leading-relaxed">
                    {verifyResult.host_fingerprint}
                  </code>
                  {verifyResult.fingerprint_status === 'new' && (
                    <p className="text-slate-600">
                      First connection — fingerprint saved to local known-hosts file.
                      Verify out-of-band using:{' '}
                      <code className="text-slate-500">
                        ssh-keyscan -p {sftpPort} {overlayHost || 'HOST'} | ssh-keygen -lf - -E sha256
                      </code>
                    </p>
                  )}
                  {verifyResult.fingerprint_status === 'changed' && (
                    <p className="text-red-400/80 font-medium">
                      ⚠ Fingerprint differs from stored value. The host may have been rebuilt
                      or this could indicate a MITM attack. Verify the host identity out-of-band
                      before clearing the stored fingerprint.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Quota detail */}
            {verifyResult.free_bytes != null && (
              <div className="border-t border-slate-800/60 px-3 py-2 flex items-center gap-2 bg-slate-900/40">
                <Info size={10} className="flex-shrink-0 text-slate-500" />
                <span className="text-slate-500">
                  Remote free space:{' '}
                  <strong className={verifyResult.quota_warning ? 'text-amber-400' : 'text-slate-300'}>
                    {formatBytes(verifyResult.free_bytes)}
                  </strong>
                  {verifyResult.quota_warning && (
                    <span className="text-amber-400/80 ml-2">— below 1 GB, check quota with peer</span>
                  )}
                </span>
              </div>
            )}
            {verifyResult.free_bytes == null && (sftpVerified || verifyResult.status === 'quota_warning') && (
              <div className="border-t border-slate-800/60 px-3 py-2 flex items-center gap-2 bg-slate-900/40">
                <Info size={10} className="flex-shrink-0 text-slate-500" />
                <span className="text-slate-600">
                  Remote free space: not available (server does not support statvfs extension).
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Repository connect ─────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Kopia SFTP Repository
          </h3>
          <button
            onClick={handleLoadPlan}
            className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
          >
            Show planned commands
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Creates a new encrypted Kopia repository on the peer&rsquo;s SFTP target, or connects to an
          existing one. Kopia encrypts all data locally before writing it to the remote path.
          Your backup password is required (set in Recovery Key).
        </p>

        {!sftpVerified && !sftpConnected && (
          <div className="flex items-center gap-2 p-2 rounded border border-amber-500/15 bg-amber-500/5 text-xs text-amber-300/70">
            <Info size={11} className="flex-shrink-0" />
            Run SFTP Verification above before connecting to confirm auth and write access.
          </div>
        )}

        {commandPlan.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-400">Planned commands (all params redacted):</div>
            {commandPlan.map((cmd, i) => (
              <div key={i} className="bg-slate-800 rounded p-2 space-y-0.5">
                <div className="text-xs text-slate-500">{cmd.label}</div>
                <code className="text-xs text-sky-300/80 font-mono">{cmd.display_command}</code>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={!canConnect}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          {initializing
            ? <><Loader2 size={12} className="animate-spin" /> Connecting…</>
            : <>
                <Wifi size={12} />
                Create / Connect SFTP Repository
              </>}
        </button>

        {initResult && (
          <div className={`flex items-start gap-2 p-3 rounded border text-xs ${
            initResult.initialized
              ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
              : 'border-red-500/20 bg-red-500/5 text-red-300'
          }`}>
            {initResult.initialized
              ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
              : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
            <div>
              <div className="font-medium">
                {initResult.initialized ? 'Repository connected' : 'Repository not connected'}
                {initResult.already_existed && ' (existing)'}
              </div>
              <p className="text-slate-400 mt-0.5">{initResult.message}</p>
              {initResult.initialized && (
                <div className="mt-2 space-y-1">
                  <p className="text-slate-400">
                    Next step: run a backup from the <strong>Backup Plan</strong> tab to verify the repository is writable.
                  </p>
                  <div className="flex items-center gap-1 text-sky-400/80">
                    <ChevronRight size={11} />
                    <span>Then run a Restore Drill to confirm end-to-end recovery works.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {initError && (
          <div className="flex items-start gap-2 p-3 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
            <XCircle size={13} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Connection failed</div>
              <p className="mt-0.5 text-red-300/80">{initError}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Requirements checklist ─────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Requirements Checklist
        </h3>
        {[
          { label: 'Owner Connection Bundle imported from peer', done: bundleParsed },
          { label: 'Private overlay network (Tailscale / Headscale / WireGuard)', done: tcpProbeSucceeded },
          { label: 'SFTP auth + write access verified', done: sftpVerified },
          { label: 'Isolated SFTP account on peer storage host', done: sftpUser.trim() !== '' },
          { label: 'Quota configured on peer storage path', done: quotaGb > 0 },
          { label: 'SSH key or agent configured for authentication', done: !!sshKeyPath.trim() },
          { label: 'Backup encryption password set (Recovery Key tab)', done: masterPasswordSet },
          { label: 'Source folders selected (Setup Wizard)', done: sourceCount > 0 },
          { label: 'SFTP repository created / connected', done: sftpConnected },
        ].map(({ label, done }) => (
          <div key={label} className={`flex items-center gap-2 text-xs ${done ? 'text-emerald-400' : 'text-slate-500'}`}>
            {done
              ? <CheckCircle size={11} className="flex-shrink-0" />
              : <div className="w-2.5 h-2.5 rounded-full border border-slate-600 flex-shrink-0" />}
            {label}
          </div>
        ))}
      </div>

      {/* Syncthing legacy notice */}
      <div className="bg-slate-900 border border-amber-500/10 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Info size={13} className="text-amber-400/70 flex-shrink-0" />
          <h3 className="text-xs font-semibold text-amber-400/70 uppercase tracking-wide">
            Syncthing — Optional Legacy Mirror Mode
          </h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Syncthing is <strong>not</strong> the default v1 backup transport. It remains available for
          advanced users who want to mirror a local encrypted repository to a second location.
          Using Syncthing in that configuration requires the data owner to maintain a full local copy
          of the encrypted repository before replication.
        </p>
        <p className="text-xs text-slate-600">
          The Syncthing configuration tab is accessible from the sidebar for legacy/experimental use.
        </p>
      </div>
    </div>
  );
}
