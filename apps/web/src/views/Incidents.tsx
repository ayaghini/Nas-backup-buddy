import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { getUserById, formatHoursAgo, formatDate, CURRENT_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { SeverityPill, IncidentStatusPill } from '../components/StatusPill';
import type { Incident, IncidentSeverity, IncidentStatus } from '../types';

const CATEGORIES = [
  'Backup stale', 'Sync stale', 'Restore drill overdue', 'Restore failed',
  'Peer offline', 'Quota low', 'Repository check failed', 'Canary mismatch',
  'Key/password missing', 'Abuse complaint', 'Other',
];

const CONTROL_FAILURE_MATRIX: { failure: string; severity: string; action: string }[] = [
  { failure: 'Restore fails',               severity: 'Critical', action: 'Mark unprotected, stop pruning, investigate repo and keys' },
  { failure: 'Canary mismatch',             severity: 'Critical', action: 'Mark unprotected, preserve logs, test alternate snapshot' },
  { failure: 'Password/key missing',        severity: 'Critical', action: 'Mark unprotected, require new protected setup' },
  { failure: 'Peer offline > 7 days',       severity: 'Critical', action: 'Start peer replacement process' },
  { failure: 'Backup stale > 72h',          severity: 'Critical', action: 'Alert user, investigate agent and source host' },
  { failure: 'Sync stale > 72h',            severity: 'Critical', action: 'Alert both users, inspect Syncthing state' },
  { failure: 'Free quota < 5%',             severity: 'Critical', action: 'Pause growth, require capacity action' },
  { failure: 'Sensitive data in telemetry', severity: 'Critical', action: 'Stop telemetry path, purge if possible, redesign schema' },
  { failure: 'Abuse complaint',             severity: 'High',     action: 'Preserve account state, follow AUP/legal process' },
];

function IncidentCard({
  incident,
  matchOptions,
  onUpdateNotes,
  onUpdateStatus,
}: {
  incident: Incident;
  matchOptions: { id: string; peerName: string }[];
  onUpdateNotes: (id: string, notes: string) => void;
  onUpdateStatus: (id: string, status: IncidentStatus) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState(incident.notes);
  const matchInfo = matchOptions.find((m) => m.id === incident.matchId);

  const saveNotes = () => {
    onUpdateNotes(incident.id, draft);
    setEditingNotes(false);
  };

  return (
    <div className={`bg-slate-900 border rounded-lg overflow-hidden ${
      incident.status === 'Open' && incident.severity === 'Critical'
        ? 'border-red-400/30'
        : incident.status === 'Open'
        ? 'border-amber-400/20'
        : 'border-slate-800'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <SeverityPill severity={incident.severity} />
              <IncidentStatusPill status={incident.status} />
              <span className="text-xs text-slate-500">
                {incident.category}
              </span>
            </div>
            <h3 className="text-sm font-medium text-slate-200">{incident.title}</h3>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-xs text-slate-500 font-mono">{formatHoursAgo(incident.createdAt)}</div>
            {matchInfo && <div className="text-xs text-slate-500">{matchInfo.peerName}</div>}
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed mb-3">{incident.description}</p>

        {incident.requiredAction && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-400/5 border border-amber-400/15 mb-3">
            <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80">{incident.requiredAction}</p>
          </div>
        )}

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <MessageSquare size={11} />
              Notes
            </div>
            <button
              onClick={() => setEditingNotes(!editingNotes)}
              className="text-xs text-sky-400 hover:text-sky-300"
            >
              {editingNotes ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editingNotes ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200
                  placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none"
              />
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={saveNotes}
                  className="px-3 py-1 rounded text-xs bg-sky-500/15 text-sky-400 border border-sky-500/25
                    hover:bg-sky-500/25 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDraft(incident.notes); setEditingNotes(false); }}
                  className="px-3 py-1 rounded text-xs border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-300 leading-relaxed">{incident.notes || '—'}</p>
          )}
        </div>

        {/* Status controls */}
        {incident.status !== 'Resolved' && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/50">
            {incident.status === 'Open' && (
              <button
                onClick={() => onUpdateStatus(incident.id, 'Monitoring')}
                className="px-3 py-1 rounded text-xs border border-amber-400/25 text-amber-400 bg-amber-400/5
                  hover:bg-amber-400/15 transition-colors"
              >
                Mark Monitoring
              </button>
            )}
            <button
              onClick={() => onUpdateStatus(incident.id, 'Resolved')}
              className="flex items-center gap-1 px-3 py-1 rounded text-xs border border-emerald-400/25
                text-emerald-400 bg-emerald-400/5 hover:bg-emerald-400/15 transition-colors"
            >
              <CheckCircle size={11} />
              Mark Resolved
            </button>
          </div>
        )}

        {incident.resolvedAt && (
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
            <CheckCircle size={11} className="text-emerald-500" />
            Resolved {formatDate(incident.resolvedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function NewIncidentModal({
  matchOptions,
  onClose,
  onSave,
}: {
  matchOptions: { id: string; peerName: string }[];
  onClose: () => void;
  onSave: (inc: Incident) => void;
}) {
  const [matchId,   setMatchId]   = useState(matchOptions[0]?.id ?? '');
  const [severity,  setSeverity]  = useState<IncidentSeverity>('Medium');
  const [category,  setCategory]  = useState(CATEGORIES[0]);
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [notes,     setNotes]     = useState('');
  const [reqAction, setReqAction] = useState('');

  const save = () => {
    if (!title.trim()) return;
    const suggestion = CONTROL_FAILURE_MATRIX.find(r =>
      category.toLowerCase().includes(r.failure.split(' ')[0].toLowerCase())
    );
    onSave({
      id: `inc-${Date.now()}`,
      matchId,
      severity,
      category,
      title: title.trim(),
      description: desc.trim(),
      createdAt: new Date().toISOString(),
      status: 'Open',
      notes: notes.trim(),
      requiredAction: reqAction.trim() || suggestion?.action,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100">Create Incident</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-match">Match</label>
              <select id="inc-match" value={matchId} onChange={e => setMatchId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 focus:outline-none">
                {matchOptions.map(m => (
                  <option key={m.id} value={m.id}>Match w/ {m.peerName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-sev">Severity</label>
              <select id="inc-sev" value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 focus:outline-none">
                {['Critical', 'High', 'Medium', 'Low'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-cat">Category</label>
            <select id="inc-cat" value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 focus:outline-none">
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-title">Title *</label>
            <input id="inc-title" type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Short description of the incident"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-desc">Description</label>
            <textarea id="inc-desc" value={desc} onChange={e => setDesc(e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-notes">Initial Notes</label>
            <textarea id="inc-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="inc-action">Required Action</label>
            <input id="inc-action" type="text" value={reqAction} onChange={e => setReqAction(e.target.value)}
              placeholder="Leave blank to auto-suggest from control matrix"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-md border border-slate-700 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={save} disabled={!title.trim()}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-sky-500/15 text-sky-400
              border border-sky-500/25 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Create Incident
          </button>
        </div>
      </div>
    </div>
  );
}

export function Incidents() {
  const { incidents, matches, updateIncidentNotes, updateIncidentStatus, createIncident } = useApp();
  const [showNew, setShowNew]     = useState(false);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'All'>('All');
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | 'All'>('All');

  const matchOptions = matches
    .filter((m) => m.status !== 'Retired')
    .map((m) => {
      const peer = getUserById(m.dataOwnerId === CURRENT_USER.id ? m.storageHostId : m.dataOwnerId);
      return { id: m.id, peerName: peer?.name ?? 'Unknown peer' };
    });

  const filtered = incidents.filter(i => {
    if (statusFilter   !== 'All' && i.status   !== statusFilter)   return false;
    if (severityFilter !== 'All' && i.severity !== severityFilter) return false;
    return true;
  });

  const openCount = incidents.filter(i => i.status === 'Open').length;

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-3xl mx-auto">
      {showNew && (
        <NewIncidentModal
          matchOptions={matchOptions}
          onClose={() => setShowNew(false)}
          onSave={inc => { createIncident(inc); setShowNew(false); }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100 mb-1">Incidents</h2>
          <p className="text-sm text-slate-400">
            Track and resolve issues with backups, sync, and peer health.
            {openCount > 0 && (
              <span className="ml-1.5 text-amber-400">{openCount} open.</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium
            bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25 transition-colors"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-slate-500" />
        {(['All', 'Open', 'Monitoring', 'Resolved'] as const).map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              statusFilter === s
                ? 'bg-sky-500/15 text-sky-400 border-sky-500/25'
                : 'text-slate-400 border-slate-700 hover:border-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="text-slate-700">|</span>
        {(['All', 'Critical', 'High', 'Medium', 'Low'] as const).map(s => (
          <button key={s}
            onClick={() => setSeverityFilter(s)}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              severityFilter === s
                ? 'bg-sky-500/15 text-sky-400 border-sky-500/25'
                : 'text-slate-400 border-slate-700 hover:border-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        {([
          { label: 'Open',       count: incidents.filter(i => i.status === 'Open').length,       color: 'text-red-400' },
          { label: 'Monitoring', count: incidents.filter(i => i.status === 'Monitoring').length, color: 'text-amber-400' },
          { label: 'Resolved',   count: incidents.filter(i => i.status === 'Resolved').length,   color: 'text-emerald-400' },
          { label: 'Critical',   count: incidents.filter(i => i.severity === 'Critical').length, color: 'text-red-400' },
        ]).map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
            <div className={`text-xl font-bold font-mono ${s.color}`}>{s.count}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Incident list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-10 text-center">
            <Clock size={24} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No incidents match this filter.</p>
          </div>
        ) : (
          filtered.map(inc => (
            <IncidentCard
              key={inc.id}
              incident={inc}
              matchOptions={matchOptions}
              onUpdateNotes={updateIncidentNotes}
              onUpdateStatus={updateIncidentStatus}
            />
          ))
        )}
      </div>

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
                <th className="text-left py-1.5 font-medium hidden sm:table-cell">Required Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {CONTROL_FAILURE_MATRIX.map(row => (
                <tr key={row.failure} className="text-slate-300">
                  <td className="py-1.5 pr-4">{row.failure}</td>
                  <td className="py-1.5 pr-4">
                    <span className={row.severity === 'Critical' ? 'text-red-400' : 'text-orange-400'}>
                      {row.severity}
                    </span>
                  </td>
                  <td className="py-1.5 text-slate-400 hidden sm:table-cell">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
