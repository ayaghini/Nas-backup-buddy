import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronRight, Download,
  ExternalLink, KeyRound, Lock, Settings, ShieldAlert,
  ShieldCheck, Sliders, Terminal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getCurrentPlatform } from '../lib/tauri-bridge';

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

// ── Kopia install helper ──────────────────────────────────────────────────────

interface InstallMethod {
  label: string;
  command?: string;
  description: string;
  url?: string;
}

function installMethods(platform: string): InstallMethod[] {
  if (platform.includes('windows')) {
    return [
      {
        label: 'winget (recommended)',
        command: 'winget install Kopia.Kopia',
        description: 'Windows Package Manager — built into Windows 10 (1809+) and Windows 11.',
      },
      {
        label: 'Chocolatey',
        command: 'choco install kopia',
        description: 'Chocolatey package manager.',
      },
      {
        label: 'Direct download',
        description: 'Download the Windows installer from kopia.io.',
        url: 'https://kopia.io/docs/installation/#windows',
      },
    ];
  }
  if (platform.includes('darwin') || platform.includes('mac')) {
    return [
      {
        label: 'Homebrew (recommended)',
        command: 'brew install kopia',
        description: 'Homebrew package manager.',
      },
      {
        label: 'MacPorts',
        command: 'sudo port install kopia',
        description: 'MacPorts package manager.',
      },
      {
        label: 'Direct download',
        description: 'Download the macOS package from kopia.io.',
        url: 'https://kopia.io/docs/installation/#macos',
      },
    ];
  }
  // Linux
  return [
    {
      label: 'APT (Debian/Ubuntu)',
      command: 'curl -s https://kopia.io/signing-key | sudo gpg --dearmor -o /etc/apt/keyrings/kopia-keyring.gpg\necho "deb [signed-by=/etc/apt/keyrings/kopia-keyring.gpg] http://packages.kopia.io/apt/ stable main" | sudo tee /etc/apt/sources.list.d/kopia.list\nsudo apt update && sudo apt install kopia',
      description: 'Official Kopia APT repository.',
    },
    {
      label: 'RPM (Fedora/RHEL)',
      command: 'sudo rpm --import https://kopia.io/signing-key\nsudo dnf install kopia',
      description: 'Official Kopia RPM repository.',
    },
    {
      label: 'Direct download',
      description: 'Download the Linux binary from kopia.io.',
      url: 'https://kopia.io/docs/installation/#linux',
    },
  ];
}

function KopiaInstallHelper({ platform }: { platform: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const methods = installMethods(platform);

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="bg-slate-900 border border-red-500/20 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-red-500/5 border-b border-red-500/20 flex items-center gap-2">
        <AlertTriangle size={14} className="text-red-400" />
        <span className="text-sm font-semibold text-red-300">Kopia not found</span>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          Kopia was not found on this system. Install it using one of the methods below, then restart the app.
          The app bundles Kopia for packaged releases — in development mode you need a system installation.
        </p>

        <div className="space-y-2">
          {methods.map(method => (
            <div key={method.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">{method.label}</span>
                {method.url && (
                  <a
                    href={method.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                  >
                    <ExternalLink size={11} /> Open
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-500">{method.description}</p>
              {method.command && (
                <div className="relative">
                  <pre className="bg-slate-900 rounded p-2 text-xs font-mono text-sky-300/80 overflow-x-auto whitespace-pre-wrap break-all">
                    {method.command}
                  </pre>
                  <button
                    onClick={() => copyCommand(method.command!)}
                    className="absolute top-1.5 right-1.5 flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                  >
                    <Terminal size={10} />
                    {copied === method.command ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-xs text-sky-300/70">
          <Download size={11} className="flex-shrink-0 mt-0.5" />
          After installing Kopia, restart the app. The app will detect it automatically on PATH.
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function SettingsView() {
  const navigate = useNavigate();
  const { offlineMode, healthReportConsent, recoveryKeyConfirmed, toolStatus,
    setOfflineMode, setHealthReportConsent } = useApp();

  const [platform, setPlatform] = useState('');
  useEffect(() => {
    getCurrentPlatform().then(setPlatform).catch(() => {});
  }, []);

  const kopiaOk = toolStatus.kopia === 'ready' || toolStatus.kopia === 'present';

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Settings</h1>
      </div>

      {/* Kopia install helper — shown when missing */}
      {!kopiaOk && <KopiaInstallHelper platform={platform} />}

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

      {/* Tool status */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tools</h3>
        {[
          { name: 'Kopia', status: toolStatus.kopia },
          { name: 'Syncthing', status: toolStatus.syncthing },
        ].map(({ name, status }) => {
          const ok = status === 'ready' || status === 'present';
          return (
            <div key={name} className="flex items-center justify-between text-sm">
              <span className="text-slate-400">{name}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                {status}
                {!ok && name === 'Kopia' && platform && (
                  <span className="text-slate-500 font-normal ml-1">— see install instructions above</span>
                )}
              </span>
            </div>
          );
        })}
        {platform && (
          <p className="text-xs text-slate-600">Platform: <code className="text-slate-500">{platform}</code></p>
        )}
      </div>

      {/* Recovery key status */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Master Encryption Password</h3>
        <div className={`flex items-center justify-between p-3 rounded-lg border ${
          recoveryKeyConfirmed
            ? 'border-emerald-800/40 bg-emerald-500/5'
            : 'border-amber-700/40 bg-amber-500/5'
        }`}>
          <div className="flex items-center gap-2.5">
            {recoveryKeyConfirmed
              ? <ShieldCheck size={15} className="text-emerald-400 flex-shrink-0" />
              : <ShieldAlert size={15} className="text-amber-400 flex-shrink-0" />}
            <div>
              <div className={`text-sm font-medium ${recoveryKeyConfirmed ? 'text-emerald-300' : 'text-amber-300'}`}>
                {recoveryKeyConfirmed ? 'Confirmed — saved externally' : 'Not confirmed — action required'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {recoveryKeyConfirmed
                  ? 'Loaded from OS keychain. External copy confirmed.'
                  : 'Set the password and confirm it is saved outside this device.'}
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

      {/* Secret handling policy */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Secret Handling Policy</h3>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          {[
            'Master password stored in OS keychain — auto-loaded on startup.',
            'Config file (app-config.json) contains only non-secret data.',
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
            { platform: 'macOS', path: '~/Library/Application Support/nasbb-backup-buddy/app-config.json' },
            { platform: 'Linux', path: '~/.local/share/nasbb-backup-buddy/app-config.json' },
            { platform: 'Windows', path: '%APPDATA%\\nasbb-backup-buddy\\app-config.json' },
          ].map(({ platform: p, path }) => (
            <div key={p} className="flex items-start gap-2">
              <span className="text-slate-500 w-16 flex-shrink-0">{p}</span>
              <code className="text-slate-400 break-all">{path}</code>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-600">Backup job configurations are saved here. Passwords are never written to this file.</p>
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
