import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  Plus,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import type {
  CommandPlanSummary,
  JobState,
  KopiaRepositoryState,
  RepoJobStatus,
  SetupDraftConfig,
} from '../lib/types';
import {
  initializeKopiaRepository,
  pickDirectory,
  planKopiaRepository,
  runRealBackupFromConfig,
} from '../lib/tauri-bridge';
import { formatBytes, kopiaStatusLabel } from '../lib/mock-state';

// ── Shared components ─────────────────────────────────────────────────────────

function RepoStatusBadge({ status }: { status: KopiaRepositoryState['status'] }) {
  const styles: Record<string, string> = {
    check_passed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    initialized: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    configured: 'bg-slate-700 text-slate-400 border-slate-600',
    check_failed: 'bg-red-500/15 text-red-400 border-red-500/30',
    not_configured: 'bg-slate-800 text-slate-500 border-slate-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${styles[status] ?? styles.not_configured}`}>
      {kopiaStatusLabel(status)}
    </span>
  );
}

function JobBadge({ state, label }: { state: JobState; label: string }) {
  if (state === 'idle') return null;
  const styles: Record<JobState, string> = {
    idle: '',
    running: 'text-sky-400',
    done: 'text-emerald-400',
    error: 'text-red-400',
  };
  return (
    <span className={`flex items-center gap-1 text-xs ${styles[state]}`}>
      {state === 'running' && <Loader2 size={10} className="animate-spin" />}
      {state === 'done' && <CheckCircle size={10} />}
      {state === 'error' && <XCircle size={10} />}
      {label}
    </span>
  );
}

// ── Per-repo card ─────────────────────────────────────────────────────────────

