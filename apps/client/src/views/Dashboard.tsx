import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronRight,
  HardDrive, KeyRound, RotateCcw, Server, Wifi, XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getTailscaleDetail } from '../lib/tauri-bridge';
import type { TailscaleDetail } from '../lib/types';
import { formatBytes, kopiaStatusLabel, readinessLabel, toolStatusLabel } from '../lib/mock-state';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function remoteStatusLabel(status: string): string {
  switch (status) {
    case 'not_configured': return 'Not configured';
    case 'reachable': return 'Reachable';
    case 'tcp_port_reachable': return 'TCP open';
    case 'unreachable': return 'Unreachable';
    case 'auth_failed': return 'Auth failed';
    case 'host_key_mismatch': return 'Host key mismatch';
    case 'quota_warning': return 'Quota warning';
    case 'error': return 'Error';
    default: return status;
  }
}

// Maps a blocking reason fragment to the route that resolves it.
const REASON_ROUTES: Array<{ fragment: string; to: string; label: string }> = [
  { fragment: 'recovery key',    to: '/recovery',      label: 'Recovery Key →' },
  { fragment: 'Recovery key',    to: '/recovery',      label: 'Recovery Key →' },
  { fragment: 'password',        to: '/recovery',      label: 'Set password →' },
  { fragment: 'not configured',  to: '/setup',         label: 'Run wizard →' },
  { fragment: 'repository',      to: '/backup',        label: 'Backup Plan →' },
  { fragment: 'authentication',  to: '/peer-storage',  label: 'Peer Storage →' },
  { fragment: 'host key',        to: '/peer-storage',  label: 'Peer Storage →' },
  { fragment: 'unreachable',     to: '/peer-storage',  label: 'Peer Storage →' },
  { fragment: 'unreachable for', to: '/peer-storage',  label: 'Peer Storage →' },
];

