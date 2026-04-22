import { CheckCircle, ChevronRight, KeyRound, Lock, Settings, ShieldAlert, ShieldCheck, Sliders } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

function Toggle({ enabled, onToggle, label, description }: {
  enabled: boolean; onToggle: () => void; label: string; description: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-start gap-3 p-3 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-800/30 text-left transition-colors"
    >
      <div className={`mt-0.5 w-8 h-4 rounded-full flex-shrink-0 relative transition-colors ${enabled ? 'bg-sky-500' : 'bg-slate-700'}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
      </div>
    </button>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const { offlineMode, healthReportConsent, recoveryKeyConfirmed, setOfflineMode, setHealthReportConsent } = useApp();

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Settings</h1>
      </div>

      {/* Mode toggles */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mode</h3>
        <Toggle
          enabled={offlineMode}
          onToggle={() => setOfflineMode(!offlineMode)}
          label="Mock / offline mode"
          description="Use mock data — no Tauri backend or web API required. Safe for development and demos."
        />
        <Toggle
          enabled={healthReportConsent}
          onToggle={() => setHealthReportConsent(!healthReportConsent)}
          label="Health reporting to web app"
          description="Send allowlisted operational metadata to the web coordination service. Off by default."
        />
      </div>

      {/* Recovery key status */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Recovery Key &amp; Backup Password</h3>
        <div className={`flex items-center justify-between p-3 rounded-lg border ${
          recoveryKeyConfirmed
            ? 'border-emerald-800/40 bg-emerald-500/5'
            : 'border-amber-700/40 bg-amber-500/5'
        }`}>
          <div className="flex items-center gap-2.5">
            {recoveryKeyConfirmed
              ? <ShieldCheck size={15} className="text-emerald-400 flex-shrink-0" />
              : <ShieldAlert size={15} className="text-amber-400 flex-shrink-0" />
            }
            <div>
              <div className={`text-sm font-medium ${recoveryKeyConfirmed ? 'text-emerald-300' : 'text-amber-300'}`}>
                {recoveryKeyConfirmed ? 'Confirmed — recovery key saved externally' : 'Action required — recovery key not confirmed'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {recoveryKeyConfirmed
                  ? 'Password is held in process memory for this session.'
                  : 'Enter your password and confirm it is saved outside this device.'}
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/recovery')}
            className="flex items-center gap-0.5 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap flex-shrink-0 ml-3"
          >
            <KeyRound size={12} />
            {recoveryKeyConfirmed ? 'Manage' : 'Set up'}
            <ChevronRight size={11} />
          </button>
        </div>
      </div>

      {/* Local-only secrets policy */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Secret Handling Policy</h3>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          {[
            'Backup passwords and recovery keys are stored in the OS keychain only.',
            'TOML config stores keychain references — never secret values.',
            'Pairing tokens are stored in the OS keychain.',
            'No secret is ever sent to the web API or included in health reports.',
            'Diagnostic bundles are redacted before export.',
          ].map((rule, i) => (
            <div key={i} className="flex items-start gap-2">
              <Lock size={11} className="text-sky-400/60 flex-shrink-0 mt-0.5" />
              {rule}
            </div>
          ))}
        </div>
      </div>

      {/* Config storage */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Config Storage</h3>
        <div className="space-y-1.5 text-xs">
          {[
            { platform: 'macOS', path: '~/Library/Application Support/NAS Backup Buddy/' },
            { platform: 'Linux', path: '~/.config/nasbb/' },
            { platform: 'Windows', path: '%APPDATA%\\NAS Backup Buddy\\' },
          ].map(({ platform, path }) => (
            <div key={platform} className="flex items-start gap-2">
              <span className="text-slate-500 w-16 flex-shrink-0">{platform}</span>
              <code className="text-slate-400 break-all">{path}</code>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-600">Config paths are placeholders — actual paths depend on the OS and app data directory at runtime.</p>
      </div>

      {/* Current state summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Current State</h3>
        {[
          { label: 'Offline mode', value: offlineMode },
          { label: 'Health reporting', value: healthReportConsent },
          { label: 'Recovery key confirmed', value: recoveryKeyConfirmed },
        ].map(({ label, value }: { label: string; value: boolean }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{label}</span>
            <span className={`flex items-center gap-1 text-xs ${value ? 'text-emerald-400' : 'text-slate-600'}`}>
              {value && <CheckCircle size={11} />}
              {value ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ))}
      </div>

      {/* Planned settings */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Planned Settings</h3>
        {[
          'Backup schedule (cron or interval)',
          'Kopia retention policy editor',
          'Peer quota and hosted storage path',
          'Web API URL',
          'Notification preferences',
          'Export redacted diagnostics',
          'Reset / uninstall',
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-slate-600">
            <Sliders size={11} className="flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
