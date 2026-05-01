// Tauri command bridge with mock fallback for browser/dev mode.
//
// If the app is running inside Tauri, real commands are invoked.
// If running in a browser (no Tauri), mock responses are returned so the
// UI stays usable in browser preview and development without a running backend.

import type {
  HostPrereqResult,
  HostEnvValues,
  ComposeStatus,
  ComposeLogs,
  VerifyResult,
} from './host-agent-types';

import type {
  ClientSetupState,
  CommandPlanSummary,
  CompatibilityEntry,
  HealthReport,
  HostSetupInput,
  HostSetupPlan,
  HostSetupStep,
  IntegrationCheckResult,
  MockBackupResult,
  MockCheckResult,
  MockDrillResult,
  OverlayConfig,
  OverlayDetectionResult,
  OverlayProvider,
  OverlayVerifyStep,
  OwnerSshKey,
  PeerBundle,
  RealBackupResult,
  RealCheckResult,
  RealDrillResult,
  RemoteTargetProbeResponse,
  RepositoryInitResult,
  SftpRepositoryInitResult,
  SftpVerifyResult,
  SyncthingApiPlanSummary,
  SyncthingFolderResult,
  SyncthingLiveStatus,
  SyncthingRunStatus,
  TailscaleConnectResult,
  TailscaleDetail,
  TailscalePingResult,
  TestLabInfo,
  ToolProbeResult,
  TransportFolderInfo,
} from './types';
export type { SyncthingLiveStatus };
import { DEFAULT_SETUP_STATE, DEFAULT_HEALTH_REPORT } from './mock-state';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tauri not available');
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Choose a source folder',
  });
  if (typeof selected === 'string') {
    return selected;
  }
  return null;
}

export async function pickFile(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: false,
    multiple: false,
    title: 'Choose an SSH private key',
  });
  return typeof selected === 'string' ? selected : null;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function getHealthLevel(report: HealthReport): Promise<string> {
  try {
    return await invoke<string>('get_health_level', { report });
  } catch {
    // Compute locally from report fields
    // Negative values mean "not configured / not applicable" — treat as Ok.
    const syncAge = report.last_sync_age_hours;
    const peerAge = report.peer_offline_hours;
    const isCritical =
      report.last_backup_age_hours > 72 ||
      (syncAge >= 0 && syncAge > 72) ||
      report.free_quota_percent < 5 ||
      report.restore_drill_age_days < 0 ||
      (peerAge >= 0 && peerAge > 168) ||
      !report.repository_check_ok;
    const isWarning =
      report.last_backup_age_hours > 24 ||
      (syncAge >= 0 && syncAge > 24) ||
      report.free_quota_percent < 15 ||
      report.restore_drill_age_days > 30 ||
      (peerAge >= 0 && peerAge > 24);
    return isCritical ? 'critical' : isWarning ? 'warning' : 'ok';
  }
}

export async function redactLogLine(line: string): Promise<string> {
  try {
    return await invoke<string>('redact_log_line', { line });
  } catch {
    // Simple client-side redaction fallback
    return line
      .replace(/password[=:]\S+/gi, 'password=[REDACTED]')
      .replace(/token[=:]\S+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\S+/gi, 'key=[REDACTED]')
      .replace(/\/[a-z][a-z0-9]*\/[a-z][a-z0-9]*\/[^\s]+/g, '[REDACTED]');
  }
}

export async function getToolStatus(): Promise<{ kopia: string; syncthing: string }> {
  try {
    return await invoke('get_tool_status');
  } catch {
    // Fail-closed in browser/mock mode: report missing rather than fabricating Ready.
    // The UI treats this as a warning (not a blocker) when offline_mode is true.
    return { kopia: 'missing', syncthing: 'missing' };
  }
}

export async function validateSetupConfig(config: object): Promise<void> {
  try {
    return await invoke('validate_setup_config', { config });
  } catch (invokeErr: unknown) {
    if (isTauri()) throw invokeErr;
    // In browser mode: do basic client-side validation
  }
}

