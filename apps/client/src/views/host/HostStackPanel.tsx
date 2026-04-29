import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Square,
  RotateCcw,
  Eye,
  EyeOff,
  Terminal,
  Zap,
} from 'lucide-react';
import type { HostEnvValues, HostPrereqResult, ComposeStatus } from '../../lib/host-agent-types';
import { generateSecureToken } from '../../lib/host-agent-types';
import {
  hostAgentCheckPrereqs,
  hostAgentComposeDown,
  hostAgentComposeLogs,
  hostAgentComposeRestart,
  hostAgentComposeStatus,
  hostAgentComposeUp,
  hostAgentGetTokenHint,
  hostAgentReadEnv,
  hostAgentWriteEnv,
} from '../../lib/tauri-bridge';
import { getInfo, getStatus, errorMessage } from '../../lib/host-agent-api';

interface Props {
  token: string;
  onTokenChange: (t: string) => void;
  onConnected: () => void;
  appMode: 'tauri' | 'browser';
}

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-xs text-slate-500">{label}: checking…</span>;
  return (
    <span className={`text-xs flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {ok ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
      {label}
    </span>
  );
}

export function HostStackPanel({ token, onTokenChange, onConnected, appMode }: Props) {
  const [prereqs, setPrereqs] = useState<HostPrereqResult | null>(null);
  const [composeStatus, setComposeStatus] = useState<ComposeStatus | null>(null);
  const [env, setEnv] = useState<Partial<HostEnvValues>>({});
  const [editToken, setEditToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [apiAuthed, setApiAuthed] = useState<boolean | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const checkApi = useCallback(async (tok: string) => {
    try {
      const info = await getInfo();
      setApiReachable(info.ready);
      if (tok) {
        try {
          await getStatus(tok);
          setApiAuthed(true);
          onConnected();
        } catch {
          setApiAuthed(false);
        }
      } else {
        setApiAuthed(null);
      }
    } catch {
      setApiReachable(false);
      setApiAuthed(null);
    }
  }, [onConnected]);

  const refresh = useCallback(async () => {
    const [p, s, e] = await Promise.all([
      hostAgentCheckPrereqs(),
      hostAgentComposeStatus(),
      hostAgentReadEnv(),
    ]);
    setPrereqs(p);
    setComposeStatus(s);
    setEnv(e);
    await checkApi(token);
  }, [token, checkApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setEditToken(token);
  }, [token]);

  async function saveEnvAndToken() {
    if (!editToken.trim()) {
      setError('Token is required.');
      return;
    }
    setBusy('saving');
    setError(null);
    try {
      const newEnv: Partial<HostEnvValues> = {
        ...env,
        NASBB_API_TOKEN: editToken.trim(),
      };
      await hostAgentWriteEnv(newEnv);
      onTokenChange(editToken.trim());
      const refreshed = await hostAgentReadEnv();
      setEnv(refreshed);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function generateToken() {
    const tok = generateSecureToken();
    setEditToken(tok);
    setShowToken(true);
  }

  async function fetchTokenHint() {
    setBusy('hint');
    try {
      const h = await hostAgentGetTokenHint();
      if (h) {
        setHint(h);
        setEditToken(h);
        setShowToken(true);
      } else {
        setHint(null);
        setError('No token found in container logs. Pre-set a token or generate one.');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function composeUp() {
    setBusy('up');
    setError(null);
    try {
      await hostAgentComposeUp();
      await new Promise(r => setTimeout(r, 2000));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function composeDown() {
    setBusy('down');
    setError(null);
    try {
      await hostAgentComposeDown();
      await new Promise(r => setTimeout(r, 1500));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function composeRestart() {
    setBusy('restart');
    setError(null);
    try {
      await hostAgentComposeRestart();
      await new Promise(r => setTimeout(r, 2000));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function showLogs() {
    setLogsOpen(true);
    setBusy('logs');
    try {
      const l = await hostAgentComposeLogs();
      setLogs([
        l.agent_logs ? `=== nasbb-agent ===\n${l.agent_logs}` : '',
        l.sftp_logs ? `\n=== nasbb-sftp ===\n${l.sftp_logs}` : '',
        l.error ? `\n[error] ${l.error}` : '',
      ].join('\n').trim());
    } catch (e) {
      setLogs(`Error: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const agentRunning = composeStatus?.services.some(
    s => s.name.includes('agent') && s.state === 'running',
  ) ?? false;
  const sftpRunning = composeStatus?.services.some(
    s => s.name.includes('sftp') && s.state === 'running',
  ) ?? false;
  const anyRunning = agentRunning || sftpRunning;

  const dockerOk = prereqs?.docker_available && prereqs.compose_available;

  return (
    <div className="space-y-3">
      {/* Mode banner */}
      {appMode === 'browser' && (
        <div className="px-3 py-2 rounded bg-amber-900/30 border border-amber-700/40 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle size={12} />
          Browser mode — Docker commands are simulated. Run in the Tauri app for real stack control.
        </div>
      )}

      {/* Prereqs */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-1.5">
        <div className="text-xs font-medium text-slate-300 mb-2">Prerequisites</div>
        <StatusBadge ok={prereqs?.docker_available ?? null} label="Docker" />
        <div />
        <StatusBadge ok={prereqs?.compose_available ?? null} label="Docker Compose" />
        <div />
        <StatusBadge
          ok={prereqs ? prereqs.compose_dir !== null : null}
          label="Host stack files"
        />
        {prereqs?.error && (
          <div className="text-xs text-amber-400 mt-1">{prereqs.error}</div>
        )}
        {prereqs?.docker_version && (
          <div className="text-xs text-slate-500 mt-1">{prereqs.docker_version}</div>
        )}
      </div>

      {/* Container status */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-1.5">
        <div className="text-xs font-medium text-slate-300 mb-2">Container Status</div>
        <StatusBadge ok={agentRunning} label="nasbb-agent" />
        <div />
        <StatusBadge ok={sftpRunning} label="nasbb-sftp" />
        <div />
        <StatusBadge ok={apiReachable} label="API reachable" />
        <div />
        <StatusBadge ok={apiAuthed} label="API authenticated" />
      </div>

      {/* Env summary */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3">
        <div className="text-xs font-medium text-slate-300 mb-2">Active .env</div>
        <div className="space-y-0.5 font-mono text-xs text-slate-400">
          <div>API port: {env.NASBB_API_PORT || '7420'}</div>
          <div>SFTP bind: {env.NASBB_SFTP_BIND || '127.0.0.1'}</div>
          <div>SFTP port: {env.NASBB_SFTP_PORT || '2222'}</div>
          <div>Tailscale addr: {env.TAILSCALE_ADDRESS || <span className="text-slate-600">(not set)</span>}</div>
          <div>Token: {env.NASBB_API_TOKEN ? <span className="text-emerald-500">set</span> : <span className="text-amber-400">not set</span>}</div>
        </div>
      </div>

      {/* Token setup */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-300">API Token</div>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={editToken}
              onChange={e => setEditToken(e.target.value)}
              placeholder="Paste or generate a token"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono pr-7"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <button
            onClick={generateToken}
            className="px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200"
            title="Generate a strong random token"
          >
            <Zap size={12} />
          </button>
          <button
            onClick={fetchTokenHint}
            disabled={busy === 'hint'}
            className="px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 disabled:opacity-50"
            title="Read token from container logs (fallback)"
          >
            {busy === 'hint' ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
          </button>
        </div>
        {hint && (
          <div className="text-xs text-amber-400">Token read from container logs. Save it now.</div>
        )}
        <div className="flex gap-2">
          <button
            onClick={saveEnvAndToken}
            disabled={busy === 'saving' || !editToken.trim()}
            className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === 'saving' ? <Loader2 size={11} className="animate-spin" /> : null}
            Save to .env
          </button>
          <button
            onClick={async () => {
              onTokenChange(editToken.trim());
              await checkApi(editToken.trim());
            }}
            disabled={!editToken.trim()}
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 disabled:opacity-50"
          >
            Connect
          </button>
        </div>
      </div>

      {/* Stack controls */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3">
        <div className="text-xs font-medium text-slate-300 mb-2">Stack Controls</div>
        {!dockerOk && (
          <div className="text-xs text-amber-400 mb-2">
            Docker or Docker Compose not available. Install Docker Desktop or Engine first.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={composeUp}
            disabled={!dockerOk || !!busy || appMode === 'browser'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-xs text-emerald-100 disabled:opacity-40"
          >
            {busy === 'up' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Start stack
          </button>
          <button
            onClick={composeDown}
            disabled={!anyRunning || !!busy || appMode === 'browser'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-800/60 hover:bg-red-700/60 text-xs text-red-200 disabled:opacity-40"
          >
            {busy === 'down' ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />}
            Stop stack
          </button>
          <button
            onClick={composeRestart}
            disabled={!anyRunning || !!busy || appMode === 'browser'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 disabled:opacity-40"
          >
            {busy === 'restart' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            Restart
          </button>
          <button
            onClick={refresh}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 disabled:opacity-40"
          >
            {busy === null ? <RefreshCw size={11} /> : <Loader2 size={11} className="animate-spin" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-slate-900 rounded border border-slate-800">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/50"
          onClick={() => { setLogsOpen(v => !v); if (!logsOpen) void showLogs(); }}
        >
          <span className="flex items-center gap-1.5"><Terminal size={12} /> Container Logs</span>
          {logsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {logsOpen && (
          <div className="border-t border-slate-800 p-2">
            {busy === 'logs' ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 p-2">
                <Loader2 size={11} className="animate-spin" /> Loading logs…
              </div>
            ) : (
              <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-5">
                {logs || '(no output)'}
              </pre>
            )}
            <button
              onClick={() => void showLogs()}
              className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
            >
              <RefreshCw size={10} /> Reload
            </button>
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
