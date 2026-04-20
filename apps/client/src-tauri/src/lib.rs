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
use nasbb_core::redaction::redact_line;
use nasbb_core::tools::{
    check_tool_status, detect_tool_on_path, get_tool_entry, Platform, ToolManifest, ToolName,
    ToolStatus,
};
use serde::{Deserialize, Serialize};

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

    let manifest: ToolManifest = serde_json::from_str(TOOL_MANIFEST_JSON)
        .unwrap_or_else(|_| ToolManifest { manifest_version: 1, tools: vec![] });
    let platform = current_platform();
    let resource_dir = app.path().resource_dir().ok();

    let kopia =
        resolve_tool_status(&manifest, &ToolName::Kopia, &platform, resource_dir.as_deref());
    let syncthing =
        resolve_tool_status(&manifest, &ToolName::Syncthing, &platform, resource_dir.as_deref());

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
fn plan_kopia_repository(
    repo_path: String,
    engine_path: String,
) -> Vec<CommandPlanSummary> {
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
            label: "Repository check".to_string(),
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

/// Run a mock repository check.
/// `should_pass` defaults to true. Pass false to simulate a check failure.
#[tauri::command]
fn run_mock_repository_check(should_pass: Option<bool>) -> MockCheckResult {
    let passes = should_pass.unwrap_or(true);
    let raw_log = if passes {
        "repository check: verified 128 content blobs, 3 manifests — no errors found"
    } else {
        "repository check: ERROR — 2 content blobs missing or corrupted"
    };
    MockCheckResult {
        passed: passes,
        message: if passes {
            "Repository check passed. All content blobs verified.".to_string()
        } else {
            "Repository check FAILED. Investigate immediately — do not prune snapshots.".to_string()
        },
        log_line: redact_line(raw_log),
    }
}

/// Run a mock restore drill comparing expected and observed canary checksums.
///
/// A checksum mismatch maps to Critical health level.
/// A restore failure maps to Critical health level.
#[tauri::command]
fn run_mock_restore_drill(
    expected_checksum: String,
    observed_checksum: String,
) -> MockDrillResult {
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
        if expected_checksum.is_empty() { "[empty]" } else { "[REDACTED]" },
        if observed_checksum.is_empty() { "[empty]" } else { "[REDACTED]" },
        health_label
    );

    let mut audit = vec![
        format!("result: {result_label}"),
        format!("health_level: {health_label}"),
        format!("checksums_match: {checksums_match}"),
        "canary_method: sha256".to_string(),
    ];
    if matches!(drill_result, RestoreDrillResult::CanaryMismatch) {
        audit.push("ACTION: Preserve all logs. Do not prune snapshots. Investigate immediately.".to_string());
    }
    if matches!(drill_result, RestoreDrillResult::Fail) {
        audit.push("ACTION: Check restore destination permissions and available disk space.".to_string());
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
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running NAS Backup Buddy");
}
