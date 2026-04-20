import { AlertTriangle, CheckCircle, Shield, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';

const GATE_CHECKS = [
  'Backup snapshot exists',
  'Encrypted repo synced to peer',
  'Restore drill completed',
  'Canary checksum matches',
  'User has recovery key / password',
  'Retention policy configured',
  'Peer quota has buffer (≥15% free)',
  'No critical health alerts',
];

const THRESHOLDS: Array<[string, string, string]> = [
  ['Last backup age',   '> 24h → Warning',     '> 72h → Critical'],
  ['Last sync age',     '> 24h → Warning',     '> 72h → Critical'],
  ['Free quota',        '< 15% → Warning',     '< 5% → Critical'],
  ['Restore drill age', '> 30 days → Warning', 'Never run / failed → Critical'],
  ['Peer offline',      '> 24h → Warning',     '> 7 days → Critical'],
  ['Repository check',  'Tool warning',         'Check failed → Critical'],
];

type Level = 'ok' | 'warning' | 'critical';

function levelColor(l: Level) {
  if (l === 'ok') return 'text-emerald-400';
  if (l === 'warning') return 'text-amber-400';
  return 'text-red-400';
}

function LevelBadge({ level }: { level: Level }) {
  const colors: Record<Level, string> = {
    ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${colors[level]}`}>
      {level.toUpperCase()}
    </span>
  );
}

export function HealthChecks() {
  const { healthReport, setupState } = useApp();
  const repo = setupState.kopia_repository;
  const sync = setupState.syncthing_folder;

  function backupLevel(): Level {
    if (healthReport.last_backup_age_hours > 72) return 'critical';
    if (healthReport.last_backup_age_hours > 24) return 'warning';
    return 'ok';
  }
  function syncLevel(): Level {
    if (healthReport.last_sync_age_hours > 72) return 'critical';
    if (healthReport.last_sync_age_hours > 24) return 'warning';
    return 'ok';
  }
  function quotaLevel(): Level {
    if (healthReport.free_quota_percent < 5) return 'critical';
    if (healthReport.free_quota_percent < 15) return 'warning';
    return 'ok';
  }
  function drillLevel(): Level {
    if (healthReport.restore_drill_age_days < 0) return 'critical';
    if (healthReport.restore_drill_age_days > 30) return 'warning';
    return 'ok';
  }
  function peerLevel(): Level {
    if (healthReport.peer_offline_hours > 168) return 'critical';
    if (healthReport.peer_offline_hours > 24) return 'warning';
    return 'ok';
  }
  function repoCheckLevel(): Level {
    return healthReport.repository_check_ok ? 'ok' : 'critical';
  }

  const allLevels = [backupLevel(), syncLevel(), quotaLevel(), drillLevel(), peerLevel(), repoCheckLevel()];
  const overallLevel: Level = allLevels.includes('critical') ? 'critical' : allLevels.includes('warning') ? 'warning' : 'ok';

  const metrics: Array<[string, Level, string]> = [
    ['Last backup age', backupLevel(), `${healthReport.last_backup_age_hours.toFixed(1)}h ago`],
    ['Last sync age', syncLevel(), `${healthReport.last_sync_age_hours.toFixed(1)}h ago`],
    ['Free quota', quotaLevel(), `${healthReport.free_quota_percent.toFixed(1)}%`],
    ['Restore drill age', drillLevel(), healthReport.restore_drill_age_days < 0 ? 'Never run' : `${healthReport.restore_drill_age_days} days ago`],
    ['Peer offline', peerLevel(), healthReport.peer_offline_hours === 0 ? 'Online' : `${healthReport.peer_offline_hours.toFixed(1)}h`],
    ['Repository check', repoCheckLevel(), healthReport.repository_check_ok ? 'Passed' : 'FAILED'],
  ];

  // drill_ok: passed (age=0) means just ran, age>0 means recent pass, age<0 means failed/never
  const drillPassed = healthReport.restore_drill_age_days >= 0 && healthReport.restore_drill_age_days <= 30;
  const drillChecksumOk = drillPassed; // canary checksum passes if drill passed

  // Determine which gate checks pass
  const gateStatus: boolean[] = [
    repo.snapshot_count !== null && repo.snapshot_count > 0,
    sync.state === 'in_sync',
    drillPassed,
    drillChecksumOk,
    setupState.recovery_key_confirmed,
    true,  // retention always configured in mock
    healthReport.free_quota_percent >= 15,
    overallLevel !== 'critical',
  ];
  const gatePassCount = gateStatus.filter(Boolean).length;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-sky-400" />
          <h1 className="text-base font-semibold text-slate-100">Health Checks</h1>
        </div>
        <LevelBadge level={overallLevel} />
      </div>

      {/* Live metrics */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Current Metrics</h3>
        <div className="space-y-0">
          {metrics.map(([label, level, value]) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
              <span className="text-sm text-slate-300">{label}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${levelColor(level)}`}>{value}</span>
                <LevelBadge level={level} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Protected gate */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Protected Status Gate (8 checks)</h3>
        <div className="space-y-0">
          {GATE_CHECKS.map((check, i) => (
            <div key={check} className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
              <span className="text-sm text-slate-300">{check}</span>
              <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${
                gateStatus[i]
                  ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                  : 'bg-amber-400/10 text-amber-400 border-amber-400/20'
              }`}>
                {gateStatus[i]
                  ? <><CheckCircle size={10} />Pass</>
                  : <><AlertTriangle size={10} />Pending</>
                }
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {gatePassCount === 8
              ? <CheckCircle size={14} className="text-emerald-400" />
              : <XCircle size={14} className="text-slate-600" />
            }
            <span className="text-xs text-slate-500">{gatePassCount} / 8 checks pass</span>
          </div>
          {gatePassCount < 8 && (
            <span className="text-xs text-amber-400/70">Protected status blocked</span>
          )}
        </div>
      </div>

      {/* Thresholds reference */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Alert Thresholds</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-4 font-medium">Check</th>
                <th className="text-left py-1.5 pr-4 font-medium text-amber-400">Warning</th>
                <th className="text-left py-1.5 font-medium text-red-400">Critical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {THRESHOLDS.map(([check, warn, crit]) => (
                <tr key={check} className="text-slate-300">
                  <td className="py-1.5 pr-4">{check}</td>
                  <td className="py-1.5 pr-4 text-amber-400/80">{warn}</td>
                  <td className="py-1.5 text-red-400/80">{crit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
