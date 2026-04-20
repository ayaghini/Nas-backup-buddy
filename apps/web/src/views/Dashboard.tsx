import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock,
  HardDrive,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getUserById, formatHoursAgo, formatStorageGB, CURRENT_USER } from '../data/mockData';
import { MatchStatusPill, SeverityPill } from '../components/StatusPill';
import type { Match } from '../types';

function StatCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg flex-shrink-0 ${color}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold font-mono text-slate-100">{value}</div>
        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const peer = getUserById(
    match.dataOwnerId === CURRENT_USER.id ? match.storageHostId : match.dataOwnerId
  );
  const usedPct = Math.round((match.quotaUsedGB / match.quotaTotalGB) * 100);
  const alerts: string[] = [];
  if (match.health.lastBackupAgeHours > 24) alerts.push(`Backup stale ${match.health.lastBackupAgeHours}h`);
  if (match.health.lastSyncAgeHours > 24)   alerts.push(`Sync stale ${match.health.lastSyncAgeHours}h`);
  if (match.health.restoreDrillAgeDays > 30) alerts.push(`Drill ${match.health.restoreDrillAgeDays}d ago`);

  return (
    <Link
      to={`/matches/${match.id}`}
      className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200">{peer?.name ?? 'Unknown Peer'}</span>
            <span className="text-xs text-slate-500 font-mono">@{peer?.handle}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {peer?.country} · {peer?.nasServerType}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MatchStatusPill status={match.status} />
          <ArrowRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500">Quota</span>
          <span className="text-xs font-mono text-slate-400">
            {formatStorageGB(match.quotaUsedGB)} / {formatStorageGB(match.quotaTotalGB)}
          </span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${usedPct > 85 ? 'bg-amber-500' : 'bg-sky-500'}`}
            style={{ width: `${Math.max(usedPct, 0)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><Clock size={11} />Backup {match.health.lastBackupAgeHours}h ago</span>
        <span className="flex items-center gap-1"><RefreshCw size={11} />Sync {match.health.lastSyncAgeHours}h ago</span>
        <span className="flex items-center gap-1"><Shield size={11} />Drill {match.health.restoreDrillAgeDays < 0 ? 'never' : `${match.health.restoreDrillAgeDays}d ago`}</span>
      </div>

      {alerts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {alerts.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20">
              <AlertTriangle size={10} />{a}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

export function Dashboard() {
  const { matches, incidents } = useApp();

  const protectedCount = matches.filter((m) => m.status === 'Protected').length;
  const warningCount   = matches.filter((m) => m.status === 'Warning').length;
  const criticalCount  = matches.filter((m) => m.status === 'Critical').length;
  const openIncidents  = incidents.filter((i) => i.status === 'Open').length;

  const actions: { text: string; link: string; urgent: boolean }[] = [];
  matches.forEach((m) => {
    if (m.status === 'Retired') return;
    const peer = getUserById(m.storageHostId);
    const name = peer?.name ?? 'Peer';
    if (m.health.restoreDrillAgeDays > 30)
      actions.push({ text: `Schedule restore drill for match with ${name} (${m.health.restoreDrillAgeDays}d since last drill)`, link: '/restore', urgent: m.health.restoreDrillAgeDays > 45 });
    if (m.health.lastBackupAgeHours > 24)
      actions.push({ text: `Investigate stale backup for ${name} — ${m.health.lastBackupAgeHours}h since last snapshot`, link: `/matches/${m.id}`, urgent: m.health.lastBackupAgeHours > 48 });
    if (m.health.lastSyncAgeHours > 24)
      actions.push({ text: `Check Syncthing sync with ${name} — ${m.health.lastSyncAgeHours}h since last sync`, link: `/matches/${m.id}`, urgent: m.health.lastSyncAgeHours > 48 });
    if (m.status === 'Critical')
      actions.push({ text: `Match with ${name} is Critical — immediate action required`, link: `/matches/${m.id}`, urgent: true });
    if (m.status === 'Pending' && !m.pactAcceptedAt) {
      const peerName = getUserById(m.storageHostId)?.name ?? 'peer';
      actions.push({ text: `New match with ${peerName} awaiting pact signature`, link: `/pact/${m.id}`, urgent: false });
    }
  });

  const recentOpenIncidents = incidents.filter((i) => i.status !== 'Resolved').slice(0, 3);
  const activeMatches = matches.filter((m) => m.status !== 'Retired');

  const totalOffered   = CURRENT_USER.offeredStorageGB;
  const usedForHosting = matches.reduce((s, m) => s + (m.dataOwnerId !== CURRENT_USER.id ? m.quotaUsedGB : 0), 0);
  const totalBacked    = matches.reduce((s, m) => s + (m.dataOwnerId === CURRENT_USER.id ? m.repositorySizeGB : 0), 0);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
        <span>
          <strong>Experimental homelab backup exchange.</strong> This is one layer of a 3-2-1 backup strategy — not a replacement for it. Restore testing is required before any match is marked Protected.
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Protected Matches" value={protectedCount} sub="All checks passed"
          color="bg-emerald-500/10 text-emerald-400" icon={<CheckCircle size={16} />} />
        <StatCard label="Warnings" value={warningCount} sub="Action recommended"
          color="bg-amber-500/10 text-amber-400" icon={<AlertTriangle size={16} />} />
        <StatCard label="Critical" value={criticalCount} sub={criticalCount > 0 ? 'Immediate action' : 'None active'}
          color={criticalCount > 0 ? 'bg-red-500/10 text-red-400' : 'bg-slate-700/30 text-slate-500'}
          icon={<XCircle size={16} />} />
        <StatCard label="Open Incidents" value={openIncidents} sub={openIncidents > 0 ? 'Review required' : 'All clear'}
          color={openIncidents > 0 ? 'bg-orange-500/10 text-orange-400' : 'bg-slate-700/30 text-slate-500'}
          icon={<Activity size={16} />} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Offered Capacity</div>
          <div className="text-lg font-bold font-mono text-slate-100">{formatStorageGB(totalOffered)}</div>
          <div className="text-xs text-slate-500 mt-1">{formatStorageGB(usedForHosting)} in use by peers</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Data Backed Up</div>
          <div className="text-lg font-bold font-mono text-slate-100">{formatStorageGB(totalBacked)}</div>
          <div className="text-xs text-slate-500 mt-1">Encrypted, across {activeMatches.filter(m => m.dataOwnerId === CURRENT_USER.id).length} active match(es)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Reputation</div>
          <div className="text-lg font-bold font-mono text-emerald-400">{CURRENT_USER.reputation}/100</div>
          <div className="text-xs text-slate-500 mt-1">Based on uptime &amp; drill history</div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Active Matches</h2>
          <Link to="/matches" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
            Find new matches <ArrowRight size={12} />
          </Link>
        </div>
        {activeMatches.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
            <HardDrive size={24} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No active matches yet.</p>
            <Link to="/matches" className="mt-3 inline-flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300">
              Browse candidates <ArrowRight size={12} />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activeMatches.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        )}
      </section>

      {actions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Required Actions</h2>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <Link key={i} to={a.link}
                className={`flex items-start gap-2.5 p-3 rounded-lg border transition-colors group ${
                  a.urgent ? 'bg-red-400/5 border-red-400/20 hover:border-red-400/40'
                           : 'bg-amber-400/5 border-amber-400/20 hover:border-amber-400/40'}`}>
                <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${a.urgent ? 'text-red-400' : 'text-amber-400'}`} />
                <span className="text-sm text-slate-300 flex-1">{a.text}</span>
                <ArrowRight size={14} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0 mt-0.5 transition-colors" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentOpenIncidents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Open Incidents</h2>
            <Link to="/incidents" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {recentOpenIncidents.map((inc) => (
              <div key={inc.id} className="flex items-start gap-3 p-3 bg-slate-900 border border-slate-800 rounded-lg">
                <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${
                  inc.severity === 'Critical' ? 'text-red-400' : inc.severity === 'High' ? 'text-orange-400' : 'text-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-slate-200">{inc.title}</span>
                    <SeverityPill severity={inc.severity} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{inc.description}</p>
                </div>
                <span className="text-xs text-slate-500 flex-shrink-0">{formatHoursAgo(inc.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
