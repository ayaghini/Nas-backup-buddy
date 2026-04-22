import { useState } from 'react';
import { AlertTriangle, CheckCircle, Info, RotateCcw, XCircle } from 'lucide-react';
import type { RealDrillResult } from '../lib/types';
import { runRestoreDrill } from '../lib/tauri-bridge';
import { useApp } from '../context/AppContext';

export function RestoreDrill() {
  const {
    addLogLine,
    updateHealthFromDrillResult,
    realLab,
    updateRealLab,
    refreshRealHealth,
  } = useApp();
  const [result, setResult] = useState<RealDrillResult | null>(realLab.drill);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRunDrill() {
    setError(null);
    setRunning(true);
    try {
      const r = await runRestoreDrill();
      setResult(r);
      updateRealLab({ drill: r });
      addLogLine('kopia restore [snapshot] [restore-dir]', r.log_line);
      updateHealthFromDrillResult(r);
      await refreshRealHealth();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
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
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Generated-Data Restore Drill</h3>
        <p className="text-xs text-slate-500">
          Restores the latest generated-data Kopia snapshot from the test lab and verifies the canary checksum automatically.
        </p>

        <button
          onClick={handleRunDrill}
          disabled={running || !realLab.backup}
          className="w-full py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
        >
          {running ? 'Running drill…' : 'Run real restore drill'}
        </button>

        {!realLab.backup && (
          <p className="text-xs text-amber-300/80">Run a generated-data backup first in Backup Plan or Integration Test Lab.</p>
        )}

        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
            <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}
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
            {result.canary_verify && (
              <>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Canary Check</div>
                <div className="text-xs text-slate-400 font-mono">expected: {result.canary_verify.expected_sha256.slice(0, 16)}...</div>
                <div className="text-xs text-slate-400 font-mono">observed: {result.canary_verify.observed_sha256.slice(0, 16)}...</div>
                <div className={`text-xs ${result.canary_verify.matches ? 'text-emerald-300' : 'text-red-300'}`}>
                  checksum match: {result.canary_verify.matches ? 'yes' : 'no'}
                </div>
              </>
            )}
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
