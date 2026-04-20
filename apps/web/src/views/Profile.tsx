import { useState } from 'react';
import {
  CheckCircle,
  Edit3,
  Globe,
  HardDrive,
  Lock,
  Power,
  Save,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { CURRENT_USER, formatStorageGB } from '../data/mockData';
import type { UserProfile } from '../types';

function FieldRow({ label, value, mono = false }: { label: string; value: string | number | boolean; mono?: boolean }) {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-400 flex-shrink-0 w-48">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} text-slate-200`}>{display}</span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/40 border-b border-slate-800">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

export function Profile() {
  const [profile, setProfile] = useState<UserProfile>(CURRENT_USER);
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState<UserProfile>(CURRENT_USER);

  const save = () => {
    setProfile(draft);
    setEditing(false);
  };

  const u = editing ? draft : profile;

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
            <span className="text-lg font-bold text-sky-400">
              {profile.name.split(' ').map(n => n[0]).join('')}
            </span>
          </div>
          <div>
            <div className="text-base font-semibold text-slate-100">{profile.name}</div>
            <div className="text-xs text-slate-500 font-mono">@{profile.handle} · Reputation {profile.reputation}/100</div>
          </div>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => { setDraft(profile); setEditing(false); }}
              className="px-3 py-1.5 rounded-md border border-slate-700 text-sm text-slate-400 hover:bg-slate-800">
              Cancel
            </button>
            <button onClick={save}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25">
              <Save size={14} />
              Save
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
              text-slate-400 border border-slate-700 hover:bg-slate-800">
            <Edit3 size={14} />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        /* Edit form */
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Identity</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { key: 'name',     label: 'Name',     type: 'text' },
                { key: 'handle',   label: 'Handle',   type: 'text' },
                { key: 'country',  label: 'Country',  type: 'text' },
                { key: 'timezone', label: 'Timezone', type: 'text' },
                { key: 'region',   label: 'Region',   type: 'text' },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor={`pf-${f.key}`}>{f.label}</label>
                  <input id={`pf-${f.key}`} type={f.type} value={String(draft[f.key])}
                    onChange={e => set(f.key, e.target.value as never)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                      focus:outline-none focus:border-sky-500/50" />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Storage Capacity</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { key: 'offeredStorageGB',    label: 'Offered (GB)' },
                { key: 'requestedStorageGB',  label: 'Requested (GB)' },
                { key: 'uploadSpeedMbps',     label: 'Upload (Mbps)' },
                { key: 'downloadSpeedMbps',   label: 'Download (Mbps)' },
                { key: 'monthlyBandwidthCapGB', label: 'Bandwidth cap (GB, 0=unlimited)' },
                { key: 'expectedUptimePercent', label: 'Expected uptime (%)' },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor={`pf-${f.key}`}>{f.label}</label>
                  <input id={`pf-${f.key}`} type="number" value={draft[f.key] as number}
                    onChange={e => set(f.key, Number(e.target.value) as never)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm
                      font-mono text-slate-200 focus:outline-none focus:border-sky-500/50" />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Hardware</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { key: 'nasServerType', label: 'NAS / Server Type' },
                { key: 'filesystem',    label: 'Filesystem' },
                { key: 'backupEngine',  label: 'Backup Engine' },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor={`pf-${f.key}`}>{f.label}</label>
                  <input id={`pf-${f.key}`} type="text" value={String(draft[f.key])}
                    onChange={e => set(f.key, e.target.value as never)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200
                      focus:outline-none focus:border-sky-500/50" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="pf-ups">UPS / Power Backup</label>
                <select id="pf-ups" value={draft.hasPowerBackup ? 'yes' : 'no'}
                  onChange={e => set('hasPowerBackup', e.target.value === 'yes')}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 focus:outline-none">
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="pf-multi">Willing to host multiple peers</label>
                <select id="pf-multi" value={draft.willingToHostMultiple ? 'yes' : 'no'}
                  onChange={e => set('willingToHostMultiple', e.target.value === 'yes')}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 focus:outline-none">
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* View mode */
        <div className="space-y-4">
          <Section title="Identity & Location" icon={<Globe size={14} />}>
            <FieldRow label="Country"  value={u.country} />
            <FieldRow label="Region"   value={u.region} />
            <FieldRow label="Timezone" value={u.timezone} />
            <FieldRow label="Member since" value={new Date(u.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} />
          </Section>

          <Section title="Storage Profile" icon={<HardDrive size={14} />}>
            <FieldRow label="Offered storage"          value={formatStorageGB(u.offeredStorageGB)} mono />
            <FieldRow label="Requested storage"        value={formatStorageGB(u.requestedStorageGB)} mono />
            <FieldRow label="Upload speed"             value={`${u.uploadSpeedMbps} Mbps`} mono />
            <FieldRow label="Download speed"           value={`${u.downloadSpeedMbps} Mbps`} mono />
            <FieldRow
              label="Monthly bandwidth cap"
              value={u.monthlyBandwidthCapGB === 0 ? 'Unlimited' : formatStorageGB(u.monthlyBandwidthCapGB) + '/mo'}
              mono
            />
            <FieldRow label="Expected uptime"          value={`${u.expectedUptimePercent}%`} mono />
          </Section>

          <Section title="Hardware" icon={<Zap size={14} />}>
            <FieldRow label="NAS / Server type" value={u.nasServerType} />
            <FieldRow label="Filesystem"        value={u.filesystem} mono />
            <FieldRow label="Backup engine"     value={u.backupEngine} />
            <FieldRow label="UPS / power backup" value={u.hasPowerBackup} />
            <FieldRow label="Willing to host multiple peers" value={u.willingToHostMultiple} />
          </Section>

          <Section title="Reputation" icon={<Shield size={14} />}>
            <FieldRow label="Reputation score"  value={`${u.reputation}/100`} mono />
          </Section>
        </div>
      )}

      {/* Privacy notice */}
      <div className="flex items-start gap-2.5 p-3 bg-slate-900 border border-slate-800 rounded-lg">
        <Lock size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            <strong className="text-slate-300">Privacy.</strong> This platform collects only operational
            metadata — storage sizes, uptime, speed. It never collects backup passwords,
            encryption keys, file names, or file contents.
          </p>
          <p>
            <strong className="text-slate-300">Your responsibility.</strong> Keep your backup recovery
            password/key in a safe location outside this platform. Lost passwords cannot be recovered.
          </p>
        </div>
      </div>

      {/* Match-scoring tags */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          How Your Profile Affects Match Scores
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { icon: <HardDrive size={12} />, label: 'Storage Fit (25%)',       value: formatStorageGB(u.offeredStorageGB) },
            { icon: <Zap size={12} />,       label: 'Upload Speed (20%)',      value: `${u.uploadSpeedMbps} Mbps` },
            { icon: <CheckCircle size={12} />, label: 'Uptime (20%)',          value: `${u.expectedUptimePercent}%` },
            { icon: <Shield size={12} />,    label: 'Reputation (15%)',        value: `${u.reputation}/100` },
            { icon: <Globe size={12} />,     label: 'Region Distance (10%)',   value: u.region },
            { icon: <Users size={12} />,     label: 'Reciprocal Fair. (10%)',  value: 'Balanced pacts' },
          ].map(item => (
            <div key={item.label} className="flex items-start gap-2 p-2.5 bg-slate-800/50 rounded-lg">
              <span className="text-slate-500 flex-shrink-0 mt-0.5">{item.icon}</span>
              <div>
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="text-xs font-mono text-slate-300 mt-0.5">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key safety */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-400/20 bg-amber-400/5">
        <Power size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          <strong>Backup recovery key/password:</strong> Store it in a password manager or printed copy outside your NAS. If you lose it, your data cannot be recovered — not by the platform, not by your peer. This is a feature, not a bug. Client-side encryption means only you hold the keys.
        </p>
      </div>
    </div>
  );
}
