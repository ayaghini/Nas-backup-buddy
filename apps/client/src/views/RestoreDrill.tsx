import { RotateCcw, AlertTriangle, CheckCircle } from 'lucide-react';

export function RestoreDrill() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <RotateCcw size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Restore Drill</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Will guide the user through a canary restore drill
          and update the Protected gate when the Tauri backend is connected.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Restore Drill Procedure</h3>
        <div className="space-y-2">
          {[
            'Select a recent Kopia snapshot.',
            'Restore to a clean, isolated destination folder.',
            'Verify the canary file exists in the restored output.',
            'Verify the canary file checksum matches the expected value.',
            'Spot-check at least three other restored files.',
            'Record restore duration.',
            'Confirm recovery password was available without app help.',
            'Delete restore output if it contains sensitive data.',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-xs font-mono
                flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Outcomes</h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-2 text-emerald-400">
            <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Pass — Protected gate check cleared. Drill must be re-run every 30 days.</span>
          </div>
          <div className="flex items-start gap-2 text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Fail — match is marked Critical. Do not prune snapshots. Investigate immediately.</span>
          </div>
          <div className="flex items-start gap-2 text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Canary mismatch — Critical. Preserve all logs. Test alternate snapshot.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
