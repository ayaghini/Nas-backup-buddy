import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  ExternalLink,
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
  tailscaleFunnelStatus,
  tailscaleFunnelEnable,
  tailscaleFunnelDisable,
} from '../../lib/tauri-bridge';
import type { TailscaleDetail, FunnelStatus } from '../../lib/types';
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
  const [funnelStatus, setFunnelStatus] = useState<FunnelStatus | null>(null);
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
      const [ts, freshEnv, funnel] = await Promise.all([
        getTailscaleDetail(),
        hostAgentReadEnv(),
        tailscaleFunnelStatus(),
      ]);
      setTsDetail(ts);
      setFunnelStatus(funnel);
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

  async function doEnableFunnel() {
    const localPort = parseInt(localEnv.NASBB_SFTP_PORT ?? '2222', 10) || 2222;
    setBusy('funnel-enable');
    setError(null);
    try {
      const result = await tailscaleFunnelEnable(localPort);
      if (result.success) {
        // Auto-configure env: public port 443, advertised address = MagicDNS hostname
        const updates: Partial<HostEnvValues> = { NASBB_SFTP_PUBLIC_PORT: '443' };
        if (result.public_hostname) updates.TAILSCALE_ADDRESS = result.public_hostname;
        setLocalEnv(v => ({ ...v, ...updates }));
        setRestartNeeded(true);
      }
      const fs = await tailscaleFunnelStatus();
      setFunnelStatus(fs);
      if (!result.success) setError(result.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doDisableFunnel() {
    setBusy('funnel-disable');
    setError(null);
    try {
      const result = await tailscaleFunnelDisable();
      if (result.success) {
        // Remove the public port override so invites revert to the internal SFTP port
        setLocalEnv(v => { const n = { ...v }; delete n.NASBB_SFTP_PUBLIC_PORT; return n; });
        setRestartNeeded(true);
      }
      const fs = await tailscaleFunnelStatus();
      setFunnelStatus(fs);
      if (!result.success) setError(result.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

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
                  For cross-account Tailscale sharing, advertise the shared 100.x IP; MagicDNS may not resolve for the owner.
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

      {/* Tailscale Funnel */}
      <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-slate-300">Tailscale Funnel</div>
          <div className="text-xs text-slate-500">Cross-account internet access</div>
        </div>
        <div className="text-xs text-slate-400">
          Funnel makes your SFTP server publicly reachable from the internet on port 443,
          so owners on a different Tailscale account can connect without device sharing.
        </div>
        {appMode === 'browser' && (
          <div className="text-xs text-amber-400">Funnel control not available in browser mode.</div>
        )}
        {funnelStatus && appMode === 'tauri' && (
          <div className="space-y-2">
            {funnelStatus.needs_activation && (
              <div className="px-2 py-2 rounded bg-amber-900/30 border border-amber-700/40 text-xs text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={11} /> Funnel not activated for this tailnet
                </div>
                <div>Visit your Tailscale admin console to enable Funnel, then try again.</div>
                {funnelStatus.activation_url && (
                  <a
                    href={funnelStatus.activation_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sky-400 hover:text-sky-300 underline"
                  >
                    <ExternalLink size={10} /> Activate Funnel
                  </a>
                )}
              </div>
            )}
            {funnelStatus.enabled ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <Wifi size={11} /> Funnel active — port 443 → localhost:{funnelStatus.local_port ?? '?'}
                </div>
                {funnelStatus.public_hostname && (
                  <div className="text-xs text-slate-400">
                    Public host: <span className="font-mono text-slate-300">{funnelStatus.public_hostname}:443</span>
                    <span className="text-slate-500 ml-1">(embed in invites)</span>
                  </div>
                )}
                <button
                  onClick={doDisableFunnel}
                  disabled={!!busy}
                  className="px-3 py-1.5 rounded bg-red-800/60 hover:bg-red-700/60 text-xs text-red-200 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busy === 'funnel-disable' ? <Loader2 size={11} className="animate-spin" /> : null}
                  Disable Funnel
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-xs text-slate-500">{funnelStatus.message}</div>
                {!funnelStatus.needs_activation && (
                  <button
                    onClick={doEnableFunnel}
                    disabled={!!busy || !tsDetail?.connected}
                    className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50 flex items-center gap-1.5"
                    title={!tsDetail?.connected ? 'Connect Tailscale first' : undefined}
                  >
                    {busy === 'funnel-enable' ? <Loader2 size={11} className="animate-spin" /> : null}
                    Enable Funnel (TCP 443)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">
              NASBB_SFTP_PUBLIC_PORT <span className="text-slate-600">(port in invite bundles; leave blank to use SFTP port; set to 443 when Funnel is active)</span>
            </div>
            <input
              type="text"
              value={localEnv.NASBB_SFTP_PUBLIC_PORT ?? ''}
              onChange={e => { setLocalEnv(v => ({ ...v, NASBB_SFTP_PUBLIC_PORT: e.target.value })); setRestartNeeded(true); }}
              placeholder="443 (when Funnel active), blank = same as SFTP port"
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
