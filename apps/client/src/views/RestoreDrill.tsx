import { useState } from 'react';
import { AlertTriangle, CheckCircle, Info, RotateCcw, XCircle } from 'lucide-react';
import type { MockDrillResult } from '../lib/types';
import { runMockRestoreDrill } from '../lib/tauri-bridge';
import { useApp } from '../context/AppContext';

const CANARY_EXAMPLE = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function RestoreDrill() {
  const { addLogLine, updateHealthFromDrillResult } = useApp();
  const [expectedChecksum, setExpectedChecksum] = useState(CANARY_EXAMPLE);
  const [observedChecksum, setObservedChecksum] = useState('');
  const [result, setResult] = useState<MockDrillResult | null>(null);
  const [running, setRunning] = useState(false);

  async function handleRunDrill() {
    if (!expectedChecksum) return;
    setRunning(true);
    try {
      const r = await runMockRestoreDrill(expectedChecksum, observedChecksum);
      setResult(r);
      const observedForLog = observedChecksum || '[empty]';
      addLogLine(`restore_drill expected=${expectedChecksum} observed=${observedForLog}`, r.log_line);
      // Update shared health state so HealthChecks and Dashboard reflect result
      updateHealthFromDrillResult(r);
    } finally {
      setRunning(false);
    }
  }

  function simulatePassing() {
    setObservedChecksum(expectedChecksum);
  }

  function simulateMismatch() {
    setObservedChecksum('sha256:0000000000000000000000000000000000000000000000000000000000000000');
  }

  function simulateFailure() {
    setExpectedChecksum('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    setObservedChecksum('');
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <RotateCcw size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Restore Drill</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80 leading-relaxed">
          A restore drill selects a Kopia snapshot, restores it to a clean destination, then verifies the canary file checksum.
          A mismatch or failure is marked Critical and blocks Protected status.
        </p>
      </div>

      {/* Procedure */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Procedure</h3>
        <div className="space-y-1.5">
          {[
            'Select a recent Kopia snapshot.',
            'Restore to a clean, isolated destination folder.',
            'Locate the canary file in the restored output.',
            'Compute the SHA-256 checksum of the canary file.',
            'Compare to the expected checksum recorded when the snapshot was created.',
            'Spot-check at least three other restored files.',
            'Record restore duration and snapshot ID.',
            'Delete the restore destination if it contains sensitive data.',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-xs font-mono flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
      </div>

      {/* Interactive drill */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mock Drill Inputs</h3>

        <div className="flex gap-2 flex-wrap">
          <button onClick={simulatePassing} className="px-2.5 py-1 text-xs bg-emerald-900/30 border border-emerald-700/30 text-emerald-300 rounded hover:bg-emerald-900/50 transition-colors">Simulate pass</button>
          <button onClick={simulateMismatch} className="px-2.5 py-1 text-xs bg-red-900/30 border border-red-700/30 text-red-300 rounded hover:bg-red-900/50 transition-colors">Simulate mismatch</button>
          <button onClick={simulateFailure} className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 text-slate-400 rounded hover:bg-slate-700 transition-colors">Simulate failure (empty observed)</button>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1 block">Expected canary checksum</label>
          <input
            type="text"
            value={expectedChecksum}
            onChange={e => setExpectedChecksum(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">Recorded when the snapshot was created.</p>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1 block">Observed canary checksum</label>
          <input
            type="text"
            value={observedChecksum}
            onChange={e => setObservedChecksum(e.target.value)}
            placeholder="Computed from the restored canary file"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
          <p className="text-xs text-slate-600 mt-1">SHA-256 of the canary file after restore.</p>
        </div>

        <button
          onClick={handleRunDrill}
          disabled={running || !expectedChecksum}
          className="w-full py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
        >
          {running ? 'Running drill…' : 'Run mock restore drill'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`bg-slate-900 border rounded-lg p-4 space-y-3 ${
          result.result === 'pass' ? 'border-emerald-500/30' : 'border-red-500/30'
        }`}>
          <div className="flex items-center gap-2">
            {result.result === 'pass'
              ? <CheckCircle size={16} className="text-emerald-400" />
              : <XCircle size={16} className="text-red-400" />
            }
            <span className={`font-semibold text-sm ${result.result === 'pass' ? 'text-emerald-300' : 'text-red-300'}`}>
              Drill {result.result === 'pass' ? 'PASSED' : result.result === 'canary_mismatch' ? 'FAILED — CANARY MISMATCH' : 'FAILED'}
            </span>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded border font-medium ${
              result.health_level === 'ok'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}>
              {result.health_level.toUpperCase()}
            </span>
          </div>

          {result.result !== 'pass' && (
            <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5">
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-300 leading-relaxed space-y-0.5">
                {result.result === 'canary_mismatch' && (
                  <p><strong>Canary mismatch.</strong> Preserve all logs. Do not prune snapshots. Investigate immediately.</p>
                )}
                {result.result === 'fail' && (
                  <p><strong>Restore failed.</strong> Check restore destination and available disk space.</p>
                )}
                <p>Protected status is blocked until a drill passes.</p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Audit Evidence</div>
            {result.audit_evidence.map((e, i) => (
              <div key={i} className="text-xs text-slate-400 font-mono">{e}</div>
            ))}
          </div>

          <div className="text-xs font-mono text-slate-600 border-t border-slate-800 pt-2 mt-1">
            log: {result.log_line}
          </div>
        </div>
      )}

      {/* Outcome reference */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Outcomes</h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-2 text-emerald-400">
            <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span><strong>Pass</strong> — Protected gate check cleared. Re-run every 30 days.</span>
          </div>
          <div className="flex items-start gap-2 text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span><strong>Fail</strong> — Critical. Investigate restore destination and snapshot. Do not prune.</span>
          </div>
          <div className="flex items-start gap-2 text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span><strong>Canary mismatch</strong> — Critical. Preserve all logs. Test alternate snapshot immediately.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
