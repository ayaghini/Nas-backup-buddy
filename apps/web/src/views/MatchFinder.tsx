import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Filter,
  Search,
  SortAsc,
  Clock,
  Zap,
  Globe,
  HardDrive,
  CheckCircle,
  Power,
  Users,
} from 'lucide-react';
import { MATCH_CANDIDATES, CURRENT_USER, formatStorageGB } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { ScoreBadge, ScoreBar } from '../components/ScoreBar';
import type { MatchCandidate } from '../types';

type SortKey = 'score' | 'uploadSpeed' | 'offeredStorage' | 'uptime' | 'reputation';

const REGIONS = ['All', 'Europe', 'Asia Pacific', 'North America', 'South America', 'Middle East'];

function ProfileTag({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      <span className="text-slate-500">{icon}</span>
      {label}
    </span>
  );
}

function CandidateCard({
  candidate,
  expanded,
  onToggle,
  requested,
  onRequest,
}: {
  candidate: MatchCandidate;
  expanded: boolean;
  onToggle: () => void;
  requested: boolean;
  onRequest: () => void;
}) {
  const p = candidate.profile;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-100">{p.name}</span>
              <span className="text-xs text-slate-500 font-mono">@{p.handle}</span>
              {requested && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                  Requested
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Globe size={11} />
              {p.country} · {p.timezone}
            </div>
          </div>
          <ScoreBadge total={candidate.score.total} />
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mb-3">
          <ProfileTag
            icon={<HardDrive size={11} />}
            label={`Offers ${formatStorageGB(p.offeredStorageGB)}`}
          />
          <ProfileTag
            icon={<Zap size={11} />}
            label={`${p.uploadSpeedMbps} Mbps up`}
          />
          <ProfileTag
            icon={<CheckCircle size={11} />}
            label={`${p.expectedUptimePercent}% uptime`}
          />
          <ProfileTag
            icon={<HardDrive size={11} />}
            label={p.nasServerType}
          />
          <ProfileTag
            icon={<Clock size={11} />}
            label={`Restore ~${candidate.estimatedRestoreTimeMins} min`}
          />
          <ProfileTag
            icon={<Power size={11} />}
            label={p.hasPowerBackup ? 'UPS backup' : 'No UPS'}
          />
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
            {p.filesystem}
          </span>
          <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
            {p.backupEngine}
          </span>
          {p.willingToHostMultiple && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20">
              Multi-peer OK
            </span>
          )}
          {p.monthlyBandwidthCapGB === 0 ? (
            <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
              Unlimited BW
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
              {formatStorageGB(p.monthlyBandwidthCapGB)}/mo cap
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={onToggle}
            className="text-xs text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
          >
            {expanded ? 'Hide score breakdown' : 'View score breakdown'}
            <ArrowRight size={11} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
          {requested ? (
            <Link
              to={`/matches/candidate-${p.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                bg-slate-700/50 text-slate-400 border border-slate-700"
            >
              View Match <ArrowRight size={12} />
            </Link>
          ) : (
            <button
              onClick={onRequest}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
            >
              View &amp; Request Match <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded score breakdown */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4 bg-slate-950/50">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Match Score Breakdown</div>
          <ScoreBar score={candidate.score} />
          <div className="mt-3 pt-3 border-t border-slate-800/50">
            <p className="text-xs text-slate-500 leading-relaxed">
              Storage fit measures whether {p.name.split(' ')[0]}'s offered capacity ({formatStorageGB(p.offeredStorageGB)}) exceeds your requested capacity ({formatStorageGB(CURRENT_USER.requestedStorageGB)}) with buffer. Upload speed of {p.uploadSpeedMbps} Mbps gives an estimated restore time of ~{candidate.estimatedRestoreTimeMins} min for your current data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function MatchFinder() {
  const navigate = useNavigate();
  const { requestedCandidateIds, requestMatch } = useApp();

  const [search, setSearch]       = useState('');
  const [region, setRegion]       = useState('All');
  const [sortKey, setSortKey]     = useState<SortKey>('score');
  const [minScore, setMinScore]   = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleRequest = (candidateProfileId: string) => {
    const result = requestMatch(candidateProfileId);
    if (result) {
      navigate(`/matches/candidate-${candidateProfileId}`);
    }
  };

  const filtered = MATCH_CANDIDATES.filter((c) => {
    const p = c.profile;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.country.toLowerCase().includes(search.toLowerCase()) &&
        !p.nasServerType.toLowerCase().includes(search.toLowerCase())) return false;
    if (region !== 'All' && p.region !== region) return false;
    if (c.score.total < minScore) return false;
    return true;
  }).sort((a, b) => {
    switch (sortKey) {
      case 'score':          return b.score.total - a.score.total;
      case 'uploadSpeed':    return b.profile.uploadSpeedMbps - a.profile.uploadSpeedMbps;
      case 'offeredStorage': return b.profile.offeredStorageGB - a.profile.offeredStorageGB;
      case 'uptime':         return b.profile.expectedUptimePercent - a.profile.expectedUptimePercent;
      case 'reputation':     return b.profile.reputation - a.profile.reputation;
    }
  });

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-slate-100 mb-1">Find a Backup Match</h2>
        <p className="text-sm text-slate-400">
          Browse homelab users who have offered spare storage. Scores are computed from the{' '}
          <Link to="/help" className="text-sky-400 hover:underline">match scoring matrix</Link> using storage fit, upload speed, uptime, region, reputation, and reciprocal fairness.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold uppercase tracking-wide">
          <Filter size={12} />
          Filters &amp; Sort
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Name, country, NAS type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/20"
            />
          </div>

          {/* Region */}
          <div>
            <label className="sr-only" htmlFor="region-filter">Region</label>
            <select
              id="region-filter"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                focus:outline-none focus:border-sky-500/50"
            >
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>

          {/* Sort */}
          <div className="relative">
            <SortAsc size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
            <label className="sr-only" htmlFor="sort-key">Sort by</label>
            <select
              id="sort-key"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="w-full pl-7 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                focus:outline-none focus:border-sky-500/50"
            >
              <option value="score">Sort: Match Score</option>
              <option value="uploadSpeed">Sort: Upload Speed</option>
              <option value="offeredStorage">Sort: Storage Offered</option>
              <option value="uptime">Sort: Uptime</option>
              <option value="reputation">Sort: Reputation</option>
            </select>
          </div>

          {/* Min score */}
          <div>
            <label className="sr-only" htmlFor="min-score">Min score</label>
            <div className="flex items-center gap-2">
              <input
                id="min-score"
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="flex-1 accent-sky-500"
              />
              <span className="text-xs font-mono text-slate-400 w-10 text-right">≥{minScore}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-slate-500" />
          <span className="text-sm text-slate-400">
            {filtered.length} candidate{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          Your requested storage: {formatStorageGB(CURRENT_USER.requestedStorageGB)}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-10 text-center">
          <p className="text-slate-400 text-sm">No candidates match your filters.</p>
          <button
            onClick={() => { setSearch(''); setRegion('All'); setMinScore(0); }}
            className="mt-3 text-xs text-sky-400 hover:text-sky-300"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <CandidateCard
              key={c.profile.id}
              candidate={c}
              expanded={expandedId === c.profile.id}
              onToggle={() => setExpandedId(expandedId === c.profile.id ? null : c.profile.id)}
              requested={requestedCandidateIds.includes(c.profile.id)}
              onRequest={() => handleRequest(c.profile.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
