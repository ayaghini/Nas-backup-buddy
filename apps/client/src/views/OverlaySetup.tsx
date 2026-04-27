import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  Copy, ExternalLink, Info, Loader2, Network,
  Play, RefreshCw, Shield, XCircle, Zap,
} from 'lucide-react';
import {
  getTailscaleDetail,
  probeRemoteTarget,
  tailscaleConnect,
  tailscalePingPeer,
} from '../lib/tauri-bridge';
import { loadPersistedConfig, savePersistedConfig } from '../lib/persistence';
import type {
  RemoteTargetProbeResponse,
  TailscaleConnectResult,
  TailscaleDetail,
  TailscalePingResult,
} from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
    >
      <Copy size={10} />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ── Tailscale Status Card ─────────────────────────────────────────────────────

function TailscaleStatusCard({
  detail,
  loading,
  onRefresh,
  onConnect,
  connecting,
  connectResult,
}: {
  detail: TailscaleDetail | null;
  loading: boolean;
  onRefresh: () => void;
  onConnect: () => void;
  connecting: boolean;
  connectResult: TailscaleConnectResult | null;
}) {
  // (no two-step confirmation needed — safety copy is shown inline)

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" />
          Detecting Tailscale…
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const state = detail.setup_state;

  const headerIcon = state === 'ready'
    ? <CheckCircle size={13} className="text-emerald-400" />
    : state === 'not_installed'
    ? <XCircle size={13} className="text-red-400" />
    : <AlertTriangle size={13} className="text-amber-400" />;

  const headerBorder = state === 'ready' ? 'border-emerald-500/20' : 'border-amber-500/20';

  const stateLabel: Record<string, string> = {
    ready: 'Tailscale Ready',
    installed_needs_login: 'Tailscale — Login Required',
    installed_cli_not_accessible: 'Tailscale — CLI Not Accessible',
    not_installed: 'Tailscale Not Installed',
    error: 'Tailscale — Detection Error',
  };

  return (
    <div className={`bg-slate-900 border rounded-lg overflow-hidden ${headerBorder}`}>
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          {headerIcon}
          <span className={`text-xs font-semibold ${state === 'ready' ? 'text-emerald-400' : state === 'not_installed' ? 'text-red-400' : 'text-amber-400'}`}>
            {stateLabel[state] ?? state}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="p-4 space-y-3 text-xs">
        <p className="text-slate-400 leading-relaxed">{detail.status_message}</p>

        {/* Ready: full details */}
        {state === 'ready' && (
          <div className="space-y-2">
            {detail.cli_path && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">CLI path</span>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <code className="text-sky-300/80 font-mono truncate">{detail.cli_path}</code>
                  {detail.on_path && (
                    <span className="text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded flex-shrink-0">on PATH</span>
                  )}
                </div>
              </div>
            )}
            {detail.self_dns_name && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">MagicDNS name</span>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <code className="text-sky-300/90 font-mono truncate">{detail.self_dns_name}</code>
                  <span className="text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded text-xs flex-shrink-0">recommended</span>
                  <CopyButton text={detail.self_dns_name} />
                </div>
              </div>
            )}
            {detail.self_ips.map(ip => (
              <div key={ip} className="flex items-center justify-between gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">Local IP</span>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <code className="text-sky-300/70 font-mono truncate">{ip}</code>
                  <CopyButton text={ip} />
                </div>
              </div>
            ))}
            {detail.tailnet_name && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">Tailnet</span>
                <code className="text-slate-400 font-mono">{detail.tailnet_name}</code>
              </div>
            )}
            {detail.peer_count > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">Peers visible</span>
                <span className="text-slate-400">{detail.peer_count}</span>
              </div>
            )}
            {detail.last_checked_at && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28 flex-shrink-0">Last checked</span>
                <span className="text-slate-600">{detail.last_checked_at}</span>
              </div>
            )}
          </div>
        )}

        {/* NeedsLogin: show connect button + manual guidance */}
        {state === 'installed_needs_login' && (
          <div className="space-y-3">
            <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5 space-y-2">
              <p className="text-amber-300/80 leading-relaxed">
                Tailscale is installed but not signed in.
                Open the Tailscale app and sign in via the menu bar or tray icon.
                The app never runs authentication commands automatically.
              </p>
              {detail.auth_url && (
                <a href={detail.auth_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300">
                  Open auth URL <ExternalLink size={10} />
                </a>
              )}
            </div>

            {/* One-click connect with inline safety copy */}
            <div className="space-y-2">
              <p className="text-slate-500 leading-relaxed">
                Runs <code className="text-slate-400">tailscale up</code> with no flags.
                No auth keys, routes, ACLs, SSH, serve/funnel, or other network settings are changed.
                If login is needed, an auth URL or instructions will be shown.
              </p>
              <button
                onClick={onConnect}
                disabled={connecting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-700 hover:bg-sky-600 disabled:opacity-40 rounded text-white transition-colors"
              >
                {connecting ? <Loader2 size={11} className="animate-spin" /> : <Play size={10} />}
                {connecting ? 'Connecting…' : 'Run tailscale up (connect)'}
              </button>
            </div>

            {/* Connect result */}
            {connectResult && (
              <div className={`p-2.5 rounded border text-xs ${
                connectResult.success
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                  : 'border-amber-500/20 bg-amber-500/5 text-amber-300/80'
              }`}>
                <p>{connectResult.message}</p>
                {connectResult.auth_url && (
                  <a href={connectResult.auth_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 mt-1">
                    Open auth URL <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* CLI not accessible */}
        {state === 'installed_cli_not_accessible' && (
          <div className="space-y-2 p-3 rounded border border-amber-500/20 bg-amber-500/5">
            <p className="text-amber-300/80 leading-relaxed">
              Tailscale is installed but the CLI is not accessible. Add it to PATH so the app can read status automatically.
            </p>
            <div className="space-y-1.5">
              {[
                { p: 'macOS',     n: 'Menu bar → Preferences → "Install CLI". Or symlink: sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale' },
                { p: 'Windows',   n: 'System Settings → Environment Variables → Path → add the Tailscale install directory.' },
                { p: 'Linux/Pi',  n: 'The installer usually handles this. Restart your terminal, or run: sudo systemctl restart tailscaled' },
              ].map(({ p, n }) => (
                <div key={p} className="flex gap-2 text-slate-500">
                  <span className="text-slate-400 flex-shrink-0 w-20">{p}</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Peer Address / Reachability Card ──────────────────────────────────────────

function PeerAddressCard({
  detail,
  localAddress,
  setLocalAddress,
  peerAddress,
  setPeerAddress,
  sftpPort,
  setSftpPort,
  probing,
  probeResult,
  onProbe,
  pinging,
  pingResult,
  onPing,
  savedHost,
  savedPeer,
  onSaveForHostSetup,
  onSaveForPeerStorage,
}: {
  detail: TailscaleDetail | null;
  localAddress: string;
  setLocalAddress: (v: string) => void;
  peerAddress: string;
  setPeerAddress: (v: string) => void;
  sftpPort: string;
  setSftpPort: (v: string) => void;
  probing: boolean;
  probeResult: RemoteTargetProbeResponse | null;
  onProbe: () => void;
  pinging: boolean;
  pingResult: TailscalePingResult | null;
  onPing: () => void;
  savedHost: boolean;
  savedPeer: boolean;
  onSaveForHostSetup: () => void;
  onSaveForPeerStorage: () => void;
}) {
  const canPing = !!detail?.cli_accessible && !!peerAddress.trim();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Network size={14} className="text-sky-400" />
        <h3 className="text-xs font-semibold text-slate-300">Peer Address / Reachability</h3>
      </div>

      <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-xs text-sky-300/70 leading-relaxed">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>
          Ask your peer for their Storage Host address from the Owner Connection Bundle.
          For Tailscale, this is usually their MagicDNS name or 100.x address after device sharing/invite is accepted.
          Overlay/TCP probe confirms reachability only; SFTP auth is verified later.
        </span>
      </div>

      {/* Local address */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-300">Your overlay address (local)</label>
        <input
          type="text"
          value={localAddress}
          onChange={e => setLocalAddress(e.target.value)}
          placeholder="my-mac.tailnet.ts.net or 100.x.x.x"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
        <p className="text-xs text-slate-600">Auto-filled from Tailscale MagicDNS or IPv4. Give this to your peer via the Owner Connection Bundle.</p>
      </div>

      {/* Peer address */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-300">Peer's overlay address</label>
        <input
          type="text"
          value={peerAddress}
          onChange={e => setPeerAddress(e.target.value)}
          placeholder="peer.tailnet.ts.net or 100.x.x.x"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* SFTP port */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-300">SFTP port</label>
        <input
          type="text"
          value={sftpPort}
          onChange={e => setSftpPort(e.target.value)}
          placeholder="22"
          className="w-32 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* Probe + ping buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onProbe}
          disabled={probing || !peerAddress.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-700 hover:bg-sky-600 disabled:opacity-40 rounded text-white transition-colors"
        >
          {probing ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />}
          {probing ? 'Probing…' : 'Probe Overlay / TCP'}
        </button>

        {/* Fix 2: Explicit Tailscale ping button */}
        <button
          onClick={onPing}
          disabled={pinging || !canPing}
          title={!detail?.cli_accessible ? 'Tailscale CLI must be accessible to run ping' : ''}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-200 transition-colors"
        >
          {pinging ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          {pinging ? 'Pinging…' : 'Tailscale ping peer'}
        </button>
      </div>

      {/* TCP probe note */}
      <p className="text-xs text-slate-600">
        <strong className="text-slate-500">Probe Overlay/TCP</strong> tests TCP port reachability only — it is not an overlay-level ping.{' '}
        <strong className="text-slate-500">Tailscale ping peer</strong> uses the Tailscale CLI to verify the overlay path directly (requires CLI accessible).
      </p>

      {/* TCP probe result */}
      {probeResult && (
        <div className={`flex items-start gap-2 p-2.5 rounded border text-xs ${
          probeResult.status === 'tcp_port_reachable'
            ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
            : 'border-amber-500/20 bg-amber-500/5 text-amber-300/80'
        }`}>
          {probeResult.status === 'tcp_port_reachable'
            ? <CheckCircle size={11} className="flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />}
          <span>
            {probeResult.message}
            {probeResult.latency_ms != null && <span className="text-slate-500 ml-2">{probeResult.latency_ms} ms</span>}
            <span className="text-slate-600 ml-2">(TCP only — SSH auth not verified)</span>
          </span>
        </div>
      )}

      {/* Fix 2: Tailscale ping result */}
      {pingResult && (
        <div className={`flex items-start gap-2 p-2.5 rounded border text-xs ${
          pingResult.reachable
            ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
            : 'border-amber-500/20 bg-amber-500/5 text-amber-300/80'
        }`}>
          {pingResult.reachable
            ? <CheckCircle size={11} className="flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />}
          <span>
            {pingResult.message}
            {pingResult.latency_ms != null && <span className="text-slate-500 ml-2">{pingResult.latency_ms} ms</span>}
            {pingResult.via && <span className="text-slate-500 ml-2">via {pingResult.via}</span>}
          </span>
        </div>
      )}

      {/* Fix 1: Separate handoff buttons with field-specific save + specific confirmation */}
      <div className="border-t border-slate-800 pt-3 space-y-2">
        <p className="text-xs text-slate-600">Save overlay addresses for use in other views:</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSaveForHostSetup}
            disabled={!localAddress.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-200 transition-colors"
          >
            {savedHost ? <CheckCircle size={10} className="text-emerald-400" /> : null}
            {savedHost ? 'Saved local address for Host Setup' : 'Use local address in Host Setup'}
          </button>
          <button
            onClick={onSaveForPeerStorage}
            disabled={!peerAddress.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-200 transition-colors"
          >
            {savedPeer ? <CheckCircle size={10} className="text-emerald-400" /> : null}
            {savedPeer ? 'Saved peer address for Peer Storage' : 'Use peer address in Peer Storage'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tailscale Setup Help Card ─────────────────────────────────────────────────

// Fix 4: accepts initiallyOpen to auto-expand when Tailscale is not ready
function TailscaleSetupCard({
  initiallyOpen = false,
  onDismiss,
}: {
  initiallyOpen?: boolean;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-sky-400" />
          <span className="text-xs font-semibold text-slate-300">How to set up Tailscale</span>
        </div>
        <div className="flex items-center gap-2">
          {onDismiss && (
            <span
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors px-1"
              onClick={e => { e.stopPropagation(); onDismiss(); }}
            >
              Dismiss
            </span>
          )}
          {open ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800 p-4 space-y-4 text-xs">
          <div className="flex items-start gap-2 p-2.5 rounded border border-sky-500/15 bg-sky-500/5 text-sky-300/80">
            <Info size={11} className="flex-shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Each user installs Tailscale on their own device and signs in to their own account.</strong>{' '}
              A shared account is <strong>not</strong> required.
              The Storage Host shares their device or sends a tailnet invite so the Data Owner can reach them.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="font-semibold text-slate-300 mb-1.5">1. Install Tailscale</div>
              <div className="space-y-1.5 text-slate-500 leading-relaxed">
                {[
                  { p: 'macOS',        n: 'Download the GUI app. Use Preferences → "Install CLI" to get the CLI on PATH. Advanced: symlink /Applications/Tailscale.app/Contents/MacOS/Tailscale.' },
                  { p: 'Windows',      n: 'Install Tailscale for Windows. Reopen your terminal after install. If tailscale is not found, add the install directory to your PATH environment variable.' },
                  { p: 'Linux',        n: 'Run the official installer script — it adds tailscale to PATH automatically.' },
                  { p: 'Raspberry Pi', n: 'Use the Linux installer — ARM packages are included by the official script.' },
                ].map(({ p, n }) => (
                  <div key={p} className="flex gap-2">
                    <span className="text-slate-400 flex-shrink-0 w-24">{p}</span>
                    <span>{n}</span>
                  </div>
                ))}
              </div>
              <a href="https://tailscale.com/download" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 mt-2">
                tailscale.com/download <ExternalLink size={10} />
              </a>
            </div>

            <div>
              <div className="font-semibold text-slate-300 mb-1">2. Sign in</div>
              <p className="text-slate-500 leading-relaxed">
                macOS/Windows: click the menu bar or tray icon → "Log in" — browser opens.
                Linux: run <code className="text-slate-400">tailscale up</code> in a terminal yourself.
                The app never runs authentication commands automatically.
              </p>
            </div>

            <div>
              <div className="font-semibold text-slate-300 mb-1">3. Share device / invite peer</div>
              <p className="text-slate-500 leading-relaxed">
                The Storage Host shares their device or sends a tailnet invite to the Data Owner.
                Both devices do not need to be on the same Tailscale account.
              </p>
              <a href="https://tailscale.com/kb/1084/sharing" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 mt-2">
                Device sharing guide <ExternalLink size={10} />
              </a>
            </div>

            <div>
              <div className="font-semibold text-slate-300 mb-1">4. Exchange addresses</div>
              <p className="text-slate-500 leading-relaxed">
                Once both devices can see each other, each side has a stable MagicDNS name
                (e.g. my-mac.tailnet.ts.net) or a 100.x address.
                Share the Storage Host address via the Owner Connection Bundle.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Advanced Providers (placeholders) ─────────────────────────────────────────

function AdvancedPlaceholders() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-500">Advanced / Future Providers</span>
        {open ? <ChevronDown size={12} className="text-slate-600" /> : <ChevronRight size={12} className="text-slate-600" />}
      </button>
      {open && (
        <div className="border-t border-slate-800 p-4 space-y-3 text-xs text-slate-600">
          {[
            { name: 'Headscale', desc: 'Planned — self-hosted advanced path. Both peers must join the same Headscale control server.' },
            { name: 'WireGuard', desc: 'Planned — manual advanced path. Requires keypair exchange and matching tunnel configs on both machines.' },
            { name: 'Custom address', desc: 'Advanced — not recommended for public SFTP. Use only on a secured private network you control.' },
          ].map(({ name, desc }) => (
            <div key={name} className="p-3 rounded border border-slate-800 space-y-1">
              <div className="text-slate-500 font-semibold">{name}</div>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function OverlaySetup() {
  const [detail, setDetail] = useState<TailscaleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [localAddress, setLocalAddress] = useState('');
  const [peerAddress, setPeerAddress] = useState('');
  const [sftpPort, setSftpPort] = useState('22');

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<RemoteTargetProbeResponse | null>(null);

  // Fix 2: Tailscale ping state
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<TailscalePingResult | null>(null);

  // Fix 3: On-demand connect state
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<TailscaleConnectResult | null>(null);

  // Fix 1: Separate saved confirmations per button
  const [savedHost, setSavedHost] = useState(false);
  const [savedPeer, setSavedPeer] = useState(false);

  const [showSetupHelp, setShowSetupHelp] = useState(false);

  // Fix 5: Track persisted values so detection doesn't overwrite them
  const persistedLocal = useRef('');
  const persistedPeer = useRef('');

  async function runDetection() {
    setLoading(true);
    try {
      const d = await getTailscaleDetail();
      setDetail(d);
      // Only fill local address if no persisted or user value exists
      if (!persistedLocal.current && !localAddress) {
        const addr = d.self_dns_name ?? d.self_ips[0];
        if (addr) setLocalAddress(addr);
      }
      // Show setup help automatically if not ready (Fix 4 feeds into this)
      if (d.setup_state !== 'ready') {
        setShowSetupHelp(true);
      }
    } finally {
      setLoading(false);
    }
  }

  // Fix 5: Sequential init — persisted config FIRST, then detection fills gaps
  useEffect(() => {
    async function init() {
      // Step 1: restore persisted overlay metadata
      try {
        const saved = await loadPersistedConfig();
        const om = saved.overlayMeta;
        if (om) {
          if (om.local_address) { setLocalAddress(om.local_address); persistedLocal.current = om.local_address; }
          if (om.peer_address)  { setPeerAddress(om.peer_address);   persistedPeer.current  = om.peer_address; }
          if (om.sftp_port)     setSftpPort(String(om.sftp_port));
        }
      } catch { /* non-fatal */ }

      // Step 2: detection — only fills fields still empty after persisted restore
      await runDetection();
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleProbe() {
    if (!peerAddress.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await probeRemoteTarget(peerAddress.trim(), parseInt(sftpPort, 10) || 22);
      setProbeResult(result);
    } catch (e: unknown) {
      setProbeResult({ status: 'unreachable', method: 'tcp_connect', latency_ms: null, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setProbing(false);
    }
  }

  // Fix 2: Explicit Tailscale ping
  async function handlePing() {
    if (!peerAddress.trim()) return;
    setPinging(true);
    setPingResult(null);
    try {
      const result = await tailscalePingPeer(peerAddress.trim());
      setPingResult(result);
    } finally {
      setPinging(false);
    }
  }

  // Fix 3: On-demand connect (confirmation handled in TailscaleStatusCard)
  async function handleConnect() {
    setConnecting(true);
    setConnectResult(null);
    try {
      const result = await tailscaleConnect();
      setConnectResult(result);
      // Refresh status after connect attempt
      await runDetection();
    } finally {
      setConnecting(false);
    }
  }

  // Fix 1: Save only local_address, merging against any existing peer_address
  async function handleSaveForHostSetup() {
    try {
      const existing = await loadPersistedConfig().catch(() => ({}));
      const prev = (existing as { overlayMeta?: { peer_address?: string; sftp_port?: number } }).overlayMeta;
      await savePersistedConfig({
        overlayMeta: {
          provider: 'tailscale',
          local_address: localAddress,
          peer_address: prev?.peer_address ?? persistedPeer.current,
          sftp_port: parseInt(sftpPort, 10) || 22,
          last_status: detail?.status_message ?? '',
          last_checked_at: detail?.last_checked_at ?? '',
        },
      });
      persistedLocal.current = localAddress;
      setSavedHost(true);
      setTimeout(() => setSavedHost(false), 3000);
    } catch { /* browser mode — silently ignore */ }
  }

  // Fix 1: Save only peer_address, merging against any existing local_address
  async function handleSaveForPeerStorage() {
    try {
      const existing = await loadPersistedConfig().catch(() => ({}));
      const prev = (existing as { overlayMeta?: { local_address?: string; sftp_port?: number } }).overlayMeta;
      await savePersistedConfig({
        overlayMeta: {
          provider: 'tailscale',
          local_address: prev?.local_address ?? persistedLocal.current,
          peer_address: peerAddress,
          sftp_port: parseInt(sftpPort, 10) || 22,
          last_status: detail?.status_message ?? '',
          last_checked_at: detail?.last_checked_at ?? '',
        },
      });
      persistedPeer.current = peerAddress;
      setSavedPeer(true);
      setTimeout(() => setSavedPeer(false), 3000);
    } catch { /* browser mode — silently ignore */ }
  }

  // Fix 4: setup help initiallyOpen when Tailscale is not ready
  const setupHelpInitiallyOpen = showSetupHelp && detail?.setup_state !== 'ready';

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Network size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Overlay Network</h1>
        <span className="text-xs text-slate-500 ml-1">Private connectivity for backup peers</span>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5 text-xs text-sky-300/80">
        <Shield size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p>
            <strong>Both machines need a private reachable path to each other.</strong>{' '}
            Kopia connects over SFTP — the overlay network provides the private, stable address.
            Public inbound ports are not recommended.
          </p>
          <p>
            The two machines are typically owned by <strong>separate users</strong>.
            A shared Tailscale account is not required — use device sharing or an invite.
          </p>
        </div>
      </div>

      {/* 1. Tailscale Status Card */}
      <TailscaleStatusCard
        detail={detail}
        loading={loading}
        onRefresh={runDetection}
        onConnect={handleConnect}
        connecting={connecting}
        connectResult={connectResult}
      />

      {/* Setup help: auto-open when required (Fix 4), dismissible only when ready */}
      {showSetupHelp && (
        <TailscaleSetupCard
          initiallyOpen={setupHelpInitiallyOpen}
          onDismiss={detail?.setup_state === 'ready' ? () => setShowSetupHelp(false) : undefined}
        />
      )}

      {/* Show help toggle when already ready */}
      {detail && detail.setup_state === 'ready' && !showSetupHelp && (
        <button
          onClick={() => setShowSetupHelp(true)}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          Help me set up Tailscale on another machine →
        </button>
      )}

      {/* 2. Peer Address / Reachability Card */}
      <PeerAddressCard
        detail={detail}
        localAddress={localAddress}
        setLocalAddress={setLocalAddress}
        peerAddress={peerAddress}
        setPeerAddress={v => { setPeerAddress(v); setProbeResult(null); setPingResult(null); }}
        sftpPort={sftpPort}
        setSftpPort={setSftpPort}
        probing={probing}
        probeResult={probeResult}
        onProbe={handleProbe}
        pinging={pinging}
        pingResult={pingResult}
        onPing={handlePing}
        savedHost={savedHost}
        savedPeer={savedPeer}
        onSaveForHostSetup={handleSaveForHostSetup}
        onSaveForPeerStorage={handleSaveForPeerStorage}
      />

      {/* 3. Advanced Providers (collapsed placeholders) */}
      <AdvancedPlaceholders />
    </div>
  );
}
