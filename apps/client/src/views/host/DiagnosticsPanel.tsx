import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { HostAgentEvent, HostAgentHealth, HostAgentStorageStatus } from '../../lib/host-agent-types';
import { formatBytes } from '../../lib/host-agent-types';
import {
  getEvents,
  getHealth,
  getStorageStatus,
  errorMessage,
} from '../../lib/host-agent-api';
import { hostAgentRunVerify } from '../../lib/tauri-bridge';

interface Props {
  token: string;
  apiUrl: string;
  appMode: 'tauri' | 'browser';
}

const EVENT_KIND_COLOR: Record<string, string> = {
  'allocation.created': 'text-sky-400',
  'invite.exported': 'text-sky-300',
  'key.authorized': 'text-emerald-400',
  'key.deauthorized': 'text-orange-400',
  'sftp.reload': 'text-slate-400',
  'quota.warning': 'text-amber-400',
  'quota.critical': 'text-red-400',
  'quota.restored': 'text-emerald-400',
  'allocation.suspended': 'text-orange-400',
  'allocation.resumed': 'text-emerald-400',
  'allocation.retiring': 'text-slate-400',
  'allocation.retired': 'text-slate-500',
  'invite.expired': 'text-amber-400',
};

export function DiagnosticsPanel({ token, apiUrl, appMode }: Props) {
  const [health, setHealth] = useState<HostAgentHealth | null>(null);
  const [storage, setStorage] = useState<HostAgentStorageStatus | null>(null);
  const [events, setEvents] = useState<HostAgentEvent[]>([]);
  const [verifyOutput, setVerifyOutput] = useState('');
  const [verifyPassed, setVerifyPassed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    setBusy('refresh');
    setError(null);
    try {
      const [h, s, ev] = await Promise.all([
        getHealth(token, apiUrl),
        getStorageStatus(token, apiUrl),
        getEvents(token, { limit: 50 }, apiUrl),
      ]);
      setHealth(h);
      setStorage(s);
      setEvents(ev);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    if (token) void refreshAll();
  }, [token, refreshAll]);

  async function runVerify() {
    setBusy('verify');
    setVerifyOutput('');
    setVerifyPassed(null);
    setError(null);
    try {
      const result = await hostAgentRunVerify();
      setVerifyOutput(result.output);
      setVerifyPassed(result.passed);
      if (result.error) setError(result.error);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!token) {
    return (
      <div className="text-xs text-slate-500 p-3">
        Connect to the host agent first (Host Stack tab).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Health summary */}
      {health && (
        <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-1.5">
          <div className="text-xs font-medium text-slate-300 mb-2">Health</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
            <StatusLine ok={health.agentRunning} label="Agent running" />
            <StatusLine ok={health.sftpRunning} label="SFTP running" />
            <StatusLine ok={health.storageRootAvailable} label="Storage available" />
            <StatusLine ok={!health.sftpPublicExposureWarning} label="No public exposure" />
            <div className="col-span-2">
              Overlay: <span className={
                health.overlayStatus === 'connected' ? 'text-emerald-400' :
                health.overlayStatus === 'unconfigured' ? 'text-slate-500' : 'text-amber-400'
              }>{health.overlayStatus}</span>
            </div>
          </div>
          {health.sftpPublicExposureWarning && (
            <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300 flex items-center gap-1.5 mt-1">
              <AlertTriangle size={11} />
              SFTP public exposure warning — SFTP may be reachable without Tailscale protection
            </div>
          )}
        </div>
      )}

      {/* Storage */}
      {storage && (
        <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-1">
          <div className="text-xs font-medium text-slate-300 mb-1">Storage</div>
          <div className="text-xs text-slate-400">
            <div>Total: {formatBytes(storage.totalBytes)}</div>
            <div>Available: {formatBytes(storage.availableBytes)}</div>
            <div>Used: {formatBytes(storage.usedBytes)}</div>
            <div>Allocations: {storage.allocationCount}</div>
          </div>
        </div>
      )}

      {/* Verification */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-300">End-to-End Verification</div>
        {appMode === 'browser' && (
          <div className="text-xs text-amber-400">Verification script requires the Tauri app.</div>
        )}
        <button
          onClick={runVerify}
          disabled={!!busy || appMode === 'browser'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700 text-xs text-sky-100 disabled:opacity-50"
        >
          {busy === 'verify' ? <Loader2 size={11} className="animate-spin" /> : <Terminal size={11} />}
          Run host verification
        </button>
        {verifyPassed !== null && (
          <div className={`flex items-center gap-1.5 text-xs ${verifyPassed ? 'text-emerald-400' : 'text-red-400'}`}>
            {verifyPassed ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {verifyPassed ? 'All checks passed' : 'Some checks failed'}
          </div>
        )}
        {verifyOutput && (
          <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap bg-slate-800/60 rounded p-2 max-h-64 overflow-y-auto leading-5">
            {verifyOutput}
          </pre>
        )}
      </div>

      {/* Events */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-slate-300">Recent Events</div>
          <button
            onClick={refreshAll}
            disabled={!!busy}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50"
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
        {busy === 'refresh' && events.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={11} className="animate-spin" /> Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="text-xs text-slate-500">No events yet.</div>
        ) : (
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {events.map(ev => (
              <div key={ev.eventId} className="flex gap-2 text-xs leading-5">
                <span className="text-slate-600 flex-shrink-0 font-mono">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
                <span className={`flex-shrink-0 ${EVENT_KIND_COLOR[ev.kind] ?? 'text-slate-400'}`}>
                  {ev.kind}
                </span>
                <span className="text-slate-400 truncate">{ev.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          {error}
          <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {ok ? <CheckCircle size={10} /> : <XCircle size={10} />}
      {label}
    </div>
  );
}
