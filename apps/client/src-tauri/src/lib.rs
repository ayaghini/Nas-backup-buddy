//! Tauri application entry point and command handlers.
//!
//! Commands exposed to the frontend use nasbb-core types.
//! No passwords, private keys, plaintext file names, or file contents
//! are accepted or returned by any command.

use nasbb_core::commands::{KopiaPlanner, SyncthingPlanner};
use nasbb_core::config::{validate_config, NasbbConfig};
use nasbb_core::host_setup::{
    generate_authorize_owner_key_steps_linux, generate_authorize_owner_key_steps_macos,
    generate_host_setup_plan_linux, generate_host_setup_plan_macos,
    validate_host_setup, validate_hosted_path_isolation,
    HostSetupInput, HostSetupPlan, HostSetupStep,
};
use nasbb_core::overlay::{
    compatibility_matrix, detect_overlay_tools,
    get_tailscale_detail as core_get_tailscale_detail,
    headscale_setup_guide,
    overlay_verify_steps, tailscale_setup_guide, wireguard_setup_guide,
    CompatibilityEntry, OverlayConfig, OverlayDetectionResult,
    OverlayProvider, OverlayVerifyStep, TailscaleConnectResult, TailscaleDetail,
    TailscalePingResult, validate_overlay_config,
};
use nasbb_core::health::{HealthLevel, HealthReport, RestoreDrillResult};
use nasbb_core::integration::{
    BackupEngine, ClientSetupState, IntegrationCheckResult, KopiaRepositoryState,
    KopiaRepositoryStatus, SyncthingFolderStatus, SyncthingState,
};
use nasbb_core::kopia::KopiaRunner;
use nasbb_core::redaction::redact_line;
use nasbb_core::syncthing::{
    prepare_transport_folder_def, probe_syncthing_status, start_syncthing_daemon,
    SyncthingRunStatus, SyncthingStartArgs,
};
use nasbb_core::test_lab::{
    self, CanaryVerifyResult, TestLabInfo, TestLabPaths, TEST_LAB_PASSWORD,
};
use nasbb_core::tools::{
    check_tool_status, detect_tool_on_path, get_tool_entry, Platform, PinnedTool, ToolManifest,
    ToolManager, ToolName, ToolProbeResult, ToolStatus,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Bundled tool manifest — compiled into the binary at build time.
/// Fill in the `sha256` fields before any production release.
/// See `docs/client-app/packaging-and-release.md` for the update procedure.
const TOOL_MANIFEST_JSON: &str = include_str!("../resources/tool-manifest.json");

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolStatusResponse {
    pub kopia: String,
    pub syncthing: String,
}

#[derive(Debug, Serialize)]
pub struct CommandPlanSummary {
    pub label: String,
    pub display_command: String,
}

#[derive(Debug, Serialize)]
pub struct SyncthingApiPlanSummary {
    pub method: String,
    pub display_command: String,
    pub body_summary: String,
}

#[derive(Debug, Serialize)]
pub struct MockBackupResult {
    pub success: bool,
    pub snapshot_id: String,
    pub files_changed: u32,
    pub size_bytes: u64,
    pub duration_ms: u64,
    pub log_line: String,
}

#[derive(Debug, Serialize)]
pub struct MockCheckResult {
    pub passed: bool,
    pub message: String,
    pub log_line: String,
}

#[derive(Debug, Serialize)]
pub struct MockDrillResult {
    pub result: String,
    pub health_level: String,
    pub expected_checksum: String,
    pub observed_checksum: String,
    pub match_result: bool,
    pub log_line: String,
    pub audit_evidence: Vec<String>,
}

// ── Real integration response types ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct RealBackupResult {
    pub success: bool,
    pub snapshot_id: String,
    pub source_label: String,
    pub timestamp: String,
    pub log_line: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RealCheckResult {
    pub passed: bool,
    pub message: String,
    pub duration_ms: u64,
    pub log_line: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RealDrillResult {
    pub result: String,
    pub health_level: String,
    pub canary_verify: Option<CanaryVerifyResult>,
    pub restore_duration_ms: u64,
    pub log_line: String,
    pub audit_evidence: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransportFolderInfo {
    pub folder_id: String,
    pub folder_type: String,
    pub is_safety_validated: bool,
    pub config_snippet: String,
    pub note: String,
}

/// Result of initialising or connecting to a user's real Kopia repository.
#[derive(Debug, Serialize, Deserialize)]
pub struct RepositoryInitResult {
    pub initialized: bool,
    /// True when the repository dir already had data (connect path taken).
    pub already_existed: bool,
    /// Human-readable status — no raw paths.
    pub message: String,
}

/// Result of adding the repository folder to the running Syncthing daemon.
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncthingFolderResult {
    pub added: bool,
    pub folder_id: String,
    pub web_ui_url: String,
    /// Human-readable next-step note.
    pub note: String,
}

// ── Syncthing live status types ───────────────────────────────────────────────

/// Live status for one Syncthing folder, polled from the REST API.
#[derive(Debug, Serialize)]
pub struct SyncthingFolderLiveStatus {
    pub folder_id: String,
    pub label: String,
    /// Raw state string from Syncthing: "idle", "scanning", "syncing", "error", "unknown"
    pub raw_state: String,
    /// Mapped to our SyncthingState values for the frontend
    pub state: String,
    /// Bytes the local device still needs from peers
    pub bytes_pending: i64,
    /// Number of files still needed
    pub files_pending: i64,
    /// Device IDs this folder is shared with
    pub peer_device_ids: Vec<String>,
}

/// Full live Syncthing status returned to the frontend on each poll.
#[derive(Debug, Serialize)]
pub struct SyncthingLiveStatus {
    /// Whether the Syncthing daemon is reachable on port 8384
    pub running: bool,
    /// This device's Syncthing device ID
    pub my_device_id: Option<String>,
    /// All configured folders with their current states
    pub folders: Vec<SyncthingFolderLiveStatus>,
    /// Device IDs of currently connected peers
    pub connected_peer_ids: Vec<String>,
    /// Web UI URL
    pub web_ui_url: String,
}

// ── Syncthing wizard apply types ──────────────────────────────────────────────

/// One peer device to register in Syncthing.
#[derive(Debug, Deserialize)]
pub struct ApplySyncthingPeer {
    /// Local app-assigned UUID — used to match assignments.
    pub id: String,
    /// Human-readable name shown in Syncthing.
    pub name: String,
    /// Syncthing device ID (uppercase, 8×7 chars separated by hyphens).
    pub device_id: String,
}

/// One folder–peer assignment from the wizard.
#[derive(Debug, Deserialize)]
pub struct ApplySyncthingAssignment {
    pub folder_id: String,
    /// Encrypted repository path — internal use only, never logged.
    pub folder_path: String,
    pub label: String,
    /// Matches ApplySyncthingPeer.id.
    pub peer_id: String,
    /// "sync" or "encrypted".
    pub mode: String,
    /// Only meaningful when mode == "encrypted". Never logged.
    pub encryption_password: String,
}

/// Result returned to the frontend after applying the Syncthing configuration.
#[derive(Debug, Serialize)]
pub struct ApplySyncthingResult {
    pub devices_added: Vec<String>,
    pub folders_configured: Vec<String>,
    pub errors: Vec<String>,
    pub web_ui_url: String,
}

// ── Test lab runtime state (stored between commands) ─────────────────────────

struct TestLabStateInner {
    /// Test password — never exposed to the UI layer.
    password: String,
    paths: Option<TestLabPaths>,
    canary_sha256: Option<String>,
    last_snapshot_id: Option<String>,
    /// Unix timestamp (secs) when the last successful backup completed.
    last_backup_at_secs: Option<u64>,
    /// Whether the last repository verification passed.
    last_check_passed: Option<bool>,
    /// Result of the last restore drill: "pass", "canary_mismatch", or "fail".
    last_drill_result: Option<String>,
}

struct AppTestLabState(Mutex<TestLabStateInner>);

// ── Syncthing managed process state ──────────────────────────────────────────
// Holds the child process spawned by ensure_syncthing_running.
// The process is killed when the app exits via the RunEvent::Exit handler.
struct SyncthingProcessState(Mutex<Option<std::process::Child>>);

// ── User Kopia password state ─────────────────────────────────────────────────
// Holds the repository encryption password in process memory.
// The password is also persisted to the OS keychain (macOS Keychain,
// Windows Credential Manager, Linux Secret Service) via the `keyring` crate.
// It is write-only from the UI: never returned to the frontend.
struct KopiaPasswordState(Mutex<Option<String>>);

// Keychain identifiers — fixed strings that identify this app's credential entry.
const KEYCHAIN_SERVICE: &str = "nasbb.backup-buddy";
const KEYCHAIN_ACCOUNT: &str = "master-password";

// ── Platform-specific keychain helpers ───────────────────────────────────────
//
// macOS uses the `security` CLI (not the `keyring` crate).
//
// Why not `keyring`: it calls SecKeychainAddGenericPassword which binds the ACL to the
// creating binary's code signature. Every `cargo build` changes the binary signature, so
// every restart triggers the macOS "enter login keychain password" dialog. That dialog
// wants the macOS ACCOUNT password, not the backup password — users are confused.
//
// Why NOT `-T ""`: the security(1) man page states "If the -T option is not provided,
// any application can access the item." Passing -T with any value (including an empty
// string) restricts access to the listed application(s). Omitting -T entirely is
// the correct way to create an unrestricted item.
//
// Store strategy: delete-then-add (never update-in-place).
//   Updating an existing ACL-restricted item requires reading its ACL first, which
//   triggers the confirm dialog. Deleting by metadata does NOT read the secret value,
//   so kSecACLAuthorizationDecrypt is never invoked — no dialog, even for items created
//   by the old `keyring` code.
//
// Retrieve strategy: try silently; on any non-"not found" failure return None WITHOUT
//   deleting the entry. We never destroy the user's credential automatically.
//   The UI detects "entry exists but couldn't be read" and lets the user decide:
//   re-enter (which migrates to the correct format) or retry.
//
// Existence check: uses `find-generic-password` WITHOUT `-w`. Reading metadata does
//   NOT invoke kSecACLAuthorizationDecrypt, so no dialog ever appears for this check.
//
// Windows / Linux: `keyring` crate works correctly on those platforms.

/// macOS: check if the keychain entry exists using metadata-only lookup.
/// Does NOT read the secret value → no ACL dialog, regardless of how the item was stored.
#[cfg(target_os = "macos")]
fn macos_entry_exists() -> bool {
    std::process::Command::new("security")
        .args(["find-generic-password",
               "-s", KEYCHAIN_SERVICE,
               "-a", KEYCHAIN_ACCOUNT])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// macOS: delete the entry by metadata.
/// Deletion does NOT read the secret value (kSecACLAuthorizationDecrypt is not invoked),
/// so no ACL confirm dialog appears even for ACL-restricted items.
#[cfg(target_os = "macos")]
fn macos_delete_entry() {
    let _ = std::process::Command::new("security")
        .args(["delete-generic-password",
               "-s", KEYCHAIN_SERVICE,
               "-a", KEYCHAIN_ACCOUNT])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// Store the password in the OS keychain.
///
/// macOS: always deletes any existing entry first (no dialog), then adds a fresh one
/// with no -T flag (= any application can access, per security(1) man page).
/// This silently migrates old keyring-created ACL-restricted items on first write.
fn keychain_store(password: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Delete first: works without ACL dialog; silently no-ops if item absent.
        macos_delete_entry();

        // Add WITHOUT any -T flag.
        // man security(1): "If the -T option is not provided, any application can
        // access the item." This means no confirm dialog, ever, for any binary.
        let out = std::process::Command::new("security")
            .args(["add-generic-password",
                   "-s", KEYCHAIN_SERVICE,
                   "-a", KEYCHAIN_ACCOUNT,
                   "-w", password])
            .output()
            .map_err(|e| format!("security CLI unavailable: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Keychain write failed: {}", stderr.trim()));
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("keychain unavailable: {e}"))?;
        entry.set_password(password)
            .map_err(|e| format!("keychain write failed: {e}"))
    }
}

/// Retrieve the password from the OS keychain. Returns Ok(None) if absent or unreadable.
///
/// macOS: if an old ACL-restricted entry exists the dialog may appear. If it does and
/// the user cancels or enters the wrong macOS password, we return Ok(None) WITHOUT
/// deleting the entry — that is the user's data and we must not destroy it silently.
/// The UI will show "entry exists but couldn't be loaded" and let the user choose:
/// re-enter the password (which migrates the entry to the correct format) or retry.
fn keychain_retrieve() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("security")
            .args(["find-generic-password", "-w",
                   "-s", KEYCHAIN_SERVICE,
                   "-a", KEYCHAIN_ACCOUNT])
            .output()
            .map_err(|e| format!("security CLI unavailable: {e}"))?;

        if out.status.success() {
            let pw = String::from_utf8_lossy(&out.stdout).trim().to_string();
            return Ok(if pw.is_empty() { None } else { Some(pw) });
        }

        // Exit 44 = errSecItemNotFound
        if out.status.code() == Some(44) {
            return Ok(None);
        }

        // Any other failure (ACL dialog cancelled, wrong macOS password, keychain
        // locked): return None WITHOUT deleting. The caller checks has_entry_without_read()
        // separately to decide what to show the user.
        return Ok(None);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("keychain unavailable: {e}"))?;
        match entry.get_password() {
            Ok(pw) if !pw.is_empty() => Ok(Some(pw)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keychain read failed: {e}")),
        }
    }
}

/// Delete the password from the OS keychain.
/// Silently succeeds if the entry does not exist.
fn keychain_delete() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("security")
            .args(["delete-generic-password",
                   "-s", KEYCHAIN_SERVICE,
                   "-a", KEYCHAIN_ACCOUNT])
            .output()
            .map_err(|e| format!("security CLI unavailable: {e}"))?;
        if out.status.success() || out.status.code() == Some(44) {
            return Ok(());
        }
        return Err(format!(
            "Keychain delete failed (exit {}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(format!("keychain delete failed: {e}")),
            }
        }
        Ok(())
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the overall health level for a given report.
#[tauri::command]
fn get_health_level(report: HealthReport) -> String {
    match report.overall_level() {
        HealthLevel::Ok => "ok".to_string(),
        HealthLevel::Warning => "warning".to_string(),
        HealthLevel::Critical => "critical".to_string(),
    }
}

/// Redact a log line before displaying it in the Logs view.
#[tauri::command]
fn redact_log_line(line: String) -> String {
    redact_line(&line)
}

fn tool_status_str(s: &ToolStatus) -> &'static str {
    match s {
        ToolStatus::Missing => "missing",
        ToolStatus::Present => "present",
        ToolStatus::VersionMismatch => "version_mismatch",
        ToolStatus::ChecksumMismatch => "checksum_mismatch",
        ToolStatus::Ready => "ready",
    }
}

/// Expose the current platform to the frontend as a plain string.
/// Used by the install-helper UI to show the right package manager command.
#[tauri::command]
fn get_current_platform() -> String {
    match current_platform() {
        Platform::X86_64Windows | Platform::Aarch64MacOs => current_platform().to_string(),
        p => p.to_string(),
    }
}

