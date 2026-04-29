// Host tab — Docker host-agent setup and management.
//
// Independent of owner/backup setup. A host-only user can use this tab
// without visiting Setup Wizard, Backup Plan, Recovery Key, or other tabs.
//
// Persists host state separately from owner backup state using a dedicated
// "hostTabState" key in app-config.json.

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Network,
  Server,
  Settings,
  Terminal,
} from 'lucide-react';
import type { HostEnvValues, HostTabPersistedState } from '../lib/host-agent-types';
import { HostStackPanel } from './host/HostStackPanel';
import { TailscalePanel } from './host/TailscalePanel';
import { SettingsPanel } from './host/SettingsPanel';
import { AllocationsPanel } from './host/AllocationsPanel';
import { DiagnosticsPanel } from './host/DiagnosticsPanel';

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown; }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

async function loadHostState(): Promise<Partial<HostTabPersistedState>> {
  if (!isTauri()) return {};
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<Record<string, unknown>>('load_app_config');
    const s = raw['hostTabState'];
    if (typeof s === 'object' && s !== null) {
      return s as Partial<HostTabPersistedState>;
    }
  } catch { /* no-op */ }
  return {};
}

async function saveHostState(state: Partial<HostTabPersistedState>): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const existing = await invoke<Record<string, unknown>>('load_app_config');
    const merged = { ...existing, hostTabState: { ...(existing['hostTabState'] as object ?? {}), ...state } };
    await invoke<void>('save_app_config', { config: merged });
  } catch { /* non-fatal */ }
}

type SectionId = 'stack' | 'tailscale' | 'settings' | 'allocations' | 'diagnostics';

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'stack',       label: 'Host Stack',          icon: <Server size={13} /> },
  { id: 'tailscale',   label: 'Tailscale & Network',  icon: <Network size={13} /> },
  { id: 'settings',    label: 'Host Settings',        icon: <Settings size={13} /> },
  { id: 'allocations', label: 'Allocations',          icon: <HardDrive size={13} /> },
  { id: 'diagnostics', label: 'Events & Diagnostics', icon: <Terminal size={13} /> },
];

const DEFAULT_API_URL = 'http://127.0.0.1:7420/api/v1';

export function Host() {
  const [token, setToken] = useState('');
  const [apiUrl] = useState(DEFAULT_API_URL);
  const [connected, setConnected] = useState(false);
  const [env, setEnv] = useState<Partial<HostEnvValues>>({});
  const [openSection, setOpenSection] = useState<SectionId>('stack');
  const [loaded, setLoaded] = useState(false);

  const appMode: 'tauri' | 'browser' = isTauri() ? 'tauri' : 'browser';

  // Load persisted state on mount
  useEffect(() => {
    loadHostState().then(saved => {
      if (saved.hostAgentToken) setToken(saved.hostAgentToken);
      if (saved.lastKnownEnv) setEnv(saved.lastKnownEnv);
      setLoaded(true);
    });
  }, []);

  const handleTokenChange = useCallback((t: string) => {
    setToken(t);
    void saveHostState({ hostAgentToken: t });
  }, []);

  const handleConnected = useCallback(() => {
    setConnected(true);
    void saveHostState({ lastHostSetupCompletedAt: new Date().toISOString() });
  }, []);

  const handleEnvChange = useCallback((e: Partial<HostEnvValues>) => {
    setEnv(e);
    void saveHostState({ lastKnownEnv: e });
  }, []);

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Server size={16} className="text-sky-400" />
          <h1 className="text-sm font-semibold text-slate-100">Host</h1>
          {connected ? (
            <span className="ml-2 flex items-center gap-1 text-xs text-emerald-400">
              <Activity size={10} /> Agent connected
            </span>
          ) : (
            <span className="ml-2 text-xs text-slate-500">not connected</span>
          )}
          {appMode === 'browser' && (
            <span className="ml-auto text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} /> browser/mock mode
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Manage the Docker host-agent stack and storage allocations for backup owners.
        </p>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
          {SECTIONS.map(({ id, label, icon }) => {
            const isOpen = openSection === id;
            return (
              <div key={id} className="rounded border border-slate-800 overflow-hidden">
                <button
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors ${
                    isOpen
                      ? 'bg-slate-800/60 text-slate-100'
                      : 'text-slate-300 hover:bg-slate-800/30 hover:text-slate-100'
                  }`}
                  onClick={() => setOpenSection(isOpen ? id : id)}
                >
                  <span className="text-sky-400">{icon}</span>
                  <span className="flex-1 text-left font-medium">{label}</span>
                  {/* Section badge */}
                  {id === 'stack' && !connected && (
                    <span className="text-xs text-amber-400">setup needed</span>
                  )}
                  {id === 'stack' && connected && (
                    <span className="text-xs text-emerald-400">connected</span>
                  )}
                  {id === 'tailscale' && env.NASBB_SFTP_BIND === '127.0.0.1' && (
                    <span className="text-xs text-amber-400">local-only</span>
                  )}
                  {isOpen ? (
                    <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-3 border-t border-slate-800">
                    {id === 'stack' && (
                      <HostStackPanel
                        token={token}
                        onTokenChange={handleTokenChange}
                        onConnected={handleConnected}
                        appMode={appMode}
                      />
                    )}
                    {id === 'tailscale' && (
                      <TailscalePanel
                        token={token}
                        env={env}
                        onEnvChange={handleEnvChange}
                        appMode={appMode}
                      />
                    )}
                    {id === 'settings' && (
                      <SettingsPanel token={token} apiUrl={apiUrl} />
                    )}
                    {id === 'allocations' && (
                      <AllocationsPanel token={token} apiUrl={apiUrl} env={env} />
                    )}
                    {id === 'diagnostics' && (
                      <DiagnosticsPanel token={token} apiUrl={apiUrl} appMode={appMode} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
