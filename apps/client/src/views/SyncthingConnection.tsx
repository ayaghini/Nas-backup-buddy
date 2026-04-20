import { Wifi, AlertTriangle } from 'lucide-react';

export function SyncthingConnection() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Wifi size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Syncthing Connection</h1>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <strong>Placeholder.</strong> Will show peer connection status, folder sync state,
          and Syncthing device ID once the backend is connected.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Important: Syncthing Safety</h3>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          <p>• Syncthing is used as transport only — never to sync live source folders.</p>
          <p>• Only the encrypted Kopia repository folder is shared with peers.</p>
          <p>• Peers receive encrypted data blobs — they cannot read your files.</p>
          <p>• The repository folder path is not included in health reports sent to the web app.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Planned Sections</h3>
        {[
          'Syncthing process status (running / stopped)',
          'This device ID (redacted in logs)',
          'Peer device ID and connection state',
          'Repository folder sync progress',
          'Last sync timestamp',
          'Bandwidth usage',
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-1 h-1 rounded-full bg-slate-600 flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
