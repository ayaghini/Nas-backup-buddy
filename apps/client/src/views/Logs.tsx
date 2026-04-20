import { Shield, Terminal } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function Logs() {
  const { logLines } = useApp();

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <Terminal size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Logs</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
        <Shield size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-sky-300/80 space-y-1">
          <p><strong>All log lines are redacted before display.</strong></p>
          <p>Passwords, keys, pairing tokens, and absolute filesystem paths are replaced with <code>[REDACTED]</code>.</p>
          <p>Raw tool output from Kopia/Syncthing is never sent to the web API.</p>
        </div>
      </div>

      {/* Before/after redaction demo */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Redaction Demo</span>
        </div>
        <div className="divide-y divide-slate-800/50">
          {logLines.filter(l => l.raw !== l.redacted).slice(0, 4).map((line, i) => (
            <div key={i} className="px-4 py-2.5 space-y-1">
              <div className="flex items-start gap-2">
                <span className="text-xs text-red-400/60 flex-shrink-0 w-12">Before</span>
                <code className="text-xs font-mono text-slate-500 break-all">{line.raw}</code>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-xs text-emerald-400/60 flex-shrink-0 w-12">After</span>
                <code className="text-xs font-mono text-slate-300 break-all">{line.redacted}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Redacted log stream */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Redacted Log Output</span>
          <span className="text-xs text-slate-600">{logLines.length} lines</span>
        </div>
        <div className="p-4 space-y-0.5 font-mono text-xs text-slate-400 max-h-80 overflow-y-auto">
          {logLines.map((line, i) => (
            <div key={i} className="leading-relaxed whitespace-pre-wrap break-all">
              {line.redacted}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
