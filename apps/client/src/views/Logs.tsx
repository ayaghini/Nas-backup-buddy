import { Terminal, AlertTriangle, Shield } from 'lucide-react';

// Sample redacted log lines showing what the output will look like.
// Real log lines come from the Tauri `redact_log_line` command.
const SAMPLE_LINES = [
  '2026-04-18T10:00:01Z [INFO]  kopia snapshot started',
  '2026-04-18T10:00:03Z [INFO]  scanning source directory: [REDACTED]',
  '2026-04-18T10:00:15Z [INFO]  uploading 42 new content blocks',
  '2026-04-18T10:00:28Z [INFO]  snapshot complete: 1.2 GB, duration=27s',
  '2026-04-18T10:01:00Z [INFO]  syncthing: repository folder in sync',
  '2026-04-18T10:01:01Z [INFO]  health report emitted: last_backup_age_hours=0.0 free_quota_percent=65.0',
];

export function Logs() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <Terminal size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Logs</h1>
      </div>

      {/* Redaction notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Shield size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-300/80 space-y-1">
          <p><strong>All log lines are redacted before display.</strong></p>
          <p>Passwords, keys, pairing tokens, and absolute filesystem paths are replaced with <code>[REDACTED]</code>.</p>
          <p>Raw tool output from Kopia/Syncthing is never sent to the web API.</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Sample lines below show the expected format after redaction.
          Live streaming will be implemented when the Tauri backend is connected.
        </p>
      </div>

      {/* Sample log output */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sample Output (redacted)</span>
          <span className="text-xs text-slate-600">Tail 100 lines</span>
        </div>
        <div className="p-4 space-y-0.5 font-mono text-xs text-slate-400">
          {SAMPLE_LINES.map((line, i) => (
            <div key={i} className="leading-relaxed whitespace-pre-wrap break-all">{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
