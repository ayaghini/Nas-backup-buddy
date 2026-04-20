import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import type { HealthCheckData } from '../types';

type CheckLevel = 'ok' | 'warning' | 'critical';

interface HealthRowProps {
  label: string;
  value: string;
  level: CheckLevel;
  detail?: string;
}

function HealthRow({ label, value, level, detail }: HealthRowProps) {
  const cfg: Record<CheckLevel, { icon: React.ReactNode; color: string; bg: string }> = {
    ok:       { icon: <CheckCircle size={14} />,    color: 'text-emerald-400', bg: '' },
    warning:  { icon: <AlertTriangle size={14} />,  color: 'text-amber-400',   bg: 'bg-amber-400/5' },
    critical: { icon: <XCircle size={14} />,        color: 'text-red-400',     bg: 'bg-red-400/5' },
  };
  const { icon, color, bg } = cfg[level];

  return (
    <div className={`flex items-start justify-between gap-2 py-2.5 px-3 rounded ${bg}`}>
      <div className="flex items-start gap-2 min-w-0">
        <span className={`mt-0.5 flex-shrink-0 ${color}`}>{icon}</span>
        <div className="min-w-0">
          <span className="text-sm text-slate-200">{label}</span>
          {detail && <p className="text-xs text-slate-400 mt-0.5">{detail}</p>}
        </div>
      </div>
      <span className={`text-sm font-mono flex-shrink-0 ${color}`}>{value}</span>
    </div>
  );
}

interface HealthCheckPanelProps {
  health: HealthCheckData;
}

function backupLevel(hours: number): CheckLevel {
  if (hours > 72) return 'critical';
  if (hours > 24) return 'warning';
  return 'ok';
}

function syncLevel(hours: number): CheckLevel {
  if (hours > 72) return 'critical';
  if (hours > 24) return 'warning';
  return 'ok';
}

function quotaLevel(pct: number): CheckLevel {
  if (pct < 5)  return 'critical';
  if (pct < 15) return 'warning';
  return 'ok';
}

function drillLevel(days: number): CheckLevel {
  if (days < 0) return 'critical'; // never run
  if (days > 30) return 'warning';
  return 'ok';
}

function peerOfflineLevel(hours: number): CheckLevel {
  if (hours > 7 * 24) return 'critical';
  if (hours > 24)     return 'warning';
  return 'ok';
}

function repoCheckLevel(status: HealthCheckData['repositoryCheckStatus']): CheckLevel {
  if (status === 'failed')  return 'critical';
  if (status === 'warning') return 'warning';
  return 'ok';
}

function fmtHours(h: number): string {
  if (h === 0) return 'Online';
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

export function HealthCheckPanel({ health }: HealthCheckPanelProps) {
  return (
    <div className="space-y-1">
      <HealthRow
        label="Last backup"
        value={`${health.lastBackupAgeHours}h ago`}
        level={backupLevel(health.lastBackupAgeHours)}
        detail={
          health.lastBackupAgeHours > 24
            ? `Warning threshold: 24h · Critical threshold: 72h`
            : undefined
        }
      />
      <HealthRow
        label="Last sync"
        value={`${health.lastSyncAgeHours}h ago`}
        level={syncLevel(health.lastSyncAgeHours)}
        detail={
          health.lastSyncAgeHours > 24
            ? `Warning threshold: 24h · Critical threshold: 72h`
            : undefined
        }
      />
      <HealthRow
        label="Free quota"
        value={`${health.freeQuotaPercent.toFixed(1)}%`}
        level={quotaLevel(health.freeQuotaPercent)}
        detail={
          health.freeQuotaPercent < 15
            ? `Warning threshold: 15% · Critical threshold: 5%`
            : undefined
        }
      />
      <HealthRow
        label="Restore drill"
        value={
          health.restoreDrillAgeDays < 0
            ? 'Never run'
            : `${health.restoreDrillAgeDays}d ago`
        }
        level={drillLevel(health.restoreDrillAgeDays)}
        detail={
          health.restoreDrillAgeDays > 30
            ? `Warning threshold: 30 days old`
            : undefined
        }
      />
      <HealthRow
        label="Peer connectivity"
        value={
          health.peerOfflineHours === 0
            ? 'Online'
            : fmtHours(health.peerOfflineHours)
        }
        level={peerOfflineLevel(health.peerOfflineHours)}
        detail={
          health.peerOfflineHours > 24
            ? `Warning: >24h · Critical: >7 days`
            : undefined
        }
      />
      <HealthRow
        label="Repository integrity"
        value={
          health.repositoryCheckStatus === 'ok'
            ? 'Passed'
            : health.repositoryCheckStatus === 'warning'
            ? 'Warning'
            : 'Failed'
        }
        level={repoCheckLevel(health.repositoryCheckStatus)}
        detail={health.repositoryCheckMessage}
      />
    </div>
  );
}

export { backupLevel, syncLevel, quotaLevel, drillLevel, peerOfflineLevel };
