import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Lock,
  RefreshCw,
  Shield,
  Zap,
} from 'lucide-react';

interface AccordionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Accordion({ title, icon, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          <span className="text-sm font-semibold text-slate-200">{title}</span>
        </div>
        {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-800 text-sm text-slate-300 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

const RISKS = [
  { id: 'R1', risk: 'Syncthing propagates deletion/bad state', likelihood: 'Medium', impact: 'High', control: 'Use Kopia/restic snapshots — never sync live source folders directly to peers.' },
  { id: 'R2', risk: 'Peer disappears',                         likelihood: 'High',   impact: 'High', control: 'Alerts, grace periods, reputation scoring, multi-peer in a later phase.' },
  { id: 'R3', risk: 'Peer deletes encrypted repository',       likelihood: 'Medium', impact: 'High', control: 'Backup pact, agent warnings, storage proofs planned for later phases.' },
  { id: 'R4', risk: 'User loses encryption password',          likelihood: 'Medium', impact: 'High', control: 'Key export checklist, repeated warnings, restore drill required for Protected status.' },
  { id: 'R5', risk: 'Disk fills up',                           likelihood: 'High',   impact: 'Medium', control: 'Quota enforcement, preflight checks, alerts at 15% and 5% free.' },
  { id: 'R6', risk: 'Residential bandwidth too slow',          likelihood: 'High',   impact: 'Medium', control: 'Match by upload speed — score includes bandwidth. Estimated restore time shown.' },
  { id: 'R7', risk: 'Ransomware corrupts source data',         likelihood: 'Medium', impact: 'High', control: 'Snapshot retention, immutable-ish retention guidance, delayed prune.' },
  { id: 'R8', risk: 'Peer inspects data',                      likelihood: 'Medium', impact: 'High', control: 'Client-side encryption — peer receives only encrypted repository blobs.' },
  { id: 'R13', risk: 'False sense of safety',                  likelihood: 'Medium', impact: 'High', control: 'Honest copy, health states, explicit "not your only backup" warnings throughout.' },
];

export function Help() {
  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-base font-semibold text-slate-100 mb-1">Help &amp; Documentation</h2>
        <p className="text-sm text-slate-400">
          Key concepts, architecture, non-negotiable rules, and risk register highlights.
          Full documentation lives in the <code className="font-mono text-xs bg-slate-800 px-1 py-0.5 rounded">docs/</code> directory.
        </p>
      </div>

      {/* Product disclaimer */}
      <div className="flex items-start gap-2.5 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          <strong>Honest product statement:</strong> NAS Backup Buddy is an experimental homelab backup exchange. It coordinates matches, monitors health, and helps you run restore drills. It is not a guaranteed cloud-backup replacement. Treat it as one layer of a 3-2-1 backup strategy.
        </p>
      </div>

      <div className="space-y-3">
        {/* What is this? */}
        <Accordion title="What is NAS Backup Buddy?" icon={<BookOpen size={14} />} defaultOpen>
          <div className="mt-3 space-y-3">
            <p>
              NAS Backup Buddy is a <strong>homelab backup exchange</strong>. Users with spare NAS or server capacity can match with other users who need offsite backup storage. Because data is encrypted before it leaves your machine, your peer only ever stores encrypted blobs — they cannot read your files.
            </p>
            <p>
              The platform coordinates matching, health checks, reputation, and recovery workflows. Open-source tools (Kopia, Syncthing) do the actual backup and transfer work.
            </p>
            <p>
              The first launch is <strong>invite-only and barter-based</strong>. No money changes hands in the alpha. Paid marketplace features are explicitly blocked until safety controls are proven.
            </p>
          </div>
        </Accordion>

        {/* Architecture */}
        <Accordion title="How the system works" icon={<Database size={14} />}>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              {[
                {
                  step: '1',
                  title: 'Backup engine creates encrypted snapshots',
                  body: 'Kopia (recommended) or restic takes a snapshot of your source folders and writes an encrypted, deduplicated repository to a local path. This is the only step that touches plaintext. Your password never leaves your machine.',
                },
                {
                  step: '2',
                  title: 'Syncthing replicates the encrypted repository',
                  body: 'Syncthing is configured to share only the encrypted repository directory — not your source folders — with your matched peer. The peer receives opaque blobs. They cannot read file names or contents.',
                },
                {
                  step: '3',
                  title: 'Website coordinates everything',
                  body: 'NAS Backup Buddy manages matching, backup pacts, health dashboards, and restore drill records. It collects only operational metadata (sizes, timestamps, status). It never receives passwords, keys, file names, or file contents.',
                },
                {
                  step: '4',
                  title: 'Restore drill proves it works',
                  body: 'Before a match is marked Protected, a restore drill must succeed. You restore a snapshot to a clean location, verify the canary file checksum, and confirm your recovery key works without platform help.',
                },
              ].map(item => (
                <div key={item.step} className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center flex-shrink-0 font-mono font-bold mt-0.5">
                    {item.step}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-200 mb-0.5">{item.title}</div>
                    <p className="text-xs text-slate-400 leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50">
              <p className="text-xs text-slate-400">
                <strong className="text-slate-300">Key distinction:</strong> Syncthing is a <em>transport layer</em> — it replicates already-encrypted repository files. It is not the backup engine. Kopia/restic handles snapshots, versioning, retention, and restore. This separation is critical — raw Syncthing propagates deletions and cannot replace a proper backup tool.
              </p>
            </div>
          </div>
        </Accordion>

        {/* Non-negotiable rules */}
        <Accordion title="Non-negotiable rules" icon={<Shield size={14} />}>
          <div className="mt-3 space-y-2">
            {[
              { rule: 'Never sync a live source folder directly to an untrusted peer.', icon: <AlertTriangle size={13} className="text-red-400" /> },
              { rule: 'Never collect backup encryption passwords.', icon: <Lock size={13} className="text-red-400" /> },
              { rule: 'Never mark a setup healthy until a restore drill succeeds.', icon: <RefreshCw size={13} className="text-red-400" /> },
              { rule: 'Never launch paid storage before legal, abuse, payout, and dispute controls exist.', icon: <AlertTriangle size={13} className="text-red-400" /> },
              { rule: 'Never imply this replaces a complete 3-2-1 backup strategy.', icon: <AlertTriangle size={13} className="text-amber-400" /> },
            ].map(item => (
              <div key={item.rule} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 mt-0.5">{item.icon}</span>
                <span className="text-sm text-slate-300">{item.rule}</span>
              </div>
            ))}
          </div>
        </Accordion>

        {/* Protected status */}
        <Accordion title="How Protected status works" icon={<CheckCircle size={14} />}>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-300">
              A match reaches <strong className="text-emerald-400">Protected</strong> status only when all eight gate checks pass simultaneously:
            </p>
            <div className="space-y-1">
              {[
                'Backup snapshot exists',
                'Encrypted repository synced to peer',
                'Restore drill completed',
                'Canary checksum matches',
                'User has recovery password/key',
                'Retention policy configured',
                'Peer quota has buffer',
                'No critical health alerts',
              ].map((check, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-800/50 last:border-0">
                  <CheckCircle size={12} className="text-slate-500" />
                  <span className="text-sm text-slate-300">{check}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              If any check fails, the match falls back to Warning or Critical. Protected status is not permanent — health checks run continuously.
            </p>
          </div>
        </Accordion>

        {/* Match scoring */}
        <Accordion title="Match scoring matrix" icon={<Zap size={14} />}>
          <div className="mt-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left py-1.5 pr-4 font-medium">Factor</th>
                    <th className="text-left py-1.5 pr-4 font-medium">Weight</th>
                    <th className="text-left py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {[
                    ['Storage Fit',       '25/100', 'Offered capacity must exceed requested plus buffer'],
                    ['Upload Speed',      '20/100', 'Slow upload affects backup window and restore time'],
                    ['Uptime',            '20/100', 'Backup target must be reachable to be useful'],
                    ['Reputation',        '15/100', 'Starts manual in alpha; based on past drill history'],
                    ['Region Distance',   '10/100', 'Far enough for disaster separation, near enough for speed'],
                    ['Reciprocal Fair.',  '10/100', 'Prevents one-sided free riding'],
                  ].map(([factor, weight, notes]) => (
                    <tr key={factor} className="text-slate-300">
                      <td className="py-1.5 pr-4">{factor}</td>
                      <td className="py-1.5 pr-4 font-mono text-sky-400">{weight}</td>
                      <td className="py-1.5 text-slate-400">{notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Accordion>

        {/* Backup pact */}
        <Accordion title="Backup Pact overview" icon={<FileText size={14} />}>
          <div className="mt-3 space-y-3 text-sm text-slate-300">
            <p>
              A Backup Pact is a plain-language agreement between the data owner and the storage host. It records storage terms, security responsibilities, operational commitments, and the exit process.
            </p>
            <p>
              It is not a legal contract. In the alpha it is a shared commitment between trusted users. Legal review is required before public launch.
            </p>
            <div className="space-y-2">
              <strong className="text-slate-200 text-xs uppercase tracking-wide">Key terms</strong>
              {[
                'Data owner encrypts backups before transfer — host receives only encrypted data.',
                'Host agrees not to inspect, modify, or delete repository data except through retirement.',
                'Data owner keeps recovery key/password outside this platform.',
                'Restore drill must complete within 7 days of first successful sync.',
                'Grace period: host keeps encrypted data for agreed period after match retirement.',
              ].map((term, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <CheckCircle size={11} className="text-slate-600 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-400">{term}</span>
                </div>
              ))}
            </div>
          </div>
        </Accordion>

        {/* Risk register */}
        <Accordion title="Risk register highlights" icon={<AlertTriangle size={14} />}>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1.5 pr-2 font-medium">ID</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Risk</th>
                  <th className="text-left py-1.5 pr-2 font-medium hidden sm:table-cell">Like.</th>
                  <th className="text-left py-1.5 pr-2 font-medium hidden sm:table-cell">Impact</th>
                  <th className="text-left py-1.5 font-medium hidden md:table-cell">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {RISKS.map(r => (
                  <tr key={r.id} className="text-slate-300">
                    <td className="py-1.5 pr-2 font-mono text-slate-500">{r.id}</td>
                    <td className="py-1.5 pr-4">{r.risk}</td>
                    <td className={`py-1.5 pr-2 hidden sm:table-cell ${r.likelihood === 'High' ? 'text-amber-400' : 'text-slate-400'}`}>{r.likelihood}</td>
                    <td className={`py-1.5 pr-2 hidden sm:table-cell ${r.impact === 'High' ? 'text-red-400/80' : 'text-amber-400/80'}`}>{r.impact}</td>
                    <td className="py-1.5 text-slate-400 hidden md:table-cell">{r.control}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>

        {/* Backup engine options */}
        <Accordion title="Backup engine options" icon={<Database size={14} />}>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1.5 pr-4 font-medium">Tool</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Strengths</th>
                  <th className="text-left py-1.5 font-medium">Fit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {[
                  ['Kopia',        'Encrypted by default, snapshots, policies, dedupe, GUI and CLI', 'Best first candidate'],
                  ['restic',       'Simple, mature, encrypted, dedupe, broad backend support', 'Strong MVP candidate'],
                  ['BorgBackup',   'Excellent compression/dedupe, authenticated encryption', 'Advanced Linux users'],
                  ['Syncthing only', 'Easy sync and peer connectivity', 'Transport only — NOT a backup engine'],
                ].map(([tool, strengths, fit]) => (
                  <tr key={tool} className="text-slate-300">
                    <td className="py-1.5 pr-4 font-mono text-sky-400">{tool}</td>
                    <td className="py-1.5 pr-4 text-slate-400">{strengths}</td>
                    <td className={`py-1.5 ${fit.includes('NOT') ? 'text-amber-400' : ''}`}>{fit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>

        {/* Privacy */}
        <Accordion title="Privacy &amp; what the platform collects" icon={<Lock size={14} />}>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-emerald-400/5 border border-emerald-400/15 rounded-lg">
                <div className="text-xs font-semibold text-emerald-400 mb-2">✓ Platform collects</div>
                <ul className="space-y-1 text-xs text-slate-300">
                  {['Agent version','Last backup status and timestamp','Last sync status and timestamp','Repository size (bytes)','Available quota','Peer online/offline state','Disk health summary (no paths)','Error category (redacted)'].map(i => <li key={i}>• {i}</li>)}
                </ul>
              </div>
              <div className="p-3 bg-red-400/5 border border-red-400/15 rounded-lg">
                <div className="text-xs font-semibold text-red-400 mb-2">✗ Platform never collects</div>
                <ul className="space-y-1 text-xs text-slate-300">
                  {['Backup encryption passwords','Private keys','Plaintext file names','Plaintext file contents','Source folder paths','Backup payload data'].map(i => <li key={i}>• {i}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </Accordion>
      </div>
    </div>
  );
}
