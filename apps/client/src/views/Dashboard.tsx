import { Activity, AlertTriangle, CheckCircle, HardDrive, RotateCcw, Shield, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  formatBytes,
  kopiaStatusLabel,
  readinessLabel,
  roleLabel,
  syncthingStateLabel,
  toolStatusLabel,
} from '../lib/mock-state';

function ReadinessBadge({ readiness }: { readiness: string | undefined }) {
  if (!readiness) return null;
  const colors: Record<string, string> = {
    blocked: 'bg-red-500/10 text-red-400 border-red-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    ready_for_test_backup: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    ready_for_restore_drill: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    protected_eligible: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-medium ${colors[readiness] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
      {readinessLabel(readiness)}
    </span>
  );
}

function ToolBadge({ status }: { status: string }) {
  const ok = status === 'ready';
  return (
    <span className={`text-xs font-medium ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {toolStatusLabel(status)}
    </span>
  );
}

function CheckRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done
        ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
        : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
      }
      <span className={done ? 'text-slate-300' : 'text-slate-400'}>{label}</span>
    </div>
  );
}

export function Dashboard() {
  const { setupState, readiness, offlineMode, toolStatus } = useApp();
  const repo = setupState.kopia_repository;
  const sync = setupState.syncthing_folder;

  const backupAgo = repo.last_snapshot_at
    ? new Date(repo.last_snapshot_at).toLocaleString()
    : 'Never';
  const syncAgo = sync.last_sync_at
    ? new Date(sync.last_sync_at).toLocaleString()
    : 'Never';

  const setupChecks = [
    { done: repo.status !== 'not_configured', label: 'Kopia repository configured' },
    { done: repo.status === 'check_passed', label: 'Repository check passed' },
    { done: sync.state !== 'not_configured', label: 'Syncthing folder configured' },
    { done: sync.state === 'in_sync', label: 'Repository synced to peer' },
    { done: setupState.recovery_key_confirmed, label: 'Recovery key saved externally' },
    { done: false, label: 'Restore drill completed' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-100 mb-1">Dashboard</h1>
          <p className="text-sm text-slate-400">Local backup status — no data leaves this device.</p>
        </div>
        <ReadinessBadge readiness={readiness?.readiness} />
      </div>

      {offlineMode && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>Offline / mock mode.</strong> The web API is not connected.
            Health data shown here is from local mock state only.
          </span>
        </div>
      )}

      {/* Blocking reasons */}
      {readiness && readiness.blocking_reasons.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-1.5">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={14} className="text-red-400" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Setup Blocked</span>
          </div>
          {readiness.blocking_reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-red-300">
              <span className="text-red-500 mt-0.5">•</span>{r}
            </div>
          ))}
        </div>
      )}

      {/* Warning reasons */}
      {readiness && readiness.blocking_reasons.length === 0 && readiness.warning_reasons.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 space-y-1.5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Warnings</span>
          </div>
          {readiness.warning_reasons.map((r, i) => (
            <div key={i} className="text-sm text-amber-300">• {r}</div>
          ))}
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg flex-shrink-0 bg-sky-500/10 text-sky-400"><HardDrive size={16} /></div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{backupAgo}</div>
            <div className="text-xs text-slate-400 mt-0.5">Last Backup</div>
            <div className="text-xs text-slate-500 mt-0.5">{kopiaStatusLabel(repo.status)}</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg flex-shrink-0 bg-sky-500/10 text-sky-400"><Activity size={16} /></div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{syncAgo}</div>
            <div className="text-xs text-slate-400 mt-0.5">Last Sync</div>
            <div className="text-xs text-slate-500 mt-0.5">{syncthingStateLabel(sync.state)}</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg flex-shrink-0 bg-amber-500/10 text-amber-400"><RotateCcw size={16} /></div>
          <div>
            <div className="text-sm font-bold text-slate-100">Never run</div>
            <div className="text-xs text-slate-400 mt-0.5">Restore Drill</div>
            <div className="text-xs text-red-400 mt-0.5">Blocks Protected status</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg flex-shrink-0 bg-slate-700/50 text-slate-400"><Shield size={16} /></div>
          <div>
            <div className="text-sm font-bold text-slate-100">{roleLabel(setupState.role)}</div>
            <div className="text-xs text-slate-400 mt-0.5">Current Role</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {formatBytes(repo.repo_size_bytes)} in repo
            </div>
          </div>
        </div>
      </div>

      {/* Tool status */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tool Status</h3>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Kopia (backup engine)</span>
            <ToolBadge status={toolStatus.kopia} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Syncthing (transport)</span>
            <ToolBadge status={toolStatus.syncthing} />
          </div>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          {toolStatus.kopia === 'missing'
            ? 'Tools not found on PATH. Install kopia and syncthing, or run via Tauri for bundled binaries.'
            : toolStatus.kopia === 'present'
            ? 'Tools found on PATH but not checksum-verified. Checksum verification requires bundled manifest.'
            : 'Tools detected and verified.'}
        </p>
      </div>

      {/* Setup checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Setup Checklist</h3>
        <div className="space-y-1.5">
          {setupChecks.map(({ done, label }) => (
            <CheckRow key={label} done={done} label={label} />
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {setupChecks.filter(c => c.done).length} / {setupChecks.length} checks pass
          </span>
          <span className="text-xs text-slate-500">
            Peer: {sync.peer_device_id ?? '—'} {sync.peer_connected ? '· online' : '· offline'}
          </span>
        </div>
      </div>
    </div>
  );
}
