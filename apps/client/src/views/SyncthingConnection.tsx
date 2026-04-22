import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronRight, ExternalLink,
  FolderOpen, Info, Loader2, Lock, Plus, RefreshCw, Trash2,
  Users, Wifi, XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type {
  FolderPeerAssignment, PeerSyncMode, SyncFolderConfig,
  SyncPeer, SyncthingFolderStatus, SyncthingRunStatus,
} from '../lib/types';
import { syncthingStateLabel } from '../lib/mock-state';
import {
  type ApplySyncthingResult,
  applySyncthingSetup,
  ensureSyncthingRunning,
} from '../lib/tauri-bridge';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function isValidDeviceId(id: string): boolean {
  // Syncthing device IDs: 8 groups of 7 uppercase alphanumeric chars separated by hyphens
  return /^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/.test(id.trim().toUpperCase());
}

function StatusDot({ ok, pending }: { ok: boolean; pending?: boolean }) {
  if (pending) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />;
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />;
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Daemon', 'Folders', 'Peers', 'Assign', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

function StepIndicator({ current, maxReached }: { current: StepIndex; maxReached: StepIndex }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReached;
        return (
          <div key={label} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
              ${active ? 'bg-sky-600 text-white' : done ? 'bg-emerald-600/20 text-emerald-400' : reachable ? 'text-slate-400' : 'text-slate-600'}`}>
              {done
                ? <CheckCircle size={11} />
                : <span className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px] leading-none
                    border-current">{i + 1}</span>}
              {label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={12} className={i < current ? 'text-emerald-600' : 'text-slate-700'} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 0: Daemon ────────────────────────────────────────────────────────────

function DaemonStep({
  syncStatus, starting, startError, onRetry, onNext,
}: {
  syncStatus: SyncthingRunStatus | null;
  starting: boolean;
  startError: string | null;
  onRetry: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Syncthing Daemon</h2>
        <p className="text-xs text-slate-500 mt-0.5">The bundled Syncthing daemon must be running before you can configure peers and folders.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 font-medium">Status</span>
          <button
            onClick={onRetry}
            disabled={starting}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200"
          >
            {starting ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {starting ? 'Starting…' : syncStatus?.is_running ? 'Restart' : 'Retry'}
          </button>
        </div>

        {starting && (
          <div className="flex items-start gap-2.5 p-2.5 rounded border border-sky-500/20 bg-sky-500/5 text-xs text-sky-300/80">
            <Loader2 size={13} className="animate-spin flex-shrink-0 mt-0.5" />
            <div>
              <div>Starting bundled Syncthing daemon…</div>
              <div className="text-sky-400/60 mt-0.5">First run generates a device key and may take up to 30 s.</div>
            </div>
          </div>
        )}

        {startError && !starting && (
          <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
            <XCircle size={13} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Failed to start Syncthing</div>
              <pre className="whitespace-pre-wrap break-words text-red-300/80 mt-0.5">{startError}</pre>
            </div>
          </div>
        )}

        {syncStatus && !starting && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Binary</span>
              <div className="flex items-center gap-2">
                <StatusDot ok={syncStatus.binary_present} />
                <span className={`text-xs font-medium ${syncStatus.binary_present ? 'text-emerald-400' : 'text-red-400'}`}>
                  {syncStatus.binary_present ? (syncStatus.binary_version ?? 'Found') : 'Not found'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Daemon (port {syncStatus.api_port})</span>
              <div className="flex items-center gap-2">
                <StatusDot ok={syncStatus.is_running} />
                <span className={`text-xs font-medium ${syncStatus.is_running ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {syncStatus.is_running ? 'Running' : 'Not running'}
                </span>
              </div>
            </div>

            {syncStatus.is_running && (
              <div className="pt-1 space-y-2">
                <div className="flex items-start gap-2 p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-300/80">
                  <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>Daemon is running. Your device ID is visible in the web UI under <strong>Actions → Show ID</strong>. Share it with your peer out-of-band.</span>
                </div>
                <a
                  href={syncStatus.web_ui_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <ExternalLink size={12} />
                  Open Syncthing web UI — {syncStatus.web_ui_url}
                </a>
              </div>
            )}

            {!syncStatus.is_running && !startError && (
              <div className="flex items-start gap-2 p-2.5 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{syncStatus.setup_guidance}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!syncStatus?.is_running}
          className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          Next: Backup Folders
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Folders ───────────────────────────────────────────────────────────

function SyncStateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    in_sync: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    syncing: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    folder_configured: 'bg-sky-500/10 text-sky-300/70 border-sky-500/20',
    device_configured: 'bg-slate-700 text-slate-400 border-slate-600',
    stale: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    error: 'bg-red-500/15 text-red-400 border-red-500/30',
    not_configured: 'bg-slate-800 text-slate-500 border-slate-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${colors[state] ?? colors.not_configured}`}>
      {syncthingStateLabel(state)}
    </span>
  );
}

function FoldersStep({
  folders, sourceFolders, primaryFolderStatus, onChange, onNext, onBack,
}: {
  folders: SyncFolderConfig[];
  sourceFolders: string[];
  primaryFolderStatus: SyncthingFolderStatus;
  onChange: (folders: SyncFolderConfig[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const labelId = useId();

  const kopiaFolders = folders.filter(f => f.source === 'kopia');
  const manualFolders = folders.filter(f => f.source === 'manual');
  const selectedCount = folders.filter(f => f.selected).length;

  function toggle(id: string) {
    onChange(folders.map(f => f.folder_id === id ? { ...f, selected: !f.selected } : f));
  }

  function updateLabel(id: string, label: string) {
    onChange(folders.map(f => f.folder_id === id ? { ...f, label } : f));
  }

  function removeManual(id: string) {
    onChange(folders.filter(f => f.folder_id !== id));
  }

  function addManualFolder() {
    const path = newPath.trim();
    const label = newLabel.trim() || `Folder ${manualFolders.length + 1}`;
    if (!path) { setAddError('Enter a folder path.'); return; }
    if (sourceFolders.some(s => path === s || path.startsWith(s + '/') || s.startsWith(path + '/'))) {
      setAddError('This path overlaps with a source folder and cannot be synced directly.');
      return;
    }
    if (folders.some(f => f.path === path)) { setAddError('This path is already in the list.'); return; }
    setAddError(null);
    onChange([...folders, { folder_id: `manual-${uid()}`, label, path, source: 'manual', selected: true }]);
    setNewPath('');
    setNewLabel('');
  }

  // Derive a display sync state for a folder: match by path against the primary status.
  function folderState(f: SyncFolderConfig): string {
    // In the future, each folder will have its own live status. For now we use
    // the primary repo status only for the folder whose path matches the configured repo.
    if (f.source === 'kopia' && primaryFolderStatus.state !== 'not_configured') {
      return primaryFolderStatus.state;
    }
    return 'not_configured';
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Backup Folders</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select which folders to include in this Syncthing setup. Check the boxes next to the folders you want to sync.
        </p>
      </div>

      {/* ── Kopia-managed repositories ── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Kopia-managed repositories</div>

        {kopiaFolders.length === 0 && (
          <div className="text-center py-4 text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg">
            No Kopia repository configured yet.{' '}
            <span className="text-slate-500">Complete the Backup Plan setup first.</span>
          </div>
        )}

        {kopiaFolders.map(f => {
          const state = folderState(f);
          const lastSync = primaryFolderStatus.last_sync_at
            ? new Date(primaryFolderStatus.last_sync_at).toLocaleString()
            : null;
          const bytesPending = primaryFolderStatus.bytes_pending;

          return (
            <label
              key={f.folder_id}
              className={`flex items-start gap-3 p-3 bg-slate-900 border rounded-lg cursor-pointer transition-colors
                ${f.selected ? 'border-sky-600/50 bg-sky-950/20' : 'border-slate-800 hover:border-slate-700'}`}
            >
              <input
                type="checkbox"
                checked={f.selected}
                onChange={() => toggle(f.folder_id)}
                className="mt-0.5 accent-sky-500 w-3.5 h-3.5 flex-shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <FolderOpen size={13} className="text-sky-400 flex-shrink-0" />
                    <input
                      value={f.label}
                      onChange={e => updateLabel(f.folder_id, e.target.value)}
                      onClick={e => e.preventDefault()}
                      className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none focus:text-white w-36"
                    />
                  </div>
                  <SyncStateBadge state={state} />
                  <span className="text-xs text-emerald-500/60 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                    Kopia encrypted
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-500 truncate">{f.path}</div>
                {state !== 'not_configured' && (
                  <div className="flex gap-4 text-xs text-slate-500">
                    {lastSync && <span>Last sync: {lastSync}</span>}
                    {bytesPending !== null && (
                      <span>{bytesPending === 0 ? 'Up to date' : `${bytesPending} bytes pending`}</span>
                    )}
                    {primaryFolderStatus.peer_connected && (
                      <span className="text-emerald-400/70">Peer online</span>
                    )}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* ── Manually added folders ── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Manually added folders</div>

        {manualFolders.length > 0 && (
          <div className="space-y-2">
            {manualFolders.map(f => (
              <label
                key={f.folder_id}
                className={`flex items-start gap-3 p-3 bg-slate-900 border rounded-lg cursor-pointer transition-colors
                  ${f.selected ? 'border-amber-600/40 bg-amber-950/10' : 'border-slate-800 hover:border-slate-700'}`}
              >
                <input
                  type="checkbox"
                  checked={f.selected}
                  onChange={() => toggle(f.folder_id)}
                  className="mt-0.5 accent-amber-500 w-3.5 h-3.5 flex-shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <FolderOpen size={13} className="text-amber-400 flex-shrink-0" />
                      <input
                        value={f.label}
                        onChange={e => updateLabel(f.folder_id, e.target.value)}
                        onClick={e => e.preventDefault()}
                        className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none focus:text-white w-36"
                      />
                    </div>
                    <SyncStateBadge state={folderState(f)} />
                    <span className="text-xs text-amber-500/60 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                      Raw — not Kopia-managed
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-500 truncate">{f.path}</div>
                </div>
                <button
                  onClick={e => { e.preventDefault(); removeManual(f.folder_id); }}
                  className="text-slate-600 hover:text-red-400 transition-colors mt-0.5"
                >
                  <Trash2 size={13} />
                </button>
              </label>
            ))}
          </div>
        )}

        {/* Manually add form */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3">
          <div className="text-xs font-medium text-slate-300">Manually add a folder</div>

          <div className="flex items-start gap-2 p-2.5 rounded border border-amber-500/20 bg-amber-500/5">
            <Info size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              Folders added here are synced <strong>as-is</strong> — Syncthing will replicate whatever is in that path directly to your peer.
              They are <strong>not processed or encrypted by Kopia</strong>.
              If you want encrypted, versioned backups of a folder, add it via <strong>Backup Plan → Source Folders</strong> first — Kopia will write an encrypted repository that you then add here.
            </p>
          </div>

          {/* Source folder blocklist */}
          {sourceFolders.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/15 rounded p-2 space-y-1">
              <div className="text-xs text-red-400/80 font-medium">These source paths are blocked from being added:</div>
              {sourceFolders.map(f => (
                <div key={f} className="flex items-center gap-1.5 text-xs text-red-400/60">
                  <XCircle size={10} className="flex-shrink-0" />
                  <code>{f}</code>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={labelId} className="text-xs text-slate-500 mb-1 block">Label</label>
              <input
                id={labelId}
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Media Files"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Folder path</label>
              <input
                value={newPath}
                onChange={e => { setNewPath(e.target.value); setAddError(null); }}
                onKeyDown={e => e.key === 'Enter' && addManualFolder()}
                placeholder="/mnt/shared/media"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <button
            onClick={addManualFolder}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200 transition-colors"
          >
            <Plus size={11} /> Add Folder
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onBack} className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Back
        </button>
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="text-xs text-slate-500">{selectedCount} folder{selectedCount !== 1 ? 's' : ''} selected</span>
          )}
          <button
            onClick={onNext}
            disabled={selectedCount === 0}
            className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
          >
            Next: Add Peers
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Peers ─────────────────────────────────────────────────────────────

function PeersStep({
  peers, onChange, onNext, onBack,
}: {
  peers: SyncPeer[];
  onChange: (peers: SyncPeer[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [newDeviceId, setNewDeviceId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  function addPeer() {
    const name = newName.trim();
    const deviceId = newDeviceId.trim().toUpperCase();
    if (!name) { setAddError('Enter a friendly name for this peer.'); return; }
    if (!isValidDeviceId(deviceId)) {
      setAddError('Invalid device ID format. It should look like: XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX');
      return;
    }
    if (peers.some(p => p.device_id === deviceId)) { setAddError('This device ID is already added.'); return; }
    setAddError(null);
    onChange([...peers, { id: uid(), name, device_id: deviceId }]);
    setNewName('');
    setNewDeviceId('');
  }

  function removePeer(id: string) {
    onChange(peers.filter(p => p.id !== id));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Peers</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Add the Syncthing device IDs of peers you want to sync with.
          Exchange device IDs out-of-band — they are not secret.
        </p>
      </div>

      {/* Transport encryption notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Lock size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-300/80 space-y-1 leading-relaxed">
          <p><strong>Transport is always encrypted.</strong> Syncthing uses TLS for all peer-to-peer traffic — data in transit is protected regardless of mode.</p>
          <p>In the next step you can also choose <strong>Encrypted Folder</strong> mode, where the peer stores your data encrypted at rest and cannot read its contents — perfect for untrusted backup peers.</p>
        </div>
      </div>

      {/* Peer list */}
      {peers.length > 0 && (
        <div className="space-y-2">
          {peers.map(peer => (
            <div key={peer.id} className="flex items-center gap-2 p-2.5 bg-slate-900 border border-slate-800 rounded-lg">
              <Users size={13} className="text-sky-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-200">{peer.name}</div>
                <code className="text-xs text-slate-500 truncate block">{peer.device_id}</code>
              </div>
              <button onClick={() => removePeer(peer.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {peers.length === 0 && (
        <div className="text-center py-6 text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg">
          No peers added yet. Add at least one peer to proceed.
        </div>
      )}

      {/* Add peer form */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
        <div className="text-xs font-medium text-slate-400">Add a peer</div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Friendly name</label>
          <input
            value={newName}
            onChange={e => { setNewName(e.target.value); setAddError(null); }}
            placeholder="e.g. Alice's NAS"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Syncthing device ID</label>
          <input
            value={newDeviceId}
            onChange={e => { setNewDeviceId(e.target.value); setAddError(null); }}
            onKeyDown={e => e.key === 'Enter' && addPeer()}
            placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Your peer finds their device ID in Syncthing UI under Actions → Show ID.</p>
        </div>
        {addError && <p className="text-xs text-red-400">{addError}</p>}
        <button
          onClick={addPeer}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200 transition-colors"
        >
          <Plus size={11} /> Add Peer
        </button>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={peers.length === 0}
          className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          Next: Assign Folders
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Assign ────────────────────────────────────────────────────────────

const MODE_CYCLE: PeerSyncMode[] = ['off', 'sync', 'encrypted'];

function ModeChip({ mode, onClick }: { mode: PeerSyncMode; onClick: () => void }) {
  const styles: Record<PeerSyncMode, string> = {
    off: 'bg-slate-800 text-slate-500 border-slate-700',
    sync: 'bg-sky-600/20 text-sky-300 border-sky-600/40',
    encrypted: 'bg-violet-600/20 text-violet-300 border-violet-600/40',
  };
  const labels: Record<PeerSyncMode, string> = {
    off: 'Off',
    sync: 'Sync',
    encrypted: 'Encrypted',
  };
  return (
    <button
      onClick={onClick}
      title={
        mode === 'off' ? 'Not shared with this peer'
        : mode === 'sync' ? 'Full bidirectional sync — use for trusted peers / own devices'
        : 'Encrypted folder — peer stores data without being able to read it (Syncthing encrypted folder feature)'
      }
      className={`text-xs px-2 py-0.5 rounded border font-medium transition-colors ${styles[mode]}`}
    >
      {labels[mode]}
    </button>
  );
}

function AssignStep({
  folders, peers, assignments, onChange, onNext, onBack,
}: {
  folders: SyncFolderConfig[];
  peers: SyncPeer[];
  assignments: FolderPeerAssignment[];
  onChange: (assignments: FolderPeerAssignment[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  function getAssignment(folderId: string, peerId: string): FolderPeerAssignment {
    return assignments.find(a => a.folder_id === folderId && a.peer_id === peerId)
      ?? { folder_id: folderId, peer_id: peerId, mode: 'off', encryption_password: '' };
  }

  function cycleMode(folderId: string, peerId: string) {
    const current = getAssignment(folderId, peerId);
    const nextMode = MODE_CYCLE[(MODE_CYCLE.indexOf(current.mode) + 1) % MODE_CYCLE.length];
    const updated = assignments.filter(a => !(a.folder_id === folderId && a.peer_id === peerId));
    if (nextMode !== 'off') {
      updated.push({ ...current, mode: nextMode });
    }
    onChange(updated);
  }

  function setPassword(folderId: string, peerId: string, password: string) {
    onChange(assignments.map(a =>
      a.folder_id === folderId && a.peer_id === peerId
        ? { ...a, encryption_password: password }
        : a,
    ));
  }

  const hasAnyActive = assignments.some(a => a.mode !== 'off');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Assign Folders to Peers</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Click a mode chip to cycle: <strong>Off → Sync → Encrypted</strong>.
          Use <strong>Encrypted</strong> for untrusted backup peers — they store your data without being able to read it.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-1.5"><ModeChip mode="off" onClick={() => {}} /> Not shared</div>
        <div className="flex items-center gap-1.5"><ModeChip mode="sync" onClick={() => {}} /> Full bidirectional sync</div>
        <div className="flex items-center gap-1.5"><ModeChip mode="encrypted" onClick={() => {}} /> Encrypted at rest on peer</div>
      </div>

      {/* Assignment matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-3 text-slate-500 font-medium w-1/3">Folder</th>
              {peers.map(peer => (
                <th key={peer.id} className="text-center p-3 text-slate-400 font-medium">
                  <div>{peer.name}</div>
                  <div className="text-slate-600 font-normal truncate max-w-24">{peer.device_id.slice(0, 14)}…</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {folders.map((folder, i) => (
              <>
                <tr key={folder.folder_id} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/30'}>
                  <td className="p-3">
                    <div className="font-medium text-slate-200">{folder.label}</div>
                    <div className="text-slate-600 font-mono truncate">{folder.path}</div>
                  </td>
                  {peers.map(peer => {
                    const assignment = getAssignment(folder.folder_id, peer.id);
                    return (
                      <td key={peer.id} className="p-3 text-center">
                        <ModeChip mode={assignment.mode} onClick={() => cycleMode(folder.folder_id, peer.id)} />
                      </td>
                    );
                  })}
                </tr>
                {/* Password row — shown when any cell in this folder row is 'encrypted' */}
                {peers.some(peer => getAssignment(folder.folder_id, peer.id).mode === 'encrypted') && (
                  <tr key={`${folder.folder_id}-enc`} className={`border-t border-slate-800/50 ${i % 2 === 0 ? 'bg-violet-900/5' : 'bg-violet-900/8'}`}>
                    <td className="px-3 pb-2 pt-1">
                      <div className="flex items-center gap-1 text-violet-400/70">
                        <Lock size={10} />
                        <span>Encryption passwords for {folder.label}</span>
                      </div>
                    </td>
                    {peers.map(peer => {
                      const assignment = getAssignment(folder.folder_id, peer.id);
                      if (assignment.mode !== 'encrypted') return <td key={peer.id} />;
                      return (
                        <td key={peer.id} className="px-3 pb-2 pt-1 text-center">
                          <input
                            type="password"
                            value={assignment.encryption_password}
                            onChange={e => setPassword(folder.folder_id, peer.id, e.target.value)}
                            placeholder="Encryption password"
                            className="w-full bg-slate-800 border border-violet-700/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
                          />
                          <p className="text-xs text-slate-600 mt-0.5">Peer-specific. Never logged.</p>
                        </td>
                      );
                    })}
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {!hasAnyActive && (
        <div className="flex items-center gap-2 p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span>No folders are assigned to any peer yet. Click a mode chip above to start.</span>
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!hasAnyActive}
          className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          Review Configuration
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Review ────────────────────────────────────────────────────────────

function ReviewStep({
  folders, peers, assignments, syncStatus, onBack,
}: {
  folders: SyncFolderConfig[];
  peers: SyncPeer[];
  assignments: FolderPeerAssignment[];
  syncStatus: SyncthingRunStatus | null;
  onBack: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplySyncthingResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const activeAssignments = assignments.filter(a => a.mode !== 'off');

  const encryptedPasswordsOk = activeAssignments
    .filter(a => a.mode === 'encrypted')
    .every(a => a.encryption_password.length >= 8);

  const warnings: string[] = [];
  if (!encryptedPasswordsOk)
    warnings.push('Some encrypted-mode assignments have no password or a password shorter than 8 characters.');
  if (!syncStatus?.is_running)
    warnings.push('Syncthing daemon is not running — go back to step 1 and start it first.');

  async function handleApply() {
    setApplying(true);
    setApplyError(null);
    setResult(null);
    try {
      const r = await applySyncthingSetup(
        peers.map(p => ({ id: p.id, name: p.name, device_id: p.device_id })),
        activeAssignments.map(a => {
          const folder = folders.find(f => f.folder_id === a.folder_id);
          return {
            folder_id: a.folder_id,
            folder_path: folder?.path ?? '',
            label: folder?.label ?? a.folder_id,
            peer_id: a.peer_id,
            mode: a.mode,
            encryption_password: a.encryption_password,
          };
        }),
      );
      setResult(r);
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Review & Apply</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Review the configuration below, then apply it to the running Syncthing daemon.
        </p>
      </div>

      {warnings.map(w => (
        <div key={w} className="flex items-start gap-2 p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{w}</span>
        </div>
      ))}

      {/* Devices to register */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Devices to register ({peers.length})
        </div>
        <div className="divide-y divide-slate-800">
          {peers.map(peer => (
            <div key={peer.id} className="px-3 py-2.5 flex items-center gap-2">
              <Users size={12} className="text-sky-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-slate-200">{peer.name}</span>
                <code className="text-xs text-slate-500 ml-2 truncate">{peer.device_id}</code>
              </div>
              {result && result.devices_added.includes(peer.name) && (
                <CheckCircle size={12} className="text-emerald-400 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Folder assignments */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Folder assignments ({activeAssignments.length})
        </div>
        <div className="divide-y divide-slate-800">
          {folders.map(folder => {
            const folderAssignments = activeAssignments.filter(a => a.folder_id === folder.folder_id);
            if (folderAssignments.length === 0) return null;
            const folderDone = result?.folders_configured.includes(folder.label);
            return (
              <div key={folder.folder_id} className="px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                  <FolderOpen size={12} className="text-sky-400" />
                  {folder.label}
                  {folderDone && <CheckCircle size={11} className="text-emerald-400 ml-1" />}
                </div>
                {folderAssignments.map(a => {
                  const peer = peers.find(p => p.id === a.peer_id);
                  return (
                    <div key={a.peer_id} className="flex items-center gap-2 pl-4 text-xs text-slate-400">
                      <span className="text-slate-600">→</span>
                      <span>{peer?.name}</span>
                      {a.mode === 'encrypted'
                        ? <span className="flex items-center gap-1 text-violet-400"><Lock size={10} /> Encrypted</span>
                        : <span className="text-sky-400">Sync</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* API key note */}
      <p className="text-xs text-slate-600 flex items-center gap-1.5">
        <Lock size={10} />
        API key read from Syncthing's config.xml at call time — never logged or returned.
      </p>

      {/* Apply result */}
      {result && (
        <div className={`p-3 rounded border text-xs space-y-1 ${
          result.errors.length > 0
            ? 'border-amber-500/20 bg-amber-500/5'
            : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          {result.errors.length === 0 ? (
            <div className="flex items-center gap-2 text-emerald-300 font-medium">
              <CheckCircle size={13} />
              Configuration applied to Syncthing.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-300 font-medium">
              <AlertTriangle size={13} />
              Applied with warnings — check errors below.
            </div>
          )}
          {result.devices_added.length > 0 && (
            <p className="text-slate-400">Devices added: {result.devices_added.join(', ')}</p>
          )}
          {result.folders_configured.length > 0 && (
            <p className="text-slate-400">Folders configured: {result.folders_configured.join(', ')}</p>
          )}
          {result.errors.map((e, i) => (
            <p key={i} className="text-amber-400">{e}</p>
          ))}
          {result.errors.length === 0 && (
            <p className="text-slate-500 mt-1">
              Syncthing will now attempt to connect to your peers. Open the web UI to monitor connection status.
            </p>
          )}
        </div>
      )}

      {applyError && (
        <div className="flex items-start gap-2 p-3 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
          <XCircle size={13} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium mb-0.5">Failed to apply configuration</div>
            <span>{applyError}</span>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          disabled={applying}
          className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors"
        >
          Back
        </button>
        <div className="flex gap-2">
          {syncStatus?.is_running && (
            <a
              href={syncStatus.web_ui_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
            >
              <ExternalLink size={11} />
              Open web UI
            </a>
          )}
          <button
            onClick={handleApply}
            disabled={applying || warnings.length > 0}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
          >
            {applying
              ? <><Loader2 size={11} className="animate-spin" /> Applying…</>
              : result
                ? 'Apply Again'
                : 'Apply Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SyncthingConnection() {
  const { wizardConfigs, setupState } = useApp();

  const [step, setStep] = useState<StepIndex>(0);
  const [maxReached, setMaxReached] = useState<StepIndex>(0);

  // Step 0 state
  const [syncStatus, setSyncStatus] = useState<SyncthingRunStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Step 1 state — seed all Kopia repos from every wizard run, using the user-chosen label
  const [folders, setFolders] = useState<SyncFolderConfig[]>(() =>
    wizardConfigs
      .filter(c => c.repository_path)
      .map((c, i) => ({
        folder_id: `nasbb-repo-${i}`,
        label: c.label || `Backup job ${i + 1}`,
        path: c.repository_path,
        source: 'kopia' as const,
        selected: true,
      })),
  );

  // Step 2 state
  const [peers, setPeers] = useState<SyncPeer[]>([]);

  // Step 3 state
  const [assignments, setAssignments] = useState<FolderPeerAssignment[]>([]);

  // Collect all source folders across every wizard config for safety validation
  const sourceFolders = [...new Set(wizardConfigs.flatMap(c => c.source_folders))];

  async function ensureRunning() {
    setStarting(true);
    setStartError(null);
    try {
      const s = await ensureSyncthingRunning();
      setSyncStatus(s);
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => { void ensureRunning(); }, []);

  function goTo(s: StepIndex) {
    setStep(s);
    if (s > maxReached) setMaxReached(s);
  }

  function next() { goTo((step + 1) as StepIndex); }
  function back() { setStep((step - 1) as StepIndex); }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Wifi size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Syncthing Setup</h1>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <AlertTriangle size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80 leading-relaxed">
          <strong>Syncthing is transport only.</strong> It replicates the encrypted Kopia repository — never live source folders.
          Peers receive encrypted data blobs and cannot read your files.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} maxReached={maxReached} />

      {/* Step content */}
      {step === 0 && (
        <DaemonStep
          syncStatus={syncStatus}
          starting={starting}
          startError={startError}
          onRetry={ensureRunning}
          onNext={next}
        />
      )}
      {step === 1 && (
        <FoldersStep
          folders={folders}
          sourceFolders={sourceFolders}
          primaryFolderStatus={setupState.syncthing_folder}
          onChange={setFolders}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 2 && (
        <PeersStep
          peers={peers}
          onChange={setPeers}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 3 && (
        <AssignStep
          folders={folders.filter(f => f.selected)}
          peers={peers}
          assignments={assignments}
          onChange={setAssignments}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 4 && (
        <ReviewStep
          folders={folders.filter(f => f.selected)}
          peers={peers}
          assignments={assignments}
          syncStatus={syncStatus}
          onBack={back}
        />
      )}
    </div>
  );
}
