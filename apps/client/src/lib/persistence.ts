// Persistent app configuration.
//
// Backed by direct Rust file I/O (save_app_config / load_app_config commands)
// writing JSON to the platform app-data directory:
//   macOS:   ~/Library/Application Support/dev.nasbb.client/app-config.json
//   Windows: %APPDATA%\dev.nasbb.client\app-config.json
//   Linux:   ~/.local/share/dev.nasbb.client/app-config.json
//
// Only non-secret data is stored here. Passwords stay in the OS keychain.

import type { BackupTarget, HostAllocation, OwnerSshKey, OverlayMeta, SavedPeer, SetupDraftConfig } from './types';

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown; }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export interface SftpBundleFields {
  overlayHost: string;
  sftpUser: string;
  sftpPort: string;
  sftpPath: string;
  overlayProvider: string;
  quotaGb: number;
  matchId: string;
  hostKeyFingerprintNote: string;
  compatibilityNote: string;
}

export interface PersistedConfig {
  wizardConfigs: SetupDraftConfig[];
  recoveryKeyConfirmed: boolean;
  healthReportConsent: boolean;
  offlineMode: boolean;
  /** True after the user has successfully applied a Syncthing configuration. */
  syncthingConfigured: boolean;
  /** Non-secret connection fields imported from the last Owner Connection Bundle. */
  sftpBundleFields?: SftpBundleFields;
  /** Non-secret overlay network metadata (provider, addresses, port, last status). */
  overlayMeta?: OverlayMeta;
  /** One hosted storage allocation per peer this device stores data for. */
  hostAllocations?: HostAllocation[];
  /** One backup target per peer this device backs up to. */
  backupTargets?: BackupTarget[];
  /** Non-secret owner-side SSH key refs/public keys, one per match. */
  ownerSshKeys?: OwnerSshKey[];
  /** All peer match connections this device has as a data owner. */
  savedPeers?: SavedPeer[];
}

export async function loadPersistedConfig(): Promise<Partial<PersistedConfig>> {
  if (!isTauri()) return {};
  try {
    const raw = await invoke<Record<string, unknown>>('load_app_config');
    return {
      wizardConfigs: Array.isArray(raw.wizardConfigs) ? (raw.wizardConfigs as SetupDraftConfig[]) : [],
      recoveryKeyConfirmed: typeof raw.recoveryKeyConfirmed === 'boolean' ? raw.recoveryKeyConfirmed : false,
      healthReportConsent: typeof raw.healthReportConsent === 'boolean' ? raw.healthReportConsent : false,
      offlineMode: typeof raw.offlineMode === 'boolean' ? raw.offlineMode : false,
      syncthingConfigured: typeof raw.syncthingConfigured === 'boolean' ? raw.syncthingConfigured : false,
      sftpBundleFields: typeof raw.sftpBundleFields === 'object' && raw.sftpBundleFields !== null
        ? raw.sftpBundleFields as SftpBundleFields
        : undefined,
      overlayMeta: typeof raw.overlayMeta === 'object' && raw.overlayMeta !== null
        ? raw.overlayMeta as OverlayMeta
        : undefined,
      hostAllocations: Array.isArray(raw.hostAllocations) ? raw.hostAllocations as HostAllocation[] : [],
      backupTargets: Array.isArray(raw.backupTargets) ? raw.backupTargets as BackupTarget[] : [],
      ownerSshKeys: Array.isArray(raw.ownerSshKeys) ? raw.ownerSshKeys as OwnerSshKey[] : [],
      savedPeers: Array.isArray(raw.savedPeers) ? raw.savedPeers as SavedPeer[] : [],
    };
  } catch (e) {
    console.error('[persistence] load failed:', e);
    return {};
  }
}

export async function savePersistedConfig(config: Partial<PersistedConfig>): Promise<void> {
  if (!isTauri()) return;
  try {
    // Load the existing config first so we only overwrite the keys we have
    const existing = await invoke<Record<string, unknown>>('load_app_config');
    const merged = { ...existing, ...config };
    await invoke<void>('save_app_config', { config: merged });
  } catch (e) {
    console.error('[persistence] save failed:', e);
    throw e; // Re-throw so callers can detect failure
  }
}
