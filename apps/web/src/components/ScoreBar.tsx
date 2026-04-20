import type { MatchScore } from '../types';

interface ScoreRowProps {
  label: string;
  value: number;
  max: number;
  weight: string;
}

function ScoreRow({ label, value, max, weight }: ScoreRowProps) {
  const pct = Math.round((value / max) * 100);
  const color =
    pct >= 80
      ? 'bg-emerald-500'
      : pct >= 55
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-3">
      <div className="w-36 flex-shrink-0">
        <span className="text-xs text-slate-300">{label}</span>
        <span className="text-xs text-slate-500 ml-1">({weight})</span>
      </div>
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-12 text-right font-mono text-xs text-slate-300">
        {value}/{max}
      </div>
    </div>
  );
}

interface ScoreBarProps {
  score: MatchScore;
}

export function ScoreBar({ score }: ScoreBarProps) {
  const totalPct = Math.round(score.total);
  const totalColor =
    totalPct >= 80
      ? 'text-emerald-400'
      : totalPct >= 60
      ? 'text-amber-400'
      : 'text-red-400';

  return (
    <div className="space-y-2.5">
      <ScoreRow label="Storage Fit"       value={score.storageFit}         max={25} weight="25%" />
      <ScoreRow label="Upload Speed"      value={score.uploadSpeed}        max={20} weight="20%" />
      <ScoreRow label="Uptime"            value={score.uptime}             max={20} weight="20%" />
      <ScoreRow label="Reputation"        value={score.reputation}         max={15} weight="15%" />
      <ScoreRow label="Region Distance"   value={score.regionDistance}     max={10} weight="10%" />
      <ScoreRow label="Reciprocal Fair."  value={score.reciprocalFairness} max={10} weight="10%" />
      <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-wide">Total Match Score</span>
        <span className={`text-lg font-bold font-mono ${totalColor}`}>{totalPct}/100</span>
      </div>
    </div>
  );
}

// ─── Compact score badge ──────────────────────────────────────────────────────

interface ScoreBadgeProps {
  total: number;
}

export function ScoreBadge({ total }: ScoreBadgeProps) {
  const color =
    total >= 80
      ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25'
      : total >= 60
      ? 'text-amber-400 bg-amber-400/10 border-amber-400/25'
      : 'text-red-400 bg-red-400/10 border-red-400/25';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-mono font-semibold ${color}`}
    >
      {total}/100
    </span>
  );
}