function actionForReason(reason: string): { to: string; label: string } | null {
  for (const { fragment, to, label } of REASON_ROUTES) {
    if (reason.includes(fragment)) return { to, label };
  }
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusCard({
  icon, iconColor, title, subtitle, detail, borderColor, action,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  subtitle: string;
  detail?: React.ReactNode;
  borderColor?: string;
  action?: { label: string; to: string };
}) {
  const navigate = useNavigate();
  return (
    <div className={`bg-slate-900 border rounded-lg p-4 flex items-start gap-3 ${borderColor ?? 'border-slate-800'}`}>
      <div className={`p-2 rounded-lg flex-shrink-0 ${iconColor}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-100 truncate">{title}</div>
        <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
        {detail && <div className="text-xs mt-1">{detail}</div>}
        {action && (
          <button
            onClick={() => navigate(action.to)}
            className="text-xs text-sky-400 hover:text-sky-300 mt-1 flex items-center gap-0.5"
          >
            {action.label} <ChevronRight size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function CheckRow({ done, label, optional }: { done: boolean; label: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done
        ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
        : optional
          ? <div className="w-3.5 h-3.5 rounded-full border border-slate-700 flex-shrink-0" />
          : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
      }
      <span className={done ? 'text-slate-300' : optional ? 'text-slate-600' : 'text-slate-400'}>
        {label}
        {optional && <span className="text-slate-600 ml-1">(optional)</span>}
      </span>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const navigate = useNavigate();
  const {
    setupState, readiness, toolStatus, realLab,
    masterPasswordSet, wizardConfigs,
  } = useApp();

  const [tailscale, setTailscale] = useState<TailscaleDetail | null>(null);

  // Poll Tailscale status once on mount — fast read-only CLI probe.
  useEffect(() => {
    getTailscaleDetail().then(setTailscale).catch(() => {});
  }, []);

  const repo = setupState.kopia_repository;
  const remote = setupState.remote_repository;
  const drillPassed = realLab.drill?.result === 'pass';
  const hasBackup = realLab.backup !== null || (repo.last_snapshot_at != null);
  const kopiaReady = toolStatus.kopia === 'ready' || toolStatus.kopia === 'present';

  const backupAgo = realLab.backup?.timestamp
    ?? repo.last_snapshot_at
    ?? null;
  const backupLabel = backupAgo
    ? new Date(backupAgo).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : 'Never';

  const remoteOk = remote.status === 'reachable';
  const hasSftpConfig = wizardConfigs.some(c => c.overlay_host?.trim());

  // Overlay: derive from Tailscale detail if available, else from TCP probe result.
  const overlayConnected = tailscale?.connected === true || remoteOk;
  const overlayLabel = tailscale
    ? tailscale.connected
      ? `Tailscale — ${tailscale.self_dns_name ?? tailscale.self_ips[0] ?? 'connected'}`
      : tailscale.installed
        ? tailscale.needs_login ? 'Tailscale — needs login' : 'Tailscale — disconnected'
        : 'No overlay detected'
    : remoteOk
      ? 'Overlay reachable (TCP)'
      : 'Not verified';

  const setupChecks = [
    { done: masterPasswordSet,           label: 'Encryption password set (keychain)',   optional: false },
    { done: kopiaReady,                  label: 'Kopia binary available',               optional: false },
    { done: remote.status === 'reachable', label: 'SFTP repository connected',           optional: false },
    { done: hasBackup,                   label: 'At least one backup completed',        optional: false },
    { done: drillPassed,                 label: 'Restore drill passed',                 optional: false },
  ];
  const requiredChecks = setupChecks.filter(c => !c.optional);
  const passCount = requiredChecks.filter(c => c.done).length;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-100 mb-1">Dashboard</h1>
          <p className="text-sm text-slate-400">Local backup status — no data leaves this device.</p>
        </div>
        <ReadinessBadge readiness={readiness?.readiness} />
      </div>

      {/* Password gate */}
      {!masterPasswordSet && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <KeyRound size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-300">Encryption password not set</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Set it once in Recovery Key or directly in Peer Storage when connecting a repository.
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/recovery')}
            className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap flex-shrink-0"
          >
            Set password <ChevronRight size={11} />
          </button>
        </div>
      )}

      {/* Blocking reasons */}
      {readiness && readiness.blocking_reasons.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-1.5">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={14} className="text-red-400" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Setup Blocked</span>
          </div>
          {readiness.blocking_reasons.map((r, i) => {
            const action = actionForReason(r);
            return (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-2 text-sm text-red-300 min-w-0">
                  <span className="text-red-500 mt-0.5 flex-shrink-0">•</span>
                  <span className="truncate">{r}</span>
                </div>
                {action && (
                  <button
                    onClick={() => navigate(action.to)}
                    className="flex items-center gap-0.5 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap flex-shrink-0"
                  >
                    {action.label} <ChevronRight size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Warnings */}
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

      {/* Status cards — 2×2 */}
      <div className="grid grid-cols-2 gap-3">
        {/* Overlay / Tailscale */}
        <StatusCard
          icon={<Wifi size={16} />}
          iconColor={overlayConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/50 text-slate-400'}
          title={overlayLabel}
          subtitle="Overlay network"
          borderColor={overlayConnected ? 'border-emerald-800/40' : 'border-slate-800'}
          detail={
            tailscale && !tailscale.connected && tailscale.installed
              ? <span className="text-amber-400/70">
                  {tailscale.needs_login ? 'Run: tailscale up' : 'Check Tailscale status'}
                </span>
              : tailscale?.connected && tailscale.tailnet_name
                ? <span className="text-slate-500">{tailscale.tailnet_name}</span>
                : !tailscale && hasSftpConfig && !remoteOk
                  ? <span className="text-slate-600">Start overlay before backup</span>
                  : null
          }
          action={!overlayConnected ? { label: 'Overlay setup →', to: '/overlay' } : undefined}
        />

        {/* Last backup */}
        <StatusCard
          icon={<HardDrive size={16} />}
          iconColor={hasBackup ? 'bg-sky-500/10 text-sky-400' : 'bg-slate-700/50 text-slate-400'}
          title={backupLabel}
          subtitle="Last backup"
          borderColor="border-slate-800"
          detail={
            <span className={
              repo.status === 'check_passed' ? 'text-emerald-400' :
              repo.status === 'check_failed' ? 'text-red-400' :
              'text-slate-500'
            }>
              {kopiaStatusLabel(repo.status)}
              {repo.repo_size_bytes ? ` · ${formatBytes(repo.repo_size_bytes)}` : ''}
            </span>
          }
          action={!hasBackup ? { label: 'Run backup →', to: '/backup' } : undefined}
        />

        {/* Remote SFTP target */}
        <StatusCard
          icon={<Server size={16} />}
          iconColor={remoteOk ? 'bg-emerald-500/10 text-emerald-400' : hasSftpConfig ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-700/50 text-slate-400'}
          title={remoteStatusLabel(remote.status)}
          subtitle="SFTP repository (peer storage)"
          borderColor={remoteOk ? 'border-emerald-800/40' : hasSftpConfig && !remoteOk ? 'border-amber-800/30' : 'border-slate-800'}
          detail={
            remoteOk
              ? <span className="text-emerald-400/70">Kopia SFTP repository reachable</span>
              : remote.status === 'auth_failed'
                ? <span className="text-red-400/80">SSH auth failed — check key config</span>
                : remote.status === 'host_key_mismatch'
                  ? <span className="text-red-400/80">Host key changed — verify peer identity</span>
                  : !hasSftpConfig
                    ? <span className="text-slate-600">Configure in Setup Wizard</span>
                    : <span className="text-amber-400/70">Run SFTP Verification in Peer Storage</span>
          }
          action={hasSftpConfig && !remoteOk ? { label: 'Peer Storage →', to: '/peer-storage' } : undefined}
        />

        {/* Restore drill */}
        <StatusCard
          icon={<RotateCcw size={16} />}
          iconColor={drillPassed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}
          title={drillPassed ? 'Passed' : realLab.drill ? 'Failed' : 'Never run'}
          subtitle="Restore drill"
          borderColor={drillPassed ? 'border-emerald-800/50' : 'border-slate-800'}
          detail={
            drillPassed
              ? <span className="text-emerald-400/70">Canary checksum verified</span>
              : <span className="text-amber-400/70">Required for Protected status</span>
          }
          action={!drillPassed ? { label: 'Run drill →', to: '/restore' } : undefined}
        />
      </div>

      {/* Kopia tool + password row */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Backup Engine</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Kopia</span>
            <span className={`text-xs font-medium ${
              toolStatus.kopia === 'ready' ? 'text-emerald-400' :
              toolStatus.kopia === 'present' ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {toolStatusLabel(toolStatus.kopia)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Encryption password</span>
            <span className={`text-xs font-medium ${masterPasswordSet ? 'text-emerald-400' : 'text-amber-400'}`}>
              {masterPasswordSet ? 'Set (OS keychain)' : 'Not set'}
            </span>
          </div>
        </div>
        {toolStatus.kopia === 'missing' && (
          <p className="text-xs text-red-400/70 mt-2">
            Kopia not found — install it or use the bundled binary.
          </p>
        )}
        {toolStatus.kopia === 'present' && (
          <p className="text-xs text-slate-600 mt-2">
            Found on PATH but not checksum-verified. Bundled binary required for production.
          </p>
        )}
      </div>

      {/* Setup checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Setup Checklist</h3>
        <div className="space-y-1.5">
          {setupChecks.map(({ done, label, optional }) => (
            <CheckRow key={label} done={done} label={label} optional={optional} />
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {passCount} / {requiredChecks.length} required checks pass
          </span>
          {passCount === requiredChecks.length && (
            <span className="text-xs text-emerald-400/70 flex items-center gap-1">
              <CheckCircle size={10} /> All checks pass
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