export async function planKopiaRepository(
  repoPath: string,
  enginePath: string,
): Promise<CommandPlanSummary[]> {
  try {
    return await invoke('plan_kopia_repository', {
      repoPath,
      enginePath,
    });
  } catch {
    const exe = enginePath || 'kopia';
    return [
      { label: 'Detect version', display_command: `${exe} --version` },
      { label: 'Create repository', display_command: `${exe} repository create filesystem --path [REDACTED]` },
      { label: 'Repository verification', display_command: `${exe} snapshot verify` },
      { label: 'Create snapshot', display_command: `${exe} snapshot create [REDACTED]` },
      { label: 'List snapshots', display_command: `${exe} snapshot list` },
    ];
  }
}

export async function planSyncthingFolder(
  folderId: string,
  folderPath: string,
  sourceFolders: string[],
): Promise<SyncthingApiPlanSummary> {
  try {
    return await invoke('plan_syncthing_folder', {
      folderId,
      folderPath,
      sourceFolders,
    });
  } catch {
    // Propagate safety errors (source folder rejection) even in mock mode
    if (sourceFolders.some(src => folderPath === src || folderPath.startsWith(src + '/') || src.startsWith(folderPath + '/'))) {
      throw new Error(`Source folder path must not be used as a Syncthing folder: ${folderPath}`);
    }
    return {
      method: 'POST',
      display_command: `POST /rest/config/folders  id=${folderId}  path=[REDACTED]  type=sendreceive  [X-API-Key: REDACTED]`,
      body_summary: `{"id":"${folderId}","path":"[REDACTED]","type":"sendreceive"}`,
    };
  }
}

export async function runMockBackup(): Promise<MockBackupResult> {
  try {
    return await invoke('run_mock_backup');
  } catch {
    return {
      success: true,
      snapshot_id: 'mock-snap-abc12345def67890',
      files_changed: 42,
      size_bytes: 1_258_291_200,
      duration_ms: 27_000,
      log_line: 'snapshot complete: files=42 size=1258291200 duration=27s snapshot_id=mock-snap-abc12345def67890',
    };
  }
}

export async function runMockRepositoryCheck(shouldPass?: boolean): Promise<MockCheckResult> {
  try {
    return await invoke('run_mock_repository_check', { shouldPass: shouldPass ?? true });
  } catch {
    const passes = shouldPass ?? true;
    return {
      passed: passes,
      message: passes
        ? 'Repository verification passed. All content blobs verified.'
        : 'Repository verification FAILED. Investigate immediately — do not prune snapshots.',
      log_line: passes
        ? 'repository verification: verified 128 content blobs — no errors found'
        : 'repository verification: ERROR — 2 content blobs missing or corrupted',
    };
  }
}

export async function runMockRestoreDrill(
  expectedChecksum: string,
  observedChecksum: string,
): Promise<MockDrillResult> {
  try {
    return await invoke('run_mock_restore_drill', { expectedChecksum, observedChecksum });
  } catch {
    const match = expectedChecksum.length > 0 && observedChecksum.length > 0 && expectedChecksum === observedChecksum;
    const result = expectedChecksum.length === 0 || observedChecksum.length === 0
      ? 'fail'
      : match ? 'pass' : 'canary_mismatch';
    const level = result === 'pass' ? 'ok' : 'critical';
    return {
      result: result as MockDrillResult['result'],
      health_level: level as MockDrillResult['health_level'],
      expected_checksum: expectedChecksum,
      observed_checksum: observedChecksum,
      match_result: match,
      log_line: `restore_drill result=${result} health=${level}`,
      audit_evidence: [
        `result: ${result}`,
        `health_level: ${level}`,
        `checksums_match: ${match}`,
        'canary_method: sha256',
        ...(result === 'canary_mismatch' ? ['ACTION: Preserve all logs. Do not prune snapshots.'] : []),
      ],
    };
  }
}