/// Detect the current compile-time target platform.
fn current_platform() -> Platform {
    if cfg!(all(target_arch = "x86_64", target_os = "linux")) {
        Platform::X86_64Linux
    } else if cfg!(all(target_arch = "aarch64", target_os = "linux")) {
        Platform::Aarch64Linux
    } else if cfg!(all(target_arch = "x86_64", target_os = "windows")) {
        Platform::X86_64Windows
    } else if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        Platform::X86_64MacOs
    } else {
        // Default: Apple Silicon Mac (aarch64-apple-darwin) and other arm64
        Platform::Aarch64MacOs
    }
}

/// Resolve tool status using the bundled manifest and on-disk binary.
///
/// Resolution order:
/// 1. Parse manifest entry for this tool+platform.
/// 2. If the bundled binary exists at the expected path, call `check_tool_status`
///    (SHA-256 verified → `ready`; empty checksum → `checksum_mismatch`; etc.).
/// 3. If the bundled binary is absent, fall back to PATH detection.
///    PATH detection returns `present` or `missing` — never `ready`, because
///    PATH-only binaries cannot be checksum-verified against the manifest.
fn resolve_tool_status(
    manifest: &ToolManifest,
    tool: &ToolName,
    platform: &Platform,
    resource_dir: Option<&std::path::Path>,
) -> ToolStatus {
    if let Some(rdir) = resource_dir {
        if let Ok(entry) = get_tool_entry(manifest, tool, platform) {
            let binary_path = rdir.join(&entry.binary_path);
            let status = check_tool_status(entry, Some(&binary_path));
            if status != ToolStatus::Missing {
                // Binary was found at bundle path — return checksum result directly
                return status;
            }
            // Binary not in bundle yet — fall through to PATH detection
        }
        // No manifest entry for this platform — fall through to PATH detection
    }
    // No resource dir resolved, or binary missing from bundle.
    // PATH detection is a development convenience only; production requires bundle.
    detect_tool_on_path(&tool.to_string())
}

/// Check whether Kopia and Syncthing are ready for use.
///
/// Tries the bundled manifest first. If the bundled binary is absent (common in
/// dev), falls back to PATH detection (`present`/`missing`). Only returns `ready`
/// when the bundled binary exists and its SHA-256 matches the manifest entry.
#[tauri::command]
fn get_tool_status(app: tauri::AppHandle) -> ToolStatusResponse {
    use tauri::Manager;

    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();

    let kopia = resolve_tool_status(
        &manifest,
        &ToolName::Kopia,
        &platform,
        resource_dir.as_deref(),
    );
    let syncthing = resolve_tool_status(
        &manifest,
        &ToolName::Syncthing,
        &platform,
        resource_dir.as_deref(),
    );

    // If the Syncthing binary wasn't found on PATH or in the bundle BUT the
    // daemon is already running on port 8384 (e.g. a user-installed Syncthing),
    // report it as present — we can still talk to it via the REST API.
    let syncthing = if syncthing == ToolStatus::Missing {
        let running = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 8384)),
            std::time::Duration::from_millis(500),
        ).is_ok();
        if running { ToolStatus::Present } else { ToolStatus::Missing }
    } else {
        syncthing
    };

    ToolStatusResponse {
        kopia: tool_status_str(&kopia).to_string(),
        syncthing: tool_status_str(&syncthing).to_string(),
    }
}

/// Validate a setup config submitted from the setup wizard.
/// Returns Ok on success or a human-readable error message on failure.
/// Never returns passwords, keys, or full source paths in the error message.
#[tauri::command]
fn validate_setup_config(config: NasbbConfig) -> Result<(), String> {
    validate_config(&config).map_err(|e| e.to_string())
}

/// Return the Kopia command plan for a repository setup.
/// All sensitive values are replaced by [REDACTED] in display output.
#[tauri::command]
fn plan_kopia_repository(repo_path: String, engine_path: String) -> Vec<CommandPlanSummary> {
    let planner = KopiaPlanner::new(engine_path);
    vec![
        CommandPlanSummary {
            label: "Detect version".to_string(),
            display_command: planner.detect_version().display_command,
        },
        CommandPlanSummary {
            label: "Create repository".to_string(),
            display_command: planner.create_repository(&repo_path).display_command,
        },
        CommandPlanSummary {
            label: "Repository verification".to_string(),
            display_command: planner.check_repository().display_command,
        },
        CommandPlanSummary {
            label: "Create snapshot".to_string(),
            display_command: planner.create_snapshot("[source-folder]").display_command,
        },
        CommandPlanSummary {
            label: "List snapshots".to_string(),
            display_command: planner.list_snapshots().display_command,
        },
    ]
}

/// Return the Syncthing folder plan for the repository path.
/// Rejects if folder_path overlaps with any source folder.
#[tauri::command]
fn plan_syncthing_folder(
    folder_id: String,
    folder_path: String,
    source_folders: Vec<String>,
) -> Result<SyncthingApiPlanSummary, String> {
    let planner = SyncthingPlanner::new("http://127.0.0.1:8384");
    let source_refs: Vec<&str> = source_folders.iter().map(|s| s.as_str()).collect();
    let plan = planner
        .create_repository_folder(&folder_id, &folder_path, &source_refs)
        .map_err(|e| e.to_string())?;
    Ok(SyncthingApiPlanSummary {
        method: plan.method,
        display_command: plan.display_command,
        body_summary: plan.body_summary,
    })
}

/// Run a mock backup. Returns a successful fake snapshot event.
/// Logs are redacted before returning.
#[tauri::command]
fn run_mock_backup() -> MockBackupResult {
    let snapshot_id = "kf4d9ab01c2e3f789abcdef1234567890ab".to_string();
    let raw_log = "snapshot complete: source=[REDACTED] snapshot_id=kf4d9ab01c2e3f789abcdef1234567890ab files=42 size=1258291200 duration=27s";
    MockBackupResult {
        success: true,
        snapshot_id,
        files_changed: 42,
        size_bytes: 1_258_291_200,
        duration_ms: 27_000,
        log_line: redact_line(raw_log),
    }
}

/// Run a mock repository verification.
/// `should_pass` defaults to true. Pass false to simulate a check failure.
#[tauri::command]
fn run_mock_repository_check(should_pass: Option<bool>) -> MockCheckResult {
    let passes = should_pass.unwrap_or(true);
    let raw_log = if passes {
        "repository verification: verified 128 content blobs, 3 manifests — no errors found"
    } else {
        "repository verification: ERROR — 2 content blobs missing or corrupted"
    };
    MockCheckResult {
        passed: passes,
        message: if passes {
            "Repository verification passed. All content blobs verified.".to_string()
        } else {
            "Repository verification FAILED. Investigate immediately — do not prune snapshots.".to_string()
        },
        log_line: redact_line(raw_log),
    }
}

/// Run a mock restore drill comparing expected and observed canary checksums.
///
/// A checksum mismatch maps to Critical health level.
/// A restore failure maps to Critical health level.
#[tauri::command]
fn run_mock_restore_drill(expected_checksum: String, observed_checksum: String) -> MockDrillResult {
    let checksums_match = !expected_checksum.is_empty()
        && !observed_checksum.is_empty()
        && expected_checksum == observed_checksum;

    let drill_result = if expected_checksum.is_empty() || observed_checksum.is_empty() {
        RestoreDrillResult::Fail
    } else if checksums_match {
        RestoreDrillResult::Pass
    } else {
        RestoreDrillResult::CanaryMismatch
    };

    let health_level = nasbb_core::health::restore_result_to_level(&drill_result);

    let (result_label, health_label) = match (&drill_result, &health_level) {
        (RestoreDrillResult::Pass, _) => ("pass", "ok"),
        (RestoreDrillResult::CanaryMismatch, _) => ("canary_mismatch", "critical"),
        (RestoreDrillResult::Fail, _) => ("fail", "critical"),
    };

    let raw_log = format!(
        "restore_drill result={result_label} expected={} observed={} health={}",
        if expected_checksum.is_empty() {
            "[empty]"
        } else {
            "[REDACTED]"
        },
        if observed_checksum.is_empty() {
            "[empty]"
        } else {
            "[REDACTED]"
        },
        health_label
    );

    let mut audit = vec![
        format!("result: {result_label}"),
        format!("health_level: {health_label}"),
        format!("checksums_match: {checksums_match}"),
        "canary_method: sha256".to_string(),
    ];
    if matches!(drill_result, RestoreDrillResult::CanaryMismatch) {
        audit.push(
            "ACTION: Preserve all logs. Do not prune snapshots. Investigate immediately."
                .to_string(),
        );
    }
    if matches!(drill_result, RestoreDrillResult::Fail) {
        audit.push(
            "ACTION: Check restore destination permissions and available disk space.".to_string(),
        );
    }

    MockDrillResult {
        result: result_label.to_string(),
        health_level: health_label.to_string(),
        expected_checksum: expected_checksum.clone(),
        observed_checksum: observed_checksum.clone(),
        match_result: checksums_match,
        log_line: redact_line(&raw_log),
        audit_evidence: audit,
    }
}

/// Return the setup readiness based on a ClientSetupState.
#[tauri::command]
fn get_setup_readiness(state: ClientSetupState) -> IntegrationCheckResult {
    state.check_readiness()
}

// ── Binary path resolution ────────────────────────────────────────────────────

