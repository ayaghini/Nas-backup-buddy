import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  HardDrive,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { getUserById, formatDate, formatStorageGB, CURRENT_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { DrillStatusPill } from '../components/StatusPill';
import type { RestoreDrill } from '../types';

const CHECKLIST = [
  'Stop writing to the restore destination if it already exists.',
  'Select the snapshot to restore.',
  'Restore to a clean destination folder.',
  'Verify the canary file exists in the restored output.',
  'Verify the canary file checksum matches expected.',
  'Spot-check at least three other restored files.',
  'Record restore duration.',
  'Confirm password/key material was available without platform help.',
  'Delete restore output if it contains sensitive data.',
];

function DrillCard({ drill, matchPeer }: { drill: RestoreDrill; matchPeer: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-200">Drill — {matchPeer}</span>
            <DrillStatusPill status={drill.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatDate(drill.startedAt)}
            </span>
            {drill.restoreDurationSecs && (
              <span className="flex items-center gap-1">
                <RotateCcw size={11} />
                {Math.ceil(drill.restoreDurationSecs / 60)} min
              </span>
            )}
            <span>By {drill.operatorName}</span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-sky-400 hover:text-sky-300 flex-shrink-0"
        >
          {expanded ? 'Collapse' : 'View record'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4 bg-slate-950/50 space-y-3">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Audit Evidence Record
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              { label: 'Backup snapshot',         value: drill.backupSnapshot },
              { label: 'Repository size',          value: drill.repositorySizeGB ? formatStorageGB(drill.repositorySizeGB) : undefined },
              { label: 'Restore destination',      value: drill.restoreDestination },
              { label: 'Tool versions',            value: drill.toolVersions },
              { label: 'Canary checksum expected', value: drill.canaryChecksumExpected },
              { label: 'Canary checksum observed', value: drill.canaryChecksumObserved },
            ].map(({ label, value }) =>
              value ? (
                <div key={label}>
                  <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                  <div className="text-xs font-mono text-slate-300 break-all">{value}</div>
                </div>
              ) : null
            )}
          </div>

          {/* Checksum match */}
          {drill.canaryChecksumExpected && drill.canaryChecksumObserved && (
            <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
              drill.canaryChecksumExpected === drill.canaryChecksumObserved
                ? 'bg-emerald-400/5 border-emerald-400/20 text-emerald-400'
                : 'bg-red-400/5 border-red-400/20 text-red-400'
            }`}>
              {drill.canaryChecksumExpected === drill.canaryChecksumObserved
                ? <><CheckCircle size={13} /> Canary checksum matched — data integrity confirmed</>
                : <><XCircle size={13} /> Canary checksum MISMATCH — critical, investigate immediately</>
              }
            </div>
          )}

          {drill.warnings && drill.warnings !== 'None.' && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-400/5 border border-amber-400/20">
              <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-medium text-amber-400 mb-0.5">Warnings</div>
                <p className="text-xs text-amber-300/80">{drill.warnings}</p>
              </div>
            </div>
          )}

          {drill.followUp && drill.followUp !== 'None required.' && (
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Follow-up</div>
              <p className="text-xs text-slate-300">{drill.followUp}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewDrillModal({
  matchOptions,
  onClose,
  onSave,
}: {
  matchOptions: { id: string; peerName: string }[];
  onClose: () => void;
  onSave: (drill: Partial<RestoreDrill> & { matchId: string }) => void;
}) {
  const [matchId,     setMatchId]     = useState(matchOptions[0]?.id ?? '');
  const [snapshot,    setSnapshot]    = useState('');
  const [destination, setDestination] = useState('');
  const [toolVers,    setToolVers]    = useState('');
  const [checklist,   setChecklist]   = useState<boolean[]>(CHECKLIST.map(() => false));
  const [checksumExp, setChecksumExp] = useState('');
  const [checksumObs, setChecksumObs] = useState('');
  const [duration,    setDuration]    = useState('');
  const [warnings,    setWarnings]    = useState('');
  const [followUp,    setFollowUp]    = useState('');

  const allChecked = checklist.every(Boolean);

  const toggle = (i: number) => {
    const next = [...checklist];
    next[i] = !next[i];
    setChecklist(next);
  };

  const checksumMatch = checksumExp.trim() && checksumObs.trim() && checksumExp.trim() === checksumObs.trim();
  const checksumFail  = checksumExp.trim() && checksumObs.trim() && checksumExp.trim() !== checksumObs.trim();

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <RotateCcw size={16} className="text-sky-400" />
            New Restore Drill
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Match select */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-match">Match</label>
            <select
              id="drill-match"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                focus:outline-none focus:border-sky-500/50"
            >
              {matchOptions.map((m) => (
                <option key={m.id} value={m.id}>Match with {m.peerName}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-snapshot">Backup Snapshot ID</label>
              <input id="drill-snapshot" type="text" value={snapshot}
                onChange={e => setSnapshot(e.target.value)}
                placeholder="kopia:snap-…"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                  placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-tools">Tool Versions</label>
              <input id="drill-tools" type="text" value={toolVers}
                onChange={e => setToolVers(e.target.value)}
                placeholder="Kopia 0.17.0 / Syncthing 1.27.7"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                  placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-dest">Restore Destination</label>
              <input id="drill-dest" type="text" value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder="/tmp/restore-test-…"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                  placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-duration">Duration (minutes)</label>
              <input id="drill-duration" type="number" value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="30"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                  placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
            </div>
          </div>

          {/* Canary checksums */}
          <div>
            <div className="text-xs text-slate-400 mb-1.5">Canary File Checksum Verification</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1" htmlFor="drill-cs-exp">Expected</label>
                <input id="drill-cs-exp" type="text" value={checksumExp}
                  onChange={e => setChecksumExp(e.target.value)}
                  placeholder="sha256:…"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs font-mono
                    text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1" htmlFor="drill-cs-obs">Observed</label>
                <input id="drill-cs-obs" type="text" value={checksumObs}
                  onChange={e => setChecksumObs(e.target.value)}
                  placeholder="sha256:…"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs font-mono
                    text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500/50" />
              </div>
            </div>
            {checksumMatch && (
              <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={11} />Checksums match</p>
            )}
            {checksumFail && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1"><XCircle size={11} />Checksums do NOT match — mark Critical</p>
            )}
          </div>

          {/* Procedure checklist */}
          <div>
            <div className="text-xs text-slate-400 mb-2">Procedure Checklist</div>
            <div className="space-y-1.5">
              {CHECKLIST.map((step, i) => (
                <label key={i} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checklist[i]}
                    onChange={() => toggle(i)}
                    className="mt-0.5 accent-sky-500 flex-shrink-0"
                  />
                  <span className={`text-xs leading-relaxed ${checklist[i] ? 'text-slate-400 line-through' : 'text-slate-300'}`}>
                    {step}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-warnings">Warnings / Issues</label>
            <textarea id="drill-warnings" value={warnings}
              onChange={e => setWarnings(e.target.value)}
              rows={2}
              placeholder="None."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none" />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5" htmlFor="drill-followup">Follow-up Actions</label>
            <textarea id="drill-followup" value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              rows={2}
              placeholder="None required."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                placeholder-slate-600 focus:outline-none focus:border-sky-500/50 resize-none" />
          </div>

          {checksumFail && (
            <div className="flex items-start gap-2 p-3 bg-red-400/5 border border-red-400/20 rounded-lg">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/90">
                Checksum mismatch detected. This match must be marked Critical. Do not prune snapshots.
                Preserve all logs. Investigate the repository and restore process before this match can be Protected.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-md border border-slate-700 text-sm
            text-slate-300 hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                matchId,
                backupSnapshot: snapshot,
                restoreDestination: destination,
                toolVersions: toolVers,
                canaryChecksumExpected: checksumExp,
                canaryChecksumObserved: checksumObs,
                restoreDurationSecs: duration ? Number(duration) * 60 : undefined,
                warnings: warnings || 'None.',
                followUp: followUp || 'None required.',
                status: checksumFail ? 'Fail' : allChecked ? 'Pass' : 'In Progress',
              })
            }
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-sky-500/15 text-sky-400
              border border-sky-500/25 hover:bg-sky-500/25 transition-colors"
          >
            Record Drill
          </button>
        </div>
      </div>
    </div>
  );
}

export function RestoreDrills() {
  const { drills, matches, recordDrill } = useApp();
  const [showNew, setShowNew] = useState(false);

  const matchOptions = matches
    .filter((m) => m.status !== 'Retired')
    .map((m) => {
      const peer = getUserById(
        m.dataOwnerId === CURRENT_USER.id ? m.storageHostId : m.dataOwnerId
      );
      return { id: m.id, peerName: peer?.name ?? 'Unknown peer' };
    });

  const save = (partial: Partial<RestoreDrill> & { matchId: string }) => {
    recordDrill(partial);
    setShowNew(false);
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">
      {showNew && matchOptions.length > 0 && (
        <NewDrillModal
          matchOptions={matchOptions}
          onClose={() => setShowNew(false)}
          onSave={save}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100 mb-1">Restore Drills</h2>
          <p className="text-sm text-slate-400">
            A restore drill must pass before Protected status is granted. Run drills every 30 days.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          disabled={matchOptions.length === 0}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium
            bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={14} />
          New Drill
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Drills',   value: drills.length,                              color: 'text-slate-200' },
          { label: 'Passed',         value: drills.filter(d => d.status === 'Pass').length,    color: 'text-emerald-400' },
          { label: 'Failed',         value: drills.filter(d => d.status === 'Fail').length,    color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-center">
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Frequency guidance */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Frequency Requirements</h3>
        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <HardDrive size={12} className="text-slate-500" />
            <span><strong className="text-slate-200">Alpha:</strong> Once per match before Protected status can be granted.</span>
          </div>
          <div className="flex items-center gap-2">
            <RotateCcw size={12} className="text-slate-500" />
            <span><strong className="text-slate-200">Beta:</strong> Monthly automated canary restore, quarterly manual restore.</span>
          </div>
          <div className="flex items-center gap-2">
            <FileText size={12} className="text-slate-500" />
            <span><strong className="text-slate-200">Paid marketplace:</strong> Monthly restore required for Protected status.</span>
          </div>
        </div>
      </div>

      {/* Drill history */}
      <div className="space-y-3">
        {drills.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-10 text-center">
            <RotateCcw size={24} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No drills on record.</p>
            <button onClick={() => setShowNew(true)} className="mt-3 text-sky-400 text-sm hover:text-sky-300">
              Run your first drill
            </button>
          </div>
        ) : (
          drills.map((drill) => {
            const match = matches.find((m) => m.id === drill.matchId);
            const peer  = match
              ? getUserById(match.dataOwnerId === CURRENT_USER.id ? match.storageHostId : match.dataOwnerId)
              : null;
            return (
              <DrillCard
                key={drill.id}
                drill={drill}
                matchPeer={peer?.name ?? 'Unknown peer'}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
