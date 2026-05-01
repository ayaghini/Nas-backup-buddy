import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Shield,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { HostEnvValues } from '../../lib/host-agent-types';
import { classifyReachability } from '../../lib/host-agent-types';
import {
  getTailscaleDetail,
  hostAgentReadEnv,
  hostAgentWriteEnv,
  hostAgentComposeRestart,
} from '../../lib/tauri-bridge';
import type { TailscaleDetail } from '../../lib/types';
import { errorMessage, getOverlayStatus, getSftpStatus, refreshOverlayStatus } from '../../lib/host-agent-api';

interface Props {
  token: string;
  env: Partial<HostEnvValues>;
  onEnvChange: (env: Partial<HostEnvValues>) => void;
  appMode: 'tauri' | 'browser';
}

function ReachabilityBadge({ cls }: { cls: ReturnType<typeof classifyReachability> }) {
  const map = {
    overlay_ready: { color: 'text-emerald-400', label: 'Overlay ready — remote owners can connect' },
    local_test_only: { color: 'text-amber-400', label: 'Local test only — remote owners cannot connect' },
    advertised_blocked: { color: 'text-red-400', label: 'Advertised but blocked — SFTP bind is loopback, owners cannot reach SFTP' },
    unsafe_public: { color: 'text-red-400', label: 'Unsafe — SFTP bound to 0.0.0.0 (all interfaces)' },
    unknown: { color: 'text-slate-400', label: 'Unknown reachability' },
  };
  const { color, label } = map[cls];
  return <span className={`text-xs ${color}`}>{label}</span>;
}

