import { Activity, AlertTriangle, CheckCircle, HardDrive, RotateCcw, Shield } from 'lucide-react';

export function Dashboard() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-base font-semibold text-slate-100 mb-1">Dashboard</h1>
        <p className="text-sm text-slate-400">Local backup status — no data leaves this device.</p>
      </div>

      {/* Offline mode banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
        <span>
          <strong>Offline / mock mode.</strong> The web API is not yet connected.
          Health data shown here is from local state only.
        </span>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Last Backup',    value: '2h ago',     icon: <HardDrive size={16} />,  color: 'bg-emerald-500/10 text-emerald-400' },
          { label: 'Last Sync',      value: '1h ago',     icon: <Activity size={16} />,   color: 'bg-emerald-500/10 text-emerald-400' },
          { label: 'Restore Drill',  value: 'Never run',  icon: <RotateCcw size={16} />,  color: 'bg-amber-500/10 text-amber-400'    },
          { label: 'Protected Gate', value: '5 / 8',      icon: <Shield size={16} />,     color: 'bg-amber-500/10 text-amber-400'    },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
            <div className={`p-2 rounded-lg flex-shrink-0 ${color}`}>{icon}</div>
            <div>
              <div className="text-lg font-bold font-mono text-slate-100">{value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Required actions placeholder */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Required Actions</h3>
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-400/20 bg-amber-400/5">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-slate-300">Run a restore drill — no drill on record. Protected status is blocked until a drill passes.</span>
        </div>
      </div>

      {/* Setup reminder */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Setup</h3>
        <div className="space-y-1.5">
          {[
            { done: true,  label: 'Source folders selected' },
            { done: true,  label: 'Encrypted repository created' },
            { done: false, label: 'Syncthing connection established' },
            { done: false, label: 'Web app paired' },
            { done: false, label: 'Restore drill completed' },
          ].map(({ done, label }) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              {done
                ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
              }
              <span className={done ? 'text-slate-300' : 'text-slate-400'}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
