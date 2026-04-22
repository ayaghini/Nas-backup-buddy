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

// ── Real integration types ────────────────────────────────────────────────────

export type ToolLocation = 'bundled' | 'system_path' | 'configured' | 'not_found';

export interface ToolVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

export interface ToolProbeResult {
  name: 'Kopia' | 'Syncthing';
  location: ToolLocation;
  version: ToolVersion | null;
  status: ToolStatus;
  error_message: string | null;
}

export interface TestLabInfo {
  root_label: string;
  is_fresh: boolean;
  canary_sha256: string;
  sample_file_count: number;
}

export interface CanaryVerifyResult {
  expected_sha256: string;
  observed_sha256: string;
  matches: boolean;
}

export interface RealBackupResult {
  success: boolean;
  snapshot_id: string;
  source_label: string;
  timestamp: string;
  log_line: string;
}

export interface RealCheckResult {
  passed: boolean;
  message: string;
  duration_ms: number;
  log_line: string;
}

export interface RealDrillResult {
  result: 'pass' | 'canary_mismatch' | 'fail';
  health_level: HealthLevel;
  canary_verify: CanaryVerifyResult | null;
  restore_duration_ms: number;
  log_line: string;
  audit_evidence: string[];
}

export interface RepositoryInitResult {
  initialized: boolean;
  already_existed: boolean;
  message: string;
}

export interface SyncthingFolderResult {
  added: boolean;
  folder_id: string;
  web_ui_url: string;
  note: string;
}

export interface SyncthingRunStatus {
  binary_present: boolean;
  binary_version: string | null;
  is_running: boolean;
  api_port: number;
  web_ui_url: string;
  setup_guidance: string;
}

export interface TransportFolderInfo {
  folder_id: string;
  folder_type: string;
  is_safety_validated: boolean;
  config_snippet: string;
  note: string;
}

// ── Syncthing live status (polled from REST API) ──────────────────────────────

export interface SyncthingFolderLiveStatus {
  folder_id: string;
  label: string;
  raw_state: string;
  state: SyncthingState;
  bytes_pending: number;
  files_pending: number;
  peer_device_ids: string[];
}

export interface SyncthingLiveStatus {
  running: boolean;
  my_device_id: string | null;
  folders: SyncthingFolderLiveStatus[];
  connected_peer_ids: string[];
  web_ui_url: string;
}

// ── Per-repo backup job status ────────────────────────────────────────────────

export type JobState = 'idle' | 'running' | 'done' | 'error';

export interface RepoJobStatus {
  init_state: JobState;
  backup_state: JobState;
  last_snapshot_at: string | null;
  snapshot_count: number;
  error: string | null;
}

// ── Syncthing peer setup types ────────────────────────────────────────────────

export interface SyncPeer {
  id: string;
  name: string;
  device_id: string;
}

export interface SyncFolderConfig {
  /** Stable ID passed to Syncthing as the folder ID */
  folder_id: string;
  label: string;
  path: string;
  /** 'kopia' = managed by Kopia (encrypted repo); 'manual' = raw path added by user */
  source: 'kopia' | 'manual';
  selected: boolean;
}

/** How this app shares a folder with a specific peer. */
export type PeerSyncMode = 'off' | 'sync' | 'encrypted';

export interface FolderPeerAssignment {
  folder_id: string;
  peer_id: string;
  mode: PeerSyncMode;
  /** Required when mode === 'encrypted'. Never logged or sent to web app. */
  encryption_password: string;
}

// ── Partial config for the setup wizard — values are filled in progressively.
export interface SetupDraftConfig {
  /** Human-readable name the user gives this backup job, e.g. "Home documents". */
  label: string;
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
