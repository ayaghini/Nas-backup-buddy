//! Tauri application entry point and command handlers.
//!
//! Commands exposed to the frontend use nasbb-core types.
//! No passwords, private keys, plaintext file names, or file contents
//! are accepted or returned by any command.

use nasbb_core::health::{HealthReport, HealthLevel};

/// Return the overall health level for a given report.
/// Called by the frontend to determine which status indicator to show.
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
    nasbb_core::redaction::redact_line(&line)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_health_level,
            redact_log_line,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NAS Backup Buddy");
}