function KopiaRepoCard({
  config,
  configIndex,
  repoState,
  jobStatus,
  masterPasswordSet,
  onRunBackup,
}: {
  config: SetupDraftConfig;
  configIndex: number;
  repoState: KopiaRepositoryState | null;
  jobStatus: RepoJobStatus | null;
  masterPasswordSet: boolean;
  onRunBackup: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = repoState?.status ?? 'configured';
  const isRunning = jobStatus?.init_state === 'running' || jobStatus?.backup_state === 'running';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          <HardDrive size={13} className="text-slate-500" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-200">
                {config.label || 'Unnamed backup job'}
              </span>
              <RepoStatusBadge status={status} />
            </div>
            <div className="flex gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
              <span>{config.source_folders.length} source folder{config.source_folders.length !== 1 ? 's' : ''}</span>
              {repoState?.last_snapshot_at && (
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  Last: {new Date(repoState.last_snapshot_at).toLocaleString()}
                </span>
              )}
              {repoState?.snapshot_count != null && (
                <span>{repoState.snapshot_count} snapshot{repoState.snapshot_count !== 1 ? 's' : ''}</span>
              )}
              {jobStatus && (
                <span className="flex items-center gap-2">
                  <JobBadge state={jobStatus.init_state} label="Initialising" />
                  <JobBadge state={jobStatus.backup_state} label="Backing up" />
                </span>
              )}
            </div>
          </div>
          {open ? <ChevronDown size={13} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />}
        </button>

        <button
          onClick={() => onRunBackup(configIndex)}
          disabled={isRunning || !masterPasswordSet}
          title={!masterPasswordSet ? 'Set master password first' : undefined}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors whitespace-nowrap"
        >
          {isRunning ? <><Loader2 size={10} className="animate-spin" /> Running…</> : 'Run Backup Now'}
        </button>
      </div>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-slate-800 px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500 mb-0.5">Repository size</div>
              <div className="text-slate-300">{formatBytes(repoState?.repo_size_bytes ?? null)}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Snapshots</div>
              <div className="text-slate-300">{repoState?.snapshot_count ?? '—'}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Last snapshot</div>
              <div className="text-slate-300">
                {repoState?.last_snapshot_at ? new Date(repoState.last_snapshot_at).toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Kopia status</div>
              <div className="text-slate-300">{kopiaStatusLabel(status)}</div>
            </div>
          </div>

          {jobStatus?.error && (
            <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
              <XCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{jobStatus.error}</span>
            </div>
          )}

          <div>
            <div className="text-xs text-slate-500 mb-1.5">Source folders</div>
            {config.source_folders.length > 0 ? (
              <div className="space-y-1">
                {config.source_folders.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <FolderOpen size={11} className="text-slate-500 flex-shrink-0" />
                    <code className="truncate">{f}</code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600">No source folders configured.</div>
            )}
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1.5">Retention policy</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
              {[
                ['Keep last', `${config.retention_keep_last} snapshots`],
                ['Keep daily', `${config.retention_keep_daily} days`],
                ['Keep weekly', `${config.retention_keep_weekly} weeks`],
                ['Keep monthly', `${config.retention_keep_monthly} months`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-slate-300 font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Advanced: add backup job ──────────────────────────────────────────────────

function AddBackupJobForm({ masterPasswordSet }: { masterPasswordSet: boolean }) {
  const [open, setOpen] = useState(false);
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [repoPath, setRepoPath] = useState('');
  const [newSource, setNewSource] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickSource() {
    const dir = await pickDirectory();
    if (dir) setSourceFolders(prev => prev.includes(dir) ? prev : [...prev, dir]);
  }

  async function runJob() {
    if (!repoPath.trim() || sourceFolders.length === 0) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      await initializeKopiaRepository(repoPath.trim());
      const r = await runRealBackupFromConfig(sourceFolders, repoPath.trim());
      setResult(`Backup completed — snapshot ${r.snapshot_id} at ${new Date(r.timestamp).toLocaleString()}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function addManualSource() {
    const s = newSource.trim();
    if (s && !sourceFolders.includes(s)) { setSourceFolders(prev => [...prev, s]); setNewSource(''); }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wide hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Plus size={13} className="text-slate-500" />
          Advanced — Add a backup job manually
        </div>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {open && (
        <div className="border-t border-slate-800 p-4 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Quickly wire up source folder(s) → encrypted repository without re-running the Setup Wizard.
            Kopia will initialise the repository (if needed) and run a snapshot immediately.
          </p>

          {!masterPasswordSet && (
            <div className="flex items-center gap-2 p-2.5 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300">
              <AlertTriangle size={12} className="flex-shrink-0" />
              Master password not set — set it in the Recovery Key tab before running a backup.
            </div>
          )}

          {/* Source folders */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400">Source folders</div>
            {sourceFolders.map(f => (
              <div key={f} className="flex items-center gap-2 text-xs">
                <FolderOpen size={11} className="text-slate-500 flex-shrink-0" />
                <code className="flex-1 text-slate-300 truncate">{f}</code>
                <button onClick={() => setSourceFolders(prev => prev.filter(x => x !== f))} className="text-slate-600 hover:text-red-400">×</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={newSource}
                onChange={e => setNewSource(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addManualSource()}
                placeholder="/path/to/source"
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button onClick={addManualSource} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200">Add</button>
              <button onClick={pickSource} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200 flex items-center gap-1">
                <FolderOpen size={11} /> Browse
              </button>
            </div>
          </div>

          {/* Repository path */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-400">Encrypted repository path (destination)</div>
            <input
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              placeholder="/path/to/encrypted-repo"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
            <p className="text-xs text-slate-600">Must not overlap with any source folder. Kopia will encrypt everything written here.</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {result && (
            <div className="flex items-start gap-2 p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-300">
              <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
              {result}
            </div>
          )}

          <button
            onClick={runJob}
            disabled={running || !masterPasswordSet || sourceFolders.length === 0 || !repoPath.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
          >
            {running ? <><Loader2 size={11} className="animate-spin" /> Running…</> : 'Run backup job'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function BackupPlan() {
  const navigate = useNavigate();
  const {
    setupState,
    wizardConfig,
    wizardConfigs,
    masterPasswordSet,
    repoJobStatuses,
    triggerRepoBackup,
  } = useApp();
  const repo = setupState.kopia_repository;
  const repoPath = wizardConfig?.repository_path ?? '';

  // ── Command plan preview (collapsible, advanced) ──────────────────────────
  const [commandPlans, setCommandPlans] = useState<CommandPlanSummary[]>([]);
  const [commandPlanOpen, setCommandPlanOpen] = useState(false);
  useEffect(() => {
    planKopiaRepository(repoPath || '[repo-path]', 'kopia').then(setCommandPlans);
  }, [repoPath]);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <HardDrive size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Backup Plan</h1>
      </div>

      {/* Master password gate */}
      {!masterPasswordSet && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <KeyRound size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-amber-300">Master encryption password not set</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Set it once in the Recovery Key tab. Kopia uses it for all encrypted repositories — you'll only need to enter it again after restarting the app.
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/recovery')}
            className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap flex-shrink-0"
          >
            Set up <ChevronRight size={11} />
          </button>
        </div>
      )}

      {/* No repos yet */}
      {wizardConfigs.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 text-center space-y-2">
          <div className="text-xs text-slate-500">No backup repositories configured yet.</div>
          <button
            onClick={() => navigate('/setup')}
            className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 mx-auto"
          >
            Run the Setup Wizard <ChevronRight size={11} />
          </button>
        </div>
      )}

      {/* Configured repositories */}
      {wizardConfigs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Configured Repositories ({wizardConfigs.length})
            </h3>
            <button onClick={() => navigate('/setup')} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
              <Plus size={11} /> Add another
            </button>
          </div>

          {wizardConfigs.map((cfg, i) => (
            <KopiaRepoCard
              key={cfg.repository_path || i}
              config={cfg}
              configIndex={i}
              repoState={cfg.repository_path === wizardConfig?.repository_path ? repo : null}
              jobStatus={repoJobStatuses[i] ?? null}
              masterPasswordSet={masterPasswordSet}
              onRunBackup={triggerRepoBackup}
            />
          ))}
        </div>
      )}

      {/* Advanced: add backup job */}
      <AddBackupJobForm masterPasswordSet={masterPasswordSet} />

      {/* Kopia command plan (collapsible) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setCommandPlanOpen(v => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wide hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal size={13} className="text-slate-500" />
            Kopia Command Plan (redacted)
          </div>
          {commandPlanOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {commandPlanOpen && (
          <>
            <div className="divide-y divide-slate-800/50">
              {commandPlans.map(plan => (
                <div key={plan.label} className="px-4 py-2.5">
                  <div className="text-xs text-slate-500 mb-0.5">{plan.label}</div>
                  <code className="text-xs font-mono text-sky-300/80 break-all">{plan.display_command}</code>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 bg-slate-800/20 border-t border-slate-800">
              <p className="text-xs text-slate-600">Paths and secrets replaced with [REDACTED]. Real commands use KOPIA_PASSWORD env var.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
