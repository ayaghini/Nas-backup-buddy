// Default mock state for browser preview and offline mode.
// This data is safe to display — no secrets, no raw source paths.

import type { ClientSetupState, HealthReport } from './types';

// Honest initial state: nothing is configured or run yet.
// Tool status starts missing and is updated on mount by real detection.
export const DEFAULT_SETUP_STATE: ClientSetupState = {
  role: 'data_owner',
  engine: 'kopia',
  kopia_tool_status: 'missing',
  syncthing_tool_status: 'missing',
  kopia_repository: {
    status: 'not_configured',
    snapshot_count: null,
    last_snapshot_at: null,
    repo_size_bytes: null,
  },
  syncthing_folder: {
    state: 'not_configured',
    peer_device_id: null,
    peer_connected: false,
    last_sync_at: null,
    bytes_pending: null,
  },
  recovery_key_confirmed: false,
  health_report_consent: false,
  offline_mode: false,
};

// Honest initial health: nothing has run yet, peers not configured.
// Negative values for sync/peer fields mean "not configured" — the health
// thresholds treat these as Ok rather than Critical so a fresh install
// doesn't immediately show an alarming health state.
// Values update to real data after each operation via refreshRealHealth().
export const DEFAULT_HEALTH_REPORT: HealthReport = {
  last_backup_age_hours: 999.0,   // no backup yet → Critical (intentional, prompts action)
  last_sync_age_hours: -1.0,      // Syncthing not configured → Ok
  free_quota_percent: 100.0,
  restore_drill_age_days: -1,     // never run → Critical (intentional, prompts action)
  peer_offline_hours: -1.0,       // no peer configured → Ok
  repository_check_ok: false,
  repository_check_message: null,
};

// Start with no log lines — real lines accumulate as operations run.
export const SAMPLE_LOG_LINES: Array<{ raw: string; redacted: string }> = [];

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function readinessLabel(r: string): string {
  switch (r) {
    case 'blocked': return 'Blocked';
    case 'warning': return 'Warning';
    case 'ready_for_test_backup': return 'Ready for test backup';
    case 'ready_for_restore_drill': return 'Ready for restore drill';
    case 'protected_eligible': return 'Protected eligible';
    default: return r;
  }
}

export function roleLabel(r: string): string {
  switch (r) {
    case 'data_owner': return 'Data Owner';
    case 'storage_host': return 'Storage Host';
    case 'reciprocal_match': return 'Reciprocal Match';
    default: return r;
  }
}

export function toolStatusLabel(s: string): string {
  switch (s) {
    case 'missing': return 'Missing';
    case 'present': return 'Present';
    case 'version_mismatch': return 'Version mismatch';
    case 'checksum_mismatch': return 'Checksum mismatch';
    case 'ready': return 'Ready';
    default: return s;
  }
}

export function syncthingStateLabel(s: string): string {
  switch (s) {
    case 'not_configured': return 'Not configured';
    case 'device_configured': return 'Device configured';
    case 'folder_configured': return 'Folder configured';
    case 'syncing': return 'Syncing';
    case 'in_sync': return 'In sync';
    case 'stale': return 'Stale';
    case 'error': return 'Error';
    default: return s;
  }
}

export function kopiaStatusLabel(s: string): string {
  switch (s) {
    case 'not_configured': return 'Not configured';
    case 'configured': return 'Configured';
    case 'initialized': return 'Initialized';
    case 'check_passed': return 'Check passed';
    case 'check_failed': return 'Check failed';
    default: return s;
  }
}
