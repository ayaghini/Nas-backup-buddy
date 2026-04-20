import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Globe,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Shield,
  User,
  Zap,
} from 'lucide-react';
import {
  MATCH_CANDIDATES,
  getUserById,
  formatStorageGB,
  formatDate,
  formatHoursAgo,
  CURRENT_USER,
} from '../data/mockData';
import { useApp } from '../context/AppContext';
import { MatchStatusPill, CheckPill } from '../components/StatusPill';
import { ScoreBar } from '../components/ScoreBar';
import { HealthCheckPanel } from '../components/HealthCheckRow';
import type { Match, MatchCandidate } from '../types';

function GateRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/50 last:border-0">
      <span className="text-sm text-slate-300">{label}</span>
      <CheckPill pass={pass} />
    </div>
  );
}

function ActiveMatchDetail({ match }: { match: Match }) {
  const { pacts, drills, incidents } = useApp();

  const peer = getUserById(
    match.dataOwnerId === CURRENT_USER.id ? match.storageHostId : match.dataOwnerId
  );
  const pact          = pacts.find((p) => p.matchId === match.id);
  const matchDrills   = drills.filter((d) => d.matchId === match.id);
  const matchIncidents = incidents.filter((i) => i.matchId === match.id);
  const allGatePassed = Object.values(match.gate).every(Boolean);

  return (
    <div className="space-y-5">
      {/* Peer profile */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <User size={16} className="text-slate-500" />
              <h2 className="text-base font-semibold text-slate-100">{peer?.name}</h2>
              <span className="text-sm text-slate-500 font-mono">@{peer?.handle}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Globe size={11} />
              {peer?.country} · {peer?.timezone}
            </div>
          </div>
          <MatchStatusPill status={match.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'NAS Type',      value: peer?.nasServerType },
            { label: 'Filesystem',    value: peer?.filesystem },
            { label: 'Backup Engine', value: peer?.backupEngine },
            { label: 'Upload Speed',  value: `${peer?.uploadSpeedMbps} Mbps` },
            { label: 'Uptime SLA',    value: `${peer?.expectedUptimePercent}%` },
            { label: 'Reputation',    value: `${peer?.reputation}/100` },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-xs text-slate-500 mb-0.5">{f.label}</div>
              <div className="text-sm font-mono text-slate-200">{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Match timeline */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Match Timeline</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-slate-500 mb-0.5">Created</div>
            <div className="font-mono text-slate-300">{formatDate(match.createdAt)}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Pact signed</div>
            <div className="font-mono text-slate-300">
              {match.pactAcceptedAt ? formatDate(match.pactAcceptedAt) : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Last backup</div>
            <div className="font-mono text-slate-300">
              {match.lastBackupAt ? formatHoursAgo(match.lastBackupAt) : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Last sync</div>
            <div className="font-mono text-slate-300">
              {match.lastSyncAt ? formatHoursAgo(match.lastSyncAt) : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Health checks */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Health Checks</h3>
            <Link to="/health" className="text-xs text-sky-400 hover:text-sky-300">Full view →</Link>
          </div>
          <HealthCheckPanel health={match.health} />
        </div>

        {/* Protected gate */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Protected Status Gate</h3>
            {allGatePassed ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle size={12} />All checks pass
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <AlertTriangle size={12} />Checks failing
              </span>
            )}
          </div>
          <div>
            <GateRow label="Backup snapshot exists"            pass={match.gate.backupSnapshotExists} />
            <GateRow label="Encrypted repo synced to peer"     pass={match.gate.encryptedRepoSyncedToPeer} />
            <GateRow label="Restore drill completed"           pass={match.gate.restoreDrillCompleted} />
            <GateRow label="Canary checksum matches"           pass={match.gate.canaryChecksumMatches} />
            <GateRow label="User has recovery key/password"    pass={match.gate.userHasRecoveryKey} />
            <GateRow label="Retention policy configured"       pass={match.gate.retentionPolicyConfigured} />
            <GateRow label="Peer quota has buffer"             pass={match.gate.peerQuotaHasBuffer} />
            <GateRow label="No critical health alerts"         pass={match.gate.noCriticalAlerts} />
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Storage — Hosted on {peer?.name?.split(' ')[0]}'s NAS
        </h3>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Quota usage</span>
          <span className="text-xs font-mono text-slate-300">
            {formatStorageGB(match.quotaUsedGB)} / {formatStorageGB(match.quotaTotalGB)}
            &nbsp;({Math.round((match.quotaUsedGB / match.quotaTotalGB) * 100)}%)
          </span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 rounded-full"
            style={{ width: `${(match.quotaUsedGB / match.quotaTotalGB) * 100}%` }}
          />
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Encrypted repository: <span className="font-mono text-slate-300">{formatStorageGB(match.repositorySizeGB)}</span> on disk
        </div>
      </div>

      {/* Match score */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Match Score Breakdown</h3>
        <ScoreBar score={match.score} />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: `/pact/${match.id}`, icon: <FileText size={16} />, label: 'Backup Pact',
            sub: pact?.dataOwnerAccepted && pact?.storageHostAccepted ? 'Signed' : 'Pending' },
          { to: '/restore', icon: <RotateCcw size={16} />, label: 'Restore Drills',
            sub: `${matchDrills.length} on record` },
          { to: '/incidents', icon: <AlertTriangle size={16} />, label: 'Incidents',
            sub: `${matchIncidents.filter(i => i.status === 'Open').length} open` },
          { to: '/health', icon: <Shield size={16} />, label: 'Health Detail',
            sub: match.status },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex flex-col items-start gap-1 p-3 bg-slate-900 border border-slate-800
              rounded-lg hover:border-slate-700 transition-colors"
          >
            <span className="text-slate-400">{item.icon}</span>
            <span className="text-sm font-medium text-slate-200">{item.label}</span>
            <span className="text-xs text-slate-500">{item.sub}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CandidateMatchDetail({ candidate }: { candidate: MatchCandidate }) {
  const navigate = useNavigate();
  const { requestedCandidateIds, requestMatch } = useApp();
  const p = candidate.profile;
  const alreadyRequested = requestedCandidateIds.includes(p.id);

  const handleRequest = () => {
    if (alreadyRequested) return;
    const result = requestMatch(p.id);
    if (result) {
      navigate(`/pact/${result.matchId}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{p.name}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {p.country} · {p.timezone} · Member since {formatDate(p.joinedAt)}
            </div>
          </div>
          <span className="text-2xl font-bold font-mono text-emerald-400">{candidate.score.total}/100</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Offers',          value: formatStorageGB(p.offeredStorageGB), icon: <HardDrive size={13} /> },
            { label: 'Upload Speed',    value: `${p.uploadSpeedMbps} Mbps`,         icon: <Zap size={13} /> },
            { label: 'Uptime',          value: `${p.expectedUptimePercent}%`,        icon: <Clock size={13} /> },
            { label: 'NAS Type',        value: p.nasServerType,                      icon: <HardDrive size={13} /> },
            { label: 'Backup Engine',   value: p.backupEngine,                       icon: <Shield size={13} /> },
            { label: 'Est. Restore',    value: `~${candidate.estimatedRestoreTimeMins} min`, icon: <RefreshCw size={13} /> },
          ].map((f) => (
            <div key={f.label} className="flex items-start gap-2">
              <span className="text-slate-500 mt-0.5 flex-shrink-0">{f.icon}</span>
              <div>
                <div className="text-xs text-slate-500">{f.label}</div>
                <div className="text-sm font-mono text-slate-200">{f.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.hasPowerBackup && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">UPS Backup</span>
          )}
          {p.willingToHostMultiple && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-sky-400/10 text-sky-400 border border-sky-400/20">Multi-peer OK</span>
          )}
          <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">{p.filesystem}</span>
          {p.monthlyBandwidthCapGB === 0
            ? <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">Unlimited BW</span>
            : <span className="px-1.5 py-0.5 rounded text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20">{formatStorageGB(p.monthlyBandwidthCapGB)}/mo cap</span>
          }
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Match Score</h3>
        <ScoreBar score={candidate.score} />
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-300/80 leading-relaxed">
            <strong>Before requesting a match:</strong> Review the{' '}
            <Link to="/help" className="underline">Backup Pact template</Link> together. Both parties must understand their obligations. A restore drill is required within 7 days of the first successful sync before Protected status can be granted.
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/matches')}
          className="flex-1 px-4 py-2.5 rounded-md border border-slate-700 text-sm text-slate-300
            hover:bg-slate-800 transition-colors"
        >
          Back to candidates
        </button>
        {alreadyRequested ? (
          <div className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium text-center
            bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Match requested — check Dashboard
          </div>
        ) : (
          <button
            onClick={handleRequest}
            className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium
              bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25 transition-colors"
          >
            Request Match with {p.name.split(' ')[0]}
          </button>
        )}
      </div>
    </div>
  );
}

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { matches } = useApp();

  const activeMatch = matches.find((m) => m.id === id);
  const candidate   = MATCH_CANDIDATES.find((c) => `candidate-${c.profile.id}` === id);

  if (!activeMatch && !candidate) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-400">Match not found.</p>
        <button onClick={() => navigate('/matches')} className="mt-3 text-sky-400 text-sm">
          Back to matches
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-5"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      {activeMatch  && <ActiveMatchDetail match={activeMatch} />}
      {candidate    && <CandidateMatchDetail candidate={candidate} />}
    </div>
  );
}
