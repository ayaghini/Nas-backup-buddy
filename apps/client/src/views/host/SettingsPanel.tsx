import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Save } from 'lucide-react';
import type { HostAgentConfig } from '../../lib/host-agent-types';
import { getConfig, patchConfig, errorMessage } from '../../lib/host-agent-api';

interface Props {
  token: string;
  apiUrl: string;
}

export function SettingsPanel({ token, apiUrl }: Props) {
  const [config, setConfig] = useState<HostAgentConfig | null>(null);
  const [draft, setDraft] = useState<Partial<HostAgentConfig>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const c = await getConfig(token, apiUrl);
      setConfig(c);
      setDraft({
        hostLabel: c.hostLabel,
        advertisedCapacityBytes: c.advertisedCapacityBytes,
        defaultQuotaBytes: c.defaultQuotaBytes,
        defaultWarningThresholdPercent: c.defaultWarningThresholdPercent,
        defaultCriticalThresholdPercent: c.defaultCriticalThresholdPercent,
        bandwidthCapBytesPerSecond: c.bandwidthCapBytesPerSecond,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token, apiUrl]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  async function save() {
    if (!token) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await patchConfig(token, draft, apiUrl);
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="text-xs text-slate-500 p-3">
        Connect to the host agent first (Host Stack tab).
      </div>
    );
  }

  function gbVal(bytes: number | undefined) {
    if (bytes === undefined || bytes === 0) return '';
    return String(Math.round(bytes / (1024 ** 3)));
  }

  function parseGb(s: string): number {
    const n = parseFloat(s);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n * 1024 ** 3);
  }

  return (
    <div className="space-y-3">
      {!config ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 p-3">
          <Loader2 size={12} className="animate-spin" /> Loading config…
        </div>
      ) : (
        <div className="bg-slate-900 rounded border border-slate-800 p-3 space-y-3">
          <div className="text-xs font-medium text-slate-300">Host Settings</div>

          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">Host label</div>
            <input
              type="text"
              value={draft.hostLabel ?? ''}
              onChange={e => setDraft(v => ({ ...v, hostLabel: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">Advertised capacity (GB)</div>
            <input
              type="number"
              min="0"
              value={gbVal(draft.advertisedCapacityBytes)}
              onChange={e => setDraft(v => ({ ...v, advertisedCapacityBytes: parseGb(e.target.value) }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">Default quota per allocation (GB)</div>
            <input
              type="number"
              min="0"
              value={gbVal(draft.defaultQuotaBytes)}
              onChange={e => setDraft(v => ({ ...v, defaultQuotaBytes: parseGb(e.target.value) }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs text-slate-400 mb-0.5">Warning threshold %</div>
              <input
                type="number"
                min="1" max="99"
                value={draft.defaultWarningThresholdPercent ?? ''}
                onChange={e => setDraft(v => ({ ...v, defaultWarningThresholdPercent: parseInt(e.target.value) || 0 }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              />
            </label>
            <label className="block">
              <div className="text-xs text-slate-400 mb-0.5">Critical threshold %</div>
              <input
                type="number"
                min="1" max="99"
                value={draft.defaultCriticalThresholdPercent ?? ''}
                onChange={e => setDraft(v => ({ ...v, defaultCriticalThresholdPercent: parseInt(e.target.value) || 0 }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              />
            </label>
          </div>

          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">
              Advisory bandwidth cap (MB/s, 0 = no cap)
              <span className="text-slate-600 ml-1">— not enforced in v1</span>
            </div>
            <input
              type="number"
              min="0"
              value={draft.bandwidthCapBytesPerSecond ? String(Math.round(draft.bandwidthCapBytesPerSecond / (1024 * 1024))) : '0'}
              onChange={e => setDraft(v => ({ ...v, bandwidthCapBytesPerSecond: (parseInt(e.target.value) || 0) * 1024 * 1024 }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save settings
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle size={11} /> Saved
              </span>
            )}
          </div>
        </div>
      )}

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