export async function getMockSetupState(): Promise<ClientSetupState> {
  try {
    return await invoke('get_mock_setup_state');
  } catch {
    return DEFAULT_SETUP_STATE;
  }
}

export async function getSetupReadiness(state: ClientSetupState): Promise<IntegrationCheckResult> {
  try {
    return await invoke('get_setup_readiness', { state });
  } catch {
    // Compute locally
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (state.kopia_tool_status !== 'ready') blocking.push(`Kopia tool not ready: ${state.kopia_tool_status}`);
    if (state.syncthing_tool_status !== 'ready') blocking.push(`Syncthing tool not ready: ${state.syncthing_tool_status}`);
    if (state.kopia_repository.status === 'not_configured') blocking.push('Kopia repository not configured');
    if (state.kopia_repository.status === 'check_failed') blocking.push('Kopia repository verification failed — investigate immediately');
    if (state.syncthing_folder.state === 'error') blocking.push('Syncthing error — check Syncthing logs');

    if (state.syncthing_folder.state === 'stale') warnings.push('Syncthing folder is stale — peer data may be outdated');
    if (state.syncthing_folder.state === 'not_configured') warnings.push('Syncthing not yet configured — peer replication is inactive');

    let readiness: IntegrationCheckResult['readiness'] = 'blocked';
    if (blocking.length === 0 && warnings.length === 0) {
      if (state.kopia_repository.status === 'check_passed' && state.syncthing_folder.state === 'in_sync') {
        readiness = 'ready_for_restore_drill';
      } else if (['check_passed', 'initialized', 'configured'].includes(state.kopia_repository.status)) {
        readiness = 'ready_for_test_backup';
      }
    } else if (blocking.length === 0) {
      readiness = 'warning';
    }

    return { readiness, blocking_reasons: blocking, warning_reasons: warnings };
  }
}

// ── Real integration commands ─────────────────────────────────────────────────

// ── Real user-data backup commands ───────────────────────────────────────────

/// Initialise or connect to the user's real Kopia repository.
export async function initializeKopiaRepository(
  repositoryPath: string,
): Promise<RepositoryInitResult> {
  return invoke<RepositoryInitResult>('initialize_kopia_repository', { repositoryPath });
}

/// Back up the configured source folders to the real repository.
export async function runRealBackupFromConfig(
  sourceFolders: string[],
  repositoryPath: string,
): Promise<RealBackupResult> {
  return invoke<RealBackupResult>('run_real_backup_from_config', { sourceFolders, repositoryPath });
}

/// Run `kopia snapshot verify` against the real repository.
export async function runRealRepositoryCheck(
  repositoryPath: string,
): Promise<RealCheckResult> {
  return invoke<RealCheckResult>('run_real_repository_check', { repositoryPath });
}

/// Add the encrypted repository folder to the running Syncthing daemon.
export async function addSyncthingFolder(
  repositoryPath: string,
  sourceFolders: string[],
): Promise<SyncthingFolderResult> {
  return invoke<SyncthingFolderResult>('add_syncthing_folder', { repositoryPath, sourceFolders });
}

export async function probeTools(): Promise<ToolProbeResult[]> {
  try {
    return await invoke<ToolProbeResult[]>('probe_tools');
  } catch {
    // Fail-closed: report missing in browser/mock mode
    return [
      {
        name: 'Kopia',
        location: 'not_found',
        version: null,
        status: 'missing',
        error_message: 'Not available in browser mode',
      },
      {
        name: 'Syncthing',
        location: 'not_found',
        version: null,
        status: 'missing',
        error_message: 'Not available in browser mode',
      },
    ];
  }
}

export async function createTestLab(): Promise<TestLabInfo> {
  return await invoke<TestLabInfo>('create_test_lab');
}

export async function runTestBackup(): Promise<RealBackupResult> {
  return await invoke<RealBackupResult>('run_test_backup');
}

export async function runRepositoryCheck(): Promise<RealCheckResult> {
  return await invoke<RealCheckResult>('run_repository_check');
}

export async function runRestoreDrill(): Promise<RealDrillResult> {
  return await invoke<RealDrillResult>('run_restore_drill');
}

