import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  FileText,
  Lock,
  Shield,
} from 'lucide-react';
import { getUserById, formatDate, formatStorageGB } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { CheckPill } from '../components/StatusPill';

function PactSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-800/50 border-b border-slate-800">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function PactField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-800/50 last:border-0">
      <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-xs font-mono text-slate-200 text-right">{value}</span>
    </div>
  );
}

export function BackupPact() {
  const { matchId } = useParams<{ matchId: string }>();
  const { pacts, acceptPact } = useApp();
  const pact = pacts.find((p) => p.matchId === matchId);

  const [confirmChecked, setConfirmChecked] = useState(false);

  if (!pact) {
    return (
      <div className="p-6 text-center">
        <FileText size={24} className="text-slate-600 mx-auto mb-2" />
        <p className="text-slate-400 text-sm mb-3">No pact found for this match.</p>
        <Link to="/matches" className="text-sky-400 text-sm">Back to matches</Link>
      </div>
    );
  }

  const owner = getUserById(pact.dataOwnerId);
  const host  = getUserById(pact.storageHostId);
  const bothSigned = pact.dataOwnerAccepted && pact.storageHostAccepted;

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <Link to={`/matches/${pact.matchId}`}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-5">
        <ArrowLeft size={14} />
        Back to match
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <FileText size={18} className="text-sky-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100">Backup Pact</h1>
          <p className="text-xs text-slate-500">
            Between {owner?.name} (data owner) and {host?.name} (storage host)
          </p>
        </div>
        {bothSigned && (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle size={14} />Signed
          </span>
        )}
      </div>

      {/* Alpha disclaimer */}
      <div className="mb-5 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          This is a plain-language agreement for the private alpha. It is not a legal contract.
          Both parties should read it and use it as a shared commitment — not a guarantee.
        </p>
      </div>

      <div className="space-y-4">
        {/* Participants */}
        <PactSection title="Participants">
          <PactField label="Data owner"       value={owner?.name ?? '—'} />
          <PactField label="Storage host"     value={host?.name ?? '—'} />
          <PactField label="Start date"       value={formatDate(pact.startDate)} />
          <PactField label="Review date"      value={formatDate(pact.reviewDate)} />
        </PactSection>

        {/* Storage terms */}
        <PactSection title="Storage Terms">
          <PactField label="Storage offered"     value={formatStorageGB(pact.offeredStorageGB)} />
          <PactField label="Storage requested"   value={formatStorageGB(pact.requestedStorageGB)} />
          <PactField label="Quota buffer"        value={formatStorageGB(pact.quotaBufferGB)} />
          <PactField label="Expected min uptime" value={`${pact.expectedMinUptimePercent}%`} />
          <PactField
            label="Expected monthly bandwidth"
            value={pact.expectedMonthlyBandwidthGB === 0
              ? 'Unlimited'
              : formatStorageGB(pact.expectedMonthlyBandwidthGB) + '/mo'}
          />
          <PactField label="Region"               value={pact.region} />
          <PactField
            label="Retention after match ends"
            value={`${pact.retentionDaysAfterEnd} days`}
          />
        </PactSection>

        {/* Security agreement */}
        <PactSection title="Security Agreement">
          <div className="space-y-3">
            {[
              { icon: <Lock size={14} />, text: 'The data owner will encrypt backups before they leave their machine using Kopia or restic. Plaintext data will never be transferred.' },
              { icon: <Shield size={14} />, text: 'The storage host will receive only encrypted repository data. They will not inspect, modify, or attempt to decrypt it.' },
              { icon: <AlertTriangle size={14} />, text: 'The data owner will not share backup passwords or encryption keys with the storage host or this platform.' },
              { icon: <CheckCircle size={14} />, text: 'The data owner is responsible for saving recovery passwords/keys in a safe location outside this platform.' },
              { icon: <Shield size={14} />, text: 'The storage host agrees not to delete repository data except through the agreed retirement process.' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-slate-500 flex-shrink-0 mt-0.5">{item.icon}</span>
                <p className="text-sm text-slate-300 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </PactSection>

        {/* Operational agreement */}
        <PactSection title="Operational Agreement">
          <PactField label="Initial backup target"        value={formatDate(pact.initialBackupTargetDate)} />
          <PactField label="First restore drill target"   value={formatDate(pact.firstRestoreDrillTargetDate)} />
          <PactField label="Restore drill frequency"      value={`Every ${pact.restoreDrillFrequencyDays} days`} />
          <PactField label="Alert contact method"         value={pact.alertContactMethod} />
          <PactField label="Grace period on retirement"   value={`${pact.gracePeriodDays} days`} />
        </PactSection>

        {/* Exit process */}
        <PactSection title="Exit Process">
          <ol className="space-y-2">
            {[
              'Either participant may request match retirement.',
              'Data owner confirms whether they need time to migrate data.',
              'Storage host keeps encrypted data for the agreed grace period.',
              'Data owner confirms migration or expiration.',
              'Storage host deletes encrypted repository data.',
              'Both participants mark the pact retired.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                <span className="w-4 h-4 rounded-full bg-slate-700 text-slate-400 text-xs flex items-center
                  justify-center flex-shrink-0 mt-0.5 font-mono">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </PactSection>

        {/* Acknowledgements */}
        <PactSection title="Acknowledgements">
          <div className="space-y-2">
            {[
              'This is an experimental homelab backup exchange.',
              'This should not be your only backup. Maintain a separate 3-2-1 backup strategy.',
              'Restore testing is required before any match is marked Protected.',
              'Lost passwords or encryption keys cannot be recovered by this platform.',
            ].map((ack, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-400">
                <CheckCircle size={13} className="text-slate-600 flex-shrink-0 mt-0.5" />
                {ack}
              </div>
            ))}
          </div>
        </PactSection>

        {/* Signature status */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Signatures</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div className="text-xs text-slate-500 mb-1">Data Owner</div>
              <div className="text-sm font-medium text-slate-200 mb-2">{owner?.name}</div>
              <div className="flex items-center justify-between">
                <CheckPill pass={pact.dataOwnerAccepted} labelPass="Accepted" labelFail="Pending" />
                {pact.dataOwnerAcceptedAt && pact.dataOwnerAccepted && (
                  <span className="text-xs text-slate-500 font-mono">{formatDate(pact.dataOwnerAcceptedAt)}</span>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div className="text-xs text-slate-500 mb-1">Storage Host</div>
              <div className="text-sm font-medium text-slate-200 mb-2">{host?.name}</div>
              <div className="flex items-center justify-between">
                <CheckPill pass={pact.storageHostAccepted} labelPass="Accepted" labelFail="Pending" />
                {pact.storageHostAcceptedAt && pact.storageHostAccepted && (
                  <span className="text-xs text-slate-500 font-mono">{formatDate(pact.storageHostAcceptedAt)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Accept flow (if not yet signed) */}
          {!bothSigned && (
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-0.5 accent-sky-500"
                />
                <span className="text-sm text-slate-300">
                  I have read this pact, I understand my obligations, and I confirm that I will keep my recovery password/key safe outside this platform.
                </span>
              </label>

              <div className="flex gap-2 flex-wrap">
                {!pact.dataOwnerAccepted && (
                  <button
                    disabled={!confirmChecked}
                    onClick={() => acceptPact(pact.id, 'owner')}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-sky-500/15 text-sky-400
                      border border-sky-500/25 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Accept as Data Owner
                  </button>
                )}
                {!pact.storageHostAccepted && (
                  <button
                    disabled={!confirmChecked}
                    onClick={() => acceptPact(pact.id, 'host')}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-sky-500/15 text-sky-400
                      border border-sky-500/25 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Accept as Storage Host
                  </button>
                )}
              </div>
            </div>
          )}

          {bothSigned && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle size={16} />
              Both parties have accepted this pact.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