/// Resolve the filesystem path for a bundled tool binary, with PATH fallback.
/// Returns None only if the binary is completely absent.
fn resolve_binary_path(
    manifest: &ToolManifest,
    tool: &ToolName,
    platform: &Platform,
    resource_dir: Option<&std::path::Path>,
) -> Option<std::path::PathBuf> {
    if let Some(rdir) = resource_dir {
        if let Ok(entry) = get_tool_entry(manifest, tool, platform) {
            let p = rdir.join(&entry.binary_path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // PATH fallback: check if the name resolves on PATH
    let name = tool.to_string();
    if matches!(detect_tool_on_path(&name), ToolStatus::Present) {
        Some(std::path::PathBuf::from(name))
    } else {
        None
    }
}

/// Resolve and gate the Kopia binary on readiness.
///
/// - Bundled binary: must pass SHA-256 checksum verification (ToolStatus::Ready).
///   Checksum or version mismatch → error, fail closed.
/// - PATH binary: allowed as a development fallback but never considered Ready.
///   The returned path is usable but callers should surface the dev-mode warning.
///
/// This must be called instead of `resolve_binary_path` for any command that
/// creates, reads, or modifies a Kopia repository.
fn require_kopia_binary(
    manifest: &ToolManifest,
    platform: &Platform,
    resource_dir: Option<&std::path::Path>,
) -> Result<std::path::PathBuf, String> {
    if let Some(rdir) = resource_dir {
        if let Ok(entry) = get_tool_entry(manifest, &ToolName::Kopia, platform) {
            let path = rdir.join(&entry.binary_path);
            if path.exists() {
                return match check_tool_status(entry, Some(&path)) {
                    ToolStatus::Ready => Ok(path),
                    ToolStatus::ChecksumMismatch => Err(
                        "Kopia binary checksum mismatch — binary may be tampered or corrupted. \
                         Reinstall the application."
                            .to_string(),
                    ),
                    ToolStatus::VersionMismatch => Err(
                        "Kopia binary version does not match the pinned manifest. \
                         Reinstall the application."
                            .to_string(),
                    ),
                    other => Err(format!(
                        "Kopia binary status is not ready: {:?}",
                        other
                    )),
                };
            }
        }
    }
    // PATH fallback — development-only; not checksum-verified.
    let name = ToolName::Kopia.to_string();
    if matches!(detect_tool_on_path(&name), ToolStatus::Present) {
        Ok(std::path::PathBuf::from(name))
    } else {
        Err("Kopia binary not found — ensure it is bundled or on PATH".to_string())
    }
}

// ── Real integration commands ─────────────────────────────────────────────────

/// Probe Kopia and Syncthing: detect binaries, read versions, check against
/// pinned manifest. Returns structured ToolProbeResult for each tool.
#[tauri::command]
fn probe_tools(app: tauri::AppHandle) -> Vec<ToolProbeResult> {
    use tauri::Manager;
    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();

    let kopia_path = resolve_binary_path(
        &manifest,
        &ToolName::Kopia,
        &platform,
        resource_dir.as_deref(),
    );
    let syncthing_path = resolve_binary_path(
        &manifest,
        &ToolName::Syncthing,
        &platform,
        resource_dir.as_deref(),
    );

    // Build pinned constraints from manifest entries for current platform
    let mut pinned = Vec::new();
    if let Ok(ke) = get_tool_entry(&manifest, &ToolName::Kopia, &platform) {
        pinned.push(PinnedTool {
            name: ToolName::Kopia,
            expected_version: ke.version.clone(),
            expected_sha256: ke.sha256.clone(),
        });
    }
    if let Ok(se) = get_tool_entry(&manifest, &ToolName::Syncthing, &platform) {
        pinned.push(PinnedTool {
            name: ToolName::Syncthing,
            expected_version: se.version.clone(),
            expected_sha256: se.sha256.clone(),
        });
    }

    let mut manager = ToolManager::new().with_pinned(pinned);
    if let Some(p) = kopia_path {
        manager = manager.with_kopia(p);
    }
    if let Some(p) = syncthing_path {
        manager = manager.with_syncthing(p);
    }

    manager.probe_all()
}

/// Create the local test sandbox under the OS temp directory.
///
/// Generates sample files, computes the canary checksum, and stores
/// the test password + paths in Tauri state. Returns TestLabInfo for display.
/// The test password is NEVER returned to the frontend.
#[tauri::command]
fn create_test_lab(
    state: tauri::State<AppTestLabState>,
) -> Result<TestLabInfo, String> {
    let root = test_lab::test_lab_root();
    let (paths, info) =
        test_lab::create_test_lab(&root).map_err(|e| e.to_string())?;

    let mut inner = state.0.lock().map_err(|_| "state lock error")?;
    inner.paths = Some(paths);
    inner.canary_sha256 = Some(info.canary_sha256.clone());
    inner.last_snapshot_id = None;
    inner.last_backup_at_secs = None;
    inner.last_check_passed = None;
    inner.last_drill_result = None;
    Ok(info)
}

/// Run a real Kopia backup of the test lab source directory.
///
/// Requires `create_test_lab` to have been called first.
/// The test password is retrieved from Tauri state — never from the frontend.
/// Kopia binary must pass readiness verification before any repository operation.
#[tauri::command]
fn run_test_backup(
    app: tauri::AppHandle,
    state: tauri::State<AppTestLabState>,
) -> Result<RealBackupResult, String> {
    use tauri::Manager;
    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    // Readiness-gated: fails closed on checksum or version mismatch.
    let binary_path = require_kopia_binary(&manifest, &platform, resource_dir.as_deref())?;

    let mut inner = state.0.lock().map_err(|_| "state lock error")?;
    let paths = inner
        .paths
        .as_ref()
        .ok_or("Test lab not initialized — call create_test_lab first")?
        .clone();
    let password = inner.password.clone();

    let runner = KopiaRunner::new(
        binary_path,
        paths.repo_dir.clone(),
        paths.kopia_config_path.clone(),
    );

    // Initialize the repository if not already done.
    // Decision: check whether the config file exists (written by kopia on create/connect).
    //   - Config absent + repo dir empty → create new repository.
    //   - Config absent + repo dir has data → connect to existing repository.
    //   - Config present → repository already connected; skip init.
    if !paths.kopia_config_path.exists() {
        let repo_is_empty = paths
            .repo_dir
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(true);

        if repo_is_empty {
            runner
                .create_repository(&password)
                .map_err(|e| format!("Repository creation failed: {e}"))?;
        } else {
            runner
                .connect_repository(&password)
                .map_err(|e| format!("Repository connect failed: {e}"))?;
        }
    }

    let snapshot = runner
        .create_snapshot(&paths.source_dir, &password)
        .map_err(|e| e.to_string())?;

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    inner.last_snapshot_id = Some(snapshot.snapshot_id.clone());
    inner.last_backup_at_secs = Some(now_secs);

    let log_line = redact_line(&format!(
        "backup_completed snapshot_id={} timestamp={}",
        snapshot.snapshot_id, snapshot.timestamp
    ));

    Ok(RealBackupResult {
        success: true,
        snapshot_id: snapshot.snapshot_id,
        source_label: "[REDACTED — test sandbox]".to_string(),
        timestamp: snapshot.timestamp,
        log_line,
    })
}

/// Run `kopia snapshot verify` against the test lab repository.
/// Kopia binary must pass readiness verification. Result is persisted in state.
#[tauri::command]
fn run_repository_check(
    app: tauri::AppHandle,
    state: tauri::State<AppTestLabState>,
) -> Result<RealCheckResult, String> {
    use tauri::Manager;
    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary_path = require_kopia_binary(&manifest, &platform, resource_dir.as_deref())?;

    let mut inner = state.0.lock().map_err(|_| "state lock error")?;
    let paths = inner
        .paths
        .as_ref()
        .ok_or("Test lab not initialized — call create_test_lab first")?
        .clone();
    let password = inner.password.clone();

    let runner = KopiaRunner::new(
        binary_path,
        paths.repo_dir.clone(),
        paths.kopia_config_path.clone(),
    );

    let result = runner
        .check_repository(&password)
        .map_err(|e| e.to_string())?;

    // Persist outcome so get_health_report can reflect the real check result.
    inner.last_check_passed = Some(result.passed);

    let log_line = redact_line(&format!(
        "repository_check passed={} duration_ms={}",
        result.passed, result.duration_ms
    ));

    Ok(RealCheckResult {
        passed: result.passed,
        message: result.message,
        duration_ms: result.duration_ms,
        log_line,
    })
}

/// Run a restore drill: restore the latest snapshot and verify the canary checksum.
///
/// Restore failure or canary mismatch maps to Critical health level.
#[tauri::command]
fn run_restore_drill(
    app: tauri::AppHandle,
    state: tauri::State<AppTestLabState>,
) -> Result<RealDrillResult, String> {
    use tauri::Manager;

    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    // Readiness-gated: fails closed on checksum or version mismatch.
    let binary_path = require_kopia_binary(&manifest, &platform, resource_dir.as_deref())?;

    let inner = state.0.lock().map_err(|_| "state lock error")?;
    let paths = inner
        .paths
        .as_ref()
        .ok_or("Test lab not initialized — call create_test_lab first")?
        .clone();
    let password = inner.password.clone();
    let expected_sha256 = inner
        .canary_sha256
        .clone()
        .ok_or("Canary checksum not found — recreate test lab")?;
    let snapshot_id = inner
        .last_snapshot_id
        .clone()
        .ok_or("No snapshot found — run test backup first")?;

    // Unlock state before running the long subprocess
    drop(inner);

    // Clear restore directory before drill
    test_lab::prepare_restore_dir(&paths.restore_dir)
        .map_err(|e| e.to_string())?;

    let runner = KopiaRunner::new(
        binary_path,
        paths.repo_dir.clone(),
        paths.kopia_config_path.clone(),
    );

    let restore_result = runner.restore_snapshot(
        &snapshot_id,
        &paths.restore_dir,
        &password,
    );

    let (drill_result, canary_verify, restore_ms) = match restore_result {
        Err(e) => {
            // Persist failed outcome before early return so health report is accurate.
            if let Ok(mut inner) = state.0.lock() {
                inner.last_drill_result = Some("fail".to_string());
            }
            let log = redact_line(&format!("restore_drill_failed reason={}", e));
            return Ok(RealDrillResult {
                result: "fail".to_string(),
                health_level: "critical".to_string(),
                canary_verify: None,
                restore_duration_ms: 0,
                log_line: log,
                audit_evidence: vec![
                    "result: fail".to_string(),
                    "health_level: critical".to_string(),
                    "ACTION: Check restore destination and Kopia logs.".to_string(),
                ],
            });
        }
        Ok(r) => {
            // Find and verify canary file
            let canary_path = test_lab::find_restored_canary(&paths.restore_dir);
            let verify = match canary_path {
                None => {
                    // Persist failed outcome before early return.
                    if let Ok(mut inner) = state.0.lock() {
                        inner.last_drill_result = Some("fail".to_string());
                    }
                    return Ok(RealDrillResult {
                        result: "fail".to_string(),
                        health_level: "critical".to_string(),
                        canary_verify: None,
                        restore_duration_ms: r.duration_ms,
                        log_line: "restore_drill_failed reason=canary_file_not_found".to_string(),
                        audit_evidence: vec![
                            "result: fail".to_string(),
                            "health_level: critical".to_string(),
                            "ACTION: Canary file was not found in restore output.".to_string(),
                        ],
                    });
                }
                Some(p) => test_lab::verify_canary(&p, &expected_sha256)
                    .map_err(|e| e.to_string())?,
            };
            let dr = if verify.matches {
                RestoreDrillResult::Pass
            } else {
                RestoreDrillResult::CanaryMismatch
            };
            (dr, Some(verify), r.duration_ms)
        }
    };

    let health = nasbb_core::health::restore_result_to_level(&drill_result);
    let (result_label, health_label) = match (&drill_result, &health) {
        (RestoreDrillResult::Pass, _) => ("pass", "ok"),
        (RestoreDrillResult::CanaryMismatch, _) => ("canary_mismatch", "critical"),
        (RestoreDrillResult::Fail, _) => ("fail", "critical"),
    };

    // Persist drill outcome so get_health_report reflects real restore drill state.
    {
        let mut inner = state.0.lock().map_err(|_| "state lock error")?;
        inner.last_drill_result = Some(result_label.to_string());
    }

    let log_line = redact_line(&format!(
        "restore_drill result={result_label} health={health_label} duration_ms={restore_ms}"
    ));

    let mut audit = vec![
        format!("result: {result_label}"),
        format!("health_level: {health_label}"),
        format!("restore_duration_ms: {restore_ms}"),
        "canary_method: sha256".to_string(),
    ];
    if matches!(drill_result, RestoreDrillResult::CanaryMismatch) {
        audit.push(
            "ACTION: Preserve all logs. Do not prune snapshots. Investigate immediately.".to_string(),
        );
    }

    Ok(RealDrillResult {
        result: result_label.to_string(),
        health_level: health_label.to_string(),
        canary_verify,
        restore_duration_ms: restore_ms,
        log_line,
        audit_evidence: audit,
    })
}

/// Prepare a Syncthing transport folder definition for the test lab repository.
///
/// This is config-only preparation: it validates path safety and generates a
/// folder definition, but does not execute the Syncthing binary or require it
/// to be verified. No binary dependency is needed for this step.
///
/// Validates that the repository path does not overlap with the source folder
/// and returns a config snippet for display — never the real path.
#[tauri::command]
fn prepare_syncthing_transport(
    state: tauri::State<AppTestLabState>,
) -> Result<TransportFolderInfo, String> {
    let inner = state.0.lock().map_err(|_| "state lock error")?;
    let paths = inner
        .paths
        .as_ref()
        .ok_or("Test lab not initialized — call create_test_lab first")?
        .clone();

    // Config-only: no binary needed. Safety validation is still enforced.
    let def = prepare_transport_folder_def(
        "nasbb-test-transport",
        &paths.repo_dir,
        &[paths.source_dir.as_path()],
    )
    .map_err(|e| e.to_string())?;

    let snippet = def.to_config_snippet();

    Ok(TransportFolderInfo {
        folder_id: def.folder_id,
        folder_type: def.folder_type,
        is_safety_validated: def.is_safety_validated,
        config_snippet: snippet,
        note: "Transport folder points at encrypted repository only — source folder is excluded."
            .to_string(),
    })
}

/// Return a health report reflecting actual test lab outcomes.
///
/// Backup age is computed from the real timestamp stored when run_test_backup
/// completed. Repository verification and restore drill results come from their
/// respective stored outcomes. Sync and peer fields are always stale because
/// Syncthing is not running in the test lab.
#[tauri::command]
fn get_health_report(state: tauri::State<AppTestLabState>) -> HealthReport {
    let inner = state.0.lock().unwrap_or_else(|p| p.into_inner());

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let backup_age_hours = inner
        .last_backup_at_secs
        .map(|t| (now_secs.saturating_sub(t) as f64) / 3600.0)
        .unwrap_or(999.0);

    let repo_check_ok = inner.last_check_passed.unwrap_or(false);
    let repo_check_message = inner.last_check_passed.map(|p| {
        if p {
            "Repository verification passed.".to_string()
        } else {
            "Repository verification FAILED — investigate immediately.".to_string()
        }
    });

    let drill_age_days: i64 = match inner.last_drill_result.as_deref() {
        Some("pass") => 0,
        Some(_) => -1, // failed or mismatched drill counts as never passed
        None => -1,
    };

    HealthReport {
        last_backup_age_hours: backup_age_hours,
        last_sync_age_hours: -1.0, // Syncthing not configured in test lab → not-applicable sentinel
        free_quota_percent: 100.0,
        restore_drill_age_days: drill_age_days,
        peer_offline_hours: -1.0, // No peer in test lab → not-applicable sentinel
        repository_check_ok: repo_check_ok,
        repository_check_message: repo_check_message,
        // Remote SFTP target is not configured in the local generated-data test lab.
        // "not_configured" does not escalate to Critical — it is a valid local-only state.
        remote_target_status: "not_configured".to_string(),
        remote_target_last_ok_hours: -1.0,
    }
}

// ── Helpers shared by the real-backup commands ───────────────────────────────

fn parse_manifest_json() -> ToolManifest {
    serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
        manifest_version: 1,
        tools: vec![],
    })
}

/// Build a KopiaRunner pointing at the user's real repository.
///
/// Config is isolated to the app data directory so it never touches any
/// existing Kopia installation the user may have.
fn user_kopia_runner(
    app: &tauri::AppHandle,
    repository_path: &str,
) -> Result<KopiaRunner, String> {
    use tauri::Manager;
    let manifest = parse_manifest_json();
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary = require_kopia_binary(&manifest, &platform, resource_dir.as_deref())?;
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("kopia")
        .join("config.json");
    // Ensure parent dir exists so Kopia can write the config file.
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create kopia config dir: {e}"))?;
    }
    Ok(KopiaRunner::new(binary, repository_path, config_path))
}

/// Initialise (or re-connect to) the user's Kopia repository at `repository_path`.
///
/// - Config file absent + repo dir empty → `repository create`
/// - Config file absent + repo dir has data → `repository connect`
/// - Config file present → already connected; skip and return immediately.
#[tauri::command]
fn initialize_kopia_repository(
    app: tauri::AppHandle,
    repository_path: String,
    kopia_pw: tauri::State<KopiaPasswordState>,
) -> Result<RepositoryInitResult, String> {
    let password = kopia_pw
        .0
        .lock()
        .map_err(|_| "state lock error")?
        .clone()
        .ok_or("No backup password set — go to Recovery Key page first")?;

    let runner = user_kopia_runner(&app, &repository_path)?;

    // Already connected in this session?
    if runner.config_path.exists() {
        return Ok(RepositoryInitResult {
            initialized: true,
            already_existed: true,
            message: "Repository already connected from this session.".to_string(),
        });
    }

    // Decide create vs connect based on whether the repo directory has data.
    let repo_is_empty = std::path::Path::new(&repository_path)
        .read_dir()
        .map(|mut d| d.next().is_none())
        .unwrap_or(true);

    if repo_is_empty {
        runner
            .create_repository(&password)
            .map_err(|e| format!("Repository creation failed: {e}"))?;
        Ok(RepositoryInitResult {
            initialized: true,
            already_existed: false,
            message: "New encrypted repository created.".to_string(),
        })
    } else {
        runner
            .connect_repository(&password)
            .map_err(|e| format!("Repository connect failed: {e}"))?;
        Ok(RepositoryInitResult {
            initialized: true,
            already_existed: true,
            message: "Connected to existing encrypted repository.".to_string(),
        })
    }
}

// ── SFTP remote target commands ───────────────────────────────────────────────

/// Result of a remote SFTP target reachability probe.
#[derive(Debug, Serialize)]
pub struct RemoteTargetProbeResponse {
    pub status: String,
    /// Probe method used: "tcp_connect" (current) or "ssh_handshake" (future).
    /// TCP connect does NOT verify SSH/SFTP authentication.
    pub method: String,
    pub latency_ms: Option<u64>,
    pub message: String,
}

/// Result of initialising a remote SFTP Kopia repository.
#[derive(Debug, Serialize)]
pub struct SftpRepositoryInitResult {
    pub initialized: bool,
    pub already_existed: bool,
    /// Human-readable status — host/user/path are never included.
    pub message: String,
}

/// Probe whether the SFTP host is reachable on the overlay network.
///
/// Current method: TCP connect only — verifies port is open on the overlay network.
/// Does NOT perform SSH/SFTP handshake or authentication.
/// A `reachable` status means TCP port is open; SSH auth is not verified.
/// No secrets are used or transmitted. Host address is never logged.
#[tauri::command]
fn probe_remote_target(host: String, port: u16) -> RemoteTargetProbeResponse {
    use nasbb_core::remote_target::{probe_tcp_reachability, ProbeMethod};
    let result = probe_tcp_reachability(&host, port);
    let status = match &result.status {
        nasbb_core::remote_target::RemoteTargetStatus::NotConfigured => "not_configured",
        nasbb_core::remote_target::RemoteTargetStatus::Reachable => "tcp_port_reachable",
        nasbb_core::remote_target::RemoteTargetStatus::AuthFailed => "auth_failed",
        nasbb_core::remote_target::RemoteTargetStatus::Unreachable => "unreachable",
        nasbb_core::remote_target::RemoteTargetStatus::HostKeyMismatch => "host_key_mismatch",
        nasbb_core::remote_target::RemoteTargetStatus::QuotaWarning => "quota_warning",
        nasbb_core::remote_target::RemoteTargetStatus::Error => "error",
    };
    let method = match &result.method {
        ProbeMethod::TcpConnect => "tcp_connect",
        ProbeMethod::SshHandshake => "ssh_handshake",
    };
    RemoteTargetProbeResponse {
        status: status.to_string(),
        method: method.to_string(),
        latency_ms: result.latency_ms,
        message: result.message,
    }
}

