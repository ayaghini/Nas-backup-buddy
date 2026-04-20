import { BookOpen, ExternalLink } from 'lucide-react';

export function About() {
  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <BookOpen size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">About &amp; License</h1>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Application</div>
          <div className="text-sm font-medium text-slate-200">NAS Backup Buddy</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Version</div>
          <div className="text-sm font-mono text-slate-200">0.1.0 · private alpha</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-0.5">License</div>
          <div className="text-sm font-mono text-slate-200">AGPL-3.0-only</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Description</div>
          <div className="text-sm text-slate-300 leading-relaxed">
            Experimental homelab backup exchange. Cross-platform desktop client.
            One layer of a 3-2-1 backup strategy — not a replacement for it.
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Bundled Tools</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          This application bundles pinned versions of Kopia and Syncthing.
          Their licenses and checksums are listed in <code>THIRD_PARTY_NOTICES.md</code> at the root of the repository.
        </p>
        <div className="space-y-1.5">
          {[
            { name: 'Kopia',       license: 'Apache-2.0', note: 'backup engine' },
            { name: 'Syncthing',   license: 'MPL-2.0',    note: 'transport layer' },
          ].map(tool => (
            <div key={tool.name} className="flex items-center gap-3 text-xs">
              <span className="text-slate-300 font-medium w-20">{tool.name}</span>
              <span className="font-mono text-slate-500">{tool.license}</span>
              <span className="text-slate-600">{tool.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Source Code</h3>
        <div className="flex items-center gap-1.5 text-xs text-sky-400">
          <ExternalLink size={11} />
          <span>Source available — see repository root for LICENSE</span>
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          This software is free software: you can redistribute it and/or modify it under the terms
          of the GNU Affero General Public License as published by the Free Software Foundation,
          version 3 or (at your option) any later version.
        </p>
      </div>
    </div>
  );
}
