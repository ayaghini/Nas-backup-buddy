import { HardDrive, AlertTriangle } from 'lucide-react';

export function BackupPlan() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <HardDrive size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Backup Plan</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Will show source folders, repository location, Kopia schedule,
          retention policy, and last snapshot summary once the backend is connected.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Planned Sections</h3>
        {[
          'Source folders (count, total size — no file names)',
          'Encrypted repository location',
          'Last snapshot: timestamp, size, duration',
          'Kopia retention policy settings',
          'Next scheduled backup time',
          'Run backup now',
          'Run repository check',
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-1 h-1 rounded-full bg-slate-600 flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
