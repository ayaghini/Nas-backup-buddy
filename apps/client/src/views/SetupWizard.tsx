import { AlertTriangle, CheckCircle, HardDrive, Lock, Shield, Users, Wand2 } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Choose role',              icon: <Users size={16} />,     done: false },
  { id: 2, label: 'Select source folders',    icon: <HardDrive size={16} />, done: false },
  { id: 3, label: 'Set repository location',  icon: <Lock size={16} />,      done: false },
  { id: 4, label: 'Configure hosted storage', icon: <HardDrive size={16} />, done: false },
  { id: 5, label: 'Save recovery key',        icon: <Shield size={16} />,    done: false },
  { id: 6, label: 'Configure retention',      icon: <Shield size={16} />,    done: false },
  { id: 7, label: 'Pair with web app',        icon: <CheckCircle size={16} />, done: false },
];

export function SetupWizard() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Wand2 size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Setup Wizard</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          <strong>Placeholder — not yet interactive.</strong> The wizard UI will be implemented when
          the Tauri backend commands are ready. See <code>src-tauri/src/lib.rs</code> for the
          command stubs.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Onboarding Steps</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {STEPS.map(step => (
            <div key={step.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 text-xs font-mono
                flex items-center justify-center flex-shrink-0">
                {step.id}
              </span>
              <span className="text-slate-500 flex-shrink-0">{step.icon}</span>
              <span className="text-sm text-slate-400">{step.label}</span>
              <span className="ml-auto text-xs text-slate-600">Pending</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Safety Constraints</h3>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          <p>• Source folders will never be shared directly with peers.</p>
          <p>• Repository path must not be inside a source folder, and vice versa.</p>
          <p>• Backups are encrypted by Kopia before any sync occurs.</p>
          <p>• Your recovery password is never stored on this device in plaintext.</p>
          <p>• The web app receives health metrics only — never file names or contents.</p>
        </div>
      </div>
    </div>
  );
}
