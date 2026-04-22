import { useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronLeft, ChevronRight,
  FolderOpen, HardDrive, Info, Lock, Shield, Sliders, Users, Wand2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { SetupDraftConfig, UserRole } from '../lib/types';
import { pickDirectory, validateSetupConfig } from '../lib/tauri-bridge';

type Step = 'role' | 'source-folders' | 'repository' | 'hosted-storage' | 'retention' | 'health-consent' | 'summary';

const STEPS: Step[] = ['role', 'source-folders', 'repository', 'hosted-storage', 'retention', 'health-consent', 'summary'];

function stepLabel(s: Step): string {
  switch (s) {
    case 'role': return 'Choose role';
    case 'source-folders': return 'Source folders';
    case 'repository': return 'Repository location';
    case 'hosted-storage': return 'Hosted storage';
    case 'retention': return 'Retention policy';
    case 'health-consent': return 'Health reporting';
    case 'summary': return 'Summary';
  }
}

function isHostRole(role: UserRole): boolean {
  return role === 'storage_host' || role === 'reciprocal_match';
}
function isOwnerRole(role: UserRole): boolean {
  return role === 'data_owner' || role === 'reciprocal_match';
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
};

function safetyCheck(draft: SetupDraftConfig): string[] {
  const errors: string[] = [];
  if (isOwnerRole(draft.role)) {
    if (draft.source_folders.length === 0) errors.push('At least one source folder is required.');
    if (!draft.repository_path) errors.push('Encrypted repository path is required.');
    if (draft.repository_path && draft.source_folders.some(s => s === draft.repository_path))
      errors.push('Repository path must not equal a source folder.');
    if (draft.repository_path && draft.source_folders.some(s => draft.repository_path.startsWith(s + '/')))
      errors.push('Repository path must not be inside a source folder.');
    if (draft.repository_path && draft.source_folders.some(s => s.startsWith(draft.repository_path + '/')))
      errors.push('Source folder must not be inside the repository path.');
    if (draft.repository_path && draft.source_folders.some(s => s === draft.repository_path))
      errors.push('Source path must not be used as a Syncthing shared folder — only the repository path is allowed.');
  }
  if (isHostRole(draft.role)) {
    if (!draft.hosted_storage_path) errors.push('Hosted peer-storage path is required.');
    if (draft.hosted_quota_gb <= 0) errors.push('Hosted quota must be greater than 0 GB.');
    if (draft.hosted_storage_path && draft.source_folders.some(s => draft.hosted_storage_path.startsWith(s + '/')))
      errors.push('Hosted storage must not be inside a source folder.');
  }
  if (draft.retention_keep_last < 1) errors.push('Retention keep_last must be at least 1.');
  return errors;
}

export function SetupWizard() {
  const { applyWizardConfig, setHealthReportConsent } = useApp();
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState<SetupDraftConfig>(INITIAL_DRAFT);
  const [newFolder, setNewFolder] = useState('');
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);


  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  function prev() { setStepIdx(i => Math.max(0, i - 1)); }

  async function next() {
    const stepErrors = validateStep(step, draft);
    if (stepErrors.length > 0) { setValidationErrors(stepErrors); return; }
    setValidationErrors([]);

    if (!isLast) {
      setStepIdx(i => i + 1);
      return;
    }

    // Final step: run full validation before touching shared state
    // 1. Client-side safety check
    const clientErrors = safetyCheck(draft);
    if (clientErrors.length > 0) {
      setValidationErrors(clientErrors);
      return;
    }

    // 2. Backend validation (Rust validate_config via Tauri; no-ops gracefully in browser)
    setSaving(true);
    try {
      await validateSetupConfig({
        role: draft.role,
        source_folders: draft.source_folders,
        repository_path: draft.repository_path || null,
        hosted_storage_path: draft.hosted_storage_path || null,
        hosted_quota_gb: draft.hosted_quota_gb,
        retention_keep_last: draft.retention_keep_last,
        retention_keep_daily: draft.retention_keep_daily,
        retention_keep_weekly: draft.retention_keep_weekly,
        retention_keep_monthly: draft.retention_keep_monthly,
        web_api_url: draft.web_api_url,
        pairing_token_ref: draft.pairing_token_ref,
      });
    } catch (e: unknown) {
      setValidationErrors([String(e)]);
      setSaving(false);
      return;
    }

    // 3. All validation passed — persist to shared state.
    applyWizardConfig(draft);
    setHealthReportConsent(draft.health_report_consent);
    setSaving(false);
    setCompleted(true);
  }

  function validateStep(s: Step, d: SetupDraftConfig): string[] {
    switch (s) {
      case 'role': return !d.role ? ['Select a role.'] : [];
      case 'source-folders':
        if (!isOwnerRole(d.role)) return [];
        return d.source_folders.length === 0 ? ['Add at least one source folder.'] : [];
      case 'repository':
        if (!isOwnerRole(d.role)) return [];
        if (!d.repository_path) return ['Enter the encrypted repository path.'];
        if (d.source_folders.some(s => d.repository_path === s))
          return ['Repository path must not be the same as a source folder.'];
        if (d.source_folders.some(s => d.repository_path.startsWith(s + '/')))
          return ['Repository path must not be inside a source folder.'];
        if (d.source_folders.some(s => s.startsWith(d.repository_path + '/')))
          return ['A source folder must not be inside the repository path.'];
        return [];
      case 'hosted-storage':
        if (!isHostRole(d.role)) return [];
        if (!d.hosted_storage_path) return ['Enter the hosted peer-storage path.'];
        if (d.hosted_quota_gb <= 0) return ['Enter a quota greater than 0 GB.'];
        return [];
      case 'retention':
        return d.retention_keep_last < 1 ? ['Keep-last must be at least 1.'] : [];
      default: return [];
    }
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
          <div className="space-y-1.5">
            <p className="text-sm text-emerald-300 font-medium">Repository configuration saved.</p>
            <p className="text-xs text-emerald-300/70">
              If your master encryption password is already set, Kopia will initialise the repository and run the first backup automatically.
              If not, go to <strong>Recovery Key</strong> to set it — a backup will start as soon as it's saved.
            </p>
            {draft.health_report_consent && (
              <p className="text-xs text-sky-300/70">
                Health reporting enabled — allowlisted metadata will be sent to the web app when connected.
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => { setCompleted(false); setStepIdx(0); setDraft(INITIAL_DRAFT); setValidationErrors([]); }}
          className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
        >
          Add another repository
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

      {/* Progress */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIdx ? 'bg-sky-500' : 'bg-slate-800'}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Step {stepIdx + 1} of {STEPS.length}</span>
        <span className="text-slate-300 font-medium">{stepLabel(step)}</span>
      </div>

      {/* Step content */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4 min-h-48">
        {step === 'role' && (
          <RoleStep role={draft.role} onChange={role => setDraft(d => ({ ...d, role }))} />
        )}
        {step === 'source-folders' && (
          <SourceFoldersStep
            role={draft.role}
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
        {step === 'repository' && (
          <RepositoryStep
            role={draft.role}
            label={draft.label}
            value={draft.repository_path}
            onLabelChange={v => setDraft(d => ({ ...d, label: v }))}
            onChange={v => setDraft(d => ({ ...d, repository_path: v }))}
          />
        )}
        {step === 'hosted-storage' && (
          <HostedStorageStep
            role={draft.role}
            path={draft.hosted_storage_path}
            quota={draft.hosted_quota_gb}
            onPathChange={v => setDraft(d => ({ ...d, hosted_storage_path: v }))}
            onQuotaChange={v => setDraft(d => ({ ...d, hosted_quota_gb: v }))}
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
        {step === 'health-consent' && (
          <HealthConsentStep
            consent={draft.health_report_consent}
            onChange={v => setDraft(d => ({ ...d, health_report_consent: v }))}
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
          Source folders are never shared directly with peers. Syncthing transports only the encrypted repository.
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
          {saving ? 'Validating…' : isLast ? 'Save configuration' : 'Continue'} {!isLast && !saving && <ChevronRight size={15} />}
        </button>
      </div>
    </div>
  );
}

// ── Step components ────────────────────────────────────────────────────────────

function RoleStep({ role, onChange }: { role: UserRole; onChange: (r: UserRole) => void }) {
  const options: Array<{ value: UserRole; label: string; desc: string; icon: React.ReactNode }> = [
    { value: 'data_owner', label: 'Data Owner', desc: 'Back up your data to an encrypted repository synced to a peer.', icon: <HardDrive size={16} /> },
    { value: 'storage_host', label: 'Storage Host', desc: 'Offer spare storage for another user\'s encrypted repository.', icon: <Shield size={16} /> },
    { value: 'reciprocal_match', label: 'Reciprocal Match', desc: 'Both back up your own data and host a peer\'s encrypted repository.', icon: <Users size={16} /> },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Choose your role</h3>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
            role === opt.value
              ? 'border-sky-500/50 bg-sky-500/10'
              : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
          }`}
        >
          <span className={`mt-0.5 flex-shrink-0 ${role === opt.value ? 'text-sky-400' : 'text-slate-500'}`}>{opt.icon}</span>
          <div>
            <div className="text-sm font-medium text-slate-200">{opt.label}</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{opt.desc}</div>
          </div>
          {role === opt.value && <CheckCircle size={14} className="text-sky-400 ml-auto flex-shrink-0 mt-0.5" />}
        </button>
      ))}
    </div>
  );
}

function SourceFoldersStep({ role, folders, newFolder, setNewFolder, onAdd, onRemove }: {
  role: UserRole; folders: string[]; newFolder: string;
  setNewFolder: (v: string) => void; onAdd: () => void; onRemove: (f: string) => void;
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
        setBrowseError('Folder picker is available in the desktop app. You can still paste a path manually.');
      }
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  }

  if (!isOwnerRole(role)) {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80">
          Source folders are not required for the Storage Host role. Skip this step.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Source folders</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        These folders will be backed up by Kopia. They will never be shared directly with peers —
        only the encrypted repository is synced via Syncthing.
      </p>
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-slate-200 rounded transition-colors"
          title="Choose a source folder"
        >
          <FolderOpen size={14} />
          {browsing ? 'Opening' : 'Browse'}
        </button>
        <button
          onClick={onAdd}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 rounded transition-colors"
        >
          Add
        </button>
      </div>
      {browseError && (
        <p className="text-xs text-amber-300/80">{browseError}</p>
      )}
      {folders.length > 0 && (
        <div className="space-y-1">
          {folders.map(f => (
            <div key={f} className="flex items-center gap-2 bg-slate-800/50 rounded px-3 py-1.5">
              <span className="text-xs font-mono text-slate-300 flex-1 truncate">{f}</span>
              <button onClick={() => onRemove(f)} className="text-slate-500 hover:text-red-400 text-xs transition-colors">remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepositoryStep({ role, label, value, onLabelChange, onChange }: {
  role: UserRole;
  label: string;
  value: string;
  onLabelChange: (v: string) => void;
  onChange: (v: string) => void;
}) {
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  async function handleBrowse() {
    setBrowseError(null);
    setBrowsing(true);
    try {
      const folder = await pickDirectory();
      if (folder) {
        onChange(folder);
      } else {
        setBrowseError('Folder picker is available in the desktop app. You can still paste a path manually.');
      }
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  }

  if (!isOwnerRole(role)) {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80">Repository path is not required for the Storage Host role. Skip this step.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Encrypted repository</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        Give this backup job a name, then choose where Kopia will write encrypted snapshots.
        This path — not your source folders — is what gets synced to your peer via Syncthing.
      </p>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">Backup job name</label>
        <input
          type="text"
          value={label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="e.g. Home documents, Photos, Work projects"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
        <p className="text-xs text-slate-600 mt-1">Used as the display name in Backup Plan and Syncthing setup.</p>
      </div>
      <div className="flex items-center gap-2.5 p-2.5 rounded border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
        <p className="text-xs text-amber-300/80">Must not be inside a source folder, and source folders must not be inside it.</p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/home/user/.nasbb-repo"
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={handleBrowse}
          disabled={browsing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-slate-200 rounded transition-colors"
          title="Choose encrypted repository folder"
        >
          <FolderOpen size={14} />
          {browsing ? 'Opening' : 'Browse'}
        </button>
      </div>
      {browseError && (
        <p className="text-xs text-amber-300/80">{browseError}</p>
      )}
      <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/10 bg-sky-500/5">
        <Lock size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/70">This path will become the Syncthing shared folder. Your source folders will never be shared.</p>
      </div>
    </div>
  );
}

function HostedStorageStep({ role, path, quota, onPathChange, onQuotaChange }: {
  role: UserRole; path: string; quota: number;
  onPathChange: (v: string) => void; onQuotaChange: (v: number) => void;
}) {
  if (!isHostRole(role)) {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80">Hosted storage is not required for the Data Owner role. Skip this step.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Hosted peer-storage</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        This is where your peer's encrypted repository will be stored. The data is encrypted before it arrives — you cannot read it.
      </p>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Peer-storage path</label>
        <input
          type="text"
          value={path}
          onChange={e => onPathChange(e.target.value)}
          placeholder="/mnt/peer-storage"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Quota (GB)</label>
        <input
          type="number"
          min={1}
          value={quota || ''}
          onChange={e => onQuotaChange(parseInt(e.target.value, 10) || 0)}
          placeholder="500"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
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
      <h3 className="text-sm font-medium text-slate-200">Retention policy</h3>
      <p className="text-xs text-slate-400">How many snapshots Kopia keeps. Older snapshots outside policy are pruned.</p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'retention_keep_last', label: 'Keep last N', value: keepLast },
          { key: 'retention_keep_daily', label: 'Daily (days)', value: keepDaily },
          { key: 'retention_keep_weekly', label: 'Weekly (weeks)', value: keepWeekly },
          { key: 'retention_keep_monthly', label: 'Monthly (months)', value: keepMonthly },
        ].map(({ key, label, value }) => (
          <div key={key}>
            <label className="text-xs text-slate-400 mb-1 block">{label}</label>
            <input
              type="number"
              min={key === 'retention_keep_last' ? 1 : 0}
              value={value}
              onChange={e => onChange(key, parseInt(e.target.value, 10) || 0)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthConsentStep({ consent, onChange }: { consent: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Health reporting consent</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        The web app can receive allowlisted operational metadata to power health dashboards and reputation.
        This is off by default. You can change this in Settings at any time.
      </p>
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-1.5 text-xs text-slate-400">
        <p className="font-medium text-slate-300 mb-2">If enabled, only these fields are sent:</p>
        {['Client version', 'Last backup status and timestamp', 'Last sync status and timestamp', 'Repository size', 'Available quota percent', 'Peer online/offline state'].map(f => (
          <div key={f} className="flex items-center gap-2"><CheckCircle size={11} className="text-emerald-500/60 flex-shrink-0" />{f}</div>
        ))}
        <div className="mt-2 pt-2 border-t border-slate-700">
          <p className="text-red-400/70 font-medium mb-1">Never sent:</p>
          {['Passwords or keys', 'Source file names or contents', 'Full local source paths', 'Raw log output'].map(f => (
            <div key={f} className="flex items-center gap-2 text-red-400/60"><AlertTriangle size={11} className="flex-shrink-0" />{f}</div>
          ))}
        </div>
      </div>
      <button
        onClick={() => onChange(!consent)}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
          consent ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/30 text-slate-400'
        }`}
      >
        <div className={`w-4 h-4 rounded border flex items-center justify-center ${consent ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
          {consent && <CheckCircle size={10} className="text-white" />}
        </div>
        Enable health reporting to web app (optional)
      </button>
    </div>
  );
}

function SummaryStep({ draft }: { draft: SetupDraftConfig }) {
  const clientErrors = safetyCheck(draft);
  const rows: Array<[string, string]> = [
    ['Role', draft.role.replace(/_/g, ' ')],
    ['Source folders', draft.source_folders.length > 0 ? `${draft.source_folders.length} folder(s) — paths local only` : 'None'],
    ['Repository', draft.repository_path ? '[configured — path local only]' : 'Not set'],
    ['Hosted storage', draft.hosted_storage_path ? '[configured — path local only]' : 'Not set'],
    ['Hosted quota', draft.hosted_quota_gb > 0 ? `${draft.hosted_quota_gb} GB` : 'Not set'],
    ['Retention keep_last', String(draft.retention_keep_last)],
    ['Retention keep_daily', String(draft.retention_keep_daily)],
    ['Recovery key', 'Stored in OS keychain only — never sent'],
    ['Health reporting', draft.health_report_consent ? 'Enabled' : 'Disabled (default)'],
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-200">Configuration summary</h3>
      {clientErrors.length > 0 && (
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 space-y-1">
          <p className="text-xs text-red-400 font-medium">Fix before saving:</p>
          {clientErrors.map((e, i) => <p key={i} className="text-xs text-red-300">• {e}</p>)}
        </div>
      )}
      <div className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/50 last:border-0">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-300 font-mono">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/10 bg-sky-500/5">
        <Sliders size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/70">All secrets remain local. No data is sent to the web app unless health reporting is enabled.</p>
      </div>
    </div>
  );
}