export async function prepareSyncthingTransport(): Promise<TransportFolderInfo> {
  return await invoke<TransportFolderInfo>('prepare_syncthing_transport');
}

/// Store the master encryption password in process memory AND the OS keychain.
/// macOS: Keychain | Windows: Credential Manager | Linux: Secret Service
/// Write-only: the password is never returned to the frontend.
export async function setKopiaPassword(password: string): Promise<void> {
  return invoke<void>('set_kopia_password', { password });
}

/// Returns true if a master password has been set in process memory this session.
export async function hasKopiaPassword(): Promise<boolean> {
  try {
    return await invoke<boolean>('has_kopia_password');
  } catch {
    return false;
  }
}

/// Check whether a master password is stored in the OS keychain from a previous session.
export async function hasPasswordInKeychain(): Promise<boolean> {
  try {
    return await invoke<boolean>('has_password_in_keychain');
  } catch {
    return false;
  }
}

/// Load the master password from the OS keychain into process memory.
/// Returns true if a password was found and loaded. The password itself is never returned.
export async function loadMasterPasswordFromKeychain(): Promise<boolean> {
  try {
    return await invoke<boolean>('load_master_password_from_keychain');
  } catch {
    return false;
  }
}

/// Verify the given password against the one currently held in process memory.
/// Used to gate "change password" flows — the user must know the current password.
export async function verifyCurrentPassword(password: string): Promise<boolean> {
  try {
    return await invoke<boolean>('verify_current_password', { password });
  } catch {
    return false;
  }
}

/// Remove the master password from both process memory and the OS keychain.
/// Call this only on explicit user request (e.g., uninstall or revoke credential).
export async function clearMasterPassword(): Promise<void> {
  try {
    await invoke<void>('clear_master_password');
  } catch { /* no-op */ }
}

/// Ensure the bundled Syncthing daemon is running.
/// If not already running, starts it from the bundled binary and waits up to 5s.
/// Returns the final SyncthingRunStatus after startup.
export async function ensureSyncthingRunning(): Promise<SyncthingRunStatus> {
  return invoke<SyncthingRunStatus>('ensure_syncthing_running');
}

/// Kill the Syncthing process that was started by this app session.
export async function stopSyncthing(): Promise<void> {
  try {
    await invoke<void>('stop_syncthing');
  } catch { /* no-op */ }
}

// ── Syncthing wizard apply ────────────────────────────────────────────────────

export interface ApplySyncthingPeer {
  id: string;
  name: string;
  device_id: string;
}

export interface ApplySyncthingAssignment {
  folder_id: string;
  folder_path: string;
  label: string;
  peer_id: string;
  mode: string;
  encryption_password: string;
}

export interface ApplySyncthingResult {
  devices_added: string[];
  folders_configured: string[];
  errors: string[];
  web_ui_url: string;
}

/// Apply the full Syncthing wizard config: register devices, add/update folders,
/// and set per-device encryption passwords where mode === 'encrypted'.
export async function applySyncthingSetup(
  peers: ApplySyncthingPeer[],
  assignments: ApplySyncthingAssignment[],
): Promise<ApplySyncthingResult> {
  return invoke<ApplySyncthingResult>('apply_syncthing_setup', { peers, assignments });
}

/// Poll the running Syncthing daemon for live folder and peer status.
/// Returns `running: false` if the daemon is unreachable — never throws.
export async function getSyncthingLiveStatus(): Promise<SyncthingLiveStatus> {
  try {
    return await invoke<SyncthingLiveStatus>('get_syncthing_live_status');
  } catch {
    return {
      running: false,
      my_device_id: null,
      folders: [],
      connected_peer_ids: [],
      web_ui_url: 'http://127.0.0.1:8384',
    };
  }
}

