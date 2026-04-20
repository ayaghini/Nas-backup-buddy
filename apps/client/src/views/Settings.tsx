import { Settings, AlertTriangle } from 'lucide-react';

export function SettingsView() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Settings</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Settings will be editable once the config backend is implemented.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Planned Settings</h3>
        {[
          'Backup schedule (cron or interval)',
          'Kopia retention policy',
          'Peer quota and hosted storage path',
          'Web API URL',
          'Notification preferences',
          'Theme (dark / system)',
          'Export redacted diagnostics',
          'Reset / uninstall',
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
