import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  clearMasterPassword,
  hasPasswordInKeychain,
  loadMasterPasswordFromKeychain,
  setKopiaPassword,
  verifyCurrentPassword,
} from '../lib/tauri-bridge';

// ── Small helpers ─────────────────────────────────────────────────────────────

function PasswordInput({
  value,
  onChange,
  onEnter,
  placeholder,
  autoComplete,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  autoComplete?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder}
        autoComplete={autoComplete ?? 'current-password'}
        className={`flex-1 bg-slate-800 border rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 ${
          invalid ? 'border-red-500/60' : 'border-slate-700'
        }`}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="px-2 text-slate-500 hover:text-slate-300"
        title={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// ── Set password form (first-time setup) ──────────────────────────────────────

function SetPasswordForm({ onDone }: { onDone: () => void }) {
  const { setMasterPasswordSet } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weak = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSave = password.length >= 8 && password === confirm && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await setKopiaPassword(password);
      setMasterPasswordSet(true);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Choose a strong password now. Kopia uses it to derive the encryption key for every repository —
        it is stored in the OS keychain so you only need to enter it once.
      </p>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">Master password</label>
        <PasswordInput
          value={password}
          onChange={v => { setPassword(v); setError(null); }}
          onEnter={handleSave}
          placeholder="Choose a strong password (min 8 chars)"
          autoComplete="new-password"
          invalid={weak}
        />
        {weak && <p className="text-xs text-amber-400/80 mt-1">Use at least 8 characters.</p>}
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">Confirm password</label>
        <PasswordInput
          value={confirm}
          onChange={v => { setConfirm(v); setError(null); }}
          onEnter={handleSave}
          placeholder="Re-enter password"
          autoComplete="new-password"
          invalid={mismatch}
        />
        {mismatch && <p className="text-xs text-red-400/80 mt-1">Passwords do not match.</p>}
        {!mismatch && password.length >= 8 && confirm.length > 0 && (
          <p className="text-xs text-emerald-400/80 mt-1 flex items-center gap-1">
            <CheckCircle size={11} /> Passwords match.
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handleSave}
        disabled={!canSave}
        className="w-full py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
      >
        {saving ? 'Saving to keychain…' : 'Set master password'}
      </button>

      <div className="flex items-start gap-2 p-2.5 rounded border border-slate-700 bg-slate-800/30 text-xs text-slate-500">
        <Lock size={11} className="flex-shrink-0 mt-0.5 text-sky-400/60" />
        Stored in the OS keychain — macOS Keychain, Windows Credential Manager, or Linux Secret Service.
        Never written to disk in plaintext, never sent anywhere.
      </div>
    </div>
  );
}

// ── Change password form ──────────────────────────────────────────────────────

function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { setMasterPasswordSet } = useApp();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [oldWrong, setOldWrong] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weak = newPw.length > 0 && newPw.length < 8;
  const mismatch = confirm.length > 0 && newPw !== confirm;
  const canSave = oldPw.length > 0 && newPw.length >= 8 && newPw === confirm && !saving;

  async function handleChange() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setOldWrong(false);

    try {
      const verified = await verifyCurrentPassword(oldPw);
      if (!verified) {
        setOldWrong(true);
        setSaving(false);
        return;
      }
      await setKopiaPassword(newPw);
      setMasterPasswordSet(true);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Kopia re-encryption warning */}
      <div className="flex items-start gap-2.5 p-3 rounded border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-300/80 space-y-1 leading-relaxed">
          <p><strong>Changing the session password does NOT automatically re-encrypt your Kopia repositories.</strong></p>
          <p>
            After saving the new password here, you must run <code className="font-mono bg-slate-800 px-1 rounded">kopia repository change-password</code> for
            each repository, or Kopia will reject the new password when the next backup runs.
          </p>
          <p className="text-amber-400/60">
            Backups created before the password change remain accessible only after the repository
            password is also changed via the Kopia command. This is why we recommend keeping the same
            password for the lifetime of a repository.
          </p>
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">Current password</label>
        <PasswordInput
          value={oldPw}
          onChange={v => { setOldPw(v); setOldWrong(false); setError(null); }}
          placeholder="Enter current password to verify"
          invalid={oldWrong}
        />
        {oldWrong && <p className="text-xs text-red-400/80 mt-1">Incorrect current password.</p>}
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">New password</label>
        <PasswordInput
          value={newPw}
          onChange={v => { setNewPw(v); setError(null); }}
          placeholder="New password (min 8 chars)"
          autoComplete="new-password"
          invalid={weak}
        />
        {weak && <p className="text-xs text-amber-400/80 mt-1">Use at least 8 characters.</p>}
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">Confirm new password</label>
        <PasswordInput
          value={confirm}
          onChange={v => { setConfirm(v); setError(null); }}
          onEnter={handleChange}
          placeholder="Re-enter new password"
          autoComplete="new-password"
          invalid={mismatch}
        />
        {mismatch && <p className="text-xs text-red-400/80 mt-1">Passwords do not match.</p>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleChange}
          disabled={!canSave}
          className="flex-1 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
        >
          {saving ? 'Saving…' : 'Change password'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-slate-400 hover:text-slate-200 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function RecoveryKey() {
  const { recoveryKeyConfirmed, setRecoveryKeyConfirmed, setMasterPasswordSet, masterPasswordSet } = useApp();

  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'revoke'>('idle');
  const [keychainPresent, setKeychainPresent] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [checkingKeychain, setCheckingKeychain] = useState(true);
  const [revokeConfirm, setRevokeConfirm] = useState('');
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        // Try auto-loading from keychain — if found, marks masterPasswordSet in context
        const loaded = await loadMasterPasswordFromKeychain();
        if (loaded) {
          setMasterPasswordSet(true);
          setAutoLoaded(true);
        }
        const inKeychain = await hasPasswordInKeychain();
        setKeychainPresent(inKeychain);
      } finally {
        setCheckingKeychain(false);
      }
    }
    void init();
  }, [setMasterPasswordSet]);

  async function handleRevoke() {
    if (revokeConfirm.toLowerCase() !== 'revoke') return;
    try {
      await clearMasterPassword();
      setMasterPasswordSet(false);
      setKeychainPresent(false);
      setAutoLoaded(false);
      setMode('idle');
      setRevokeConfirm('');
    } catch (e: unknown) {
      setRevokeError(e instanceof Error ? e.message : String(e));
    }
  }

  const allDone = masterPasswordSet && recoveryKeyConfirmed;

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-sky-400" />
        <h1 className="text-base font-semibold text-slate-100">Master Encryption Password</h1>
      </div>

      {/* Status banner */}
      <div className={`flex items-start gap-3 p-3 rounded-lg border ${
        allDone
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/30 bg-amber-500/5'
      }`}>
        {allDone
          ? <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <ShieldAlert size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />}
        <div>
          <div className={`text-sm font-medium ${allDone ? 'text-emerald-300' : 'text-amber-300'}`}>
            {allDone
              ? 'Master password confirmed — all backup operations unlocked.'
              : masterPasswordSet
                ? 'Password set — confirm external backup below to complete setup.'
                : 'Master password not set — backups cannot run until this is done.'}
          </div>
          <div className="text-xs mt-0.5 text-slate-400">
            {masterPasswordSet
              ? autoLoaded
                ? 'Loaded automatically from OS keychain — no action needed.'
                : 'Held in process memory and OS keychain for this and future sessions.'
              : 'Set it once. Kopia uses it for all repositories. It will be remembered in the OS keychain.'}
          </div>
        </div>
      </div>

      {/* ── Keychain status ─────────────────────────────────────────────── */}
      {!checkingKeychain && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">OS Keychain</h3>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${keychainPresent ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${keychainPresent ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {keychainPresent ? 'Stored' : 'Not stored'}
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-0.5">
            <p>macOS: <strong className="text-slate-400">Keychain</strong> · Windows: <strong className="text-slate-400">Credential Manager</strong> · Linux: <strong className="text-slate-400">Secret Service</strong></p>
            <p>The password is stored under service <code className="text-slate-400 font-mono">nasbb.backup-buddy</code> and auto-loaded on app start.</p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            {!masterPasswordSet && mode !== 'set' && (
              <button
                onClick={() => setMode('set')}
                className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white text-xs rounded transition-colors"
              >
                Set master password
              </button>
            )}
            {masterPasswordSet && mode !== 'change' && mode !== 'revoke' && (
              <button
                onClick={() => setMode('change')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
              >
                Change password
              </button>
            )}
            {keychainPresent && mode !== 'revoke' && mode !== 'change' && (
              <button
                onClick={() => setMode('revoke')}
                className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 text-xs rounded transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={11} /> Revoke from keychain
              </button>
            )}
          </div>

          {/* Forms */}
          {mode === 'set' && (
            <div className="pt-1 border-t border-slate-800">
              <SetPasswordForm onDone={() => { setMode('idle'); setKeychainPresent(true); }} />
            </div>
          )}
          {mode === 'change' && (
            <div className="pt-1 border-t border-slate-800">
              <ChangePasswordForm
                onDone={() => { setMode('idle'); setKeychainPresent(true); }}
                onCancel={() => setMode('idle')}
              />
            </div>
          )}
          {mode === 'revoke' && (
            <div className="pt-1 border-t border-slate-800 space-y-3">
              <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">This removes the password from the OS keychain.</div>
                  <div className="text-red-300/70 mt-0.5">You will need to re-enter it on the next app start. This does NOT delete your backups or change the Kopia repository password.</div>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Type <strong>revoke</strong> to confirm</label>
                <input
                  value={revokeConfirm}
                  onChange={e => { setRevokeConfirm(e.target.value); setRevokeError(null); }}
                  placeholder="revoke"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-red-500"
                />
              </div>
              {revokeError && <p className="text-xs text-red-400">{revokeError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleRevoke}
                  disabled={revokeConfirm.toLowerCase() !== 'revoke'}
                  className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                >
                  Revoke
                </button>
                <button onClick={() => { setMode('idle'); setRevokeConfirm(''); }} className="px-4 py-1.5 text-slate-400 hover:text-slate-200 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm external save ────────────────────────────────────────── */}
      <div className={`bg-slate-900 border rounded-lg p-4 space-y-4 ${
        recoveryKeyConfirmed ? 'border-emerald-800/40' : 'border-slate-800'
      } ${!masterPasswordSet ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            recoveryKeyConfirmed ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'
          }`}>
            {recoveryKeyConfirmed ? '✓' : '2'}
          </div>
          <h3 className="text-sm font-medium text-slate-200">Confirm you've saved the password externally</h3>
        </div>

        {!masterPasswordSet && <p className="text-xs text-slate-500">Set the master password above first.</p>}

        {masterPasswordSet && (
          <>
            <div className="bg-slate-800/40 border border-slate-700/60 rounded p-3 space-y-2 text-xs">
              <div className="font-medium text-slate-300 mb-2">Also save your password outside this device:</div>
              {[
                { icon: '🔑', label: 'Password manager', desc: '1Password, Bitwarden, LastPass, Apple Keychain — safest option.' },
                { icon: '📄', label: 'Printed paper copy', desc: 'Written down in a locked drawer or safe, away from this device.' },
                { icon: '🔒', label: 'Encrypted USB drive', desc: 'A separate encrypted drive stored off-site.' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2 text-slate-400">
                  <span className="flex-shrink-0">{icon}</span>
                  <span><strong className="text-slate-300">{label}</strong> — {desc}</span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-400/80">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              <span><strong>Do not</strong> rely only on the OS keychain. If this device is lost or wiped, the keychain is gone too — you need an off-device copy.</span>
            </div>

            <button
              type="button"
              onClick={() => setRecoveryKeyConfirmed(!recoveryKeyConfirmed)}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                recoveryKeyConfirmed
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                recoveryKeyConfirmed ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'
              }`}>
                {recoveryKeyConfirmed && <CheckCircle size={10} className="text-white" />}
              </div>
              <span className={`text-sm leading-snug ${recoveryKeyConfirmed ? 'text-emerald-300' : 'text-slate-400'}`}>
                I have saved this password in a password manager or other secure location outside this device.
              </span>
            </button>
          </>
        )}
      </div>

      {/* ── Why this matters ─────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">How encryption works</h3>
        <div className="space-y-1.5 text-xs text-slate-400 leading-relaxed">
          {[
            'Kopia derives an internal master key from your password using a KDF. This master key encrypts every snapshot.',
            'The password is stored in the OS keychain and loaded automatically on app start — no need to re-enter each session.',
            'If you must change the password, run kopia repository change-password for every repository after saving the new password here.',
            'Backups created before a password change remain encrypted under the old master key. After change-password, the old password will no longer work.',
            'Losing the password and the OS keychain entry means the encrypted repository cannot be recovered — not even by us.',
          ].map((line, i) => (
            <div key={i} className="flex items-start gap-2">
              <Info size={10} className="text-sky-400/50 flex-shrink-0 mt-0.5" />
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