/// Return the current compile-time platform string, e.g. "x86_64-pc-windows-msvc".
export async function getCurrentPlatform(): Promise<string> {
  try {
    return await invoke<string>('get_current_platform');
  } catch {
    // In browser mode, derive from user-agent as a best-effort guess
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'x86_64-pc-windows-msvc';
    if (ua.includes('mac')) return 'aarch64-apple-darwin';
    return 'x86_64-unknown-linux-gnu';
  }
}

/// Probe Syncthing: binary present/version + TCP running check on port 8384.
/// Fast read-only check — does not start Syncthing.
export async function checkSyncthingRunning(): Promise<SyncthingRunStatus> {
  try {
    return await invoke<SyncthingRunStatus>('check_syncthing_running');
  } catch {
    return {
      binary_present: false,
      binary_version: null,
      is_running: false,
      api_port: 8384,
      web_ui_url: 'http://127.0.0.1:8384',
      setup_guidance: 'Not available in browser mode.',
    };
  }
}

export async function getRealHealthReport(): Promise<HealthReport> {
  try {
    return await invoke<HealthReport>('get_health_report');
  } catch {
    return DEFAULT_HEALTH_REPORT;
  }
}

export { DEFAULT_HEALTH_REPORT };

// ── SFTP remote target commands ───────────────────────────────────────────────

/** Probe the remote SFTP host for TCP reachability on the given port. No secrets used. */
export async function probeRemoteTarget(host: string, port: number): Promise<RemoteTargetProbeResponse> {
  try {
    return await invoke<RemoteTargetProbeResponse>('probe_remote_target', { host, port });
  } catch {
    return { status: 'error', method: 'tcp_connect', latency_ms: null, message: 'Not available in browser mode.' };
  }
}

/** Return the planned Kopia SFTP command sequence for display (all params redacted). */
export async function planKopiaSftpRepository(
  host: string,
  sftpUser: string,
  sftpPath: string,
  sftpPort: number,
  enginePath: string,
): Promise<CommandPlanSummary[]> {
  try {
    return await invoke<CommandPlanSummary[]>('plan_kopia_sftp_repository', {
      host, sftpUser, sftpPath, sftpPort, enginePath,
    });
  } catch {
    return [];
  }
}

/** Create or connect a Kopia SFTP repository on the peer storage host. */
export async function initializeKopiaSftpRepository(
  host: string,
  sftpUser: string,
  sftpPath: string,
  sftpPort: number,
  sshKeyPath: string | null,
): Promise<SftpRepositoryInitResult> {
  return invoke<SftpRepositoryInitResult>('initialize_kopia_sftp_repository', {
    host, sftpUser, sftpPath, sftpPort, sshKeyPath,
  });
}

/**
 * Run a Kopia backup of source folders to an already-connected SFTP repository.
 *
 * The repository must have been connected first via `initializeKopiaSftpRepository`.
 * Password comes from KopiaPasswordState on the Rust side — never passed here.
 */
export async function runRealSftpBackupFromConfig(
  sourceFolders: string[],
  host: string,
  sftpUser: string,
  sftpPath: string,
  sftpPort: number,
  sshKeyPath: string | null,
): Promise<RealBackupResult> {
  return invoke<RealBackupResult>('run_real_sftp_backup_from_config', {
    sourceFolders, host, sftpUser, sftpPath, sftpPort, sshKeyPath,
  });
}


// ── Storage-host setup command ─────────────────────────────────────────────────

/** Validate host setup inputs and generate a shell command plan. */
export async function planHostSetup(
  input: HostSetupInput,
  overlayHost: string,
): Promise<HostSetupPlan> {
  return invoke<HostSetupPlan>('plan_host_setup', { input, overlayHost });
}

/**
 * Validate that a hosted path does not overlap any source folder or existing hosted allocation.
 * Lighter than planHostSetup — useful for interactive validation. Throws on overlap.
 * Browser-mode fallback uses lexical path comparison.
 */
