import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  createTestLab,
  prepareSyncthingTransport,
  probeTools,
  runRepositoryCheck,
  runRestoreDrill,
  runTestBackup,
} from '../lib/tauri-bridge';
import type {
  RealBackupResult,
  RealCheckResult,
  RealDrillResult,
  TestLabInfo,
  ToolProbeResult,
  TransportFolderInfo,
} from '../lib/types';
import { useApp } from '../context/AppContext';

type StepState = 'idle' | 'running' | 'done' | 'error';

interface StepResult<T> {
  state: StepState;
  data: T | null;
  error: string | null;
}

function initialStep<T>(): StepResult<T> {
  return { state: 'idle', data: null, error: null };
}

function StatusBadge({ state }: { state: StepState }) {
  if (state === 'running') return <Loader2 size={14} className="animate-spin text-sky-400" />;
  if (state === 'done') return <CheckCircle size={14} className="text-emerald-400" />;
  if (state === 'error') return <XCircle size={14} className="text-red-400" />;
  return <span className="w-3.5 h-3.5 rounded-full border border-slate-600 inline-block" />;
}

function HealthBadge({ level }: { level: string }) {
  if (level === 'ok') return (
    <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
      <ShieldCheck size={13} /> Pass
    </span>
  );
  if (level === 'critical') return (
    <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
      <ShieldAlert size={13} /> Critical
    </span>
  );
  return <span className="text-slate-400 text-xs">{level}</span>;
}

