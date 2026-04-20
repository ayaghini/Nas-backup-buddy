import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';
import { getUserById, CURRENT_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { MatchStatusPill, CheckPill } from '../components/StatusPill';
import { HealthCheckPanel } from '../components/HealthCheckRow';
import type { ProtectedGateChecks } from '../types';

const GATE_LABELS: [keyof ProtectedGateChecks, string][] = [
  ['backupSnapshotExists',        'Backup snapshot exists'],
  ['encryptedRepoSyncedToPeer',   'Encrypted repo synced to peer'],
  ['restoreDrillCompleted',       'Restore drill completed'],
  ['canaryChecksumMatches',       'Canary checksum matches'],
  ['userHasRecoveryKey',          'User has recovery key/password'],
  ['retentionPolicyConfigured',   'Retention policy configured'],
  ['peerQuotaHasBuffer',          'Peer quota has buffer (≥15% free)'],
  ['noCriticalAlerts',            'No critical health alerts'],
];

export function HealthChecks() {
  const { matches } = useApp();

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-base font-semibold text-slate-100 mb-1">Health Checks</h2>
        <p className="text-sm text-slate-400">
          Health status is computed from six live metrics per match. All eight Protected gate
          checks must pass before a match can be marked Protected.
        </p>
      </div>

      {/* Thresholds reference */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Alert Thresholds
        </h3>
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
              {[
                ['Last backup age',    '> 24 hours',     '> 72 hours'],
                ['Last sync age',      '> 24 hours',     '> 72 hours'],
                ['Free quota',         '< 15%',          '< 5%'],
                ['Restore drill age',  '> 30 days',      'Failed or never run'],
                ['Peer offline',       '> 24 hours',     '> 7 days'],
                ['Repository check',   'Tool warning',   'Check failed'],
              ].map(([check, warn, crit]) => (
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

      {/* Per-match health */}
      {matches.map((match) => {
        const peer = getUserById(
          match.dataOwnerId === CURRENT_USER.id ? match.storageHostId : match.dataOwnerId
        );
        const allGatePassed = Object.values(match.gate).every(Boolean);
        const gatePassCount = Object.values(match.gate).filter(Boolean).length;

        return (
          <div key={match.id} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            {/* Match header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800/40 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium text-slate-200">{peer?.name}</span>
                <span className="text-xs text-slate-500 font-mono hidden sm:inline">@{peer?.handle}</span>
                <MatchStatusPill status={match.status} />
              </div>
              <Link
                to={`/matches/${match.id}`}
                className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
              >
                Match detail <ArrowRight size={11} />
              </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
              {/* Live health checks */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={13} className="text-slate-500" />
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Live Health Metrics
                  </h4>
                </div>
                <HealthCheckPanel health={match.health} />
              </div>

              {/* Protected gate */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={13} className="text-slate-500" />
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Protected Gate
                    </h4>
                  </div>
                  <span className={`text-xs font-mono ${allGatePassed ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {gatePassCount}/8
                  </span>
                </div>

                <div className="space-y-1">
                  {GATE_LABELS.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between py-1.5
                      border-b border-slate-800/40 last:border-0">
                      <span className="text-xs text-slate-300">{label}</span>
                      <CheckPill pass={match.gate[key]} />
                    </div>
                  ))}
                </div>

                {/* Overall result */}
                <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-2">
                  {allGatePassed ? (
                    <>
                      <CheckCircle size={14} className="text-emerald-400" />
                      <span className="text-xs text-emerald-400">Eligible for Protected status</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} className="text-amber-400" />
                      <span className="text-xs text-amber-400">
                        {8 - gatePassCount} check{8 - gatePassCount !== 1 ? 's' : ''} must pass
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {matches.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-10 text-center">
          <Activity size={24} className="text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No active matches to check.</p>
          <Link to="/matches" className="mt-3 inline-flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300">
            Find matches <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {/* Control failure reference */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Control Failure Response Matrix
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-4 font-medium">Failure</th>
                <th className="text-left py-1.5 pr-4 font-medium">Severity</th>
                <th className="text-left py-1.5 font-medium">Required Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[
                ['Restore fails',                  'Critical', 'Mark unprotected, stop pruning, investigate repo and keys'],
                ['Canary checksum mismatch',        'Critical', 'Mark unprotected, preserve logs, test alternate snapshot'],
                ['Password / key missing',          'Critical', 'Mark unprotected, require new protected setup'],
                ['Peer offline > 7 days',           'Critical', 'Start peer replacement process'],
                ['Backup stale > 72 hours',         'Critical', 'Alert user, investigate agent and source host'],
                ['Sync stale > 72 hours',           'Critical', 'Alert both users, inspect Syncthing state'],
                ['Free quota < 5%',                 'Critical', 'Pause growth, require capacity action'],
                ['Telemetry contains sensitive data', 'Critical', 'Stop telemetry path, purge if possible, redesign schema'],
                ['Abuse complaint',                 'High',     'Preserve account state, follow AUP/legal process'],
              ].map(([fail, sev, action]) => (
                <tr key={fail} className="text-slate-300">
                  <td className="py-1.5 pr-4">{fail}</td>
                  <td className="py-1.5 pr-4">
                    <span className={`${sev === 'Critical' ? 'text-red-400' : 'text-orange-400'}`}>
                      {sev}
                    </span>
                  </td>
                  <td className="py-1.5 text-slate-400">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
