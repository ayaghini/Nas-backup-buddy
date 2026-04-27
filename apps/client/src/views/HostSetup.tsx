import { useState, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  ClipboardCopy, HardDrive, Info, Lock, Server, Shield,
  Terminal,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { planHostSetup } from '../lib/tauri-bridge';
import { loadPersistedConfig } from '../lib/persistence';
import type { HostSetupPlan, HostSetupStep, OwnerConnectionBundle, OverlayProvider } from '../lib/types';

const PROVIDER_LABELS: Record<OverlayProvider, string> = {
  tailscale: 'Tailscale',
  headscale: 'Headscale',
  wire_guard: 'WireGuard',
  custom_reachable_address: 'Custom address',
  not_configured: 'Not configured',
};

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, hint, mono = false, textarea = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  textarea?: boolean;
}) {
  const cls = `w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 ${mono ? 'font-mono' : ''}`;
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4} className={`${cls} resize-none`} />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
    >
      <ClipboardCopy size={10} />
      {copied ? 'Copied!' : label}
    </button>
  );
}

// ── Command step card ─────────────────────────────────────────────────────────

function StepCard({ step, index }: { step: HostSetupStep; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-xs text-slate-600 font-mono w-5 flex-shrink-0">{index + 1}.</span>
        <span className="flex-1 text-xs font-medium text-slate-200">{step.label}</span>
        {step.requires_root && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
            root
          </span>
        )}
        {open ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-800 px-3 py-3 space-y-2">
          <div className="relative">
            <pre className="bg-slate-950 rounded p-3 text-xs font-mono text-sky-300/80 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {step.display_command}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={step.display_command} />
            </div>
          </div>
          {step.note && (
            <p className="text-xs text-slate-500 leading-relaxed">{step.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Owner connection bundle card ──────────────────────────────────────────────

function OwnerBundleCard({ bundle }: { bundle: OwnerConnectionBundle }) {
  const bundleText = [
    `overlay_provider: ${PROVIDER_LABELS[bundle.overlay_provider]}`,
    `overlay_host:     ${bundle.overlay_host}`,
    `sftp_user:        ${bundle.sftp_username}`,
    `sftp_port:        ${bundle.sftp_port}`,
    `sftp_path:        ${bundle.sftp_path}`,
    `quota_gb:         ${bundle.quota_gb}`,
    `match_id:         ${bundle.match_id}`,
    ``,
    `# ${bundle.host_key_fingerprint_note}`,
    `# ${bundle.compatibility_note}`,
  ].join('\n');

  return (
    <div className="bg-slate-900 border border-emerald-500/20 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-emerald-500/5 border-b border-emerald-500/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-300">Owner Connection Bundle</span>
        </div>
        <CopyButton text={bundleText} label="Copy all" />
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          Send these non-secret values to your matched data owner. They will paste them into
          their <strong>Peer Storage</strong> tab to connect their Kopia repository to your host.
        </p>

        <div className="bg-slate-950 rounded p-3 font-mono text-xs space-y-1">
          {[
            ['overlay_provider', PROVIDER_LABELS[bundle.overlay_provider]],
            ['overlay_host', bundle.overlay_host],
            ['sftp_user', bundle.sftp_username],
            ['sftp_port', String(bundle.sftp_port)],
            ['sftp_path', bundle.sftp_path],
            ['quota_gb', String(bundle.quota_gb)],
            ['match_id', bundle.match_id],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <span className="text-slate-500 w-24 flex-shrink-0">{k}</span>
              <span className="text-sky-300/80">{v}</span>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-xs text-sky-300/70">
          <Info size={11} className="flex-shrink-0 mt-0.5" />
          <span>{bundle.host_key_fingerprint_note}</span>
        </div>
        {bundle.compatibility_note && (
          <div className="flex items-start gap-2 p-2.5 rounded border border-slate-700 bg-slate-800/40 text-xs text-slate-500">
            <Info size={11} className="flex-shrink-0 mt-0.5" />
            <span><strong>Overlay compatibility: </strong>{bundle.compatibility_note}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function HostSetup() {
  const { wizardConfigs, setupState } = useApp();

  const sourceFolders = wizardConfigs.flatMap(c => c.source_folders);
  const isHostRole =
    setupState.role === 'storage_host' || setupState.role === 'reciprocal_match';

  // Form fields
  const [hostedPath, setHostedPath] = useState('');
  const [quotaGb, setQuotaGb] = useState('500');
  const [matchId, setMatchId] = useState('');
  const [sftpUsername, setSftpUsername] = useState('');
  const [sftpPort, setSftpPort] = useState('22');
  const [overlayHost, setOverlayHost] = useState('');
  const [overlayProvider, setOverlayProvider] = useState<OverlayProvider>('tailscale');
  const [ownerPublicKey, setOwnerPublicKey] = useState('');

  // Plan state
  const [plan, setPlan] = useState<HostSetupPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  // Prefill overlay address from persisted overlayMeta on mount
  useEffect(() => {
    loadPersistedConfig().then(saved => {
      const om = saved.overlayMeta;
      if (!om) return;
      if (om.local_address && !overlayHost) setOverlayHost(om.local_address);
      if (om.provider === 'tailscale') setOverlayProvider('tailscale');
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBrowse() {
    setBrowsing(true);
    try {
      const { pickDirectory: pick } = await import('../lib/tauri-bridge');
      const dir = await pick();
      if (dir) setHostedPath(dir);
    } finally {
      setBrowsing(false);
    }
  }

  async function handleGenerate() {
    setPlanError(null);
    setPlan(null);
    setGenerating(true);
    try {
      const result = await planHostSetup(
        {
          connection_name: matchId.trim(),
          hosted_path: hostedPath.trim(),
          quota_gb: parseInt(quotaGb, 10) || 0,
          match_id: matchId.trim(),
          sftp_username: sftpUsername.trim(),
          sftp_port: parseInt(sftpPort, 10) || 22,
          owner_public_key: ownerPublicKey.trim(),
          source_folders: sourceFolders,
          overlay_provider: overlayProvider,
        },
        overlayHost.trim(),
      );
      setPlan(result);
    } catch (e: unknown) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const canGenerate =
    hostedPath.trim() !== '' &&
    matchId.trim() !== '' &&
    ownerPublicKey.trim() !== '' &&
    !generating;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Server size={18} className="text-violet-400" />
        <h1 className="text-base font-semibold text-slate-100">Host Setup</h1>
        <span className="text-xs text-slate-500 ml-1">Prepare this device to store a peer&rsquo;s encrypted repository</span>
      </div>

      {/* Role notice */}
      {!isHostRole && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <p>
            Your current role is <strong>{setupState.role.replace('_', ' ')}</strong>.
            Host Setup applies to <strong>Storage Host</strong> and <strong>Reciprocal Match</strong> roles.
            You can still generate a command plan below, but run the Setup Wizard first to set your role.
          </p>
        </div>
      )}

      {/* Architecture reminder */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-violet-500/20 bg-violet-500/5 text-xs text-violet-300/80">
        <Shield size={13} className="text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p>
            <strong>You are preparing to receive encrypted backup data from a matched peer.</strong>
          </p>
          <p>
            The data you receive will be Kopia-encrypted ciphertext — you cannot read filenames or contents.
            This setup creates an isolated SFTP account reachable only over the private overlay network.
          </p>
        </div>
      </div>

      {/* Input form */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Match Details</h3>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Match ID"
            value={matchId}
            onChange={setMatchId}
            placeholder="match-abc123"
            hint="Letters, digits, hyphens, underscores only. Used in SFTP username and path."
            mono
          />
          <Field
            label="SFTP username (optional)"
            value={sftpUsername}
            onChange={setSftpUsername}
            placeholder="auto-generated from match ID"
            hint="Leave blank to auto-generate from match ID."
            mono
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">Hosted repository path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hostedPath}
                onChange={e => setHostedPath(e.target.value)}
                placeholder="/mnt/peer-storage/match-abc123"
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handleBrowse}
                disabled={browsing}
                className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-xs text-slate-200 flex items-center gap-1 flex-shrink-0"
              >
                <HardDrive size={11} />
                {browsing ? '…' : 'Browse'}
              </button>
            </div>
            <p className="text-xs text-slate-600">Where the encrypted repository will live on this machine.</p>
          </div>
          <Field
            label="Quota (GB)"
            value={quotaGb}
            onChange={setQuotaGb}
            placeholder="500"
            hint="Maximum storage for this match."
          />
        </div>

        {/* Overlay provider */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-300">Overlay provider</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(['tailscale', 'headscale', 'wire_guard', 'custom_reachable_address'] as OverlayProvider[]).map(p => (
              <button
                key={p}
                onClick={() => setOverlayProvider(p)}
                className={`px-2 py-1.5 rounded border text-xs transition-colors ${
                  overlayProvider === p
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                    : 'border-slate-700 bg-slate-800/30 text-slate-500 hover:text-slate-300'
                }`}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600">
            Included in the owner connection bundle so they know how to connect.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Your overlay host / address"
            value={overlayHost}
            onChange={setOverlayHost}
            placeholder={overlayProvider === 'tailscale' ? 'this-device.tailnet.ts.net' : overlayProvider === 'wire_guard' ? '10.99.0.1' : 'this-device-address'}
            hint="Your overlay address. Goes into the owner connection bundle."
            mono
          />
          <Field
            label="SFTP port"
            value={sftpPort}
            onChange={setSftpPort}
            placeholder="22"
            hint="SSH daemon port. Default 22."
          />
        </div>

        <Field
          label="Owner SSH public key"
          value={ownerPublicKey}
          onChange={setOwnerPublicKey}
          placeholder={'ssh-ed25519 AAAAC3... owner@host'}
          hint="Paste the data owner's SSH public key exactly as one line. Never paste a private key here."
          mono
          textarea
        />

        {/* Safety note */}
        <div className="flex items-start gap-2 p-2.5 rounded border border-slate-700 bg-slate-800/40 text-xs text-slate-500">
          <Lock size={11} className="flex-shrink-0 mt-0.5 text-violet-400/60" />
          <span>
            Only the public key is stored here. It will be written to
            <code className="mx-1 text-slate-400">authorized_keys</code>
            on this host. Private keys are never accepted or transmitted.
          </span>
        </div>

        {planError && (
          <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{planError}</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          <Terminal size={12} />
          {generating ? 'Generating…' : 'Generate Host Setup Plan'}
        </button>
      </div>

      {/* Command plan */}
      {plan && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Host Setup Commands ({plan.platform})
            </h3>
            <span className="text-xs text-amber-400/70 flex items-center gap-1">
              <AlertTriangle size={11} />
              Review before running — some steps require root
            </span>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded border border-amber-500/15 bg-amber-500/5 text-xs text-amber-300/70">
            <Info size={11} className="flex-shrink-0 mt-0.5" />
            <p>
              These are <strong>command plans for your review</strong> — the app does not execute them.
              Inspect each step, adapt to your system, and run as root/sudo where indicated.
              Run <code className="mx-1 text-amber-200">sudo sshd -t</code> after editing
              <code className="mx-1 text-amber-200">sshd_config</code>.
            </p>
          </div>

          <div className="space-y-2">
            {plan.steps.map((step, i) => (
              <StepCard key={i} step={step} index={i} />
            ))}
          </div>

          {/* Owner connection bundle */}
          <OwnerBundleCard bundle={plan.owner_bundle} />
        </div>
      )}

      {/* Source folder safety reference */}
      {sourceFolders.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Source Folder Safety Reference
          </h3>
          <p className="text-xs text-slate-500">
            The hosted path must not overlap with any of your source folders.
            The validator enforces this automatically.
          </p>
          <div className="space-y-1">
            {sourceFolders.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                <HardDrive size={10} className="flex-shrink-0 text-red-400/50" />
                <code>{f}</code>
                <span className="text-slate-700">— blocked from hosted path</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