export async function validateHostedPath(
  hostedPath: string,
  sourceFolders: string[],
  existingHostedPaths: string[],
): Promise<void> {
  try {
    return await invoke<void>('validate_hosted_path', { hostedPath, sourceFolders, existingHostedPaths });
  } catch (err) {
    if (isTauri()) throw err;
    // Browser-mode fallback: lexical overlap check
    const path = hostedPath.trim();
    if (!path) throw new Error('Hosted path must not be empty.');
    for (const src of sourceFolders) {
      if (path === src || path.startsWith(`${src}/`) || src.startsWith(`${path}/`))
        throw new Error(`Hosted path overlaps source folder: ${src}`);
    }
    for (const existing of existingHostedPaths) {
      if (!existing.trim()) continue;
      if (path === existing || path.startsWith(`${existing}/`) || existing.startsWith(`${path}/`))
        throw new Error(`Hosted path overlaps existing allocation: ${existing}`);
    }
  }
}

/**
 * Generate display-only steps to install an owner's SSH public key after their Access Request arrives.
 * Called explicitly by the host — never automatic.
 * Returns the authorized_keys installation steps only.
 */
export async function generateAuthorizeOwnerKeyPlan(
  sftpUsername: string,
  ownerPublicKey: string,
  sftpPort: number,
): Promise<HostSetupStep[]> {
  return invoke<HostSetupStep[]>('generate_authorize_owner_key_plan', { sftpUsername, ownerPublicKey, sftpPort });
}

// ── Overlay setup/detection commands ─────────────────────────────────────────

/** Detect installed overlay tools (Tailscale, WireGuard) using read-only CLI probes. */
export async function detectOverlay(): Promise<OverlayDetectionResult[]> {
  try {
    return await invoke<OverlayDetectionResult[]>('detect_overlay');
  } catch {
    return [];
  }
}

/** Validate overlay config (structural checks only — no network probe). */
export async function validateOverlay(config: OverlayConfig): Promise<void> {
  return invoke<void>('validate_overlay', { config });
}

/** Read-only overlay verification steps for a provider and peer address. */
export async function getOverlayVerifySteps(
  provider: OverlayProvider,
  peerAddress: string,
): Promise<OverlayVerifyStep[]> {
  try {
    return await invoke<OverlayVerifyStep[]>('get_overlay_verify_steps', { provider, peerAddress });
  } catch {
    return [];
  }
}

/** Guided setup steps for Tailscale. */
export async function getTailscaleSetupGuide(): Promise<OverlayVerifyStep[]> {
  try {
    return await invoke<OverlayVerifyStep[]>('get_tailscale_setup_guide');
  } catch {
    return [];
  }
}

/** Guided setup steps for WireGuard. */
export async function getWireguardSetupGuide(): Promise<OverlayVerifyStep[]> {
  try {
    return await invoke<OverlayVerifyStep[]>('get_wireguard_setup_guide');
  } catch {
    return [];
  }
}

/** Guided setup steps for Headscale. */
export async function getHeadscaleSetupGuide(serverUrl?: string): Promise<OverlayVerifyStep[]> {
  try {
    return await invoke<OverlayVerifyStep[]>('get_headscale_setup_guide', { serverUrl: serverUrl ?? null });
  } catch {
    return [];
  }
}

/** Overlay compatibility matrix. */
export async function getOverlayCompatibilityMatrix(): Promise<CompatibilityEntry[]> {
  try {
    return await invoke<CompatibilityEntry[]>('get_overlay_compatibility_matrix');
  } catch {
    return [];
  }
}

/**
 * Rich Tailscale status: binary path, PATH status, add-to-PATH command,
 * connected state, self IPs, MagicDNS hostname, tailnet name, peer count.
 * Never throws — all failures surface as field values (connected: false, etc.).
 */
export async function getTailscaleDetail(): Promise<TailscaleDetail> {
  try {
    return await invoke<TailscaleDetail>('get_tailscale_detail');
  } catch {
    return {
      installed: false,
      cli_accessible: false,
      cli_path: null,
      on_path: false,
      connected: false,
      needs_login: false,
      backend_state: null,
      auth_url: null,
      self_ips: [],
      self_dns_name: null,
      magic_dns_suffix: null,
      tailnet_name: null,
      peer_count: 0,
      last_checked_at: new Date().toISOString(),
      status_message: 'Not available in browser mode.',
      setup_state: 'not_installed',
    };
  }
}

