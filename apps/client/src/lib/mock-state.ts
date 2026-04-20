// Default mock state for browser preview and offline mode.
// This data is safe to display — no secrets, no raw source paths.

import type { ClientSetupState, HealthReport } from './types';

export const DEFAULT_SETUP_STATE: ClientSetupState = {
  role: 'data_owner',
  engine: 'kopia',
  // Start as missing — updated on mount by real detection via get_tool_status
  kopia_tool_status: 'missing',
  syncthing_tool_status: 'missing',
  kopia_repository: {
    status: 'check_passed',
    snapshot_count: 3,
    last_snapshot_at: '2026-04-19T10:00:00Z',
    repo_size_bytes: 1_258_291_200,
  },
  syncthing_folder: {
    state: 'in_sync',
    peer_device_id: 'MOCK77-DEVICE-ID',
    peer_connected: true,
    last_sync_at: '2026-04-19T11:00:00Z',
    bytes_pending: 0,
  },
  recovery_key_confirmed: false,
  health_report_consent: false,
  offline_mode: true,
};

export const DEFAULT_HEALTH_REPORT: HealthReport = {
  last_backup_age_hours: 2.0,
  last_sync_age_hours: 1.0,
  free_quota_percent: 65.0,
  restore_drill_age_days: -1,
  peer_offline_hours: 0.0,
  repository_check_ok: true,
  repository_check_message: null,
};

export const SAMPLE_LOG_LINES: Array<{ raw: string; redacted: string }> = [
  {
    raw: 'kopia snapshot create /home/alice/documents',
    redacted: 'kopia snapshot create [REDACTED]',
  },
  {
    raw: '2026-04-19T10:00:01Z [INFO]  kopia snapshot started',
    redacted: '2026-04-19T10:00:01Z [INFO]  kopia snapshot started',
  },
  {
    raw: '2026-04-19T10:00:03Z [INFO]  scanning source directory: /home/alice/documents',
    redacted: '2026-04-19T10:00:03Z [INFO]  scanning source directory: [REDACTED]',
  },
  {
    raw: '2026-04-19T10:00:15Z [INFO]  uploading 42 new content blocks',
    redacted: '2026-04-19T10:00:15Z [INFO]  uploading 42 new content blocks',
  },
  {
    raw: '2026-04-19T10:00:28Z [INFO]  snapshot complete: 1.2 GB, duration=27s',
    redacted: '2026-04-19T10:00:28Z [INFO]  snapshot complete: 1.2 GB, duration=27s',
  },
  {
    raw: '2026-04-19T10:00:29Z [INFO]  connecting with password=hunter2 to repository',
    redacted: '2026-04-19T10:00:29Z [INFO]  connecting with password=[REDACTED] to repository',
  },
  {
    raw: '2026-04-19T10:01:00Z [INFO]  syncthing: repository folder in sync',
    redacted: '2026-04-19T10:01:00Z [INFO]  syncthing: repository folder in sync',
  },
  {
    raw: '2026-04-19T10:01:01Z [INFO]  health report emitted: last_backup_age_hours=0.0 free_quota_percent=65.0',
    redacted: '2026-04-19T10:01:01Z [INFO]  health report emitted: last_backup_age_hours=0.0 free_quota_percent=65.0',
  },
];

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