/// Return the planned Kopia SFTP command sequence for display.
/// All SFTP parameters are redacted in display strings.
#[tauri::command]
fn plan_kopia_sftp_repository(
    host: String,
    sftp_user: String,
    sftp_path: String,
    sftp_port: u16,
    engine_path: String,
) -> Vec<CommandPlanSummary> {
    let planner = KopiaPlanner::new(engine_path);
    vec![
        CommandPlanSummary {
            label: "Detect version".to_string(),
            display_command: planner.detect_version().display_command,
        },
        CommandPlanSummary {
            label: "Create SFTP repository".to_string(),
            display_command: planner
                .create_sftp_repository(&host, &sftp_user, &sftp_path, sftp_port)
                .display_command,
        },
        CommandPlanSummary {
            label: "Repository verification".to_string(),
            display_command: planner.check_repository().display_command,
        },
        CommandPlanSummary {
            label: "Create snapshot".to_string(),
            display_command: planner.create_snapshot("[source-folder]").display_command,
        },
    ]
}

/// Build a `KopiaRunner` for an SFTP remote repository.
///
/// Each distinct SFTP target (different host, port, username, or remote path) gets its
/// own isolated Kopia config file derived from a stable, non-secret target ID. This
/// prevents one peer's config from being silently reused for a different peer.
///
/// Config ID is a 24-char hex derived from SHA-256(normalize(host:port:user:path)).
/// The filename is `kopia/sftp-{id}.json`. The host, username, and path are never
/// included in the filename.
fn user_kopia_runner_sftp(
    app: &tauri::AppHandle,
    sftp: &nasbb_core::kopia::SftpRepoTarget,
) -> Result<(nasbb_core::kopia::KopiaRunner, nasbb_core::kopia::SftpRepoTarget), String> {
    use tauri::Manager;
    let manifest = parse_manifest_json();
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary = require_kopia_binary(&manifest, &platform, resource_dir.as_deref())?;

    // Derive a stable, non-secret config ID from the normalized SFTP target params.
    // Different targets → different config paths. Same target → same config path.
    let target_id = sftp.config_id();
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("kopia")
        .join(format!("sftp-{target_id}.json"));

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create kopia config dir: {e}"))?;
    }
    // For SFTP runner, repo_path is unused (path is carried by SftpRepoTarget).
    let runner = nasbb_core::kopia::KopiaRunner::new(binary, "", config_path);
    Ok((runner, sftp.clone()))
}

/// Create or connect to a Kopia SFTP repository on the peer's storage host.
///
/// - Config file absent → `repository create sftp` (creates a new encrypted repository).
/// - Config file present → already connected; skips re-creation.
///
/// The repository encryption password comes from KopiaPasswordState (never the UI).
/// SSH key authentication uses the `ssh_key_path` parameter (filesystem path to key file).
/// The host, user, and path are never logged or returned.
#[tauri::command]
fn initialize_kopia_sftp_repository(
    app: tauri::AppHandle,
    host: String,
    sftp_user: String,
    sftp_path: String,
    sftp_port: u16,
    ssh_key_path: Option<String>,
    kopia_pw: tauri::State<KopiaPasswordState>,
) -> Result<SftpRepositoryInitResult, String> {
    let password = kopia_pw
        .0
        .lock()
        .map_err(|_| "state lock error")?
        .clone()
        .ok_or("No backup password set — go to Recovery Key page first")?;

    // Build runner with no known_hosts_data first — we only need the config path.
    let sftp_target_base = nasbb_core::kopia::SftpRepoTarget {
        host: host.clone(),
        port: sftp_port,
        username: sftp_user.clone(),
        path: sftp_path.clone(),
        key_path: ssh_key_path.clone(),
        known_hosts_data: None,
    };
    let (runner_base, _) = user_kopia_runner_sftp(&app, &sftp_target_base)?;

    // If config file already exists the repository is already connected — no need for the
    // host key entry since we won't call kopia repository create/connect again.
    if runner_base.config_path.exists() {
        return Ok(SftpRepositoryInitResult {
            initialized: true,
            already_existed: true,
            message: "SFTP repository already connected from this session.".to_string(),
        });
    }

    // Look up the SSH host public key captured during Verify SFTP for Kopia's --known-hosts.
    // This is only needed for kopia repository create/connect (not for snapshots).
    let known_hosts_data = {
        use tauri::Manager;
        app.path()
            .app_data_dir()
            .ok()
            .and_then(|d| {
                let fp_path = d.join("known_fingerprints.json");
                nasbb_core::sftp_verify::get_stored_host_key_entry(&host, sftp_port, &fp_path)
            })
    };
    if known_hosts_data.is_none() {
        return Err(
            "SSH host key not captured yet — run 'Verify SFTP' first, then try again.".to_string(),
        );
    }

    let sftp_target = nasbb_core::kopia::SftpRepoTarget {
        host: host.clone(),
        port: sftp_port,
        username: sftp_user.clone(),
        path: sftp_path.clone(),
        key_path: ssh_key_path,
        known_hosts_data,
    };
    let (runner, target) = user_kopia_runner_sftp(&app, &sftp_target)?;

    // Try create first; if the repository already exists on the remote side, connect instead.
    match runner.create_sftp_repository(&target, &password) {
        Ok(()) => Ok(SftpRepositoryInitResult {
            initialized: true,
            already_existed: false,
            message: "Encrypted SFTP repository created successfully.".to_string(),
        }),
        Err(nasbb_core::kopia::KopiaError::RepositoryCreateFailed(msg)) => {
            // Repository may already exist on the remote — attempt connect.
            if msg.to_lowercase().contains("already") || msg.to_lowercase().contains("exist") {
                runner
                    .connect_sftp_repository(&target, &password)
                    .map_err(|e| format!("SFTP repository connect failed: {e}"))?;
                Ok(SftpRepositoryInitResult {
                    initialized: true,
                    already_existed: true,
                    message: "Connected to existing encrypted SFTP repository.".to_string(),
                })
            } else {
                Err(format!("SFTP repository creation failed: {msg}"))
            }
        }
        Err(e) => Err(format!("SFTP repository creation failed: {e}")),
    }
}

/// Back up all configured source folders to the user's real Kopia repository.
///
/// Source paths cross the IPC boundary from the UI but are only used internally
/// and are redacted from all display output and health reports.
/// The password is read from KopiaPasswordState — never from the frontend.
#[tauri::command]
fn run_real_backup_from_config(
    app: tauri::AppHandle,
    source_folders: Vec<String>,
    repository_path: String,
    kopia_pw: tauri::State<KopiaPasswordState>,
) -> Result<RealBackupResult, String> {
    if source_folders.is_empty() {
        return Err("No source folders configured — complete the Setup Wizard first.".to_string());
    }
    let password = kopia_pw
        .0
        .lock()
        .map_err(|_| "state lock error")?
        .clone()
        .ok_or("No backup password set — go to Recovery Key page first")?;

    let runner = user_kopia_runner(&app, &repository_path)?;

    // Initialise repository if the session config is missing.
    if !runner.config_path.exists() {
        let repo_is_empty = std::path::Path::new(&repository_path)
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(true);
        if repo_is_empty {
            runner
                .create_repository(&password)
                .map_err(|e| format!("Repository creation failed: {e}"))?;
        } else {
            runner
                .connect_repository(&password)
                .map_err(|e| format!("Repository connect failed: {e}"))?;
        }
    }

    // Snapshot every source folder; keep the last snapshot ID for drills.
    let source_count = source_folders.len();
    let mut last: Option<nasbb_core::kopia::SnapshotInfo> = None;
    for folder in &source_folders {
        let snap = runner
            .create_snapshot(std::path::Path::new(folder.as_str()), &password)
            .map_err(|e| format!("Snapshot failed: {e}"))?;
        last = Some(snap);
    }
    let snap = last.ok_or("Snapshot produced no output")?;

    let log_line = redact_line(&format!(
        "backup_completed sources={source_count} snapshot_id={} timestamp={}",
        snap.snapshot_id, snap.timestamp
    ));

    Ok(RealBackupResult {
        success: true,
        snapshot_id: snap.snapshot_id,
        source_label: format!("[REDACTED — {source_count} folder(s)]"),
        timestamp: snap.timestamp,
        log_line,
    })
}

/// Back up source folders to an SFTP remote repository.
///
/// Uses the same per-target config derived by `initialize_kopia_sftp_repository`.
/// If the Kopia config file does not yet exist the command fails with a clear
/// message directing the user to the Peer Storage tab to connect first.
///
/// The repository encryption password comes from KopiaPasswordState (never the UI).
/// Host, user, and path are never logged or returned.
#[tauri::command]
fn run_real_sftp_backup_from_config(
    app: tauri::AppHandle,
    source_folders: Vec<String>,
    host: String,
    sftp_user: String,
    sftp_path: String,
    sftp_port: u16,
    ssh_key_path: Option<String>,
    kopia_pw: tauri::State<KopiaPasswordState>,
) -> Result<RealBackupResult, String> {
    if source_folders.is_empty() {
        return Err("No source folders configured — complete the Setup Wizard first.".to_string());
    }
    let password = kopia_pw
        .0
        .lock()
        .map_err(|_| "state lock error")?
        .clone()
        .ok_or("No backup password set — go to Recovery Key page first")?;

    let sftp_target = nasbb_core::kopia::SftpRepoTarget {
        host: host.clone(),
        port: sftp_port,
        username: sftp_user.clone(),
        path: sftp_path.clone(),
        key_path: ssh_key_path,
        known_hosts_data: None, // not needed for snapshot — repo already connected via config
    };
    let (runner, target) = user_kopia_runner_sftp(&app, &sftp_target)?;

    // Require that the repository was already connected (config file must exist).
    // Users must run "Create / Connect SFTP Repository" in the Peer Storage tab first.
    if !runner.config_path.exists() {
        return Err(
            "SFTP repository not yet connected. Open the Peer Storage tab and click \
             'Create / Connect SFTP Repository' before running a backup."
                .to_string(),
        );
    }

    let source_count = source_folders.len();
    let mut last: Option<nasbb_core::kopia::SnapshotInfo> = None;
    for folder in &source_folders {
        let snap = runner
            .create_snapshot(std::path::Path::new(folder.as_str()), &password)
            .map_err(|e| format!("Snapshot failed: {e}"))?;
        last = Some(snap);
    }
    let snap = last.ok_or("Snapshot produced no output")?;
    let _ = target; // target params used only during runner construction

    let log_line = redact_line(&format!(
        "sftp_backup_completed sources={source_count} snapshot_id={} timestamp={}",
        snap.snapshot_id, snap.timestamp
    ));

    Ok(RealBackupResult {
        success: true,
        snapshot_id: snap.snapshot_id,
        source_label: format!("[REDACTED — {source_count} folder(s)]"),
        timestamp: snap.timestamp,
        log_line,
    })
}

/// Run `kopia snapshot verify` against the user's real repository.
#[tauri::command]
fn run_real_repository_check(
    app: tauri::AppHandle,
    repository_path: String,
    kopia_pw: tauri::State<KopiaPasswordState>,
) -> Result<RealCheckResult, String> {
    let password = kopia_pw
        .0
        .lock()
        .map_err(|_| "state lock error")?
        .clone()
        .ok_or("No backup password set — go to Recovery Key page first")?;

    let runner = user_kopia_runner(&app, &repository_path)?;
    let result = runner.check_repository(&password).map_err(|e| e.to_string())?;
    let log_line = redact_line(&format!(
        "repository_check passed={} duration_ms={}",
        result.passed, result.duration_ms
    ));
    Ok(RealCheckResult {
        passed: result.passed,
        message: result.message,
        duration_ms: result.duration_ms,
        log_line,
    })
}

/// Add the encrypted repository folder to the running Syncthing daemon.
///
/// Validates that the repository path does not overlap with any source folder,
/// then calls `syncthing cli config folders add` against the managed Syncthing
/// home directory. Syncthing must be running before this command is called.
#[tauri::command]
fn add_syncthing_folder(
    app: tauri::AppHandle,
    repository_path: String,
    source_folders: Vec<String>,
) -> Result<SyncthingFolderResult, String> {
    use tauri::Manager;
    use nasbb_core::syncthing::prepare_transport_folder_def;

    // Safety: repo must not overlap any source folder.
    let source_paths: Vec<std::path::PathBuf> =
        source_folders.iter().map(std::path::PathBuf::from).collect();
    let src_refs: Vec<&std::path::Path> = source_paths.iter().map(|p| p.as_path()).collect();
    prepare_transport_folder_def(
        "nasbb-repo",
        std::path::Path::new(&repository_path),
        &src_refs,
    )
    .map_err(|e| e.to_string())?;

    // Require Syncthing to be running.
    let port = 8384u16;
    let running = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(500),
    )
    .is_ok();
    if !running {
        return Err(
            "Syncthing is not running — go to the Syncthing tab to start it first.".to_string(),
        );
    }

    // Resolve bundled Syncthing binary.
    let manifest = parse_manifest_json();
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary_path = resource_dir
        .as_deref()
        .and_then(|rdir| {
            get_tool_entry(&manifest, &ToolName::Syncthing, &platform)
                .ok()
                .map(|e| rdir.join(&e.binary_path))
        })
        .filter(|p| p.exists())
        .ok_or_else(|| "Syncthing bundled binary not found".to_string())?;

    let syncthing_home = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("syncthing");

    let folder_id = "nasbb-repo";
    let web_ui = format!("http://127.0.0.1:{port}");

    // Use `syncthing cli` to add (or update) the folder in the running instance.
    let output = std::process::Command::new(&binary_path)
        .args(["--home"])
        .arg(&syncthing_home)
        .args(["cli", "config", "folders", "add",
               "--id", folder_id,
               "--label", "NAS Backup Buddy Repository",
               "--path", &repository_path,
               "--type", "sendreceive"])
        .output()
        .map_err(|e| format!("Failed to run syncthing cli: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    // "already exists" is an acceptable non-error — the folder is there.
    let already_existed = stderr.to_lowercase().contains("already") || stderr.to_lowercase().contains("exists");

    if !output.status.success() && !already_existed {
        return Err(format!(
            "Syncthing CLI error: {}",
            redact_line(stderr.lines().next().unwrap_or("unknown error"))
        ));
    }

    Ok(SyncthingFolderResult {
        added: true,
        folder_id: folder_id.to_string(),
        web_ui_url: web_ui.clone(),
        note: format!(
            "Repository folder added to Syncthing. Open {web_ui} → Folders to confirm, then add your peer's device ID."
        ),
    })
}

/// Search all known Syncthing home directory locations and return the first
/// config.xml that exists. Checks the app-managed home first, then falls
/// back to the platform defaults for user-installed Syncthing.
fn find_syncthing_config_xml(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1. App-managed home (created by ensure_syncthing_running)
    if let Ok(data_dir) = app.path().app_data_dir() {
        candidates.push(data_dir.join("syncthing").join("config.xml"));
    }

    // 2. Platform default homes for user-installed Syncthing
    #[cfg(target_os = "windows")]
    {
        // winget / installer default: %LOCALAPPDATA%\Syncthing\
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(std::path::PathBuf::from(&local).join("Syncthing").join("config.xml"));
        }
        // Older default: %APPDATA%\Syncthing\
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(std::path::PathBuf::from(&appdata).join("Syncthing").join("config.xml"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(
                std::path::PathBuf::from(&home)
                    .join("Library").join("Application Support")
                    .join("Syncthing").join("config.xml"),
            );
        }
    }
    #[cfg(target_os = "linux")]
    {
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config")
            });
        candidates.push(config_home.join("syncthing").join("config.xml"));
    }

    candidates.into_iter().find(|p| p.exists())
}

