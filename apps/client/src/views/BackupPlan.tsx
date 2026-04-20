import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, HardDrive, Terminal, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { CommandPlanSummary, MockBackupResult, MockCheckResult } from '../lib/types';
import { planKopiaRepository, runMockBackup, runMockRepositoryCheck } from '../lib/tauri-bridge';
import { formatBytes, kopiaStatusLabel } from '../lib/mock-state';

export function BackupPlan() {
  const { setupState, wizardConfig, addLogLine, updateHealthFromCheckResult } = useApp();
  const repo = setupState.kopia_repository;

  const [commandPlans, setCommandPlans] = useState<CommandPlanSummary[]>([]);
  const [backupResult, setBackupResult] = useState<MockBackupResult | null>(null);
  const [checkResult, setCheckResult] = useState<MockCheckResult | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [checkRunning, setCheckRunning] = useState(false);

  // Use the real repository path from wizard config if available
  const repoPath = wizardConfig?.repository_path || '[repo-path]';

  useEffect(() => {
    planKopiaRepository(repoPath, 'kopia').then(setCommandPlans);
  }, [repoPath]);

  async function handleRunBackup() {
    setBackupRunning(true);
    try {
      const result = await runMockBackup();
      setBackupResult(result);
      addLogLine(
        `kopia snapshot create [source] → snapshot_id=${result.snapshot_id}`,
        result.log_line,
      );
    } finally {
      setBackupRunning(false);
    }
  }

  async function handleRunCheck(pass: boolean) {
    setCheckRunning(true);
    try {
      const result = await runMockRepositoryCheck(pass);
      setCheckResult(result);
      addLogLine('kopia repository check', result.log_line);
      // Update shared health state and kopia_repository.status so readiness recomputes
      updateHealthFromCheckResult(result);
    } finally {
      setCheckRunning(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <HardDrive size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Backup Plan</h1>
      </div>

      {/* Repository status */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Kopia Repository</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Status</div>
            <div className={`font-medium ${repo.status === 'check_passed' ? 'text-emerald-400' : repo.status === 'check_failed' ? 'text-red-400' : 'text-amber-400'}`}>
              {kopiaStatusLabel(repo.status)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Repository size</div>
            <div className="text-slate-200">{formatBytes(repo.repo_size_bytes)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Snapshots</div>
            <div className="text-slate-200">{repo.snapshot_count ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Last snapshot</div>
            <div className="text-slate-200 text-xs">
              {repo.last_snapshot_at ? new Date(repo.last_snapshot_at).toLocaleString() : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Command previews */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800 flex items-center gap-2">
          <Terminal size={14} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Kopia Command Plan (redacted)</span>
        </div>
        <div className="divide-y divide-slate-800/50">
          {commandPlans.map(plan => (
            <div key={plan.label} className="px-4 py-2.5">
              <div className="text-xs text-slate-500 mb-0.5">{plan.label}</div>
              <code className="text-xs font-mono text-sky-300/80 break-all">{plan.display_command}</code>
            </div>
          ))}
          {commandPlans.length === 0 && (
            <div className="px-4 py-3 text-xs text-slate-600">Loading command plans…</div>
          )}
        </div>
        <div className="px-4 py-2 bg-slate-800/20 border-t border-slate-800">
          <p className="text-xs text-slate-600">
            Paths and secrets replaced with [REDACTED]. Real commands use KOPIA_PASSWORD env var — never CLI args.
          </p>
        </div>
      </div>

      {/* Retention plan */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Retention Policy</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['Keep last', '5 snapshots'],
            ['Keep daily', '7 days'],
            ['Keep weekly', '4 weeks'],
            ['Keep monthly', '3 months'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-slate-500 text-xs">{label}</span>
              <span className="text-slate-300 text-xs font-mono">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mock backup actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mock Actions</h3>
        <p className="text-xs text-slate-500">These run mock operations — no real files are read or written.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRunBackup}
            disabled={backupRunning}
            className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
          >
            {backupRunning ? 'Running…' : 'Run mock backup'}
          </button>
          <button
            onClick={() => handleRunCheck(true)}
            disabled={checkRunning}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
          >
            {checkRunning ? 'Running…' : 'Mock check (pass)'}
          </button>
          <button
            onClick={() => handleRunCheck(false)}
            disabled={checkRunning}
            className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 text-xs rounded border border-red-700/30 transition-colors"
          >
            Mock check (fail)
          </button>
        </div>

        {backupResult && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
            <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="text-emerald-300 font-medium">Mock backup completed</div>
              <div className="text-slate-400">Snapshot: <code className="text-slate-300">{backupResult.snapshot_id}</code></div>
              <div className="text-slate-400">{backupResult.files_changed} files · {formatBytes(backupResult.size_bytes)} · {(backupResult.duration_ms / 1000).toFixed(1)}s</div>
              <div className="text-slate-500 font-mono mt-1 text-xs">{backupResult.log_line}</div>
            </div>
          </div>
        )}

        {checkResult && (
          <div className={`flex items-start gap-2.5 p-3 rounded-lg border ${checkResult.passed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
            {checkResult.passed
              ? <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              : <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
            }
            <div className="text-xs space-y-0.5">
              <div className={`font-medium ${checkResult.passed ? 'text-emerald-300' : 'text-red-300'}`}>{checkResult.message}</div>
              <div className="text-slate-500 font-mono mt-1">{checkResult.log_line}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-500/10 bg-sky-500/5">
        <AlertTriangle size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/70 leading-relaxed">
          Source folders shown as [REDACTED]. The web app never receives source paths, file names, or raw logs.
        </p>
      </div>
    </div>
  );
}
