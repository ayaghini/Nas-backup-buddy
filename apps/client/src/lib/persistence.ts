// Persistent app configuration backed by tauri-plugin-store.
//
// The store file lives in the platform app-data directory:
//   macOS:   ~/Library/Application Support/nasbb-backup-buddy/app-config.json
//   Windows: %APPDATA%\nasbb-backup-buddy\app-config.json
//   Linux:   ~/.local/share/nasbb-backup-buddy/app-config.json
//
// Only non-secret configuration is persisted here.
// Passwords are stored in the OS keychain (see RecoveryKey.tsx).

import type { SetupDraftConfig } from './types';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

const STORE_FILE = 'app-config.json';

// Keys stored in the persisted config
const KEY_WIZARD_CONFIGS = 'wizardConfigs';
const KEY_RECOVERY_KEY_CONFIRMED = 'recoveryKeyConfirmed';
const KEY_HEALTH_REPORT_CONSENT = 'healthReportConsent';
const KEY_OFFLINE_MODE = 'offlineMode';

export interface PersistedConfig {
  wizardConfigs: SetupDraftConfig[];
  recoveryKeyConfirmed: boolean;
  healthReportConsent: boolean;
  offlineMode: boolean;
}

async function getStore() {
  const { Store } = await import('@tauri-apps/plugin-store');
  return Store.load(STORE_FILE);
}

export async function loadPersistedConfig(): Promise<Partial<PersistedConfig>> {
  if (!isTauri()) return {};
  try {
    const store = await getStore();
    const wizardConfigs = await store.get<SetupDraftConfig[]>(KEY_WIZARD_CONFIGS);
    const recoveryKeyConfirmed = await store.get<boolean>(KEY_RECOVERY_KEY_CONFIRMED);
    const healthReportConsent = await store.get<boolean>(KEY_HEALTH_REPORT_CONSENT);
    const offlineMode = await store.get<boolean>(KEY_OFFLINE_MODE);
    return {
      wizardConfigs: wizardConfigs ?? [],
      recoveryKeyConfirmed: recoveryKeyConfirmed ?? false,
      healthReportConsent: healthReportConsent ?? false,
      offlineMode: offlineMode ?? false,
    };
  } catch (e) {
    console.warn('[persistence] load failed:', e);
    return {};
  }
}

export async function savePersistedConfig(config: Partial<PersistedConfig>): Promise<void> {
  if (!isTauri()) return;
  try {
    const store = await getStore();
    if (config.wizardConfigs !== undefined)
      await store.set(KEY_WIZARD_CONFIGS, config.wizardConfigs);
    if (config.recoveryKeyConfirmed !== undefined)
      await store.set(KEY_RECOVERY_KEY_CONFIRMED, config.recoveryKeyConfirmed);
    if (config.healthReportConsent !== undefined)
      await store.set(KEY_HEALTH_REPORT_CONSENT, config.healthReportConsent);
    if (config.offlineMode !== undefined)
      await store.set(KEY_OFFLINE_MODE, config.offlineMode);
    await store.save();
  } catch (e) {
    console.warn('[persistence] save failed:', e);
  }
}