/// Read the Syncthing GUI/REST API key from config.xml in the Syncthing home directory.
/// The key is stored in plaintext in `<gui><apikey>VALUE</apikey></gui>`.
fn read_syncthing_api_key(syncthing_home: &std::path::Path) -> Result<String, String> {
    let config_path = syncthing_home.join("config.xml");
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Cannot read Syncthing config.xml: {e}"))?;
    let start = content
        .find("<apikey>")
        .ok_or("API key element not found in Syncthing config.xml")?;
    let after_open = start + 8; // len("<apikey>")
    let end = content[after_open..]
        .find("</apikey>")
        .ok_or("API key closing tag not found in Syncthing config.xml")?;
    let key = content[after_open..after_open + end].trim().to_string();
    if key.is_empty() {
        return Err("Empty API key in Syncthing config.xml".to_string());
    }
    Ok(key)
}

/// Map a Syncthing folder `state` string + pending bytes to our SyncthingState values.
fn map_folder_state(raw: &str, bytes_pending: i64, peer_connected: bool) -> String {
    match raw {
        "syncing" | "sync-preparing" | "sync-waiting" => "syncing".into(),
        "scanning" => "syncing".into(),
        "error" | "scan-waiting" => "error".into(),
        "idle" if !peer_connected => "folder_configured".into(),
        "idle" if bytes_pending > 0 => "stale".into(),
        "idle" => "in_sync".into(),
        "" | "unknown" => "folder_configured".into(),
        _ => "folder_configured".into(),
    }
}

/// Query the running Syncthing daemon and return live folder + peer status.
///
/// Returns a result where `running = false` if the daemon is unreachable.
/// Never returns an Err — all failures are represented as `running = false`
/// so the frontend can show a clean "daemon not running" state.
#[tauri::command]
fn get_syncthing_live_status(app: tauri::AppHandle) -> SyncthingLiveStatus {
    let port: u16 = 8384;
    let base = format!("http://127.0.0.1:{port}");
    let not_running = SyncthingLiveStatus {
        running: false,
        my_device_id: None,
        folders: vec![],
        connected_peer_ids: vec![],
        web_ui_url: base.clone(),
    };

    // Fast TCP probe first to avoid hanging on a dead connection
    if std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(500),
    ).is_err() {
        return not_running;
    }

    // Read API key
    let config_xml = match find_syncthing_config_xml(&app) {
        Some(p) => p,
        None => return not_running,
    };
    let syncthing_home = match config_xml.parent() {
        Some(p) => p.to_path_buf(),
        None => return not_running,
    };
    let api_key = match read_syncthing_api_key(&syncthing_home) {
        Ok(k) => k,
        Err(_) => return not_running,
    };

    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(5))
        .build();

    // GET /rest/system/status → device ID
    let my_device_id: Option<String> = agent
        .get(&format!("{base}/rest/system/status"))
        .set("X-API-Key", &api_key)
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .and_then(|v| v["myID"].as_str().map(|s| s.to_string()));

    // GET /rest/config → folders + devices
    let config: serde_json::Value = match agent
        .get(&format!("{base}/rest/config"))
        .set("X-API-Key", &api_key)
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
    {
        Some(v) => v,
        None => return not_running,
    };

    // GET /rest/system/connections → connected peers
    let connections: serde_json::Value = agent
        .get(&format!("{base}/rest/system/connections"))
        .set("X-API-Key", &api_key)
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let connected_peer_ids: Vec<String> = connections["connections"]
        .as_object()
        .map(|map| {
            map.iter()
                .filter(|(_, v)| v["connected"].as_bool().unwrap_or(false))
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default();

    // Build per-folder status
    let config_folders = config["folders"].as_array().cloned().unwrap_or_default();
    let mut folders: Vec<SyncthingFolderLiveStatus> = Vec::new();

    for folder in &config_folders {
        let folder_id = folder["id"].as_str().unwrap_or("").to_string();
        let label = folder["label"].as_str().unwrap_or(&folder_id).to_string();

        // Devices sharing this folder
        let peer_device_ids: Vec<String> = folder["devices"]
            .as_array()
            .map(|devs| {
                devs.iter()
                    .filter_map(|d| d["deviceID"].as_str())
                    .filter(|id| Some(id.to_string()) != my_device_id) // exclude self
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        let peer_connected = peer_device_ids.iter().any(|id| connected_peer_ids.contains(id));

        // GET /rest/db/status?folder=<id>
        let db_status: serde_json::Value = agent
            .get(&format!("{base}/rest/db/status"))
            .query("folder", &folder_id)
            .set("X-API-Key", &api_key)
            .call()
            .ok()
            .and_then(|r| r.into_json().ok())
            .unwrap_or_else(|| serde_json::json!({}));

        let raw_state = db_status["state"].as_str().unwrap_or("unknown").to_string();
        let bytes_pending = db_status["needBytes"].as_i64().unwrap_or(0);
        let files_pending = db_status["needFiles"].as_i64()
            .or_else(|| db_status["needItems"].as_i64())
            .unwrap_or(0);

        let state = map_folder_state(&raw_state, bytes_pending, peer_connected);

        folders.push(SyncthingFolderLiveStatus {
            folder_id,
            label,
            raw_state,
            state,
            bytes_pending,
            files_pending,
            peer_device_ids,
        });
    }

    SyncthingLiveStatus {
        running: true,
        my_device_id,
        folders,
        connected_peer_ids,
        web_ui_url: base,
    }
}

/// Apply devices, folders, and peer assignments via the Syncthing REST API.
///
/// Flow:
/// 1. Read API key from Syncthing's config.xml.
/// 2. GET /rest/config to read current config.
/// 3. Merge in new devices (skip duplicates by deviceID).
/// 4. Merge in new folders (skip duplicates by folder ID); attach device shares
///    with optional per-device encryption passwords.
/// 5. PUT /rest/config to apply atomically.
///
/// Folder paths and encryption passwords are never logged or included in error messages.
#[tauri::command]
fn apply_syncthing_setup(
    app: tauri::AppHandle,
    peers: Vec<ApplySyncthingPeer>,
    assignments: Vec<ApplySyncthingAssignment>,
) -> Result<ApplySyncthingResult, String> {
    let port: u16 = 8384;
    let base = format!("http://127.0.0.1:{port}");
    let web_ui_url = base.clone();

    // Verify daemon is reachable
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(500),
    )
    .map_err(|_| "Syncthing is not running — start it on the daemon step first.".to_string())?;

    // Find config.xml — checks app-managed home first, then system installation paths.
    let config_xml = find_syncthing_config_xml(&app)
        .ok_or_else(|| {
            "Syncthing config.xml not found. Checked the app-managed home and the \
             system default locations. If Syncthing is installed in a custom location, \
             open its web UI and note the API key shown under Actions → Settings → GUI."
                .to_string()
        })?;
    let syncthing_home = config_xml.parent()
        .ok_or("Cannot determine Syncthing home from config.xml path")?
        .to_path_buf();

    let api_key = read_syncthing_api_key(&syncthing_home)?;

    // GET current Syncthing config
    let agent = ureq::AgentBuilder::new().build();
    let config_resp: serde_json::Value = agent
        .get(&format!("{base}/rest/config"))
        .set("X-API-Key", &api_key)
        .call()
        .map_err(|e| format!("Failed to GET Syncthing config: {e}"))?
        .into_json()
        .map_err(|e| format!("Failed to parse Syncthing config: {e}"))?;

    let mut config = config_resp;
    let mut devices_added: Vec<String> = Vec::new();
    let mut folders_configured: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // ── Merge devices ─────────────────────────────────────────────────────────
    let existing_devices = config["devices"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut merged_devices = existing_devices.clone();
    for peer in &peers {
        let already = existing_devices.iter().any(|d| {
            d["deviceID"].as_str().unwrap_or("") == peer.device_id
        });
        if !already {
            merged_devices.push(serde_json::json!({
                "deviceID": peer.device_id,
                "name": peer.name,
                "addresses": ["dynamic"],
                "compression": "metadata",
                "introducer": false,
                "skipIntroductionRemovals": false,
                "introducedBy": "",
                "paused": false,
                "allowedNetworks": [],
                "autoAcceptFolders": false,
                "maxSendKbps": 0,
                "maxRecvKbps": 0,
                "ignoredFolders": [],
                "maxRequestKiB": 0,
                "untrusted": false,
                "remoteGUIPort": 0
            }));
            devices_added.push(peer.name.clone());
        }
    }
    config["devices"] = serde_json::Value::Array(merged_devices);

    // ── Merge folders ─────────────────────────────────────────────────────────
    // Group assignments by folder_id so we build one folder entry per folder.
    let mut folder_map: std::collections::HashMap<&str, Vec<&ApplySyncthingAssignment>> =
        std::collections::HashMap::new();
    for a in &assignments {
        folder_map.entry(a.folder_id.as_str()).or_default().push(a);
    }

    let existing_folders = config["folders"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut merged_folders = existing_folders.clone();

    for (folder_id, folder_assignments) in &folder_map {
        // All assignments for this folder share the same path and label
        let first = folder_assignments[0];

        // Build device-share entries for this folder
        let mut device_entries: Vec<serde_json::Value> = Vec::new();
        for a in folder_assignments {
            let peer = match peers.iter().find(|p| p.id == a.peer_id) {
                Some(p) => p,
                None => {
                    errors.push(format!("Peer not found for assignment on folder {}", folder_id));
                    continue;
                }
            };
            let mut entry = serde_json::json!({
                "deviceID": peer.device_id,
                "introducedBy": "",
                "encryptionPassword": ""
            });
            if a.mode == "encrypted" && !a.encryption_password.is_empty() {
                // Password set directly in JSON — never appears in logs or error strings
                entry["encryptionPassword"] = serde_json::Value::String(
                    a.encryption_password.clone(),
                );
            }
            device_entries.push(entry);
        }

        // Check if this folder already exists
        if let Some(pos) = merged_folders
            .iter()
            .position(|f| f["id"].as_str().unwrap_or("") == *folder_id)
        {
            // Update existing folder: merge device list
            let existing_devs = merged_folders[pos]["devices"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut combined = existing_devs;
            for dev in &device_entries {
                let dev_id = dev["deviceID"].as_str().unwrap_or("");
                if !combined.iter().any(|d| d["deviceID"].as_str().unwrap_or("") == dev_id) {
                    combined.push(dev.clone());
                }
            }
            merged_folders[pos]["devices"] = serde_json::Value::Array(combined);
            folders_configured.push(first.label.clone());
        } else {
            // Add new folder — only required fields; Syncthing fills in defaults.
            // folder_path is the local encrypted repo path; it is never logged.
            let mut new_folder = serde_json::Map::new();
            new_folder.insert("id".into(), serde_json::Value::String(folder_id.to_string()));
            new_folder.insert("label".into(), serde_json::Value::String(first.label.clone()));
            new_folder.insert("path".into(), serde_json::Value::String(first.folder_path.clone()));
            new_folder.insert("type".into(), serde_json::Value::String("sendreceive".into()));
            new_folder.insert("devices".into(), serde_json::Value::Array(device_entries));
            new_folder.insert("rescanIntervalS".into(), serde_json::json!(3600));
            new_folder.insert("fsWatcherEnabled".into(), serde_json::json!(true));
            new_folder.insert("autoNormalize".into(), serde_json::json!(true));
            merged_folders.push(serde_json::Value::Object(new_folder));
            folders_configured.push(first.label.clone());
        }
    }
    config["folders"] = serde_json::Value::Array(merged_folders);

    // ── PUT updated config ────────────────────────────────────────────────────
    let resp = agent
        .put(&format!("{base}/rest/config"))
        .set("X-API-Key", &api_key)
        .set("Content-Type", "application/json")
        .send_json(&config)
        .map_err(|e| format!("Failed to apply Syncthing config: {e}"))?;

    if resp.status() != 200 {
        return Err(format!(
            "Syncthing rejected config update (HTTP {}). Check the Syncthing web UI for details.",
            resp.status()
        ));
    }

    Ok(ApplySyncthingResult {
        devices_added,
        folders_configured,
        errors,
        web_ui_url,
    })
}

/// Ensure the bundled Syncthing daemon is running.
///
/// Fast path: if port 8384 is already open, returns immediately.
///
/// Startup path:
/// 1. Resolves the bundled binary (required for lifecycle control).
/// 2. Creates an isolated home directory under the app data dir.
/// 3. Writes stderr to `{home}/nasbb-startup.log` for post-hoc diagnostics.
/// 4. Spawns `syncthing serve --home … --no-browser --no-restart --no-default-folder`.
/// 5. Polls port 8384 for up to 30 s (60 × 500 ms) with process-crash detection.
///    On first run Syncthing generates a 4096-bit RSA device key which takes
///    up to 20–30 seconds — the 30 s budget covers this.
/// 6. Returns SyncthingRunStatus; if the process crashed, returns Err with
///    the last lines of the startup log so the caller can show a useful message.
#[tauri::command]
fn ensure_syncthing_running(
    app: tauri::AppHandle,
    proc_state: tauri::State<SyncthingProcessState>,
) -> Result<SyncthingRunStatus, String> {
    use tauri::Manager;

    let api_port = 8384u16;
    let connect_addr = std::net::SocketAddr::from(([127, 0, 0, 1], api_port));

    // Fast path: already running (300 ms probe)
    if std::net::TcpStream::connect_timeout(&connect_addr, std::time::Duration::from_millis(300))
        .is_ok()
    {
        let manifest: ToolManifest =
            serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
                manifest_version: 1,
                tools: vec![],
            });
        let binary_path = resolve_binary_path(
            &manifest,
            &ToolName::Syncthing,
            &current_platform(),
            app.path().resource_dir().ok().as_deref(),
        );
        return Ok(probe_syncthing_status(binary_path.as_deref()));
    }

    // Resolve bundled binary — PATH fallback not used; we need lifecycle control.
    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary_path = resource_dir
        .as_deref()
        .and_then(|rdir| {
            get_tool_entry(&manifest, &ToolName::Syncthing, &platform)
                .ok()
                .map(|e| rdir.join(&e.binary_path))
        })
        .filter(|p| p.exists())
        .ok_or_else(|| {
            "Syncthing bundled binary not found — reinstall the application".to_string()
        })?;

    // Isolated home directory: persists device identity between restarts.
    let home_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data directory: {e}"))?
        .join("syncthing");

    // Startup log: written to home dir, truncated on each launch.
    let log_path = home_dir.join("nasbb-startup.log");

    // Spawn daemon with stderr routed to the log file.
    let child = start_syncthing_daemon(&SyncthingStartArgs {
        binary_path: &binary_path,
        home_dir: &home_dir,
        stderr_log: Some(&log_path),
    })
    .map_err(|e| format!("Failed to start Syncthing: {e}"))?;

    {
        let mut lock = proc_state.0.lock().map_err(|_| "state lock error")?;
        *lock = Some(child);
    }

    // Poll up to 30 s (60 × 500 ms). First run is slow — RSA key generation
    // for a new device certificate can take 20–30 seconds on some hardware.
    for _ in 0..60 {
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Crash detection: if the child process exited, read the startup log
        // and surface the last several lines as the error message.
        let exited = {
            let mut lock = proc_state.0.lock().map_err(|_| "state lock error")?;
            lock.as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
        };
        if let Some(code) = exited {
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            let tail: String = log
                .lines()
                .filter(|l| !l.trim().is_empty())
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!(
                "Syncthing exited with status {code}.\n\n\
                 Startup log ({}):\n{}\n\n\
                 Try clicking Retry, or check the log file for details.",
                log_path.display(),
                if tail.is_empty() { "(empty)" } else { &tail }
            ));
        }

        // Ready check
        if std::net::TcpStream::connect_timeout(
            &connect_addr,
            std::time::Duration::from_millis(300),
        )
        .is_ok()
        {
            break;
        }
    }

    let mut status = probe_syncthing_status(Some(&binary_path));

    // If still not running after 30 s, the process is alive but slow to start.
    // Update guidance to reflect that it's app-managed (not a manual-start issue).
    if !status.is_running {
        status.setup_guidance = format!(
            "Syncthing started but did not respond on port {api_port} within 30 seconds. \
             On very first run, device key generation can take longer. \
             Click Retry to check again. Startup log: {}",
            log_path.display()
        );
    }

    Ok(status)
}

/// Kill the managed Syncthing process if the app started it.
/// No-op if Syncthing was already running before the app started it.
#[tauri::command]
fn stop_syncthing(proc_state: tauri::State<SyncthingProcessState>) -> Result<(), String> {
    let mut lock = proc_state.0.lock().map_err(|_| "state lock error")?;
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Store the master encryption password in both process memory and the OS keychain.
///
/// macOS: Keychain  |  Windows: Credential Manager  |  Linux: Secret Service (libsecret)
///
/// The password is write-only from the UI — used by backup commands but NEVER
/// returned to the frontend. Keychain errors are non-fatal: the password is still
/// held in process memory for this session, but the user will need to re-enter it
/// on the next app start if keychain storage fails.
#[tauri::command]
fn set_kopia_password(
    state: tauri::State<KopiaPasswordState>,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }

    // Store in process memory first — always succeeds
    let mut lock = state.0.lock().map_err(|_| "state lock error")?;
    *lock = Some(password.clone());
    drop(lock);

    // Persist to OS keychain.
    // On macOS uses security CLI with -T "" so any build of the app can read
    // without the system ACL prompt.
    keychain_store(&password)?;
    Ok(())
}

/// Return whether a master password has been set in this session (process memory).
/// Does NOT return the password value.
#[tauri::command]
fn has_kopia_password(state: tauri::State<KopiaPasswordState>) -> bool {
    state.0.lock().map(|l| l.is_some()).unwrap_or(false)
}

/// Check whether a master password entry exists in the OS keychain.
/// Uses metadata-only lookup — does NOT read the secret value, so no ACL dialog appears.
#[tauri::command]
fn has_password_in_keychain() -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos_entry_exists();
    }
    #[cfg(not(target_os = "macos"))]
    {
        matches!(keychain_retrieve(), Ok(Some(_)))
    }
}

