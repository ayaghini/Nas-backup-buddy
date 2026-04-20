// TypeScript types mirroring the nasbb-core Rust types.
// Serde serializes Rust enums as snake_case strings by default.

export type UserRole = 'data_owner' | 'storage_host' | 'reciprocal_match';
export type BackupEngine = 'kopia' | 'restic_future';
export type ToolStatus = 'missing' | 'present' | 'version_mismatch' | 'checksum_mismatch' | 'ready';
export type KopiaRepositoryStatus = 'not_configured' | 'configured' | 'initialized' | 'check_passed' | 'check_failed';
export type SyncthingState = 'not_configured' | 'device_configured' | 'folder_configured' | 'syncing' | 'in_sync' | 'stale' | 'error';
export type SetupReadiness = 'blocked' | 'warning' | 'ready_for_test_backup' | 'ready_for_restore_drill' | 'protected_eligible';
export type HealthLevel = 'ok' | 'warning' | 'critical';

export interface KopiaRepositoryState {
  status: KopiaRepositoryStatus;
  snapshot_count: number | null;
  last_snapshot_at: string | null;
  repo_size_bytes: number | null;
}

export interface SyncthingFolderStatus {
  state: SyncthingState;
  peer_device_id: string | null;
  peer_connected: boolean;
  last_sync_at: string | null;
  bytes_pending: number | null;
}

export interface ClientSetupState {
  role: UserRole;
  engine: BackupEngine;
  kopia_tool_status: ToolStatus;
  syncthing_tool_status: ToolStatus;
  kopia_repository: KopiaRepositoryState;
  syncthing_folder: SyncthingFolderStatus;
  recovery_key_confirmed: boolean;
  health_report_consent: boolean;
  offline_mode: boolean;
}

export interface IntegrationCheckResult {
  readiness: SetupReadiness;
  blocking_reasons: string[];
  warning_reasons: string[];
}

export interface CommandPlanSummary {
  label: string;
  display_command: string;
}

export interface SyncthingApiPlanSummary {
  method: string;
  display_command: string;
  body_summary: string;
}

export interface MockBackupResult {
  success: boolean;
  snapshot_id: string;
  files_changed: number;
  size_bytes: number;
  duration_ms: number;
  log_line: string;
}

export interface MockCheckResult {
  passed: boolean;
  message: string;
  log_line: string;
}

export interface MockDrillResult {
  result: 'pass' | 'canary_mismatch' | 'fail';
  health_level: HealthLevel;
  expected_checksum: string;
  observed_checksum: string;
  match_result: boolean;
  log_line: string;
  audit_evidence: string[];
}

export interface HealthReport {
  last_backup_age_hours: number;
  last_sync_age_hours: number;
  free_quota_percent: number;
  restore_drill_age_days: number;
  peer_offline_hours: number;
  repository_check_ok: boolean;
  repository_check_message: string | null;
}

// Partial config for the setup wizard — values are filled in progressively.
export interface SetupDraftConfig {
  role: UserRole;
  source_folders: string[];
  repository_path: string;
  hosted_storage_path: string;
  hosted_quota_gb: number;
  retention_keep_last: number;
  retention_keep_daily: number;
  retention_keep_weekly: number;
  retention_keep_monthly: number;
  health_report_consent: boolean;
  pairing_token_ref: string | null;
  web_api_url: string | null;
}