export function TailscalePanel({ token, env, onEnvChange, appMode }: Props) {
  const [tsDetail, setTsDetail] = useState<TailscaleDetail | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<{ hostAddress: string; sftpPort: number } | null>(null);
  const [sftpStatus, setSftpStatus] = useState<{ bindAddress: string; running: boolean; publicExposureWarning: boolean } | null>(null);
  const [localEnv, setLocalEnv] = useState<Partial<HostEnvValues>>(env);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => {
    setLocalEnv(env);
  }, [env]);

  const refreshAll = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      const [ts, freshEnv] = await Promise.all([
        getTailscaleDetail(),
        hostAgentReadEnv(),
      ]);
      setTsDetail(ts);
      setLocalEnv(freshEnv);
      onEnvChange(freshEnv);

      if (token) {
        try {
          const [ov, sf] = await Promise.all([
            getOverlayStatus(token),
            getSftpStatus(token),
          ]);
          setOverlayStatus({ hostAddress: ov.hostAddress, sftpPort: ov.sftpPort });
          setSftpStatus({ bindAddress: sf.bindAddress, running: sf.running, publicExposureWarning: sf.publicExposureWarning });
        } catch { /* stack may not be running */ }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [token, onEnvChange]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  function applyTailscaleIp(ip: string) {
    // MagicDNS must NOT go to NASBB_SFTP_BIND — it must be a bindable IP
    if (ip.includes('.ts.net') || ip.includes(' ')) {
      setError('NASBB_SFTP_BIND requires an IP address, not a hostname. Use a Tailscale IPv4 address.');
      return;
    }
    const updated = { ...localEnv, NASBB_SFTP_BIND: ip };
    setLocalEnv(updated);
    setRestartNeeded(true);
  }

  function applyAdvertisedAddress(address: string) {
    const updated = { ...localEnv, TAILSCALE_ADDRESS: address };
    setLocalEnv(updated);
    setRestartNeeded(true);
  }

  async function saveAndRestart() {
    setBusy('save');
    setError(null);
    try {
      await hostAgentWriteEnv(localEnv as HostEnvValues);
      onEnvChange(localEnv);
      if (restartNeeded) {
        // `up -d --remove-orphans` recreates containers with fresh .env values.
        // Wait longer than a simple restart since containers are being recreated.
        await hostAgentComposeRestart();
        await new Promise(r => setTimeout(r, 4500));
      }
      setRestartNeeded(false);
      await refreshAll();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doRefreshOverlay() {
    if (!token) return;
    setBusy('refresh-overlay');
    setError(null);
    try {
      const ov = await refreshOverlayStatus(token);
      setOverlayStatus({ hostAddress: ov.hostAddress, sftpPort: ov.sftpPort });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const reachClass = classifyReachability(localEnv);
  const ipv4s = tsDetail?.self_ips.filter(ip => !ip.includes(':')) ?? [];
  const magicDns = tsDetail?.self_dns_name ?? null;

  return (
    <div className="space-y-3">
      {/* Tailscale status */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-300">Tailscale Status</div>
        {appMode === 'browser' && (
          <div className="text-xs text-amber-400">Tailscale detection not available in browser mode.</div>
        )}
        {tsDetail ? (
          <div className="space-y-1">
            <div className={`text-xs flex items-center gap-1.5 ${tsDetail.connected ? 'text-emerald-400' : 'text-slate-400'}`}>
              {tsDetail.connected ? <Wifi size={11} /> : <WifiOff size={11} />}
              {tsDetail.connected ? `Connected — ${tsDetail.tailnet_name ?? 'unknown tailnet'}` : tsDetail.status_message}
            </div>
            {ipv4s.length > 0 && (
              <div className="space-y-1 mt-1">
                {ipv4s.map(ip => (
                  <div key={ip} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-mono">{ip}</span>
                    <button
                      onClick={() => applyTailscaleIp(ip)}
                      className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                    >
                      Use for SFTP bind
                    </button>
                    <button
                      onClick={() => applyAdvertisedAddress(ip)}
                      className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                    >
                      Advertise this IP
                    </button>
                  </div>
                ))}
                <div className="text-xs text-slate-500">
                  For cross-account access: use the 100.x IPv4 (not MagicDNS) — peer's Tailscale client may not resolve your DNS name.
                </div>
              </div>
            )}
            {magicDns && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-slate-400 font-mono">{magicDns}</span>
                <button
                  onClick={() => applyAdvertisedAddress(magicDns)}
                  className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                >
                  Advertise MagicDNS
                </button>
              </div>
            )}
            {!tsDetail.connected && tsDetail.installed && (
              <div className="text-xs text-slate-500 mt-1">
                Tailscale is installed but not connected. Run <code className="text-slate-400">tailscale up</code> to authenticate.
              </div>
            )}
            {!tsDetail.installed && (
              <div className="text-xs text-slate-500 mt-1">
                Tailscale not found. Install Tailscale from tailscale.com.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500">Not checked yet.</div>
        )}
      </div>

      {/* Cross-account sharing instructions */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-1.5">
        <div className="text-xs font-medium text-slate-300">How to share with a peer on a different Tailscale account</div>
        <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
          <li>Open <span className="font-mono text-slate-300">login.tailscale.com → Machines → <em>this device</em> → Share</span></li>
          <li>Enter your peer's Tailscale email and send the invitation</li>
          <li>Your peer accepts — they can now reach your 100.x address</li>
          <li>Below, click <strong className="text-slate-300">Use for SFTP bind</strong> on your Tailscale IPv4 (100.x)</li>
          <li>Click <strong className="text-slate-300">Advertise this IP</strong> on the same IPv4</li>
          <li>Click <strong className="text-slate-300">Save &amp; Restart stack</strong></li>
          <li>Go to Allocations → generate an invite — it will include the 100.x SFTP address</li>
        </ol>
        <div className="text-xs text-slate-500 pt-0.5">
          MagicDNS hostnames are only resolvable within a single tailnet; always use the raw 100.x IP for cross-account invites.
        </div>
      </div>

      {/* Env editor */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-300">Network Configuration</div>
        <div className="space-y-2">
          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">
              NASBB_SFTP_BIND <span className="text-slate-600">(must be a local IP, not a hostname)</span>
            </div>
            <input
              type="text"
              value={localEnv.NASBB_SFTP_BIND ?? '127.0.0.1'}
              onChange={e => { setLocalEnv(v => ({ ...v, NASBB_SFTP_BIND: e.target.value })); setRestartNeeded(true); }}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono"
            />
          </label>
          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">
              TAILSCALE_ADDRESS <span className="text-slate-600">(advertised host in invites; use 100.x IP for shared-device owners)</span>
            </div>
            <input
              type="text"
              value={localEnv.TAILSCALE_ADDRESS ?? ''}
              onChange={e => { setLocalEnv(v => ({ ...v, TAILSCALE_ADDRESS: e.target.value })); setRestartNeeded(true); }}
              placeholder="e.g. 100.64.0.1"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono"
            />
          </label>
        </div>

        {/* Reachability classification */}
        <div className="mt-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700">
          <div className="text-xs text-slate-500 mb-0.5">Reachability</div>
          <ReachabilityBadge cls={reachClass} />
        </div>

        {/* Warnings */}
        {reachClass === 'advertised_blocked' && (
          <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300">
            TAILSCALE_ADDRESS is set but SFTP bind is 127.0.0.1 — owners cannot connect. Set NASBB_SFTP_BIND to your Tailscale IP.
          </div>
        )}
        {reachClass === 'unsafe_public' && (
          <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300 flex items-center gap-1.5">
            <Shield size={12} />
            SFTP is bound to 0.0.0.0 — may be exposed on public interfaces. Use a Tailscale IP instead.
          </div>
        )}
        {reachClass === 'local_test_only' && (
          <div className="px-2 py-1.5 rounded bg-amber-900/20 border border-amber-700/30 text-xs text-amber-300">
            SFTP is loopback-only. Fine for local testing — remote owners cannot connect until you set a Tailscale IP.
          </div>
        )}

        {/* Host-agent reported status */}
        {sftpStatus && (
          <div className="space-y-0.5 text-xs text-slate-400">
            <div>Agent SFTP bind: <span className="font-mono text-slate-300">{sftpStatus.bindAddress}</span></div>
            <div>SFTP running: {sftpStatus.running ? <span className="text-emerald-400">yes</span> : <span className="text-red-400">no</span>}</div>
            {sftpStatus.publicExposureWarning && (
              <div className="text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> Public exposure warning from agent</div>
            )}
          </div>
        )}
        {overlayStatus && (
          <div className="space-y-1.5">
            <div className="text-xs text-slate-400">
              Agent overlay address: <span className="font-mono text-slate-300">{overlayStatus.hostAddress || '(not set)'}</span>
              {token && (
                <button
                  onClick={doRefreshOverlay}
                  disabled={!!busy}
                  className="ml-2 text-xs text-sky-400 hover:text-sky-300 underline disabled:opacity-50"
                >
                  Refresh
                </button>
              )}
            </div>
            {/* Mismatch: .env has TAILSCALE_ADDRESS but the running agent doesn't know it.
                This happens when the container was started before the .env was updated.
                Fix: "Save & Restart" uses `docker compose up -d` which recreates containers. */}
            {localEnv.TAILSCALE_ADDRESS && !overlayStatus.hostAddress && (
              <div className="px-2 py-1.5 rounded bg-amber-900/30 border border-amber-700/40 text-xs text-amber-300 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                <span>
                  TAILSCALE_ADDRESS is set in .env but the running agent has an empty overlay address.
                  The container was started before this value was configured.
                  Click <strong>Save &amp; Restart</strong> to recreate the container with the current .env.
                </span>
              </div>
            )}
            {localEnv.TAILSCALE_ADDRESS && overlayStatus.hostAddress &&
              localEnv.TAILSCALE_ADDRESS !== overlayStatus.hostAddress && (
              <div className="px-2 py-1.5 rounded bg-amber-900/20 border border-amber-700/30 text-xs text-amber-300 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                <span>
                  Agent address (<span className="font-mono">{overlayStatus.hostAddress}</span>) differs from .env
                  (<span className="font-mono">{localEnv.TAILSCALE_ADDRESS}</span>).
                  Click <strong>Save &amp; Restart</strong> to apply.
                </span>
              </div>
            )}
          </div>
        )}

        {restartNeeded && (
          <div className="text-xs text-amber-400">Unsaved changes — save and restart to apply.</div>
        )}

        <div className="flex gap-2 mt-1">
          <button
            onClick={saveAndRestart}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : null}
            {restartNeeded ? 'Save & Restart stack' : 'Save env'}
          </button>
          <button
            onClick={refreshAll}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
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