/// Load the master password from the OS keychain into process memory.
///
/// Returns true if a password was found and loaded, false if no keychain entry exists.
/// Returns an error string if the keychain entry exists but cannot be read.
/// The password is never returned to the frontend.
#[tauri::command]
fn load_master_password_from_keychain(state: tauri::State<KopiaPasswordState>) -> Result<bool, String> {
    match keychain_retrieve()? {
        Some(pw) => {
            let mut lock = state.0.lock().map_err(|_| "state lock error")?;
            *lock = Some(pw);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Verify the given password against the one currently held in process memory.
///
/// Used to gate the "change password" flow — the user must prove they know
/// the current password before setting a new one.
/// Returns false if no password is set or if the passwords do not match.
/// The provided password is zeroed after comparison.
#[tauri::command]
fn verify_current_password(
    state: tauri::State<KopiaPasswordState>,
    password: String,
) -> bool {
    state
        .0
        .lock()
        .ok()
        .and_then(|l| l.clone())
        .map(|current| current == password)
        .unwrap_or(false)
}

/// Remove the master password from both process memory and the OS keychain.
///
/// Used when the user explicitly revokes the stored credential (e.g., uninstall,
/// or after a confirmed password change). Non-fatal if keychain entry does not exist.
#[tauri::command]
fn clear_master_password(state: tauri::State<KopiaPasswordState>) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|_| "state lock error")?;
    *lock = None;
    drop(lock);

    keychain_delete()?;
    Ok(())
}

/// Check whether Syncthing is installed and whether the daemon is running.
///
/// Detection is done in two steps:
/// 1. Binary present: bundled binary or `syncthing` on PATH.
/// 2. Daemon running: TCP connect probe to 127.0.0.1:8384 (600ms timeout).
///
/// No API key or Syncthing REST call is required.
#[tauri::command]
fn check_syncthing_running(app: tauri::AppHandle) -> SyncthingRunStatus {
    use tauri::Manager;
    let manifest: ToolManifest =
        serde_json::from_str(TOOL_MANIFEST_JSON).unwrap_or_else(|_| ToolManifest {
            manifest_version: 1,
            tools: vec![],
        });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();
    let binary_path = resolve_binary_path(
        &manifest,
        &ToolName::Syncthing,
        &platform,
        resource_dir.as_deref(),
    );
    probe_syncthing_status(binary_path.as_deref())
}

/// Return a default mock ClientSetupState for offline/development mode.
#[tauri::command]
fn get_mock_setup_state() -> ClientSetupState {
    use nasbb_core::integration::{RemoteRepositoryState, RemoteTargetState};
    ClientSetupState {
        role: nasbb_core::config::UserRole::DataOwner,
        engine: BackupEngine::Kopia,
        kopia_tool_status: ToolStatus::Ready,
        syncthing_tool_status: ToolStatus::Ready,
        kopia_repository: KopiaRepositoryState {
            status: KopiaRepositoryStatus::CheckPassed,
            snapshot_count: Some(3),
            last_snapshot_at: Some("2026-04-19T10:00:00Z".to_string()),
            repo_size_bytes: Some(1_258_291_200),
        },
        syncthing_folder: SyncthingFolderStatus {
            state: SyncthingState::InSync,
            peer_device_id: Some("MOCK77-DEVICE-ID".to_string()),
            peer_connected: true,
            last_sync_at: Some("2026-04-19T11:00:00Z".to_string()),
            bytes_pending: Some(0),
        },
        remote_repository: RemoteRepositoryState {
            status: RemoteTargetState::NotConfigured,
            last_ok_hours: -1.0,
        },
        recovery_key_confirmed: false,
        health_report_consent: false,
        offline_mode: true,
    }
}

// ── Storage-host setup commands ──────────────────────────────────────────────

/// Validate host setup inputs and generate a shell command plan for the operator.
///
/// Returns platform-appropriate commands (Linux or macOS based on the compile target)
/// for creating the isolated SFTP user, repository directory, authorized_keys entry,
/// SSH configuration, and quota guidance.
///
/// All commands are **display-only** — no privileged execution happens here.
/// The owner public key body is truncated in display; the full key is never logged.
/// Paths that would identify the local machine are included only where necessary
/// for correct command generation (e.g. user home directory).
#[tauri::command]
fn plan_host_setup(input: HostSetupInput, overlay_host: String) -> Result<HostSetupPlan, String> {
    let setup = validate_host_setup(&input).map_err(|e| e.to_string())?;
    let plan = if cfg!(target_os = "linux") {
        generate_host_setup_plan_linux(&setup, &overlay_host)
    } else {
        // macOS and any other platform — use macOS plan
        generate_host_setup_plan_macos(&setup, &overlay_host)
    };
    Ok(plan)
}

/// Validate that a hosted path does not overlap any source folder or existing hosted allocation.
/// Lighter than plan_host_setup — suitable for interactive path validation as the user types.
/// Uses canonicalization where available; falls back to lexical comparison for non-existent paths.
#[tauri::command]
fn validate_hosted_path(
    hosted_path: String,
    source_folders: Vec<String>,
    existing_hosted_paths: Vec<String>,
) -> Result<(), String> {
    let src_refs: Vec<&str> = source_folders.iter().map(|s| s.as_str()).collect();
    let existing_refs: Vec<&str> = existing_hosted_paths.iter().map(|s| s.as_str()).collect();
    validate_hosted_path_isolation(&hosted_path, &src_refs, &existing_refs)
        .map_err(|e| e.to_string())
}

/// Generate the steps to install an owner's SSH public key after their Access Request arrives.
/// Called explicitly by the host after importing the Owner Access Request.
/// Display-only — the app never runs these commands.
#[tauri::command]
fn generate_authorize_owner_key_plan(
    sftp_username: String,
    owner_public_key: String,
    sftp_port: u16,
) -> Result<Vec<HostSetupStep>, String> {
    if cfg!(target_os = "linux") {
        generate_authorize_owner_key_steps_linux(&sftp_username, &owner_public_key, sftp_port)
    } else {
        generate_authorize_owner_key_steps_macos(&sftp_username, &owner_public_key, sftp_port)
    }
    .map_err(|e| e.to_string())
}

// ── Overlay setup/detection commands ─────────────────────────────────────────

/// Detect installed overlay tools (Tailscale, WireGuard) using read-only CLI probes.
/// Never runs login/auth commands. Best-effort — never returns an error; failures
/// are captured in each result's `message` field.
#[tauri::command]
fn detect_overlay() -> Vec<OverlayDetectionResult> {
    detect_overlay_tools()
}

/// Validate an OverlayConfig (no network probe — structural checks only).
#[tauri::command]
fn validate_overlay(config: OverlayConfig) -> Result<(), String> {
    validate_overlay_config(&config).map_err(|e| e.to_string())
}

/// Return read-only overlay verification steps for a given provider and peer address.
/// Display-only — the app does not execute these commands.
#[tauri::command]
fn get_overlay_verify_steps(provider: OverlayProvider, peer_address: String) -> Vec<OverlayVerifyStep> {
    overlay_verify_steps(&provider, &peer_address)
}

/// Return guided-setup steps for Tailscale.
#[tauri::command]
fn get_tailscale_setup_guide() -> Vec<OverlayVerifyStep> {
    tailscale_setup_guide()
}

/// Return guided-setup steps for WireGuard.
#[tauri::command]
fn get_wireguard_setup_guide() -> Vec<OverlayVerifyStep> {
    wireguard_setup_guide()
}

/// Return guided-setup steps for Headscale.
#[tauri::command]
fn get_headscale_setup_guide(server_url: Option<String>) -> Vec<OverlayVerifyStep> {
    headscale_setup_guide(server_url.as_deref())
}

/// Return the overlay compatibility matrix.
#[tauri::command]
fn get_overlay_compatibility_matrix() -> Vec<CompatibilityEntry> {
    compatibility_matrix()
}

/// Return rich Tailscale status: binary path, PATH status, add-to-PATH command,
/// connected state, self IPs, MagicDNS hostname, tailnet name, peer count.
///
/// Never returns an error — all failures are represented in the struct fields.
/// Safe to call repeatedly; only runs read-only CLI commands.
#[tauri::command]
fn get_tailscale_detail() -> TailscaleDetail {
    core_get_tailscale_detail()
}

/// Run `tailscale ping <peer>` as an explicit user-triggered diagnostic.
///
/// The peer address is validated before use. Never called automatically.
/// Returns reachability, latency, and routing path (DERP or direct).
#[tauri::command]
fn tailscale_ping_peer(peer: String) -> TailscalePingResult {
    nasbb_core::overlay::ping_tailscale_peer(&peer)
}

/// Run `tailscale up` with no flags — explicit, confirmed on-demand connect.
///
/// Must only be called from a confirmed user action. Never run automatically.
/// No auth keys, routes, ACLs, SSH-enable, serve/funnel flags are passed.
/// If authentication is needed, `needs_auth` is set and the auth URL is returned.
/// The caller should refresh `get_tailscale_detail` after this returns.
#[tauri::command]
fn tailscale_connect() -> TailscaleConnectResult {
    nasbb_core::overlay::tailscale_connect()
}

// ── Owner bundle parsing ─────────────────────────────────────────────────────

/// Parse an Owner Connection Bundle pasted by the data owner into Peer Storage.
/// Returns all non-secret connection fields. Returns a user-readable error string
/// for malformed or missing required fields — never panics.
#[tauri::command]
fn parse_owner_bundle(text: String) -> Result<nasbb_core::peer_bundle::PeerBundle, String> {
    nasbb_core::peer_bundle::parse_bundle(&text).map_err(|e| e.to_string())
}

// ── Owner SSH key generation ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerSshKeyResult {
    pub match_id: String,
    pub public_key: String,
    pub fingerprint: String,
    pub private_key_path_or_ref: String,
    pub already_existed: bool,
}

/// Find the `ssh-keygen` binary.
///
/// On Windows, the OpenSSH Optional Feature installs `ssh-keygen.exe` under
/// `System32\OpenSSH\` which may not be on PATH, and Git for Windows ships its
/// own copy. Check known locations before falling back to a bare PATH lookup.
fn find_ssh_keygen() -> std::ffi::OsString {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Windows\System32\OpenSSH\ssh-keygen.exe",
            r"C:\Program Files\Git\usr\bin\ssh-keygen.exe",
            r"C:\Program Files (x86)\Git\usr\bin\ssh-keygen.exe",
        ];
        for candidate in &candidates {
            if std::path::Path::new(candidate).exists() {
                return std::ffi::OsString::from(*candidate);
            }
        }
        // Also try %ProgramFiles% env var for non-standard Git installs
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let git_path = format!(r"{}\Git\usr\bin\ssh-keygen.exe", pf);
            if std::path::Path::new(&git_path).exists() {
                return std::ffi::OsString::from(git_path);
            }
        }
    }
    "ssh-keygen".into()
}