/**
 * Run `tailscale ping <peer>` — explicit user-triggered overlay diagnostic.
 * Returns reachability, latency, and routing path (DERP relay or direct).
 * Never called automatically.
 */
export async function tailscalePingPeer(peer: string): Promise<TailscalePingResult> {
  try {
    return await invoke<TailscalePingResult>('tailscale_ping_peer', { peer });
  } catch {
    return { reachable: false, latency_ms: null, via: null, message: 'Not available in browser mode.' };
  }
}

/**
 * Run `tailscale up` with no flags — explicit, confirmed on-demand connect.
 * Must only be called from a confirmed user action. Never run automatically.
 * If NeedsLogin, the auth URL is returned in the result.
 * Caller should refresh getTailscaleDetail() after this resolves.
 */
export async function tailscaleConnect(): Promise<TailscaleConnectResult> {
  try {
    return await invoke<TailscaleConnectResult>('tailscale_connect');
  } catch {
    return { success: false, needs_auth: false, auth_url: null, message: 'Not available in browser mode.' };
  }
}

// ── Owner bundle parsing ──────────────────────────────────────────────────────

/** Parse an Owner Connection Bundle pasted by the data owner. Throws on malformed input. */
export async function parseOwnerBundle(text: string): Promise<PeerBundle> {
  try {
    return await invoke<PeerBundle>('parse_owner_bundle', { text });
  } catch (err) {
    if (isTauri()) throw err;
    // Browser/dev mode: pure-TS fallback parser matching the Rust implementation.
    return parseBundleTs(text);
  }
}

export async function generateOwnerSshKey(matchId: string): Promise<OwnerSshKey & { already_existed: boolean }> {
  try {
    return await invoke<OwnerSshKey & { already_existed: boolean }>('generate_owner_ssh_key', { matchId });
  } catch (err) {
    if (isTauri()) throw err;
    return {
      match_id: matchId,
      public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMOCKPUBLICKEYONLY nasbb-browser-mode',
      fingerprint: 'SHA256:browser-mode',
      private_key_path_or_ref: '[browser-mode-key-ref]',
      already_existed: false,
    };
  }
}

function parseBundleTs(text: string): PeerBundle {
  const map: Record<string, string> = {};
  const comments: string[] = [];
  let hasKv = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      comments.push(trimmed.slice(1).trim());
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon >= 0) {
      const key = trimmed.slice(0, colon).trim().toLowerCase().replace(/ /g, '_');
      const value = trimmed.slice(colon + 1).trim();
      map[key] = value;
      hasKv = true;
    }
  }

  if (!hasKv) throw new Error('Bundle is empty or contains no parseable key: value lines');

  const get = (field: string): string => {
    const v = map[field]?.trim() ?? '';
    if (!v) throw new Error(`Missing required field: ${field}`);
    return v;
  };

  const overlayHost = get('overlay_host');
  const sftpUser = get('sftp_user');
  const sftpPath = get('sftp_path');
  const matchId = get('match_id');

  const portStr = map['sftp_port']?.trim() || '22';
  const sftpPort = parseInt(portStr, 10);
  if (isNaN(sftpPort) || sftpPort <= 0 || sftpPort > 65535) {
    throw new Error(`sftp_port must be a number between 1 and 65535, got: '${portStr}'`);
  }

  const quotaGb = parseInt(map['quota_gb']?.trim() || '0', 10);
  const overlayProvider = map['overlay_provider']?.trim() || 'not_configured';

  const isFingerprintNote = (l: string) => /verify|fingerprint|ssh-keyscan/i.test(l);
  const hostKeyFingerprintNote = comments.find(isFingerprintNote)
    ?? 'Verify host key fingerprint out-of-band before trusting this connection.';
  const compatibilityNote = comments.find(l => !isFingerprintNote(l)) ?? '';

  const connectionName = map['connection_name']?.trim() ?? '';

  return {
    overlay_provider: overlayProvider,
    overlay_host: overlayHost,
    sftp_user: sftpUser,
    sftp_port: sftpPort,
    sftp_path: sftpPath,
    quota_gb: isNaN(quotaGb) ? 0 : quotaGb,
    match_id: matchId,
    connection_name: connectionName,
    host_key_fingerprint_note: hostKeyFingerprintNote,
    compatibility_note: compatibilityNote,
  };
}

