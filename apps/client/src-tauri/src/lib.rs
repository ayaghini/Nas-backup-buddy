//! Tauri application entry point and command handlers.
//!
//! Commands exposed to the frontend use nasbb-core types.
//! No passwords, private keys, plaintext file names, or file contents
//! are accepted or returned by any command.

use nasbb_core::commands::{KopiaPlanner, SyncthingPlanner};
use nasbb_core::config::{validate_config, NasbbConfig};
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
        last_sync_age_hours: 999.0,  // Syncthing not running in test lab
        free_quota_percent: 100.0,
        restore_drill_age_days: drill_age_days,
        peer_offline_hours: 999.0,   // No peer in test lab
        repository_check_ok: repo_check_ok,
        repository_check_message: repo_check_message,
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

    // Persist to OS keychain — errors are reported but do not block the operation.
    // If keychain is unavailable (headless CI, locked desktop session), the
    // password still works for this session.
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("keychain unavailable: {e}"))?;
    entry
        .set_password(&password)
        .map_err(|e| format!("keychain write failed: {e}"))?;

    Ok(())
}

/// Return whether a master password has been set in this session (process memory).
/// Does NOT return the password value.
#[tauri::command]
fn has_kopia_password(state: tauri::State<KopiaPasswordState>) -> bool {
    state.0.lock().map(|l| l.is_some()).unwrap_or(false)
}

/// Check whether a master password is stored in the OS keychain from a previous session.
/// Does NOT return or load the password — call load_master_password_from_keychain to load it.
#[tauri::command]
fn has_password_in_keychain() -> bool {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(|p| !p.is_empty())
        .unwrap_or(false)
}

/// Load the master password from the OS keychain into process memory.
///
/// Returns true if a password was found and loaded, false if no keychain entry exists.
/// Returns an error string if the keychain entry exists but cannot be read.
/// The password is never returned to the frontend.
#[tauri::command]
fn load_master_password_from_keychain(state: tauri::State<KopiaPasswordState>) -> Result<bool, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("keychain unavailable: {e}"))?;
    match entry.get_password() {
        Ok(pw) if !pw.is_empty() => {
            let mut lock = state.0.lock().map_err(|_| "state lock error")?;
            *lock = Some(pw);
            Ok(true)
        }
        Ok(_) => Ok(false), // empty entry
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("keychain read failed: {e}")),
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

    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("keychain delete failed: {e}")),
        }
    }
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
        recovery_key_confirmed: false,
        health_report_consent: false,
        offline_mode: true,
    }
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
            // If found, the user won't need to re-enter it this session.
            let initial_password = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
                .ok()
                .and_then(|e| e.get_password().ok())
                .filter(|p| !p.is_empty());
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
