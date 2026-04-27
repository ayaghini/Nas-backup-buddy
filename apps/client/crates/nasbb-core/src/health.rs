//! Health report model and threshold mapping.
//!
//! Thresholds are defined in docs/control-and-audit-plan.md.
//! This module is the single source of truth for threshold values in the client app.

use serde::{Deserialize, Serialize};

/// Three-tier health level, shared by individual checks and the overall report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthLevel {
    Ok,
    Warning,
    Critical,
}

fn default_remote_target_status() -> String {
    "not_configured".to_string()
}
fn default_neg_one() -> f64 {
    -1.0
}

/// Structured health report emitted by the local service.
/// Only allowlisted fields — no passwords, paths, or file names.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    /// Hours since the last successful Kopia snapshot completed.
    pub last_backup_age_hours: f64,
    /// Hours since the last successful Syncthing sync (legacy mirror mode only).
    /// Negative value means Syncthing is not configured — not a failure.
    pub last_sync_age_hours: f64,
    /// Percentage of peer quota remaining (0–100).
    pub free_quota_percent: f64,
    /// Days since the last restore drill. -1 means never run.
    pub restore_drill_age_days: i64,
    /// Hours the peer has been unreachable.
    pub peer_offline_hours: f64,
    /// Whether the most recent Kopia repository verification passed.
    pub repository_check_ok: bool,
    /// Optional message from repository verification (tool output summary, no paths).
    pub repository_check_message: Option<String>,
    /// Status of the remote SFTP repository target (default v1 backup path).
    /// Values: "not_configured" | "reachable" | "unreachable" | "auth_failed" |
    ///         "host_key_mismatch" | "quota_warning" | "error"
    /// "not_configured" in local test-lab mode is not a failure.
    #[serde(default = "default_remote_target_status")]
    pub remote_target_status: String,
    /// Hours since the remote target was last successfully reached.
    /// -1.0 = not configured or never connected.
    /// Used to escalate `unreachable` from Ok → Warning (>24h) → Critical (>72h).
    #[serde(default = "default_neg_one")]
    pub remote_target_last_ok_hours: f64,
}