// ── SFTP target verification ──────────────────────────────────────────────────

/**
 * Verify the SFTP target: SSH auth, path access, and write test using the sftp CLI.
 * More thorough than probeRemoteTarget (which is TCP-only).
 * No passwords accepted. Key is a filesystem path only.
 */
export async function verifySftpTarget(
  host: string,
  port: number,
  username: string,
  remotePath: string,
  keyPath: string | null,
): Promise<SftpVerifyResult> {
  try {
    return await invoke<SftpVerifyResult>('verify_sftp_target', {
      host, port, username, remotePath, keyPath,
    });
  } catch {
    return {
      status: 'error',
      message: 'SFTP verification not available in browser mode.',
      write_test_passed: false,
      host_fingerprint: null,
      fingerprint_status: 'not_available',
      free_bytes: null,
      quota_warning: false,
    };
  }
}

// ── Host-agent Docker commands ────────────────────────────────────────────────

export async function hostAgentCheckPrereqs(): Promise<HostPrereqResult> {
  try {
    return await invoke<HostPrereqResult>('host_agent_check_prereqs');
  } catch {
    return {
      docker_available: false,
      docker_version: null,
      compose_available: false,
      compose_version: null,
      compose_dir: null,
      error: 'Not available in browser mode.',
    };
  }
}

export async function hostAgentReadEnv(): Promise<Partial<HostEnvValues>> {
  try {
    return await invoke<Partial<HostEnvValues>>('host_agent_read_env');
  } catch {
    return {};
  }
}

export async function hostAgentWriteEnv(values: Partial<HostEnvValues>): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('host_agent_write_env', { values });
}

export async function hostAgentComposeUp(): Promise<string> {
  return invoke<string>('host_agent_compose_up');
}

export async function hostAgentComposeDown(): Promise<string> {
  return invoke<string>('host_agent_compose_down');
}

export async function hostAgentComposeRestart(): Promise<string> {
  return invoke<string>('host_agent_compose_restart');
}

export async function hostAgentComposeLogs(): Promise<ComposeLogs> {
  try {
    return await invoke<ComposeLogs>('host_agent_compose_logs');
  } catch {
    return { agent_logs: '', sftp_logs: '', error: 'Not available in browser mode.' };
  }
}

export async function hostAgentComposeStatus(): Promise<ComposeStatus> {
  try {
    return await invoke<ComposeStatus>('host_agent_compose_status');
  } catch {
    return { services: [], error: 'Not available in browser mode.' };
  }
}

export async function hostAgentGetTokenHint(): Promise<string | null> {
  try {
    return await invoke<string | null>('host_agent_get_token_hint');
  } catch {
    return null;
  }
}

export async function hostAgentRunVerify(): Promise<VerifyResult> {
  return invoke<VerifyResult>('host_agent_run_verify');
}

// ── Peer tab file helpers ─────────────────────────────────────────────────────

/** Open a file-open dialog filtered to JSON files and return the chosen path, or null. */
export async function pickJsonFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: false,
    multiple: false,
    title: 'Open Host Invite Bundle',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

/** Read a UTF-8 text file at the given path. Throws on error. */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path });
}

/** Write UTF-8 text to the given path (creates or overwrites). Throws on error. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  return invoke<void>('write_text_file', { path, content });
}

/** Open a save-file dialog and return the chosen path, or null if cancelled. */
export async function savePicker(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const selected = await save({
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return typeof selected === 'string' ? selected : null;
}
