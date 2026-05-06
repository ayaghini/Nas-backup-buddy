// TypeScript types mirroring the nasbb-core Rust types.
// Serde serializes Rust enums as snake_case strings by default.

export type UserRole = 'data_owner' | 'storage_host' | 'reciprocal_match';
export type BackupEngine = 'kopia' | 'restic_future';
export type ToolStatus = 'missing' | 'present' | 'version_mismatch' | 'checksum_mismatch' | 'ready';
export type KopiaRepositoryStatus = 'not_configured' | 'configured' | 'initialized' | 'check_passed' | 'check_failed';
export type SyncthingState = 'not_configured' | 'device_configured' | 'folder_configured' | 'syncing' | 'in_sync' | 'stale' | 'error';
export type SetupReadiness = 'blocked' | 'warning' | 'ready_for_test_backup' | 'ready_for_restore_drill' | 'protected_eligible';
export type HealthLevel = 'ok' | 'warning' | 'critical';

/** Status of the remote SFTP repository target on the peer storage host. */
export type RemoteTargetStatus =
  | 'not_configured'
  | 'reachable'
  | 'unreachable'
  | 'auth_failed'
  | 'host_key_mismatch'
  | 'quota_warning'
  | 'error';

/** State of the remote SFTP repository target (default v1 backup path). */
export type RemoteTargetState =
  | 'not_configured'
  | 'reachable'
  | 'unreachable'
  | 'auth_failed'
  | 'host_key_mismatch'
  | 'quota_warning'
  | 'error';

/** Runtime state for the remote repository target in ClientSetupState. */
export interface RemoteRepositoryState {
  status: RemoteTargetState;
  /** Hours since the remote target was last successfully reached. -1.0 = not configured / never connected. */
  last_ok_hours: number;
}

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
  /** State of the remote SFTP repository target (default v1 backup path). */
  remote_repository: RemoteRepositoryState;
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
  /** Hours since last Syncthing sync (legacy mirror mode). Negative = not configured. */
  last_sync_age_hours: number;
  free_quota_percent: number;
  restore_drill_age_days: number;
  peer_offline_hours: number;
  repository_check_ok: boolean;
  repository_check_message: string | null;
  /** Status of the remote SFTP repository target. "not_configured" is not a failure in local test mode. */
  remote_target_status: RemoteTargetStatus;
  /** Hours since the remote target was last reachable. -1.0 = not configured / never connected. */
  remote_target_last_ok_hours: number;
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
  /** Local repository path for the test lab / local filesystem mode. */
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
  // ── Remote SFTP repository target (default v1 backup path) ────────────────
  /** Peer overlay hostname or IP (Tailscale, Headscale, WireGuard). */
  overlay_host: string;
  /** Isolated SFTP username on the peer storage host. */
  sftp_user: string;
  /** SFTP port (default 22). */
  sftp_port: number;
  /** Remote path on the peer where the encrypted repository is stored. */
  sftp_path: string;
  /** Keychain reference for the SSH key or filesystem path to key file. Not the raw key. */
  ssh_key_ref: string;
  /** True once the user has confirmed the SFTP target is configured. */
  sftp_configured: boolean;
}

/** Lifecycle phase of a peer connection on the owner side. */
export type PeerPhase =
  | 'needs_invite'
  | 'invite_invalid'
  | 'needs_key'
  | 'response_ready'
  | 'waiting_for_host'
  | 'sftp_verified'
  | 'repo_ready'
  | 'blocked';

/**
 * Persisted record of one peer match relationship — one per storage host we back up to.
 * Sensitive material (private key content, passwords) stays on the Rust/OS side.
 */
export interface SavedPeer {
  /** Stable local ID — uuid generated on creation, independent of invite contents. */
  id: string;
  /** matchId from the invite bundle (set once invite is parsed). */
  matchId: string;
  /** allocId from the invite bundle. */
  allocId: string;
  /** Human-readable name from the invite (e.g. "Alice's NAS"). */
  connectionName: string;

  // Invite
  inviteJson: string;

  // SFTP connection (populated from invite)
  sftpHost: string;
  /** User-supplied override when MagicDNS won't resolve cross-account. */
  manualSftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPath: string;

  // Key exchange
  ownerDeviceLabel: string;
  ownerPublicKey: string;
  /** Path or keychain ref to the private key — never the key itself. */
  privateKeyRef: string;
  responseJson: string;
  /** allocId for which host key has been confirmed out-of-band. */
  hostKeyConfirmedForAllocId: string;

  // Status (last known)
  phase: PeerPhase;
  lastProbeStatus: string;
  lastSftpStatus: string;
  lastRepoMessage: string;

  // Timestamps
  createdAt: string;
  /** ISO timestamp of first successful repo connect. */
  connectedAt: string | null;
}

