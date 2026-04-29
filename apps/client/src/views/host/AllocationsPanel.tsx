import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type {
  HostAgentAllocation,
  HostAgentInviteBundle,
  OwnerAccessResponse,
  CreateAllocationRequest,
  ReachabilityClass,
} from '../../lib/host-agent-types';
import { formatBytes, classifyReachability } from '../../lib/host-agent-types';
import type { HostEnvValues } from '../../lib/host-agent-types';
import {
  createAllocation,
  generateInvite,
  importOwnerResponse,
  listAllocations,
  resumeAllocation,
  retireAllocation,
  suspendAllocation,
  validateOwnerResponseShape,
  errorMessage,
} from '../../lib/host-agent-api';

interface Props {
  token: string;
  apiUrl: string;
  env: Partial<HostEnvValues>;
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-slate-700 text-slate-300',
    PENDING_KEY: 'bg-amber-800/60 text-amber-200',
    READY: 'bg-emerald-800/60 text-emerald-200',
    SUSPENDED: 'bg-orange-800/60 text-orange-200',
    EXPIRED: 'bg-red-800/60 text-red-200',
    RETIRING: 'bg-slate-600 text-slate-300',
    RETIRED: 'bg-slate-800 text-slate-500',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[state] ?? 'bg-slate-700 text-slate-300'}`}>
      {state}
    </span>
  );
}

function QuotaBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    ok: 'text-emerald-400',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };
  return <span className={`text-xs ${map[state] ?? 'text-slate-400'}`}>{state}</span>;
}

function AllocationRow({
  alloc,
  token,
  apiUrl,
  reachClass,
  onRefresh,
}: {
  alloc: HostAgentAllocation;
  token: string;
  apiUrl: string;
  reachClass: ReachabilityClass;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<HostAgentInviteBundle | null>(null);
  const [responseText, setResponseText] = useState('');
  const [confirmLocalTest, setConfirmLocalTest] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function doGenerateInvite() {
    if (reachClass === 'local_test_only' && !confirmLocalTest) {
      setConfirmLocalTest(true);
      return;
    }
    if (reachClass === 'advertised_blocked' || reachClass === 'unsafe_public') {
      setError(`Cannot generate invite in ${reachClass} state. Fix SFTP/Tailscale settings first.`);
      return;
    }
    setConfirmLocalTest(false);
    setBusy('invite');
    setError(null);
    try {
      const inv = await generateInvite(token, alloc.allocId, apiUrl);
      setInvite(inv);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doImportResponse() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText.trim());
    } catch {
      setError('Invalid JSON — paste the Owner Access Response JSON.');
      return;
    }
    if (!validateOwnerResponseShape(parsed)) {
      setError('JSON does not match Owner Access Response schema (kind, matchId, allocId, ownerPublicKey, requestedSftpUsername required).');
      return;
    }
    setBusy('import');
    setError(null);
    try {
      await importOwnerResponse(token, alloc.allocId, parsed as OwnerAccessResponse, apiUrl);
      setResponseText('');
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doSuspend() {
    setBusy('suspend'); setError(null);
    try { await suspendAllocation(token, alloc.allocId, apiUrl); onRefresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function doResume() {
    setBusy('resume'); setError(null);
    try { await resumeAllocation(token, alloc.allocId, apiUrl); onRefresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function doRetire() {
    if (!confirmRetire) { setConfirmRetire(true); return; }
    setBusy('retire'); setError(null);
    try { await retireAllocation(token, alloc.allocId, 7, apiUrl); onRefresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); setConfirmRetire(false); }
  }

  function copyInvite() {
    if (!invite) return;
    void navigator.clipboard.writeText(JSON.stringify(invite, null, 2));
  }

  function downloadInvite() {
    if (!invite) return;
    const blob = new Blob([JSON.stringify(invite, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nasbb-invite-${alloc.allocId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setResponseText(String(ev.target?.result ?? ''));
    reader.readAsText(file);
  }

  const usedPct = alloc.quotaBytes > 0
    ? Math.round((alloc.usedBytes / alloc.quotaBytes) * 100)
    : 0;
  const inviteExpired = alloc.inviteExpiresAt && new Date(alloc.inviteExpiresAt) < new Date();

  return (
    <div className="bg-slate-900 rounded border border-slate-800">
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/40 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex-1 text-xs text-slate-200 font-medium truncate">{alloc.connectionName || alloc.allocId}</span>
        <StateBadge state={alloc.state} />
        {alloc.quotaEnforcedSuspend && (
          <span className="text-xs text-red-400">quota-suspended</span>
        )}
        {open ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-800 px-3 py-3 space-y-3">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
            <div>Match ID: <span className="font-mono text-slate-300">{alloc.matchId}</span></div>
            <div>Username: <span className="font-mono text-slate-300">{alloc.username}</span></div>
            <div>Quota: <span className="text-slate-300">{formatBytes(alloc.quotaBytes)}</span></div>
            <div>Used: <span className="text-slate-300">{formatBytes(alloc.usedBytes)} ({usedPct}%)</span></div>
            <div>Quota state: <QuotaBadge state={alloc.quotaState} /></div>
            <div>SFTP access: {alloc.sftpAccessActive ? <span className="text-emerald-400">active</span> : <span className="text-slate-500">inactive</span>}</div>
            {alloc.accessWindowEnabled && (
              <div className="col-span-2 text-amber-400">
                Access window configured ({alloc.accessWindowStart}–{alloc.accessWindowEnd}) — not yet enforced in v1
              </div>
            )}
            {inviteExpired && alloc.inviteExpiresAt && (
              <div className="col-span-2 text-red-400">
                Invite expired {new Date(alloc.inviteExpiresAt).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Actions row */}
          <div className="flex flex-wrap gap-2">
            {/* Invite */}
            {(alloc.state === 'DRAFT' || alloc.state === 'EXPIRED') && (
              <>
                {confirmLocalTest && (
                  <div className="w-full px-2 py-1.5 rounded bg-amber-900/30 border border-amber-700/40 text-xs text-amber-300">
                    This is a local-test invite. The owner cannot connect from a remote machine. Continue?
                    <button
                      className="ml-2 underline text-amber-200 hover:text-white"
                      onClick={() => { setConfirmLocalTest(false); void doGenerateInvite(); }}
                    >Yes, generate test invite</button>
                    <button className="ml-2 text-slate-400 hover:text-slate-200" onClick={() => setConfirmLocalTest(false)}>Cancel</button>
                  </div>
                )}
                <button
                  onClick={doGenerateInvite}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700 text-xs text-sky-100 disabled:opacity-50"
                >
                  {busy === 'invite' ? <Loader2 size={11} className="animate-spin" /> : null}
                  Generate invite
                </button>
              </>
            )}

            {/* Copy / download invite */}
            {invite && (
              <div className="w-full space-y-2">
                <div className="text-xs text-slate-400">Host Invite Bundle generated:</div>
                <div className="flex gap-2">
                  <button onClick={copyInvite} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200">
                    <ClipboardCopy size={11} /> Copy JSON
                  </button>
                  <button onClick={downloadInvite} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200">
                    <Download size={11} /> Download
                  </button>
                </div>
                <pre className="text-xs text-slate-400 font-mono bg-slate-800/60 rounded p-2 max-h-32 overflow-auto">
                  {JSON.stringify({ ...invite, hostKey: { ...invite.hostKey } }, null, 2)}
                </pre>
              </div>
            )}

            {/* Import owner response */}
            {alloc.state === 'PENDING_KEY' && (
              <div className="w-full space-y-2">
                <div className="text-xs text-slate-400">Import Owner Access Response:</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200"
                  >
                    <Upload size={11} /> Load file
                  </button>
                  <input type="file" accept=".json" ref={fileRef} className="hidden" onChange={handleFileImport} />
                </div>
                <textarea
                  value={responseText}
                  onChange={e => setResponseText(e.target.value)}
                  placeholder="Paste Owner Access Response JSON here…"
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono h-24 resize-y"
                />
                <button
                  onClick={doImportResponse}
                  disabled={!responseText.trim() || !!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-xs text-emerald-100 disabled:opacity-50"
                >
                  {busy === 'import' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  Import response
                </button>
              </div>
            )}

            {/* Lifecycle */}
            {alloc.state === 'READY' && (
              <button
                onClick={doSuspend}
                disabled={!!busy}
                className="px-2.5 py-1.5 rounded bg-orange-700/50 hover:bg-orange-700/70 text-xs text-orange-200 disabled:opacity-50"
              >
                {busy === 'suspend' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                Suspend access
              </button>
            )}
            {alloc.state === 'SUSPENDED' && (
              <button
                onClick={doResume}
                disabled={!!busy}
                className="px-2.5 py-1.5 rounded bg-emerald-700/50 hover:bg-emerald-700/70 text-xs text-emerald-200 disabled:opacity-50"
              >
                {busy === 'resume' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                Resume access
              </button>
            )}
            {alloc.state !== 'RETIRING' && alloc.state !== 'RETIRED' && (
              <>
                {confirmRetire && (
                  <span className="text-xs text-red-400">
                    Confirm retire (7 day grace)?{' '}
                    <button className="underline" onClick={doRetire}>Confirm</button>
                    {' '}<button className="text-slate-400" onClick={() => setConfirmRetire(false)}>Cancel</button>
                  </span>
                )}
                {!confirmRetire && (
                  <button
                    onClick={doRetire}
                    disabled={!!busy}
                    className="px-2.5 py-1.5 rounded bg-slate-700/60 hover:bg-red-800/50 text-xs text-slate-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {busy === 'retire' ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                    Retire
                  </button>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300 flex items-start gap-1.5">
              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
              {error}
              <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => setError(null)}>×</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AllocationsPanel({ token, apiUrl, env }: Props) {
  const [allocs, setAllocs] = useState<HostAgentAllocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<CreateAllocationRequest>>({
    connectionName: '',
    bandwidthCapBytesPerSecond: 0,
    accessWindowEnabled: false,
    accessWindowStart: '',
    accessWindowEnd: '',
  });
  const [quotaGb, setQuotaGb] = useState('10');

  const reachClass = classifyReachability(env);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const a = await listAllocations(token, apiUrl);
      setAllocs(a);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  async function doCreate() {
    const qb = parseFloat(quotaGb);
    if (!form.connectionName?.trim()) { setError('Connection name is required.'); return; }
    if (isNaN(qb) || qb <= 0) { setError('Quota must be > 0 GB.'); return; }
    setBusy(true);
    setError(null);
    try {
      await createAllocation(token, {
        connectionName: form.connectionName.trim(),
        quotaBytes: Math.round(qb * 1024 ** 3),
        bandwidthCapBytesPerSecond: form.bandwidthCapBytesPerSecond ?? 0,
        accessWindowEnabled: false,
        accessWindowStart: '',
        accessWindowEnd: '',
      }, apiUrl);
      setCreating(false);
      setForm({ connectionName: '', bandwidthCapBytesPerSecond: 0, accessWindowEnabled: false, accessWindowStart: '', accessWindowEnd: '' });
      setQuotaGb('10');
      await load();
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

  return (
    <div className="space-y-3">
      {/* Reachability warning before invite */}
      {(reachClass === 'advertised_blocked' || reachClass === 'unsafe_public') && (
        <div className="px-3 py-2 rounded bg-red-900/30 border border-red-700/40 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle size={12} />
          Network configuration issue ({reachClass}). Fix SFTP/Tailscale settings before generating invites for remote owners.
        </div>
      )}
      {reachClass === 'local_test_only' && (
        <div className="px-3 py-2 rounded bg-amber-900/20 border border-amber-700/30 text-xs text-amber-300">
          Local test mode — invites will include a warning that remote owners cannot connect.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-300">
          Allocations {allocs.length > 0 && <span className="text-slate-500">({allocs.length})</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 disabled:opacity-50"
          >
            <RefreshCw size={10} /> Refresh
          </button>
          <button
            onClick={() => setCreating(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-700/60 hover:bg-sky-700 text-xs text-sky-100"
          >
            <Plus size={10} /> New allocation
          </button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-slate-900 rounded border border-slate-700 p-3 space-y-2">
          <div className="text-xs font-medium text-slate-300">Create Allocation</div>
          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">Connection name</div>
            <input
              type="text"
              value={form.connectionName ?? ''}
              onChange={e => setForm(v => ({ ...v, connectionName: e.target.value }))}
              placeholder="e.g. Alice offsite backup"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>
          <label className="block">
            <div className="text-xs text-slate-400 mb-0.5">Quota (GB)</div>
            <input
              type="number"
              min="1"
              value={quotaGb}
              onChange={e => setQuotaGb(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
            />
          </label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={doCreate}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : null}
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300"
            >
              Cancel
            </button>
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

      {busy && allocs.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 p-3">
          <Loader2 size={12} className="animate-spin" /> Loading allocations…
        </div>
      ) : allocs.length === 0 ? (
        <div className="text-xs text-slate-500 p-3">No allocations yet. Create one above.</div>
      ) : (
        <div className="space-y-2">
          {allocs.map(a => (
            <AllocationRow
              key={a.allocId}
              alloc={a}
              token={token}
              apiUrl={apiUrl}
              reachClass={reachClass}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