impl HealthReport {
    pub fn backup_level(&self) -> HealthLevel {
        if self.last_backup_age_hours > 72.0 {
            HealthLevel::Critical
        } else if self.last_backup_age_hours > 24.0 {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }

    pub fn sync_level(&self) -> HealthLevel {
        // Negative value = Syncthing not yet configured; not a failure.
        if self.last_sync_age_hours < 0.0 {
            return HealthLevel::Ok;
        }
        if self.last_sync_age_hours > 72.0 {
            HealthLevel::Critical
        } else if self.last_sync_age_hours > 24.0 {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }

    pub fn quota_level(&self) -> HealthLevel {
        if self.free_quota_percent < 5.0 {
            HealthLevel::Critical
        } else if self.free_quota_percent < 15.0 {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }

    pub fn drill_level(&self) -> HealthLevel {
        if self.restore_drill_age_days < 0 {
            HealthLevel::Critical // never run — blocks Protected
        } else if self.restore_drill_age_days > 30 {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }

    pub fn peer_offline_level(&self) -> HealthLevel {
        // Negative value = no peer configured yet; not a failure.
        if self.peer_offline_hours < 0.0 {
            return HealthLevel::Ok;
        }
        if self.peer_offline_hours > 168.0 {
            HealthLevel::Critical // > 7 days
        } else if self.peer_offline_hours > 24.0 {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }

    pub fn repo_check_level(&self) -> HealthLevel {
        if self.repository_check_ok {
            HealthLevel::Ok
        } else {
            HealthLevel::Critical
        }
    }

    /// Health level for the remote SFTP repository target.
    ///
    /// - `not_configured`: Ok — valid in local test-lab mode.
    /// - `reachable`: Ok.
    /// - `quota_warning`: Warning.
    /// - `auth_failed`, `host_key_mismatch`: Critical.
    /// - `unreachable`: escalates based on `remote_target_last_ok_hours`:
    ///   ≤ 24h → Ok, 24–72h → Warning, > 72h or never connected → Critical.
    /// - `error`: Warning.
    pub fn remote_target_level(&self) -> HealthLevel {
        match self.remote_target_status.as_str() {
            "not_configured" => HealthLevel::Ok,
            "reachable" => HealthLevel::Ok,
            "quota_warning" => HealthLevel::Warning,
            "auth_failed" | "host_key_mismatch" => HealthLevel::Critical,
            "unreachable" => {
                let hrs = self.remote_target_last_ok_hours;
                if hrs < 0.0 {
                    // Never successfully connected to a configured target.
                    HealthLevel::Warning
                } else if hrs > 72.0 {
                    HealthLevel::Critical
                } else if hrs > 24.0 {
                    HealthLevel::Warning
                } else {
                    HealthLevel::Ok
                }
            }
            "error" => HealthLevel::Warning,
            _ => HealthLevel::Ok,
        }
    }

    /// Overall level is the worst of all individual levels.
    pub fn overall_level(&self) -> HealthLevel {
        let levels = [
            self.backup_level(),
            self.sync_level(),
            self.quota_level(),
            self.drill_level(),
            self.peer_offline_level(),
            self.repo_check_level(),
            self.remote_target_level(),
        ];
        if levels.iter().any(|l| *l == HealthLevel::Critical) {
            HealthLevel::Critical
        } else if levels.iter().any(|l| *l == HealthLevel::Warning) {
            HealthLevel::Warning
        } else {
            HealthLevel::Ok
        }
    }
}

/// Outcome of a restore drill or canary check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RestoreDrillResult {
    Pass,
    Fail,
    CanaryMismatch,
}

/// Map a restore drill result to a health level.
/// Both Fail and CanaryMismatch are Critical per control-and-audit-plan.md.
pub fn restore_result_to_level(result: &RestoreDrillResult) -> HealthLevel {
    match result {
        RestoreDrillResult::Pass => HealthLevel::Ok,
        RestoreDrillResult::Fail | RestoreDrillResult::CanaryMismatch => HealthLevel::Critical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn healthy_report() -> HealthReport {
        HealthReport {
            last_backup_age_hours: 2.0,
            last_sync_age_hours: 1.0,
            free_quota_percent: 60.0,
            restore_drill_age_days: 5,
            peer_offline_hours: 0.0,
            repository_check_ok: true,
            repository_check_message: None,
            remote_target_status: "reachable".to_string(),
            remote_target_last_ok_hours: 0.5,
        }
    }

    #[test]
    fn healthy_report_is_ok() {
        assert_eq!(healthy_report().overall_level(), HealthLevel::Ok);
    }

    #[test]
    fn stale_backup_24h_warns() {
        let mut r = healthy_report();
        r.last_backup_age_hours = 25.0;
        assert_eq!(r.backup_level(), HealthLevel::Warning);
        assert_eq!(r.overall_level(), HealthLevel::Warning);
    }

    #[test]
    fn stale_backup_72h_critical() {
        let mut r = healthy_report();
        r.last_backup_age_hours = 73.0;
        assert_eq!(r.backup_level(), HealthLevel::Critical);
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }

    #[test]
    fn low_quota_15pct_warns() {
        let mut r = healthy_report();
        r.free_quota_percent = 14.0;
        assert_eq!(r.quota_level(), HealthLevel::Warning);
    }

    #[test]
    fn low_quota_5pct_critical() {
        let mut r = healthy_report();
        r.free_quota_percent = 4.9;
        assert_eq!(r.quota_level(), HealthLevel::Critical);
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }

    #[test]
    fn never_drilled_is_critical() {
        let mut r = healthy_report();
        r.restore_drill_age_days = -1;
        assert_eq!(r.drill_level(), HealthLevel::Critical);
    }

    #[test]
    fn drill_over_30_days_warns() {
        let mut r = healthy_report();
        r.restore_drill_age_days = 31;
        assert_eq!(r.drill_level(), HealthLevel::Warning);
    }

    #[test]
    fn peer_offline_24h_warns() {
        let mut r = healthy_report();
        r.peer_offline_hours = 25.0;
        assert_eq!(r.peer_offline_level(), HealthLevel::Warning);
    }

    #[test]
    fn peer_offline_7_days_critical() {
        let mut r = healthy_report();
        r.peer_offline_hours = 169.0;
        assert_eq!(r.peer_offline_level(), HealthLevel::Critical);
    }

    #[test]
    fn restore_fail_is_critical() {
        assert_eq!(
            restore_result_to_level(&RestoreDrillResult::Fail),
            HealthLevel::Critical
        );
    }

    #[test]
    fn canary_mismatch_is_critical() {
        assert_eq!(
            restore_result_to_level(&RestoreDrillResult::CanaryMismatch),
            HealthLevel::Critical
        );
    }

    #[test]
    fn restore_pass_is_ok() {
        assert_eq!(
            restore_result_to_level(&RestoreDrillResult::Pass),
            HealthLevel::Ok
        );
    }

    #[test]
    fn failed_repo_check_is_critical() {
        let mut r = healthy_report();
        r.repository_check_ok = false;
        assert_eq!(r.repo_check_level(), HealthLevel::Critical);
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }

    // ── Remote target health ──────────────────────────────────────────────────

    #[test]
    fn remote_target_not_configured_is_ok() {
        // In local test-lab mode the remote target is not configured — must not be Critical.
        let mut r = healthy_report();
        r.remote_target_status = "not_configured".to_string();
        r.remote_target_last_ok_hours = -1.0;
        assert_eq!(r.remote_target_level(), HealthLevel::Ok);
        // Overall must not become Critical just because remote target is not configured.
        assert_ne!(r.overall_level(), HealthLevel::Critical);
    }

    #[test]
    fn remote_target_reachable_is_ok() {
        let r = healthy_report(); // remote_target_status = "reachable"
        assert_eq!(r.remote_target_level(), HealthLevel::Ok);
    }

    #[test]
    fn remote_target_quota_warning_is_warning() {
        let mut r = healthy_report();
        r.remote_target_status = "quota_warning".to_string();
        assert_eq!(r.remote_target_level(), HealthLevel::Warning);
        assert_eq!(r.overall_level(), HealthLevel::Warning);
    }

    #[test]
    fn remote_target_auth_failed_is_critical() {
        let mut r = healthy_report();
        r.remote_target_status = "auth_failed".to_string();
        assert_eq!(r.remote_target_level(), HealthLevel::Critical);
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }

    #[test]
    fn remote_target_host_key_mismatch_is_critical() {
        let mut r = healthy_report();
        r.remote_target_status = "host_key_mismatch".to_string();
        assert_eq!(r.remote_target_level(), HealthLevel::Critical);
    }

    #[test]
    fn remote_target_unreachable_within_24h_is_ok() {
        let mut r = healthy_report();
        r.remote_target_status = "unreachable".to_string();
        r.remote_target_last_ok_hours = 10.0; // last ok 10h ago
        assert_eq!(r.remote_target_level(), HealthLevel::Ok);
    }

    #[test]
    fn remote_target_unreachable_over_24h_warns() {
        let mut r = healthy_report();
        r.remote_target_status = "unreachable".to_string();
        r.remote_target_last_ok_hours = 25.0;
        assert_eq!(r.remote_target_level(), HealthLevel::Warning);
        assert_eq!(r.overall_level(), HealthLevel::Warning);
    }

    #[test]
    fn remote_target_unreachable_over_72h_is_critical() {
        let mut r = healthy_report();
        r.remote_target_status = "unreachable".to_string();
        r.remote_target_last_ok_hours = 73.0;
        assert_eq!(r.remote_target_level(), HealthLevel::Critical);
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }

    #[test]
    fn remote_target_unreachable_never_connected_warns() {
        // Never connected to a configured remote target is a warning, not critical.
        let mut r = healthy_report();
        r.remote_target_status = "unreachable".to_string();
        r.remote_target_last_ok_hours = -1.0; // never connected
        assert_eq!(r.remote_target_level(), HealthLevel::Warning);
    }

    #[test]
    fn restore_failure_still_critical_with_remote_target() {
        // Existing restore failure mapping must not be weakened by adding remote target.
        let mut r = healthy_report();
        r.repository_check_ok = false;
        r.remote_target_status = "reachable".to_string();
        assert_eq!(r.overall_level(), HealthLevel::Critical);
    }
}