/** Result from the probe_remote_target Tauri command. */
export interface RemoteTargetProbeResponse {
  /** "tcp_port_reachable" means TCP port is open; SSH/SFTP auth is NOT verified. */
  status: string;
  /** "tcp_connect" (current) or "ssh_handshake" (future). Always check this before trusting status. */
  method: string;
  latency_ms: number | null;
  message: string;
}

/** Result from initialize_kopia_sftp_repository. */
export interface SftpRepositoryInitResult {
  initialized: boolean;
  already_existed: boolean;
  message: string;
}

// ── Overlay network types ─────────────────────────────────────────────────────

export type OverlayProvider =
  | 'tailscale'
  | 'headscale'
  | 'wire_guard'
  | 'custom_reachable_address'
  | 'not_configured';

export type OverlayMode = 'use_existing' | 'guided_setup';

/** Non-secret overlay metadata stored locally. No private keys or auth tokens. */
export interface OverlayConfig {
  provider: OverlayProvider;
  mode: OverlayMode;
  local_address: string;
  peer_address: string;
  headscale_server_url?: string | null;
  notes?: string | null;
}

/** Result from detect_overlay Tauri command. */
export interface OverlayDetectionResult {
  provider: OverlayProvider;
  installed: boolean;
  running_or_configured: boolean | null;
  candidate_addresses: string[];
  message: string;
}

/** A single read-only verification or guided-setup step. */
export interface OverlayVerifyStep {
  label: string;
  display_command: string;
  note: string | null;
}

/** One row in the overlay compatibility matrix. */
export interface CompatibilityEntry {
  machine_a: string;
  machine_b: string;
  compatible: boolean;
  note: string;
}

// ── Storage-host setup types ──────────────────────────────────────────────────

/** Inputs for the plan_host_setup Tauri command. */
export interface HostSetupInput {
  /** Human-readable label for this connection. */
  connection_name: string;
  hosted_path: string;
  quota_gb: number;
  match_id: string;
  sftp_username: string;
  sftp_port: number;
  /** May be empty — the host can allocate space before receiving the owner's key. */
  owner_public_key: string;
  source_folders: string[];
  /** Paths of other active allocations — backend validates against these. */
  existing_hosted_paths?: string[];
  overlay_provider: OverlayProvider;
}

/** A single step in the host setup command plan. */
export interface HostSetupStep {
  label: string;
  requires_root: boolean;
  display_command: string;
  note: string | null;
}

/** Non-secret connection details to hand to the matched data owner (the Host Invite Bundle). */
export interface OwnerConnectionBundle {
  /** Human-readable label for this connection. */
  connection_name: string;
  overlay_host: string;
  sftp_username: string;
  sftp_port: number;
  sftp_path: string;
  quota_gb: number;
  match_id: string;
  host_key_fingerprint_note: string;
  overlay_provider: OverlayProvider;
  compatibility_note: string;
}

/** Full host setup command plan returned by plan_host_setup. */
export interface HostSetupPlan {
  steps: HostSetupStep[];
  platform: string;
  owner_bundle: OwnerConnectionBundle;
}

// ── Tailscale detail ──────────────────────────────────────────────────────────

/** Overall setup state for Tailscale, derived from detection results. */
export type TailscaleSetupState =
  | 'ready'
  | 'installed_needs_login'
  | 'installed_cli_not_accessible'
  | 'not_installed'
  | 'error';

/** Rich Tailscale status returned by get_tailscale_detail. */
export interface TailscaleDetail {
  /** Binary found at any known path or on PATH. */
  installed: boolean;
  /** Binary found AND we can successfully invoke it. */
  cli_accessible: boolean;
  /** Absolute path or "tailscale" if on PATH. Null if not found. */
  cli_path: string | null;
  /** True if `tailscale` works without a full path (i.e. is on PATH). */
  on_path: boolean;
  /** Daemon is running and this device is authenticated / connected. */
  connected: boolean;
  /** Needs authentication (BackendState is NeedsLogin or NeedsNodeKey). */
  needs_login: boolean;
  /** BackendState from `tailscale status --json` (e.g. "Running", "NeedsLogin"). */
  backend_state: string | null;
  /** URL to complete auth when state is NeedsLogin. */
  auth_url: string | null;
  /** This device's Tailscale IPv4 address(es). */
  self_ips: string[];
  /** MagicDNS hostname (e.g. my-mac.tailnet-name.ts.net). */
  self_dns_name: string | null;
  /** Tailnet-wide MagicDNS suffix (e.g. tailnet-name.ts.net). */
  magic_dns_suffix: string | null;
  /** Human-readable tailnet name (e.g. user@example.com). */
  tailnet_name: string | null;
  /** Number of peers visible in tailscale status. */
  peer_count: number;
  /** ISO-8601 UTC timestamp of when this status was last checked. */
  last_checked_at: string;
  /** Human-readable summary based on setup_state. */
  status_message: string;
  /** Overall setup state derived from detection results. */
  setup_state: TailscaleSetupState;
}

