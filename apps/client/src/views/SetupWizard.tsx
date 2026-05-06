import { useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronLeft, ChevronRight,
  FolderOpen, HardDrive, Info, Lock, Sliders, Wand2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { SavedPeer, SetupDraftConfig } from '../lib/types';
import { pickDirectory, validateSetupConfig } from '../lib/tauri-bridge';

type Step = 'source-folders' | 'peer-target' | 'retention' | 'summary';

const STEPS: Step[] = ['source-folders', 'peer-target', 'retention', 'summary'];

function stepLabel(s: Step): string {
  switch (s) {
    case 'source-folders': return 'Source folders';
    case 'peer-target':    return 'Backup destination';
    case 'retention':      return 'Retention policy';
    case 'summary':        return 'Review & save';
  }
}

const INITIAL_DRAFT: SetupDraftConfig = {
  label: '',
  role: 'data_owner',
  source_folders: [],
  repository_path: '',
  hosted_storage_path: '',
  hosted_quota_gb: 0,
  retention_keep_last: 5,
  retention_keep_daily: 7,
  retention_keep_weekly: 4,
  retention_keep_monthly: 3,
  health_report_consent: false,
  pairing_token_ref: null,
  web_api_url: null,
  overlay_host: '',
  sftp_user: '',
  sftp_port: 22,
  sftp_path: '',
  ssh_key_ref: '',
  sftp_configured: false,
};

function safetyCheck(draft: SetupDraftConfig): string[] {
  const errors: string[] = [];
  if (draft.source_folders.length === 0) errors.push('At least one source folder is required.');
  if (!draft.overlay_host.trim()) errors.push('Overlay host is required (Tailscale, Headscale, or WireGuard address).');
  if (!draft.sftp_user.trim()) errors.push('SFTP username is required.');
  if (!draft.sftp_path.trim()) errors.push('SFTP remote path is required.');
  if (draft.sftp_path && draft.source_folders.some(s => s === draft.sftp_path))
    errors.push('SFTP remote path must not match a local source folder.');
  if (draft.retention_keep_last < 1) errors.push('Retention keep_last must be at least 1.');
  return errors;
}

export function SetupWizard() {
  const { applyWizardConfig, savedPeers } = useApp();
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState<SetupDraftConfig>(INITIAL_DRAFT);
  const [newFolder, setNewFolder] = useState('');
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  // Peers that have SFTP credentials available — offered as one-click auto-fill.
  const readyPeers = savedPeers.filter(p => p.sftpHost !== '' || p.manualSftpHost !== '');

  function prev() { setStepIdx(i => Math.max(0, i - 1)); }

  async function next() {
    const stepErrors = validateStep(step, draft);
    if (stepErrors.length > 0) { setValidationErrors(stepErrors); return; }
    setValidationErrors([]);

    if (!isLast) { setStepIdx(i => i + 1); return; }

    const clientErrors = safetyCheck(draft);
    if (clientErrors.length > 0) { setValidationErrors(clientErrors); return; }

    setSaving(true);
    try {
      const remoteRepository = draft.overlay_host.trim()
        ? {
            kind: 'sftp',
            overlay_host: draft.overlay_host.trim(),
            sftp_user: draft.sftp_user.trim(),
            sftp_port: draft.sftp_port || 22,
            sftp_path: draft.sftp_path.trim(),
            ssh_key_ref: draft.ssh_key_ref.trim() || null,
            known_host_mode: 'strict',
            quota_hint_gb: null,
          }
        : null;

      await validateSetupConfig({
        role: 'data_owner',
        source_folders: draft.source_folders,
        repository_path: remoteRepository ? null : (draft.repository_path || null),
        remote_repository: remoteRepository,
        hosted_storage_path: null,
        hosted_quota_gb: 0,
        retention_keep_last: draft.retention_keep_last,
        retention_keep_daily: draft.retention_keep_daily,
        retention_keep_weekly: draft.retention_keep_weekly,
        retention_keep_monthly: draft.retention_keep_monthly,
        web_api_url: null,
        pairing_token_ref: null,
      });
    } catch (e: unknown) {
      setValidationErrors([String(e)]);
      setSaving(false);
      return;
    }

    applyWizardConfig(draft);
    setSaving(false);
    setCompleted(true);
  }

  function validateStep(s: Step, d: SetupDraftConfig): string[] {
    switch (s) {
      case 'source-folders':
        return d.source_folders.length === 0 ? ['Add at least one source folder.'] : [];
      case 'peer-target':
        if (!d.overlay_host.trim()) return ['Enter the peer overlay host address (Tailscale, Headscale, or WireGuard).'];
        if (!d.sftp_user.trim()) return ['Enter the SFTP username for the isolated peer account.'];
        if (!d.sftp_path.trim()) return ['Enter the SFTP remote path on the peer storage host.'];
        if (d.source_folders.some(s => s === d.sftp_path))
          return ['SFTP remote path must not match a local source folder.'];
        return [];
      case 'retention':
        return d.retention_keep_last < 1 ? ['Keep-last must be at least 1.'] : [];
      default: return [];
    }
  }

  function handlePresetPeer(peer: SavedPeer) {
    setDraft(d => ({
      ...d,
      label: d.label || peer.connectionName,
      overlay_host: peer.manualSftpHost || peer.sftpHost,
      sftp_user: peer.sftpUsername,
      sftp_port: peer.sftpPort || 22,
      sftp_path: peer.sftpPath,
      ssh_key_ref: peer.privateKeyRef,
    }));
  }

  if (completed) {
    return (
      <div className="p-6 space-y-6 max-w-xl">
        <div className="flex items-center gap-2">
          <Wand2 size={18} className="text-sky-400" />
          <h1 className="text-base font-semibold text-slate-100">Setup Wizard</h1>
        </div>
        <div className="flex items-start gap-2.5 p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-emerald-300 font-medium">Backup job configuration saved.</p>
            <p className="text-xs text-emerald-300/70">
              Next steps:
            </p>
            <ol className="text-xs text-emerald-300/70 space-y-1 list-none">
              <li className="flex items-start gap-2"><span className="text-emerald-500 font-bold">1.</span> Go to <strong>Peer Storage</strong> and connect the Kopia SFTP repository using the credentials you entered.</li>
              <li className="flex items-start gap-2"><span className="text-emerald-500 font-bold">2.</span> Set your encryption password in <strong>Recovery Key</strong> (or enter it directly in Peer Storage on first connect).</li>
              <li className="flex items-start gap-2"><span className="text-emerald-500 font-bold">3.</span> Run your first backup from <strong>Backup Plan</strong>.</li>
            </ol>
          </div>
        </div>
        <button
          onClick={() => { setCompleted(false); setStepIdx(0); setDraft(INITIAL_DRAFT); setValidationErrors([]); }}
          className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
        >
          Add another backup job
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Wand2 size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Setup Wizard</h1>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIdx ? 'bg-sky-500' : 'bg-slate-800'}`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Step {stepIdx + 1} of {STEPS.length}</span>
          <span className="text-slate-300 font-medium">{stepLabel(step)}</span>
        </div>
      </div>

      {/* Step content */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4 min-h-48">
        {step === 'source-folders' && (
          <SourceFoldersStep
            folders={draft.source_folders}
            newFolder={newFolder}
            setNewFolder={setNewFolder}
            onAdd={() => {
              const f = newFolder.trim();
              if (f && !draft.source_folders.includes(f)) {
                setDraft(d => ({ ...d, source_folders: [...d.source_folders, f] }));
                setNewFolder('');
              }
            }}
            onRemove={folder => setDraft(d => ({ ...d, source_folders: d.source_folders.filter(x => x !== folder) }))}
          />
        )}
        {step === 'peer-target' && (
          <PeerTargetStep
            label={draft.label}
            overlayHost={draft.overlay_host}
            sftpUser={draft.sftp_user}
            sftpPort={draft.sftp_port}
            sftpPath={draft.sftp_path}
            sshKeyRef={draft.ssh_key_ref}
            readyPeers={readyPeers}
            onPresetSelect={handlePresetPeer}
            onLabelChange={v => setDraft(d => ({ ...d, label: v }))}
            onOverlayHostChange={v => setDraft(d => ({ ...d, overlay_host: v }))}
            onSftpUserChange={v => setDraft(d => ({ ...d, sftp_user: v }))}
            onSftpPortChange={v => setDraft(d => ({ ...d, sftp_port: v }))}
            onSftpPathChange={v => setDraft(d => ({ ...d, sftp_path: v }))}
            onSshKeyRefChange={v => setDraft(d => ({ ...d, ssh_key_ref: v }))}
          />
        )}
        {step === 'retention' && (
          <RetentionStep
            keepLast={draft.retention_keep_last}
            keepDaily={draft.retention_keep_daily}
            keepWeekly={draft.retention_keep_weekly}
            keepMonthly={draft.retention_keep_monthly}
            onChange={(k, v) => setDraft(d => ({ ...d, [k]: v }))}
          />
        )}
        {step === 'summary' && (
          <SummaryStep draft={draft} />
        )}
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {validationErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-300">{e}</p>
            ))}
          </div>
        </div>
      )}

      {/* Safety notice */}
      <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-500/10 bg-sky-500/5">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/70 leading-relaxed">
          Kopia encrypts your data locally before writing to peer storage.
          Your plaintext files, filenames, and encryption password never leave your machine.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prev}
          disabled={isFirst}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={15} /> Back
        </button>
        <button
          onClick={() => { void next(); }}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-sm rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : isLast ? 'Save configuration' : 'Continue'}
          {!isLast && !saving && <ChevronRight size={15} />}
        </button>
      </div>
    </div>
  );
}

// ── Step components ────────────────────────────────────────────────────────────

function SourceFoldersStep({ folders, newFolder, setNewFolder, onAdd, onRemove }: {
  folders: string[];
  newFolder: string;
  setNewFolder: (v: string) => void;
  onAdd: () => void;
  onRemove: (f: string) => void;
}) {
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  async function handleBrowse() {
    setBrowseError(null);
    setBrowsing(true);
    try {
      const folder = await pickDirectory();
      if (folder) {
        setNewFolder(folder);
      } else {
        setBrowseError('Folder picker is available in the desktop app. Paste a path manually.');
      }
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-200">What do you want to back up?</h3>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Add every folder you want included in encrypted Kopia snapshots.
          You can add more backup jobs later.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newFolder}
          onChange={e => setNewFolder(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          placeholder="/home/user/documents"
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={handleBrowse}
          disabled={browsing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm text-slate-200 rounded transition-colors"
        >
          <FolderOpen size={14} />
          {browsing ? 'Opening…' : 'Browse'}
        </button>
        <button
          onClick={onAdd}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 rounded transition-colors"
        >
          Add
        </button>
      </div>
      {browseError && <p className="text-xs text-amber-300/80">{browseError}</p>}
      {folders.length > 0 ? (
        <div className="space-y-1">
          {folders.map(f => (
            <div key={f} className="flex items-center gap-2 bg-slate-800/50 rounded px-3 py-1.5">
              <HardDrive size={12} className="text-slate-500 flex-shrink-0" />
              <span className="text-xs font-mono text-slate-300 flex-1 truncate">{f}</span>
              <button onClick={() => onRemove(f)} className="text-slate-500 hover:text-red-400 text-xs transition-colors">remove</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-600 italic">No folders added yet.</p>
      )}
    </div>
  );
}

function peerPhaseLabel(phase: SavedPeer['phase']): { text: string; dot: string } {
  switch (phase) {
    case 'repo_ready':      return { text: 'Ready',       dot: 'bg-emerald-400' };
    case 'sftp_verified':   return { text: 'SFTP ok',     dot: 'bg-sky-400' };
    case 'waiting_for_host':return { text: 'Provisioning',dot: 'bg-amber-400' };
    case 'response_ready':  return { text: 'Keys set',    dot: 'bg-sky-500' };
    case 'blocked':         return { text: 'Blocked',     dot: 'bg-red-400' };
    default:                return { text: 'Setup needed',dot: 'bg-slate-500' };
  }
}

function PeerTargetStep({
  label, overlayHost, sftpUser, sftpPort, sftpPath, sshKeyRef,
  readyPeers, onPresetSelect,
  onLabelChange, onOverlayHostChange, onSftpUserChange,
  onSftpPortChange, onSftpPathChange, onSshKeyRefChange,
}: {
  label: string;
  overlayHost: string;
  sftpUser: string;
  sftpPort: number;
  sftpPath: string;
  sshKeyRef: string;
  readyPeers: SavedPeer[];
  onPresetSelect: (p: SavedPeer) => void;
  onLabelChange: (v: string) => void;
  onOverlayHostChange: (v: string) => void;
  onSftpUserChange: (v: string) => void;
  onSftpPortChange: (v: number) => void;
  onSftpPathChange: (v: string) => void;
  onSshKeyRefChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-200">Where should Kopia write encrypted backups?</h3>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Select a connected peer to auto-fill SFTP credentials, or fill in manually.
          Set up a peer connection first in the{' '}
          <strong className="text-slate-300">Peer</strong> tab if you haven't already.
        </p>
      </div>

      {/* Peer selection cards */}
      {readyPeers.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400">Select a peer connection — all SFTP fields fill automatically:</p>
          <div className="grid grid-cols-1 gap-2">
            {readyPeers.map(p => {
              const { text: phaseText, dot: phaseDot } = peerPhaseLabel(p.phase);
              const host = p.manualSftpHost || p.sftpHost;
              const isSelected = overlayHost === host && sftpUser === p.sftpUsername;
              return (
                <button
                  key={p.id}
                  onClick={() => onPresetSelect(p)}
                  className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
                    isSelected
                      ? 'border-sky-500/60 bg-sky-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-sky-500/30 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-200 font-medium truncate">
                      {p.connectionName || p.matchId || p.id}
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${phaseDot}`} />
                      <span className="text-xs text-slate-400">{phaseText}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono text-slate-400 truncate">{host}:{p.sftpPort || 22}</span>
                    <span className="text-xs text-slate-500">user: {p.sftpUsername}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-600">Click a peer to populate the fields below. Adjust if needed.</p>
        </div>
      ) : (
        <div className="flex items-start gap-2 p-2.5 rounded border border-amber-500/15 bg-amber-500/5">
          <Lock size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/70 leading-relaxed">
            No peer connections with SFTP credentials found. Accept a peer invite in the{' '}
            <strong>Peer</strong> tab first to get credentials, then return here.
            You can still fill the fields manually.
          </p>
        </div>
      )}

      {/* Backup job name */}
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Backup job name <span className="text-slate-600">(optional)</span></label>
        <input
          type="text"
          value={label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="e.g. Home documents, Photos"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* Overlay host + port */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-slate-400 mb-1 block">Peer overlay address</label>
          <input
            type="text"
            value={overlayHost}
            onChange={e => onOverlayHostChange(e.target.value)}
            placeholder="peer-name.tailnet.example or 100.x.x.x"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Tailscale MagicDNS name or 100.x IP.</p>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">SFTP port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={sftpPort}
            onChange={e => onSftpPortChange(parseInt(e.target.value, 10) || 22)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* SFTP user + path */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">SFTP username</label>
          <input
            type="text"
            value={sftpUser}
            onChange={e => onSftpUserChange(e.target.value)}
            placeholder="nabb_a1b2c3d4"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Isolated account from invite.</p>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">SFTP remote path</label>
          <input
            type="text"
            value={sftpPath}
            onChange={e => onSftpPathChange(e.target.value)}
            placeholder="/srv/nasbb/repos/match-x/repo"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Quota-bound path from invite.</p>
        </div>
      </div>

      {/* SSH key */}
      <div>
        <label className="text-xs text-slate-400 mb-1 block">SSH private key <span className="text-slate-600">(optional — leave blank for SSH agent)</span></label>
        <input
          type="text"
          value={sshKeyRef}
          onChange={e => onSshKeyRefChange(e.target.value)}
          placeholder="/home/user/.ssh/id_ed25519"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
        <p className="text-xs text-slate-600 mt-1">Path to key file. Never sent anywhere — used locally by Kopia only.</p>
      </div>
    </div>
  );
}

