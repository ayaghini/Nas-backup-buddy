import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle,
  Flag,
  Pause,
  Play,
  Shield,
} from 'lucide-react';
import { getUserById, formatDate, formatStorageGB } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { MatchStatusPill } from '../components/StatusPill';
import { ScoreBadge } from '../components/ScoreBar';
import type { AdminActionType } from '../types';

export function Admin() {
  const { matches, adminLog, adminAction } = useApp();

  const [noteFor,       setNoteFor]       = useState<string | null>(null);
  const [noteText,      setNoteText]      = useState('');
  const [pendingAction, setPendingAction] = useState<AdminActionType | null>(null);

  const startAction = (id: string, action: AdminActionType) => {
    setNoteFor(id);
    setPendingAction(action);
    setNoteText('');
  };

  const confirmAction = () => {
    if (!noteFor || !pendingAction) return;
    adminAction(noteFor, pendingAction, noteText.trim() || 'No note provided.');
    setNoteFor(null);
    setPendingAction(null);
    setNoteText('');
  };

  const activeMatches  = matches.filter(m => m.status !== 'Retired');
  const retiredMatches = matches.filter(m => m.status === 'Retired');

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Confirm modal */}
      {noteFor && pendingAction && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 capitalize">
                {pendingAction === 'unflag' ? 'Remove Flag' : pendingAction} Match
              </h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-300">
                {pendingAction === 'pause' && 'Pausing will set this match to Warning status and prevent Protected status until resumed.'}
                {pendingAction === 'resume' && 'Resuming will allow this match to re-enter normal health checking.'}
                {pendingAction === 'retire' && 'Retiring is permanent. The match will enter the 30-day retention/deletion flow. This cannot be undone.'}
                {pendingAction === 'flag' && 'Flagging marks this match for manual review. Both parties will be notified.'}
                {pendingAction === 'unflag' && 'This will remove the flag and allow the match to proceed normally.'}
              </p>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5" htmlFor="admin-note">Admin note (required for audit log)</label>
                <textarea
                  id="admin-note"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={2}
                  placeholder="Reason for this action…"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                    placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
              <button
                onClick={() => { setNoteFor(null); setPendingAction(null); }}
                className="flex-1 px-4 py-2 rounded-md border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmAction}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  pendingAction === 'retire'
                    ? 'bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25'
                    : 'bg-sky-500/15 text-sky-400 border-sky-500/25 hover:bg-sky-500/25'
                }`}
              >
                Confirm {pendingAction === 'unflag' ? 'Remove Flag' : pendingAction.charAt(0).toUpperCase() + pendingAction.slice(1)}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} className="text-sky-400" />
          <h2 className="text-base font-semibold text-slate-100">Admin Panel</h2>
        </div>
        <p className="text-sm text-slate-400">
          Manage active matches, review health, pause, retire, or flag for manual review.
          All actions are logged for audit.
        </p>
      </div>

      {/* Alpha controls notice */}
      <div className="flex items-start gap-2.5 p-3 bg-sky-500/5 border border-sky-500/20 rounded-lg">
        <CheckCircle size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80">
          <strong>Alpha controls required by docs/control-and-audit-plan.md:</strong> Admin must be able to pause or retire matches, and all match changes must have an audit trail. Paid marketplace features are blocked until legal, AUP, and dispute controls are in place.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active',    value: activeMatches.length,                                    color: 'text-slate-200' },
          { label: 'Paused',    value: activeMatches.filter(m => m.adminPaused).length,          color: 'text-amber-400' },
          { label: 'Flagged',   value: activeMatches.filter(m => m.flagged).length,              color: 'text-orange-400' },
          { label: 'Retired',   value: retiredMatches.length,                                    color: 'text-slate-500' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-center">
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Active matches table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Active Matches</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {activeMatches.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">No active matches.</div>
          )}
          {activeMatches.map(match => {
            const owner = getUserById(match.dataOwnerId);
            const host  = getUserById(match.storageHostId);

            return (
              <div key={match.id} className={`p-4 ${match.flagged ? 'bg-orange-400/5' : ''}`}>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-slate-200">
                        {owner?.name} → {host?.name}
                      </span>
                      <MatchStatusPill status={match.status} />
                      <ScoreBadge total={match.score.total} />
                      {match.flagged && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          bg-orange-400/10 text-orange-400 border border-orange-400/20">
                          <Flag size={10} />Flagged
                        </span>
                      )}
                      {match.adminPaused && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          bg-amber-400/10 text-amber-400 border border-amber-400/20">
                          <Pause size={10} />Admin paused
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-slate-400">
                      <span>Repo: <span className="font-mono text-slate-300">{formatStorageGB(match.repositorySizeGB)}</span></span>
                      <span>Quota: <span className="font-mono text-slate-300">{formatStorageGB(match.quotaUsedGB)}/{formatStorageGB(match.quotaTotalGB)}</span></span>
                      <span>Backup: <span className="font-mono text-slate-300">{match.health.lastBackupAgeHours}h ago</span></span>
                      <span>Sync: <span className="font-mono text-slate-300">{match.health.lastSyncAgeHours}h ago</span></span>
                    </div>
                    {match.adminNotes && (
                      <div className="mt-1.5 text-xs text-slate-500 italic">
                        Last admin note: {match.adminNotes}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end flex-shrink-0">
                    {match.status !== 'Retired' && (
                      <>
                        {match.adminPaused ? (
                          <button
                            onClick={() => startAction(match.id, 'resume')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                              border border-emerald-400/25 text-emerald-400 bg-emerald-400/5 hover:bg-emerald-400/15"
                          >
                            <Play size={11} />Resume
                          </button>
                        ) : (
                          <button
                            onClick={() => startAction(match.id, 'pause')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                              border border-amber-400/25 text-amber-400 bg-amber-400/5 hover:bg-amber-400/15"
                          >
                            <Pause size={11} />Pause
                          </button>
                        )}
                        {match.flagged ? (
                          <button
                            onClick={() => startAction(match.id, 'unflag')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                              border border-slate-600 text-slate-400 bg-slate-800/50 hover:bg-slate-700"
                          >
                            <Flag size={11} />Unflag
                          </button>
                        ) : (
                          <button
                            onClick={() => startAction(match.id, 'flag')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                              border border-orange-400/25 text-orange-400 bg-orange-400/5 hover:bg-orange-400/15"
                          >
                            <Flag size={11} />Flag
                          </button>
                        )}
                        <button
                          onClick={() => startAction(match.id, 'retire')}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                            border border-red-400/25 text-red-400 bg-red-400/5 hover:bg-red-400/15"
                        >
                          <Archive size={11} />Retire
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Retired matches */}
      {retiredMatches.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Retired Matches</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {retiredMatches.map(match => {
              const owner = getUserById(match.dataOwnerId);
              const host  = getUserById(match.storageHostId);
              return (
                <div key={match.id} className="px-4 py-3 flex items-center justify-between gap-3 opacity-60">
                  <span className="text-sm text-slate-300">{owner?.name} → {host?.name}</span>
                  <MatchStatusPill status="Retired" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Audit log */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Admin Audit Log</h3>
        </div>
        {adminLog.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">No admin actions recorded this session.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {adminLog.map((entry, i) => (
              <div key={i} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`font-semibold capitalize ${
                    entry.type === 'retire' ? 'text-red-400' :
                    entry.type === 'pause'  ? 'text-amber-400' :
                    entry.type === 'flag'   ? 'text-orange-400' :
                    'text-emerald-400'
                  }`}>{entry.type}</span>
                  <span className="text-slate-500 font-mono">{entry.matchId}</span>
                  <span className="text-slate-500 ml-auto">{formatDate(entry.timestamp)}</span>
                </div>
                <p className="text-slate-400">{entry.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Paid marketplace block notice */}
      <div className="flex items-start gap-2.5 p-3 bg-red-400/5 border border-red-400/20 rounded-lg">
        <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-red-300/80 space-y-1">
          <p><strong>Paid marketplace is blocked.</strong> Per ADR 0002, paid storage features are not available until the following are in place:</p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            {[
              'Restore reliability demonstrated',
              'Peer replacement tested and documented',
              'Abuse process documented',
              'Legal review completed',
              'Payment and payout provider selected',
              'Provider reliability controls in place',
            ].map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