/** Non-secret overlay metadata persisted in the app config. */
export interface OverlayMeta {
  provider: string;
  local_address: string;
  peer_address: string;
  sftp_port: number;
  last_status: string;
  last_checked_at: string;
}

export type HostAllocationStatus =
  | 'draft'
  | 'space_planned'
  | 'waiting_for_owner_key'
  | 'owner_key_received'
  | 'authorized'
  | 'retired';

export interface HostAllocation {
  id: string;
  /** Human-readable label set by the host. */
  connection_name: string;
  match_id: string;
  hosted_path: string;
  quota_gb: number;
  sftp_username: string;
  sftp_port: number;
  overlay_host: string;
  /** May be empty until the owner sends their Access Request. */
  owner_public_key: string;
  status: HostAllocationStatus;
  /** The serialised Host Invite Bundle text sent to the owner. */
  host_invite_bundle: string;
  /** Persisted command plan steps so the host can reopen them after reload. */
  setup_steps?: HostSetupStep[];
  /** Full owner bundle saved alongside the steps so Edit can restore a complete plan. */
  owner_bundle?: OwnerConnectionBundle;
}

export type BackupTargetStatus =
  | 'draft'
  | 'invite_imported'
  | 'access_request_sent'
  | 'sftp_verified'
  | 'repo_connected'
  | 'retired'
  | 'error';

export interface BackupTarget {
  id: string;
  /** Human-readable label from the Host Invite Bundle. */
  connection_name: string;
  match_id: string;
  overlay_host: string;
  sftp_user: string;
  sftp_port: number;
  sftp_path: string;
  quota_gb: number;
  ssh_key_ref: string;
  /** Owner's public key for this match (included in Access Request). */
  public_key: string;
  /** SHA-256 fingerprint of the owner's public key. Empty string if not available. */
  public_key_fingerprint: string;
  status: BackupTargetStatus;
  verify_status: string;
  repo_init_status: string;
}

/** Non-secret owner-side access request sent to the storage host. */
export interface OwnerAccessRequest {
  match_id: string;
  connection_name: string;
  public_key: string;
  fingerprint: string;
}

export interface OwnerSshKey {
  match_id: string;
  public_key: string;
  fingerprint: string;
  private_key_path_or_ref: string;
}

// ── Tailscale on-demand diagnostics ──────────────────────────────────────────

/** Result of `tailscale ping <peer>` (explicit user action). */
export interface TailscalePingResult {
  reachable: boolean;
  latency_ms: number | null;
  /** "DERP(region)" or "IP:port" showing how traffic reached the peer. */
  via: string | null;
  /** Safe display message — peer address not included. */
  message: string;
}

/** Result of `tailscale up` (explicit confirmed connect). */
export interface TailscaleConnectResult {
  success: boolean;
  /** True when Tailscale returned an auth URL or NeedsLogin state. */
  needs_auth: boolean;
  auth_url: string | null;
  message: string;
}

// ── Owner Connection Bundle ───────────────────────────────────────────────────

/** Parsed Owner Connection Bundle — non-secret fields imported by the data owner. */
export interface PeerBundle {
  overlay_provider: string;
  overlay_host: string;
  sftp_user: string;
  sftp_port: number;
  sftp_path: string;
  quota_gb: number;
  match_id: string;
  /** Human-readable label from the host. May be absent in older bundles. */
  connection_name?: string;
  host_key_fingerprint_note: string;
  compatibility_note: string;
}

// ── SFTP target verification ──────────────────────────────────────────────────

export type SftpVerifyStatus =
  | 'unreachable'
  | 'auth_failed'
  | 'host_key_mismatch'
  | 'path_not_found'
  | 'write_test_failed'
  | 'quota_warning'
  | 'ok'
  | 'error';

/** TOFU fingerprint comparison result. */
export type FingerprintStatus =
  | 'new'       // First time — fingerprint saved for future checks.
  | 'matching'  // Matches the stored fingerprint.
  | 'changed'   // Different from stored — connection blocked.
  | 'not_available'; // Could not retrieve fingerprint from session.

export interface SftpVerifyResult {
  status: SftpVerifyStatus;
  /** Safe display message — no host, user, path, or key material. */
  message: string;
  write_test_passed: boolean;
  /** SHA-256 fingerprint in `SHA256:base64` format. Null if unavailable. */
  host_fingerprint: string | null;
  /** TOFU fingerprint comparison result. */
  fingerprint_status: FingerprintStatus;
  /** Free bytes on the remote path's filesystem (from statvfs). Null if unsupported. */
  free_bytes: number | null;
  /** True if free_bytes is below 1 GiB. */
  quota_warning: boolean;
}
