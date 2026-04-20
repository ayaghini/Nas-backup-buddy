import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Terminal, Wifi, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { SyncthingApiPlanSummary } from '../lib/types';
import { planSyncthingFolder } from '../lib/tauri-bridge';
import { syncthingStateLabel } from '../lib/mock-state';

export function SyncthingConnection() {
  const { setupState, wizardConfig } = useApp();
  const sync = setupState.syncthing_folder;

  const [peerDeviceId, setPeerDeviceId] = useState('');
  const [folderPath, setFolderPath] = useState('');

  // Use real source folders from wizard config; fall back to demo values when no config saved yet
  const sourceFolders = wizardConfig?.source_folders.length
    ? wizardConfig.source_folders
    : ['/home/user/documents', '/home/user/photos'];
  const [planResult, setPlanResult] = useState<SyncthingApiPlanSummary | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  // When wizard config is saved, auto-validate the configured repository path
  const defaultRepoPath = wizardConfig?.repository_path || '/home/user/.nasbb-repo';
  useEffect(() => {
    planSyncthingFolder('nasbb-repo', defaultRepoPath, sourceFolders)
      .then(r => { setPlanResult(r); setPlanError(null); })
      .catch(e => setPlanError(String(e)));
  // Run when wizard config changes (new repo path or source folders)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultRepoPath, sourceFolders.join('|')]);

  async function handlePlanFolder() {
    if (!folderPath.trim()) {
      setPlanError('Enter a folder path to validate.');
      return;
    }
    setPlanning(true);
    setPlanResult(null);
    setPlanError(null);
    try {
      const result = await planSyncthingFolder('nasbb-repo', folderPath.trim(), sourceFolders);
      setPlanResult(result);
    } catch (e: unknown) {
      setPlanError(String(e));
    } finally {
      setPlanning(false);
    }
  }

  const stateColor = (s: string) => {
    if (s === 'in_sync') return 'text-emerald-400';
    if (s === 'error' || s === 'stale') return 'text-red-400';
    if (s === 'not_configured') return 'text-slate-500';
    return 'text-amber-400';
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Wifi size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Syncthing Connection</h1>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <AlertTriangle size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-300/80 space-y-1 leading-relaxed">
          <p><strong>Syncthing is transport only.</strong> It never syncs live source folders.</p>
          <p>Only the encrypted Kopia repository folder is shared with peers. Peers receive encrypted data blobs — they cannot read your files.</p>
        </div>
      </div>

      {/* Current state */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Sync Status</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Folder state</div>
            <div className={`font-medium ${stateColor(sync.state)}`}>{syncthingStateLabel(sync.state)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Peer connection</div>
            <div className={sync.peer_connected ? 'text-emerald-400' : 'text-red-400'}>
              {sync.peer_connected ? 'Online' : 'Offline'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Local device ID</div>
            <code className="text-xs text-slate-400">XXXX-LOCAL-DEVICE-ID</code>
            <div className="text-xs text-slate-600 mt-0.5">Detected at runtime — not a secret</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Peer device ID</div>
            <code className="text-xs text-slate-400">{sync.peer_device_id ?? '—'}</code>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Last sync</div>
            <div className="text-xs text-slate-300">
              {sync.last_sync_at ? new Date(sync.last_sync_at).toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Bytes pending</div>
            <div className="text-xs text-slate-300">{sync.bytes_pending === 0 ? 'None' : (sync.bytes_pending ?? '—')}</div>
          </div>
        </div>
      </div>

      {/* Peer device input */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Add Peer Device</h3>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Peer Syncthing device ID</label>
          <input
            type="text"
            value={peerDeviceId}
            onChange={e => setPeerDeviceId(e.target.value)}
            placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Syncthing device IDs are public. Exchange with your peer out-of-band.</p>
        </div>
        {peerDeviceId && (
          <div className="text-xs font-mono bg-slate-800 p-2.5 rounded border border-slate-700">
            <div className="text-slate-500 mb-0.5">Planned API call:</div>
            <code className="text-sky-300/80">
              POST /rest/config/devices  deviceID={peerDeviceId}  [X-API-Key: REDACTED]
            </code>
          </div>
        )}
      </div>

      {/* Folder path validator */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Repository Folder Safety Check</h3>
        <div className="bg-slate-800/50 border border-slate-700 rounded p-2.5 text-xs">
          <div className="text-slate-500 mb-1.5">
            {wizardConfig?.source_folders.length
              ? 'Source folders from setup (must not be synced directly):'
              : 'Demo source folders — complete Setup Wizard to use real paths:'}
          </div>
          {sourceFolders.map(f => (
            <div key={f} className="flex items-center gap-1.5 text-red-400/80">
              <XCircle size={11} className="flex-shrink-0" />
              <code>{f}</code>
              <span className="text-slate-600">(rejected)</span>
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Validate a proposed folder path</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              placeholder="/home/user/.nasbb-repo"
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
            <button
              onClick={handlePlanFolder}
              disabled={planning}
              className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
            >
              {planning ? 'Checking…' : 'Validate'}
            </button>
          </div>
        </div>

        {planError && (
          <div className="flex items-start gap-2 p-3 rounded border border-red-500/20 bg-red-500/5">
            <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{planError}</p>
          </div>
        )}

        {planResult && !planError && (
          <div className="flex items-start gap-2 p-3 rounded border border-emerald-500/20 bg-emerald-500/5">
            <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <div className="text-emerald-300 font-medium">Path accepted — safe to use as Syncthing folder</div>
              <p className="text-slate-500">Not a source folder or ancestor/descendant of a source folder.</p>
            </div>
          </div>
        )}
      </div>

      {/* Default API plan */}
      {planResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800 flex items-center gap-2">
            <Terminal size={14} className="text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Syncthing API Plan (redacted)</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="text-xs text-slate-500">Method: <span className="text-slate-300">{planResult.method}</span></div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Command</div>
              <code className="text-xs font-mono text-sky-300/80 break-all">{planResult.display_command}</code>
            </div>
            {planResult.body_summary && (
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Body summary</div>
                <code className="text-xs font-mono text-slate-400 break-all">{planResult.body_summary}</code>
              </div>
            )}
          </div>
          <div className="px-4 py-2 bg-slate-800/20 border-t border-slate-800">
            <p className="text-xs text-slate-600">API key supplied at runtime from OS keychain — never logged or serialized.</p>
          </div>
        </div>
      )}
    </div>
  );
}