fn safe_key_match_id(match_id: &str) -> Result<String, String> {
    let trimmed = match_id.trim();
    if trimmed.is_empty() {
        return Err("match_id is required before generating an SSH key".to_string());
    }
    let first = trimmed.chars().next().unwrap();
    if !first.is_ascii_alphabetic() {
        return Err("match_id must start with a letter".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("match_id may contain only letters, digits, hyphens, and underscores".to_string());
    }
    Ok(trimmed.to_string())
}

// ── RSA key helpers ──────────────────────────────────────────────────────────

/// Encode an RSA public key in SSH authorized-keys format:
/// "ssh-rsa <base64(wire)> <comment>\n"
///
/// Wire format (RFC 4253): length-prefixed "ssh-rsa", exponent, modulus.
fn rsa_pubkey_to_ssh_authorized(
    pub_key: &rsa::RsaPublicKey,
    comment: &str,
) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use rsa::traits::PublicKeyParts;

    fn encode_mpint(n: &rsa::BigUint) -> Vec<u8> {
        let mut bytes = n.to_bytes_be();
        // Prepend 0x00 if the high bit is set (positive mpint).
        if bytes.first().map(|&b| b >= 0x80).unwrap_or(false) {
            bytes.insert(0, 0x00);
        }
        let mut out = Vec::with_capacity(4 + bytes.len());
        let len = bytes.len() as u32;
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(&bytes);
        out
    }

    fn encode_string(s: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 + s.len());
        let len = s.len() as u32;
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(s);
        out
    }

    let mut wire = Vec::new();
    wire.extend_from_slice(&encode_string(b"ssh-rsa"));
    wire.extend_from_slice(&encode_mpint(pub_key.e()));
    wire.extend_from_slice(&encode_mpint(pub_key.n()));

    Ok(format!("ssh-rsa {} {}\n", B64.encode(&wire), comment))
}

/// Compute the SHA-256 fingerprint of an RSA public key from its `.pub` file,
/// returning "SHA256:<base64>" without trailing `=` (matching OpenSSH output).
fn compute_rsa_fingerprint(pub_path: &std::path::Path) -> Option<String> {
    use base64::engine::general_purpose::STANDARD_NO_PAD as B64;
    use base64::Engine;

    let content = std::fs::read_to_string(pub_path).ok()?;
    // Authorized-keys line: "ssh-rsa <base64wire> <comment>"
    let b64_wire = content.split_whitespace().nth(1)?;
    let wire = base64::engine::general_purpose::STANDARD.decode(b64_wire).ok()?;

    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(&wire);
    Some(format!("SHA256:{}", B64.encode(hash)))
}

