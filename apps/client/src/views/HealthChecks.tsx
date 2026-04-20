import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';

const GATE_CHECKS = [
  'Backup snapshot exists',
  'Encrypted repo synced to peer',
  'Restore drill completed',
  'Canary checksum matches',
  'User has recovery key / password',
  'Retention policy configured',
  'Peer quota has buffer (≥15% free)',
  'No critical health alerts',
];

const THRESHOLDS = [
  ['Last backup age',   '> 24h → Warning',   '> 72h → Critical'],
  ['Last sync age',     '> 24h → Warning',   '> 72h → Critical'],
  ['Free quota',        '< 15% → Warning',   '< 5% → Critical'],
  ['Restore drill age', '> 30 days → Warning', 'Never run / failed → Critical'],
  ['Peer offline',      '> 24h → Warning',   '> 7 days → Critical'],
  ['Repository check',  'Tool warning',        'Check failed → Critical'],
];

export function HealthChecks() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Health Checks</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Live health metrics will be displayed once the Tauri
          backend is connected. Thresholds are implemented in <code>nasbb-core/src/health.rs</code>.
        </p>
      </div>

      {/* Protected gate */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Protected Status Gate (8 checks)</h3>
        <div className="space-y-1.5">
          {GATE_CHECKS.map(check => (
            <div key={check} className="flex items-center justify-between py-1.5
              border-b border-slate-800/40 last:border-0">
              <span className="text-sm text-slate-300">{check}</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                bg-amber-400/10 text-amber-400 border border-amber-400/20">
                <AlertTriangle size={10} />Pending
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-2">
          <CheckCircle size={14} className="text-slate-600" />
          <span className="text-xs text-slate-500">0 / 8 checks pass</span>
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Alert Thresholds</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-4 font-medium">Check</th>
                <th className="text-left py-1.5 pr-4 font-medium text-amber-400">Warning</th>
                <th className="text-left py-1.5 font-medium text-red-400">Critical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {THRESHOLDS.map(([check, warn, crit]) => (
                <tr key={check} className="text-slate-300">
                  <td className="py-1.5 pr-4">{check}</td>
                  <td className="py-1.5 pr-4 text-amber-400/80">{warn}</td>
                  <td className="py-1.5 text-red-400/80">{crit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