function RetentionStep({ keepLast, keepDaily, keepWeekly, keepMonthly, onChange }: {
  keepLast: number; keepDaily: number; keepWeekly: number; keepMonthly: number;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-200">How long should Kopia keep snapshots?</h3>
        <p className="text-xs text-slate-400 mt-1">
          Snapshots outside this policy are pruned automatically. The defaults work well for most users.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'retention_keep_last',    label: 'Keep last N snapshots', min: 1,  value: keepLast },
          { key: 'retention_keep_daily',   label: 'Daily (days)',          min: 0,  value: keepDaily },
          { key: 'retention_keep_weekly',  label: 'Weekly (weeks)',        min: 0,  value: keepWeekly },
          { key: 'retention_keep_monthly', label: 'Monthly (months)',      min: 0,  value: keepMonthly },
        ].map(({ key, label, min, value }) => (
          <div key={key}>
            <label className="text-xs text-slate-400 mb-1 block">{label}</label>
            <input
              type="number"
              min={min}
              value={value}
              onChange={e => onChange(key, parseInt(e.target.value, 10) || 0)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 p-2.5 rounded border border-slate-700/50 bg-slate-800/30">
        <Info size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          Kopia deduplicates across snapshots, so keeping more history uses far less space than you might expect.
          Set daily/weekly/monthly to 0 to disable those tiers.
        </p>
      </div>
    </div>
  );
}

function SummaryStep({ draft }: { draft: SetupDraftConfig }) {
  const { wizardConfigs } = useApp();
  const isUpdate = wizardConfigs.some(c =>
    c.overlay_host.trim() === draft.overlay_host.trim() &&
    c.sftp_path.trim() === draft.sftp_path.trim(),
  );
  const clientErrors = safetyCheck(draft);
  const rows: Array<[string, string]> = [
    ['Backup job',      draft.label || '(unnamed)'],
    ['Source folders',  draft.source_folders.length > 0 ? draft.source_folders.join(', ') : 'None'],
    ['Overlay host',    draft.overlay_host.trim() || '—'],
    ['SFTP user',       draft.sftp_user.trim() || '—'],
    ['SFTP port',       String(draft.sftp_port || 22)],
    ['SFTP path',       draft.sftp_path.trim() || '—'],
    ['SSH key',         draft.ssh_key_ref.trim() || 'SSH agent (default)'],
    ['Keep last',       String(draft.retention_keep_last)],
    ['Keep daily',      String(draft.retention_keep_daily)],
    ['Keep weekly',     String(draft.retention_keep_weekly)],
    ['Keep monthly',    String(draft.retention_keep_monthly)],
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Review your configuration</h3>
      {isUpdate && clientErrors.length === 0 && (
        <div className="flex items-start gap-2 p-2 rounded border border-sky-500/20 bg-sky-500/5 text-xs text-sky-300/80">
          <Info size={11} className="flex-shrink-0 mt-0.5" />
          An existing backup job for this peer will be updated in-place.
        </div>
      )}
      {clientErrors.length > 0 && (
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 space-y-1">
          <p className="text-xs text-red-400 font-medium">Fix before saving:</p>
          {clientErrors.map((e, i) => <p key={i} className="text-xs text-red-300">• {e}</p>)}
        </div>
      )}
      <div className="space-y-0">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/50 last:border-0">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-300 font-mono">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/10 bg-sky-500/5">
        <Sliders size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/70">
          SFTP credentials are stored locally only. After saving, connect the repository in <strong>Peer Storage</strong>.
        </p>
      </div>
    </div>
  );
}
