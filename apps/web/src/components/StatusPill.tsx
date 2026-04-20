import type { MatchStatus, IncidentSeverity, IncidentStatus } from '../types';

// ─── Match Status Pill ────────────────────────────────────────────────────────

const matchStatusConfig: Record<
  MatchStatus,
  { label: string; className: string; dot: string }
> = {
  Protected:  { label: 'Protected',  className: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/25', dot: 'bg-emerald-400' },
  Warning:    { label: 'Warning',    className: 'bg-amber-400/10  text-amber-400  border-amber-400/25',  dot: 'bg-amber-400' },
  Critical:   { label: 'Critical',   className: 'bg-red-400/10    text-red-400    border-red-400/25',    dot: 'bg-red-400 animate-pulse' },
  Syncing:    { label: 'Syncing',    className: 'bg-sky-400/10    text-sky-400    border-sky-400/25',    dot: 'bg-sky-400 animate-pulse' },
  Pending:    { label: 'Pending',    className: 'bg-indigo-400/10 text-indigo-400 border-indigo-400/25', dot: 'bg-indigo-400' },
  Retired:    { label: 'Retired',    className: 'bg-slate-500/10  text-slate-400  border-slate-500/25',  dot: 'bg-slate-500' },
};

interface MatchStatusPillProps {
  status: MatchStatus;
  size?: 'sm' | 'md';
}

export function MatchStatusPill({ status, size = 'md' }: MatchStatusPillProps) {
  const cfg = matchStatusConfig[status];
  const px = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-medium ${px} ${cfg.className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Incident Severity Pill ───────────────────────────────────────────────────

const severityConfig: Record<IncidentSeverity, { className: string }> = {
  Critical: { className: 'bg-red-400/10    text-red-400    border-red-400/25' },
  High:     { className: 'bg-orange-400/10 text-orange-400 border-orange-400/25' },
  Medium:   { className: 'bg-amber-400/10  text-amber-400  border-amber-400/25' },
  Low:      { className: 'bg-slate-500/10  text-slate-400  border-slate-500/25' },
};

interface SeverityPillProps {
  severity: IncidentSeverity;
}

export function SeverityPill({ severity }: SeverityPillProps) {
  const cfg = severityConfig[severity];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cfg.className}`}
    >
      {severity}
    </span>
  );
}

// ─── Incident Status Pill ─────────────────────────────────────────────────────

const incidentStatusConfig: Record<IncidentStatus, { className: string }> = {
  Open:       { className: 'bg-red-400/10    text-red-400    border-red-400/25' },
  Monitoring: { className: 'bg-amber-400/10  text-amber-400  border-amber-400/25' },
  Resolved:   { className: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/25' },
};

interface IncidentStatusPillProps {
  status: IncidentStatus;
}

export function IncidentStatusPill({ status }: IncidentStatusPillProps) {
  const cfg = incidentStatusConfig[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cfg.className}`}
    >
      {status}
    </span>
  );
}

// ─── Check Pill ───────────────────────────────────────────────────────────────

interface CheckPillProps {
  pass: boolean;
  labelPass?: string;
  labelFail?: string;
}

export function CheckPill({
  pass,
  labelPass = 'Pass',
  labelFail = 'Fail',
}: CheckPillProps) {
  return pass ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium bg-emerald-400/10 text-emerald-400 border-emerald-400/25">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      {labelPass}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium bg-red-400/10 text-red-400 border-red-400/25">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      {labelFail}
    </span>
  );
}

// ─── Drill Status Pill ────────────────────────────────────────────────────────

import type { DrillStatus } from '../types';

const drillStatusConfig: Record<DrillStatus, { className: string }> = {
  Pass:        { className: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/25' },
  Fail:        { className: 'bg-red-400/10    text-red-400    border-red-400/25' },
  'In Progress': { className: 'bg-sky-400/10  text-sky-400    border-sky-400/25' },
  Pending:     { className: 'bg-slate-500/10  text-slate-400  border-slate-500/25' },
};

interface DrillStatusPillProps {
  status: DrillStatus;
}

export function DrillStatusPill({ status }: DrillStatusPillProps) {
  const cfg = drillStatusConfig[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cfg.className}`}>
      {status}
    </span>
  );
}