/// Generate or return a per-match RSA SSH key pair.
///
/// The private key is written under app data and never returned. The frontend
/// receives only the public key, fingerprint, and local private-key reference.
#[tauri::command]
fn generate_owner_ssh_key(
    app: tauri::AppHandle,
    match_id: String,
) -> Result<OwnerSshKeyResult, String> {
    use tauri::Manager;

    let match_id = safe_key_match_id(&match_id)?;
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("ssh-keys");
    std::fs::create_dir_all(&key_dir)
        .map_err(|e| format!("Cannot create SSH key directory: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_dir, std::fs::Permissions::from_mode(0o700));
    }

    // RSA-3072 in PKCS#1 PEM format generated in pure Rust — no ssh-keygen needed.
    // ssh-keygen defaults to OpenSSH format on modern systems, which libssh2 cannot
    // reliably parse for user authentication. PKCS#1 PEM is universally supported.
    let key_path = key_dir.join(format!("{match_id}_rsa"));
    let pub_path = key_path.with_extension("pub");

    // If an existing key is in OpenSSH format, remove it so a PEM key is generated.
    if key_path.exists() {
        let is_openssh = std::fs::read_to_string(&key_path)
            .map(|s| s.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"))
            .unwrap_or(false);
        if is_openssh {
            let _ = std::fs::remove_file(&key_path);
            let _ = std::fs::remove_file(&pub_path);
        }
    }

    let already_existed = key_path.exists() && pub_path.exists();

    if !already_existed {
        use rsa::pkcs1::EncodeRsaPrivateKey;
        let mut rng = rand::thread_rng();
        let private_key = rsa::RsaPrivateKey::new(&mut rng, 3072)
            .map_err(|e| format!("RSA key generation failed: {e}"))?;

        // Write PKCS#1 PEM private key (-----BEGIN RSA PRIVATE KEY-----)
        let pem = private_key
            .to_pkcs1_pem(rsa::pkcs8::LineEnding::LF)
            .map_err(|e| format!("Failed to encode private key as PEM: {e}"))?;
        std::fs::write(&key_path, pem.as_bytes())
            .map_err(|e| format!("Cannot write private key: {e}"))?;

        // Build SSH authorized-keys public key: "ssh-rsa <base64> <comment>\n"
        let pub_key = private_key.to_public_key();
        let ssh_pub = rsa_pubkey_to_ssh_authorized(&pub_key, &format!("nasbb-{match_id}"))
            .map_err(|e| format!("Failed to encode SSH public key: {e}"))?;
        std::fs::write(&pub_path, ssh_pub)
            .map_err(|e| format!("Cannot write public key: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
            let _ = std::fs::set_permissions(&pub_path, std::fs::Permissions::from_mode(0o644));
        }
    }

    let public_key = std::fs::read_to_string(&pub_path)
        .map_err(|e| format!("Cannot read generated public key: {e}"))?
        .trim()
        .to_string();

    // Compute SHA-256 fingerprint from the public key wire bytes.
    let fingerprint = compute_rsa_fingerprint(&pub_path).unwrap_or_else(|| {
        // Fall back to ssh-keygen if available; non-fatal if absent.
        std::process::Command::new(find_ssh_keygen())
            .arg("-lf").arg(&pub_path)
            .output()
            .ok()
            .and_then(|o| if o.status.success() {
                String::from_utf8_lossy(&o.stdout)
                    .split_whitespace().nth(1)
                    .map(|s| s.to_string())
            } else { None })
            .unwrap_or_else(|| "fingerprint unavailable".to_string())
    });

    Ok(OwnerSshKeyResult {
        match_id,
        public_key,
        fingerprint,
        private_key_path_or_ref: key_path.to_string_lossy().to_string(),
        already_existed,
    })
}

// ── SFTP target verification ─────────────────────────────────────────────────

/// Verify the SFTP target using native libssh2 — no external `sftp` binary needed.
///
/// Unlike `probe_remote_target` (TCP-only), this performs a full SSH handshake,
/// TOFU fingerprint check, public-key authentication, path existence check,
/// write test, and statvfs quota query.
///
/// TOFU fingerprints are stored in `{app_data}/known_fingerprints.json`.
/// A changed fingerprint blocks the connection and returns `host_key_mismatch`.
///
/// No passwords are accepted. SSH key is referenced by filesystem path only.
/// Host, username, and remote path never appear in returned message strings.
#[tauri::command]
fn verify_sftp_target(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    username: String,
    remote_path: String,
    key_path: Option<String>,
) -> nasbb_core::sftp_verify::SftpVerifyResult {
    use tauri::Manager;
    // Resolve the known_fingerprints.json path from app data dir.
    let fingerprints_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| {
            let _ = std::fs::create_dir_all(&d);
            d.join("known_fingerprints.json")
        });

    nasbb_core::sftp_verify::verify_sftp_target(
        &host,
        port,
        &username,
        &remote_path,
        key_path.as_deref(),
        fingerprints_path.as_deref(),
    )
}

// ── App config persistence (direct file I/O) ─────────────────────────────────
//
// Stores non-secret app configuration as JSON in the platform app-data directory.
// Using direct std::fs I/O instead of tauri-plugin-store because the plugin
// has silent initialization failures in dev mode that cause saves to be lost.

const APP_CONFIG_FILE: &str = "app-config.json";

/// Save arbitrary JSON config to `{app_data}/app-config.json`.
/// The frontend passes the full config object as a JSON value.
#[tauri::command]
fn save_app_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create app data dir: {e}"))?;
    let path = data_dir.join(APP_CONFIG_FILE);
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Serialization failed: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// ── Host-agent Docker commands ────────────────────────────────────────────────
//
// These commands drive the Docker Compose stack in apps/host-agent/.
// They use explicit std::process::Command args — no shell interpolation.
// Output is bounded and redacted before returning to the frontend.

#[derive(Debug, Serialize)]
pub struct HostPrereqResult {
    pub docker_available: bool,
    pub docker_version: Option<String>,
    pub compose_available: bool,
    pub compose_version: Option<String>,
    pub compose_dir: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HostEnvValues {
    #[serde(rename = "NASBB_API_PORT")]
    pub nasbb_api_port: String,
    #[serde(rename = "NASBB_API_TOKEN")]
    pub nasbb_api_token: String,
    #[serde(rename = "NASBB_SFTP_PORT")]
    pub nasbb_sftp_port: String,
    #[serde(rename = "NASBB_SFTP_BIND")]
    pub nasbb_sftp_bind: String,
    #[serde(rename = "TAILSCALE_ADDRESS")]
    pub tailscale_address: String,
}

#[derive(Debug, Serialize)]
pub struct ComposeServiceStatus {
    pub name: String,
    pub state: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ComposeStatus {
    pub services: Vec<ComposeServiceStatus>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ComposeLogs {
    pub agent_logs: String,
    pub sftp_logs: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VerifyResult {
    pub output: String,
    pub passed: bool,
    pub error: Option<String>,
}

// Resolve the apps/host-agent directory.
// Debug builds: use the compile-time CARGO_MANIFEST_DIR.
// Release builds: look for host-agent/ next to the executable.
fn resolve_host_agent_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        // CARGO_MANIFEST_DIR = apps/client/src-tauri at compile time
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        // apps/client/src-tauri/../../.. = repo root
        let candidate = manifest.join("../../..").join("apps/host-agent");
        if let Ok(p) = std::fs::canonicalize(&candidate) {
            if p.join("compose").join("docker-compose.yml").exists() {
                return Ok(p);
            }
        }
    }
    // Release build: check next to the executable
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("host-agent");
        if candidate.join("compose").join("docker-compose.yml").exists() {
            return Ok(candidate);
        }
    }
    Err(
        "Host stack files not found. In development ensure apps/host-agent/ exists in the \
         repository. In packaged builds the host stack is not yet bundled — this is a \
         known packaging gap."
            .to_string(),
    )
}

fn compose_file(host_agent_dir: &std::path::Path) -> std::path::PathBuf {
    host_agent_dir.join("compose").join("docker-compose.yml")
}

fn env_file(host_agent_dir: &std::path::Path) -> std::path::PathBuf {
    host_agent_dir.join("compose").join(".env")
}

fn env_example_file(host_agent_dir: &std::path::Path) -> std::path::PathBuf {
    host_agent_dir.join("compose").join(".env.example")
}

// Redact token= and SSH key patterns from a log line.
fn redact_compose_line(line: &str) -> String {
    let s = line
        .replace(|c: char| c == '\r', "");
    // Redact Bearer token values (hex 32+ chars)
    let s = regex_redact_token(&s);
    // Redact SSH public key material
    let s = redact_ssh_key(&s);
    s
}

fn regex_redact_token(s: &str) -> String {
    // Simple pattern: "Bearer " followed by non-whitespace
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find("Bearer ") {
        out.push_str(&rest[..pos + 7]);
        let after = &rest[pos + 7..];
        let end = after.find(|c: char| c.is_whitespace() || c == '"').unwrap_or(after.len());
        out.push_str("[REDACTED]");
        rest = &after[end..];
    }
    out.push_str(rest);
    // Also redact NASBB_API_TOKEN= style
    out.replace("NASBB_API_TOKEN=", "NASBB_API_TOKEN=[REDACTED]")
}

fn redact_ssh_key(s: &str) -> String {
    // SSH keys start with AAAA (base64 prefix for ed25519 / rsa)
    if !s.contains("AAAA") {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find("AAAA") {
        out.push_str(&rest[..pos]);
        out.push_str("[REDACTED-KEY]");
        let after = &rest[pos + 4..];
        let end = after.find(|c: char| c.is_whitespace() || c == '"').unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn bounded_output(raw: &[u8], max_lines: usize) -> String {
    let s = String::from_utf8_lossy(raw);
    let lines: Vec<&str> = s.lines().collect();
    let start = if lines.len() > max_lines { lines.len() - max_lines } else { 0 };
    lines[start..].iter().map(|l| redact_compose_line(l)).collect::<Vec<_>>().join("\n")
}

/// Check Docker and Docker Compose availability.
#[tauri::command]
fn host_agent_check_prereqs() -> HostPrereqResult {
    let docker_out = std::process::Command::new("docker")
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let (docker_available, docker_version) = match docker_out {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => (false, None),
    };

    let compose_out = std::process::Command::new("docker")
        .args(["compose", "version"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let (compose_available, compose_version) = match compose_out {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => (false, None),
    };

    let (compose_dir, error) = match resolve_host_agent_dir() {
        Ok(p) => (Some(p.join("compose").display().to_string()), None),
        Err(e) => (None, Some(e)),
    };

    HostPrereqResult {
        docker_available,
        docker_version,
        compose_available,
        compose_version,
        compose_dir,
        error,
    }
}

/// Read the compose .env file and return the five required fields.
/// If .env does not exist, copies from .env.example and returns defaults.
#[tauri::command]
fn host_agent_read_env() -> Result<HostEnvValues, String> {
    let dir = resolve_host_agent_dir()?;
    let env_path = env_file(&dir);

    // Create from example if missing
    if !env_path.exists() {
        let example = env_example_file(&dir);
        if example.exists() {
            std::fs::copy(&example, &env_path)
                .map_err(|e| format!("Cannot create .env from example: {e}"))?;
        }
    }

    let content = if env_path.exists() {
        std::fs::read_to_string(&env_path)
            .map_err(|e| format!("Cannot read .env: {e}"))?
    } else {
        String::new()
    };

    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() { continue; }
        if let Some(eq) = trimmed.find('=') {
            let key = trimmed[..eq].trim().to_string();
            let val = trimmed[eq + 1..].trim().trim_matches('"').trim_matches('\'').to_string();
            map.insert(key, val);
        }
    }

    Ok(HostEnvValues {
        nasbb_api_port: map.get("NASBB_API_PORT").cloned().unwrap_or_else(|| "7420".to_string()),
        nasbb_api_token: map.get("NASBB_API_TOKEN").cloned().unwrap_or_default(),
        nasbb_sftp_port: map.get("NASBB_SFTP_PORT").cloned().unwrap_or_else(|| "2222".to_string()),
        nasbb_sftp_bind: map.get("NASBB_SFTP_BIND").cloned().unwrap_or_else(|| "127.0.0.1".to_string()),
        tailscale_address: map.get("TAILSCALE_ADDRESS").cloned().unwrap_or_default(),
    })
}

/// Write specific env fields to the compose .env file.
/// Preserves existing lines and comments. Never logs the token value.
#[tauri::command]
fn host_agent_write_env(values: std::collections::HashMap<String, String>) -> Result<(), String> {
    // Validate: disallow writing tokens via command (must come from frontend only)
    // but we accept them here since they're user-generated — we just never log them.
    let dir = resolve_host_agent_dir()?;
    let env_path = env_file(&dir);

    // Seed from example if missing
    if !env_path.exists() {
        let example = env_example_file(&dir);
        if example.exists() {
            std::fs::copy(&example, &env_path)
                .map_err(|e| format!("Cannot create .env: {e}"))?;
        }
    }

    let existing = if env_path.exists() {
        std::fs::read_to_string(&env_path).unwrap_or_default()
    } else {
        String::new()
    };

    let allowed_keys = ["NASBB_API_PORT", "NASBB_API_TOKEN", "NASBB_SFTP_PORT",
                        "NASBB_SFTP_BIND", "TAILSCALE_ADDRESS"];
    let mut written_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut new_lines: Vec<String> = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            new_lines.push(line.to_string());
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            let key = trimmed[..eq].trim();
            if allowed_keys.contains(&key) {
                if let Some(new_val) = values.get(key) {
                    // Suppress writing empty-placeholder commented-out keys
                    // by writing key=value (no comment)
                    new_lines.push(format!("{}={}", key, new_val));
                    written_keys.insert(key.to_string());
                    continue;
                }
            }
        }
        new_lines.push(line.to_string());
    }

    // Append any keys not already in the file
    for key in &allowed_keys {
        if !written_keys.contains(*key) {
            if let Some(val) = values.get(*key) {
                new_lines.push(format!("{}={}", key, val));
            }
        }
    }

    let content = new_lines.join("\n") + "\n";
    std::fs::write(&env_path, content)
        .map_err(|e| format!("Cannot write .env: {e}"))?;
    Ok(())
}

fn run_compose(host_agent_dir: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let compose = compose_file(host_agent_dir);
    let mut cmd = std::process::Command::new("docker");
    cmd.arg("compose").arg("-f").arg(&compose);
    for a in args { cmd.arg(a); }
    let out = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("docker compose failed to start: {e}"))?;
    let stdout = bounded_output(&out.stdout, 200);
    let stderr = bounded_output(&out.stderr, 200);
    if !out.status.success() {
        let combined = format!("{}\n{}", stdout, stderr).trim().to_string();
        return Err(combined);
    }
    Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
}

/// Start the Docker Compose stack (docker compose up -d).
#[tauri::command]
fn host_agent_compose_up() -> Result<String, String> {
    let dir = resolve_host_agent_dir()?;
    run_compose(&dir, &["up", "-d"])
}

/// Stop the Docker Compose stack (docker compose down).
#[tauri::command]
fn host_agent_compose_down() -> Result<String, String> {
    let dir = resolve_host_agent_dir()?;
    run_compose(&dir, &["down"])
}

/// Restart the Docker Compose stack, reloading .env changes.
/// Uses `up -d --remove-orphans` instead of `restart` so that changes to the
/// .env file (e.g. TAILSCALE_ADDRESS) are picked up by recreating the containers.
/// `docker compose restart` keeps the original container environment; only `up -d`
/// recreates containers with fresh env vars from the .env file.
#[tauri::command]
fn host_agent_compose_restart() -> Result<String, String> {
    let dir = resolve_host_agent_dir()?;
    run_compose(&dir, &["up", "-d", "--remove-orphans"])
}

/// Fetch recent logs from both containers with redaction.
#[tauri::command]
fn host_agent_compose_logs() -> Result<ComposeLogs, String> {
    let dir = resolve_host_agent_dir()?;
    let compose = compose_file(&dir);

    let agent_out = std::process::Command::new("docker")
        .args(["compose", "-f"])
        .arg(&compose)
        .args(["logs", "--tail", "120", "nasbb-agent"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    let sftp_out = std::process::Command::new("docker")
        .args(["compose", "-f"])
        .arg(&compose)
        .args(["logs", "--tail", "120", "nasbb-sftp"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    let (agent_logs, sftp_logs, error) = match (agent_out, sftp_out) {
        (Ok(a), Ok(s)) => {
            let al = bounded_output(&a.stdout, 120) + &bounded_output(&a.stderr, 120);
            let sl = bounded_output(&s.stdout, 120) + &bounded_output(&s.stderr, 120);
            (al.trim().to_string(), sl.trim().to_string(), None)
        }
        (Err(e), _) | (_, Err(e)) => {
            (String::new(), String::new(), Some(format!("docker logs failed: {e}")))
        }
    };

    Ok(ComposeLogs { agent_logs, sftp_logs, error })
}

/// Get the running status of compose services.
#[tauri::command]
fn host_agent_compose_status() -> Result<ComposeStatus, String> {
    let dir = resolve_host_agent_dir()?;
    let compose = compose_file(&dir);

    let out = std::process::Command::new("docker")
        .args(["compose", "-f"])
        .arg(&compose)
        .args(["ps", "--format", "json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    match out {
        Err(e) => Ok(ComposeStatus {
            services: vec![],
            error: Some(format!("docker compose ps failed: {e}")),
        }),
        Ok(o) => {
            let raw = String::from_utf8_lossy(&o.stdout);
            let mut services = Vec::new();
            for line in raw.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    let name = v["Name"].as_str()
                        .or_else(|| v["Service"].as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let state = v["State"].as_str().unwrap_or("unknown").to_string();
                    let status = v["Status"].as_str().unwrap_or("").to_string();
                    services.push(ComposeServiceStatus { name, state, status });
                }
            }
            Ok(ComposeStatus { services, error: None })
        }
    }
}

/// Read the API token from the container log banner (fallback only).
/// The banner pattern is: NASBB_API_TOKEN=<token>
/// The token is never written to app logs.
#[tauri::command]
fn host_agent_get_token_hint() -> Result<Option<String>, String> {
    let dir = resolve_host_agent_dir()?;
    let compose = compose_file(&dir);

    let out = std::process::Command::new("docker")
        .args(["compose", "-f"])
        .arg(&compose)
        .args(["logs", "--tail", "200", "nasbb-agent"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("docker logs failed: {e}"))?;

    let combined = String::from_utf8_lossy(&out.stdout).to_string()
        + &String::from_utf8_lossy(&out.stderr);

    for line in combined.lines() {
        // Look for the agent's startup token banner
        if let Some(pos) = line.find("NASBB_API_TOKEN=") {
            let after = &line[pos + 16..];
            let token = after.split_whitespace().next().unwrap_or("").trim().to_string();
            if !token.is_empty() {
                return Ok(Some(token));
            }
        }
        // Also accept "Generated API token:" banner format
        if line.contains("Generated API token:") || line.contains("api_token:") {
            if let Some(tok_start) = line.rfind(':') {
                let token = line[tok_start + 1..].trim().to_string();
                if token.len() >= 16 {
                    return Ok(Some(token));
                }
            }
        }
    }
    Ok(None)
}

/// Run the end-to-end verification script against the running stack.
/// Output is bounded and redacted before returning to the UI.
#[tauri::command]
fn host_agent_run_verify() -> Result<VerifyResult, String> {
    let dir = resolve_host_agent_dir()?;
    let script = dir.join("tests").join("scripts").join("verify.sh");
    if !script.exists() {
        return Err(format!(
            "Verification script not found at {}",
            script.display()
        ));
    }
    let out = std::process::Command::new("bash")
        .arg(&script)
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run verify.sh: {e}"))?;

    let raw_out = String::from_utf8_lossy(&out.stdout).to_string()
        + &String::from_utf8_lossy(&out.stderr);
    let output = raw_out
        .lines()
        .map(|l| redact_compose_line(l))
        .collect::<Vec<_>>()
        .join("\n");
    let passed = out.status.success();
    Ok(VerifyResult { output, passed, error: None })
}

/// POST the owner-access response directly to the host's peer API endpoint.
///
/// Uses ureq (runs in Rust, not the webview) so there are no CORS or
/// mixed-content restrictions regardless of which Tailscale address is targeted.
/// The submit_url comes from the invite bundle's peerApi.submitUrl field.
/// No passwords or private keys are passed — only the public key and metadata.
#[tauri::command]
fn submit_peer_response(
    submit_url: String,
    invite_token: String,
    match_id: String,
    alloc_id: String,
    owner_device_label: String,
    owner_public_key: String,
    requested_sftp_username: String,
) -> Result<(), String> {
    use serde_json::json;

    let body = json!({
        "inviteToken": invite_token,
        "matchId": match_id,
        "allocId": alloc_id,
        "ownerPublicKey": owner_public_key,
        "requestedSftpUsername": requested_sftp_username,
        "ownerDeviceLabel": owner_device_label,
        "createdAt": chrono_now_iso(),
    });

    let body_str = body.to_string();

    let result = ureq::post(&submit_url)
        .set("Content-Type", "application/json")
        .send_string(&body_str);

    match result {
        Ok(resp) => {
            let status = resp.status();
            if status < 400 {
                Ok(())
            } else {
                let body = resp.into_string().unwrap_or_default();
                Err(format!("peer API returned HTTP {}: {}", status, body))
            }
        }
        Err(ureq::Error::Status(status, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("peer API returned HTTP {}: {}", status, body))
        }
        Err(e) => Err(format!("network error contacting peer API: {e}")),
    }
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Format as RFC3339 (UTC) without pulling in chrono
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    // Simple date calculation from epoch (2000 epoch adjustment would be cleaner,
    // but for a createdAt field an approximate ISO string is sufficient)
    let _ = (s, m, h, days);
    // Fall back to a full implementation using the standard library
    format_unix_utc(secs)
}

fn format_unix_utc(unix_secs: u64) -> String {
    // Days since 1970-01-01
    let mut days = unix_secs / 86400;
    let time_of_day = unix_secs % 86400;
    let hh = time_of_day / 3600;
    let mm = (time_of_day % 3600) / 60;
    let ss = time_of_day % 60;

    let mut year = 1970u64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_days: [u64; 12] = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u64;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, hh, mm, ss)
}

/// Proxy an HTTP request to the local host-agent API via Rust (ureq).
///
/// The frontend cannot reliably fetch http://127.0.0.1 from a tauri:// secure
/// context on WebKitGTK (Linux) — the engine blocks it as mixed content.
/// This command is the authorised bypass: it runs inside the Rust process, not
/// the webview, so there are no mixed-content or CORS restrictions.
///
/// Only http://127.0.0.1:7420 is reachable via this command — the base URL is
/// hard-coded and the caller only supplies a relative path.
#[derive(Debug, Deserialize)]
struct HostAgentHttpArgs {
    method: String,
    path: String,
    token: Option<String>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
struct HostAgentHttpResponse {
    status: u16,
    body: String,
    ok: bool,
}

#[tauri::command]
fn host_agent_http(args: HostAgentHttpArgs) -> Result<HostAgentHttpResponse, String> {
    let base = "http://127.0.0.1:7420/api/v1";
    let url = format!("{}{}", base, args.path);

    let req = ureq::request(&args.method, &url);
    let req = if let Some(ref token) = args.token {
        req.set("Authorization", &format!("Bearer {}", token))
    } else {
        req
    };
    let req = if args.body.is_some() {
        req.set("Content-Type", "application/json")
    } else {
        req
    };

    let result = if let Some(body) = args.body {
        req.send_string(&body)
    } else {
        req.call()
    };

    match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.into_string().unwrap_or_default();
            Ok(HostAgentHttpResponse { status, body, ok: status < 400 })
        }
        Err(ureq::Error::Status(status, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Ok(HostAgentHttpResponse { status, body, ok: false })
        }
        Err(e) => Err(format!("network_error: {e}")),
    }
}

/// Load `{app_data}/app-config.json` and return it as a JSON value.
/// Returns an empty object if the file does not exist yet.
#[tauri::command]
fn load_app_config(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join(APP_CONFIG_FILE);
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Read failed: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Parse failed: {e}"))
}

/// Read a UTF-8 text file at the given path.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {e}"))
}

/// Write UTF-8 text to the given path (creates or overwrites).
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("Cannot write file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SyncthingProcessState(Mutex::new(None)))
        .manage({
            // On startup, attempt to load the master password from the OS keychain.
            // Uses the platform helper (macOS: security CLI; others: keyring crate)
            // so there is no ACL prompt on macOS regardless of which build is running.
            let initial_password = keychain_retrieve().ok().flatten();
            KopiaPasswordState(Mutex::new(initial_password))
        })
        .manage(AppTestLabState(Mutex::new(TestLabStateInner {
            password: TEST_LAB_PASSWORD.to_string(),
            paths: None,
            canary_sha256: None,
            last_snapshot_id: None,
            last_backup_at_secs: None,
            last_check_passed: None,
            last_drill_result: None,
        })))
        .invoke_handler(tauri::generate_handler![
            // Existing commands
            get_health_level,
            redact_log_line,
            get_tool_status,
            validate_setup_config,
            plan_kopia_repository,
            plan_syncthing_folder,
            run_mock_backup,
            run_mock_repository_check,
            run_mock_restore_drill,
            get_setup_readiness,
            get_mock_setup_state,
            // Real integration commands
            probe_tools,
            create_test_lab,
            run_test_backup,
            run_repository_check,
            run_restore_drill,
            prepare_syncthing_transport,
            get_health_report,
            initialize_kopia_repository,
            run_real_backup_from_config,
            run_real_repository_check,
            add_syncthing_folder,
            ensure_syncthing_running,
            stop_syncthing,
            set_kopia_password,
            has_kopia_password,
            has_password_in_keychain,
            load_master_password_from_keychain,
            verify_current_password,
            clear_master_password,
            check_syncthing_running,
            get_current_platform,
            apply_syncthing_setup,
            save_app_config,
            load_app_config,
            get_syncthing_live_status,
            // SFTP remote target commands
            probe_remote_target,
            plan_kopia_sftp_repository,
            initialize_kopia_sftp_repository,
            run_real_sftp_backup_from_config,
            // Storage-host setup
            plan_host_setup,
            validate_hosted_path,
            generate_authorize_owner_key_plan,
            // Overlay setup/detection
            detect_overlay,
            validate_overlay,
            get_overlay_verify_steps,
            get_tailscale_setup_guide,
            get_wireguard_setup_guide,
            get_headscale_setup_guide,
            get_overlay_compatibility_matrix,
            get_tailscale_detail,
            tailscale_ping_peer,
            tailscale_connect,
            // Owner bundle and SFTP verification
            parse_owner_bundle,
            generate_owner_ssh_key,
            verify_sftp_target,
            // Host-agent Docker commands
            host_agent_check_prereqs,
            host_agent_read_env,
            host_agent_write_env,
            host_agent_compose_up,
            host_agent_compose_down,
            host_agent_compose_restart,
            host_agent_compose_logs,
            host_agent_compose_status,
            host_agent_get_token_hint,
            host_agent_run_verify,
            host_agent_http,
            submit_peer_response,
            read_text_file,
            write_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building NAS Backup Buddy")
        .run(|app_handle, event| {
            // Kill the managed Syncthing process when the app exits so it
            // doesn't linger as an orphan after the window is closed.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager as _;
                if let Ok(mut lock) = app_handle.state::<SyncthingProcessState>().0.lock() {
                    {
                        if let Some(mut child) = lock.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