function ToolProbeCard({ probe }: { probe: ToolProbeResult }) {
  const isReady = probe.status === 'ready' || probe.status === 'present';
  return (
    <div className={`rounded border px-3 py-2 text-xs ${isReady ? 'border-emerald-800 bg-emerald-950/30' : 'border-red-800 bg-red-950/30'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-slate-200">{probe.name}</span>
        <span className={`font-mono ${isReady ? 'text-emerald-400' : 'text-red-400'}`}>
          {probe.status}
        </span>
      </div>
      {probe.version && (
        <div className="text-slate-400">
          v{probe.version.major}.{probe.version.minor}.{probe.version.patch}
          <span className="text-slate-600 ml-2">({probe.location})</span>
        </div>
      )}
      {probe.error_message && (
        <div className="text-red-400 mt-1">{probe.error_message}</div>
      )}
    </div>
  );
}

function CollapsibleLog({ label, lines }: { label: string; lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <div className="mt-1 bg-slate-900 rounded p-2 font-mono text-xs text-slate-300 space-y-0.5">
          {lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

export function TestLab() {
  const {
    addLogLine,
    realLab,
    updateRealLab,
    updateHealthFromCheckResult,
    updateHealthFromDrillResult,
    refreshRealHealth,
  } = useApp();

  const [probes, setProbes] = useState<StepResult<ToolProbeResult[]>>(initialStep());
  const [lab, setLab] = useState<StepResult<TestLabInfo>>(initialStep());
  const [backup, setBackup] = useState<StepResult<RealBackupResult>>(initialStep());
  const [transport, setTransport] = useState<StepResult<TransportFolderInfo>>(initialStep());
  const [check, setCheck] = useState<StepResult<RealCheckResult>>(initialStep());
  const [drill, setDrill] = useState<StepResult<RealDrillResult>>(initialStep());

  async function handleProbeTools() {
    setProbes({ state: 'running', data: null, error: null });
    try {
      const result = await probeTools();
      setProbes({ state: 'done', data: result, error: null });
      addLogLine('probe_tools completed', 'probe_tools completed');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setProbes({ state: 'error', data: null, error: msg });
    }
  }

  async function handleCreateLab() {
    setLab({ state: 'running', data: null, error: null });
    setBackup(initialStep());
    setTransport(initialStep());
    setCheck(initialStep());
    setDrill(initialStep());
    try {
      const info = await createTestLab();
      setLab({ state: 'done', data: info, error: null });
      updateRealLab({ lab: info, backup: null, transport: null, check: null, drill: null });
      addLogLine('test_lab_created', 'test_lab_created sample_files=' + info.sample_file_count);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLab({ state: 'error', data: null, error: msg });
    }
  }

  async function handleRunBackup() {
    setBackup({ state: 'running', data: null, error: null });
    try {
      const result = await runTestBackup();
      setBackup({ state: 'done', data: result, error: null });
      updateRealLab({ backup: result, check: null, drill: null });
      addLogLine(result.log_line, result.log_line);
      await refreshRealHealth();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBackup({ state: 'error', data: null, error: msg });
    }
  }

  async function handlePrepareTransport() {
    setTransport({ state: 'running', data: null, error: null });
    try {
      const result = await prepareSyncthingTransport();
      setTransport({ state: 'done', data: result, error: null });
      updateRealLab({ transport: result });
      addLogLine('syncthing_transport_prepared folder_id=' + result.folder_id, 'syncthing_transport_prepared');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTransport({ state: 'error', data: null, error: msg });
    }
  }

  async function handleRepoCheck() {
    setCheck({ state: 'running', data: null, error: null });
    try {
      const result = await runRepositoryCheck();
      setCheck({ state: 'done', data: result, error: null });
      updateRealLab({ check: result });
      addLogLine(result.log_line, result.log_line);
      updateHealthFromCheckResult(result);
      await refreshRealHealth();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCheck({ state: 'error', data: null, error: msg });
    }
  }

  async function handleRestoreDrill() {
    setDrill({ state: 'running', data: null, error: null });
    try {
      const result = await runRestoreDrill();
      setDrill({ state: 'done', data: result, error: null });
      updateRealLab({ drill: result });
      addLogLine(result.log_line, result.log_line);
      updateHealthFromDrillResult(result);
      await refreshRealHealth();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDrill({ state: 'error', data: null, error: msg });
    }
  }

  const labReady = lab.state === 'done' || !!realLab.lab;
  const backupDone = backup.state === 'done' || !!realLab.backup;

  return (
    <div className="p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical size={18} className="text-amber-400" />
        <h1 className="text-lg font-semibold text-slate-100">Integration Test Lab</h1>
      </div>
      <p className="text-sm text-slate-400 mb-4">
        Runs a real Kopia + Syncthing integration test using generated sample data.
      </p>

      {/* Safety banner */}
      <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-700/50 rounded p-3 mb-6 text-xs text-amber-300">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
        <div>
          <strong>Generated test data only.</strong> This lab creates sample files in your OS temp
          directory (<code className="font-mono">/tmp/nasbb-test-lab</code> on macOS/Linux).
          No personal files are used. The test password is a fixed non-secret constant.
        </div>
      </div>

      {/* Step 1: Probe tools */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={probes.state} />
            Step 1 — Probe Kopia &amp; Syncthing
          </div>
          <button
            onClick={handleProbeTools}
            disabled={probes.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white"
          >
            <RefreshCw size={11} />
            Probe Tools
          </button>
        </div>
        {probes.state === 'error' && (
          <p className="text-xs text-red-400 mb-2">{probes.error}</p>
        )}
        {probes.data && (
          <div className="grid grid-cols-2 gap-2">
            {probes.data.map(p => <ToolProbeCard key={p.name} probe={p} />)}
          </div>
        )}
      </section>

      {/* Step 2: Create test lab */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={lab.state} />
            Step 2 — Create Test Sandbox
          </div>
          <button
            onClick={handleCreateLab}
            disabled={lab.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white"
          >
            Create Lab
          </button>
        </div>
        {lab.state === 'error' && (
          <p className="text-xs text-red-400">{lab.error}</p>
        )}
        {lab.data && (
          <div className="text-xs bg-slate-900 rounded p-2 text-slate-300 space-y-1">
            <div><span className="text-slate-500">Location:</span> {lab.data.root_label}</div>
            <div><span className="text-slate-500">Sample files:</span> {lab.data.sample_file_count}</div>
            <div>
              <span className="text-slate-500">Canary SHA-256:</span>{' '}
              <code className="font-mono text-emerald-400 text-xs">{lab.data.canary_sha256.slice(0, 16)}…</code>
            </div>
          </div>
        )}
      </section>

      {/* Step 3: Run encrypted backup */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={backup.state} />
            Step 3 — Run Encrypted Backup
          </div>
          <button
            onClick={handleRunBackup}
            disabled={!labReady || backup.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
          >
            Run Backup
          </button>
        </div>
        {backup.state === 'error' && (
          <p className="text-xs text-red-400">{backup.error}</p>
        )}
        {backup.data && (
          <div className="text-xs bg-slate-900 rounded p-2 text-slate-300 space-y-1">
            <div>
              <span className="text-slate-500">Snapshot ID:</span>{' '}
              <code className="font-mono text-sky-400">{backup.data.snapshot_id}</code>
            </div>
            <div><span className="text-slate-500">Source:</span> {backup.data.source_label}</div>
            <div><span className="text-slate-500">Timestamp:</span> {backup.data.timestamp}</div>
            <CollapsibleLog label="Log line" lines={[backup.data.log_line]} />
          </div>
        )}
      </section>

      {/* Step 4: Prepare Syncthing transport */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={transport.state} />
            Step 4 — Prepare Syncthing Transport
          </div>
          <button
            onClick={handlePrepareTransport}
            disabled={!labReady || transport.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
          >
            Prepare Transport
          </button>
        </div>
        {transport.state === 'error' && (
          <p className="text-xs text-red-400">{transport.error}</p>
        )}
        {transport.data && (
          <div className="text-xs bg-slate-900 rounded p-2 text-slate-300 space-y-1">
            <div>
              <span className="text-slate-500">Folder ID:</span>{' '}
              <code className="font-mono text-sky-400">{transport.data.folder_id}</code>
            </div>
            <div>
              <span className="text-slate-500">Safety validated:</span>{' '}
              {transport.data.is_safety_validated
                ? <span className="text-emerald-400">Yes — source folder excluded</span>
                : <span className="text-red-400">No</span>}
            </div>
            <div className="text-slate-500 mt-1">{transport.data.note}</div>
            <CollapsibleLog label="Config snippet" lines={[transport.data.config_snippet]} />
          </div>
        )}
      </section>

      {/* Step 5: Repository verification */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={check.state} />
            Step 5 — Repository Verification
          </div>
          <button
            onClick={handleRepoCheck}
            disabled={!backupDone || check.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
          >
            Run Check
          </button>
        </div>
        {check.state === 'error' && (
          <p className="text-xs text-red-400">{check.error}</p>
        )}
        {check.data && (
          <div className="text-xs bg-slate-900 rounded p-2 text-slate-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Result:</span>
              {check.data.passed
                ? <span className="text-emerald-400">Passed</span>
                : <span className="text-red-400 font-medium">FAILED — investigate immediately</span>}
            </div>
            <div><span className="text-slate-500">Message:</span> {check.data.message}</div>
            <div><span className="text-slate-500">Duration:</span> {check.data.duration_ms}ms</div>
          </div>
        )}
      </section>

      {/* Step 6: Restore drill */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <StatusBadge state={drill.state} />
            Step 6 — Restore Drill (Canary Verification)
          </div>
          <button
            onClick={handleRestoreDrill}
            disabled={!backupDone || drill.state === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
          >
            Run Drill
          </button>
        </div>
        {drill.state === 'error' && (
          <p className="text-xs text-red-400">{drill.error}</p>
        )}
        {drill.data && (
          <div className="text-xs bg-slate-900 rounded p-2 text-slate-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Result:</span>
              <HealthBadge level={drill.data.health_level} />
              <span className="text-slate-400">({drill.data.result})</span>
            </div>
            <div><span className="text-slate-500">Duration:</span> {drill.data.restore_duration_ms}ms</div>
            {drill.data.canary_verify && (
              <>
                <div>
                  <span className="text-slate-500">Expected SHA-256:</span>{' '}
                  <code className="font-mono">{drill.data.canary_verify.expected_sha256.slice(0, 16)}…</code>
                </div>
                <div>
                  <span className="text-slate-500">Observed SHA-256:</span>{' '}
                  <code className={`font-mono ${drill.data.canary_verify.matches ? 'text-emerald-400' : 'text-red-400'}`}>
                    {drill.data.canary_verify.observed_sha256.slice(0, 16)}…
                  </code>
                </div>
                <div>
                  <span className="text-slate-500">Checksum match:</span>{' '}
                  {drill.data.canary_verify.matches
                    ? <span className="text-emerald-400">Yes</span>
                    : <span className="text-red-400 font-medium">NO — MISMATCH DETECTED</span>}
                </div>
              </>
            )}
            <CollapsibleLog label="Audit evidence" lines={drill.data.audit_evidence} />
          </div>
        )}
      </section>
    </div>
  );
}
