//! Integration model: runtime state for Kopia and Syncthing setup.
//!
//! These types represent the full setup readiness of the client at runtime.
//! They are serializable for use in Tauri commands but must never carry secret values.

use crate::config::UserRole;
use crate::tools::ToolStatus;
use serde::{Deserialize, Serialize};

/// Which backup engine the client is using.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupEngine {
    Kopia,
    /// Restic is reserved for future use and is not supported in v1.
    ResticFuture,
}

/// State of the local Kopia repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KopiaRepositoryStatus {
    NotConfigured,
    Configured,
    Initialized,
    CheckPassed,
    CheckFailed,
}

/// State of a Syncthing folder/device pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncthingState {
    NotConfigured,
    DeviceConfigured,
    FolderConfigured,
    Syncing,
    InSync,
    Stale,
    Error,
}

/// Non-secret Kopia configuration persisted in the local config store.
/// The repository password is stored in the OS keychain — never here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KopiaConfig {
    /// Local path for the encrypted Kopia repository.
    pub repository_path: String,
    /// Path to the Kopia executable (bundled binary).
    pub executable_path: String,
    /// Keychain service/key reference — NOT the password value.
    pub password_keychain_ref: Option<String>,
    /// Whether the user has confirmed saving their recovery key externally.
    pub password_backup_confirmed: bool,
    pub retention_keep_last: u32,
    pub retention_keep_daily: u32,
    pub retention_keep_weekly: u32,
    pub retention_keep_monthly: u32,
}

/// Non-secret Syncthing configuration.
/// The API key is stored in the OS keychain — never here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncthingConfig {
    /// Path to the Syncthing executable (bundled binary).
    pub executable_path: String,
    /// Syncthing REST API base URL (localhost only).
    pub api_url: String,
    /// Keychain reference for the Syncthing API key — NOT the key value.
    pub api_key_ref: Option<String>,
    /// This device's public Syncthing device ID (not a secret).
    pub local_device_id: Option<String>,
    /// Must always be the encrypted repository path — never a source folder.
    pub shared_folder_path: Option<String>,
    /// Syncthing folder ID for the repository share.
    pub folder_id: Option<String>,
}

/// Runtime Kopia state (not persisted — polled from the running service).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KopiaRepositoryState {
    pub status: KopiaRepositoryStatus,
    pub snapshot_count: Option<u32>,
    /// ISO-8601 timestamp of the most recent successful snapshot.
    pub last_snapshot_at: Option<String>,
    /// Repository size in bytes.
    pub repo_size_bytes: Option<u64>,
}

/// Runtime Syncthing folder state (not persisted).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncthingFolderStatus {
    pub state: SyncthingState,
    /// Peer device ID (public, not a secret).
    pub peer_device_id: Option<String>,
    pub peer_connected: bool,
    /// ISO-8601 timestamp of the last successful sync.
    pub last_sync_at: Option<String>,
    pub bytes_pending: Option<u64>,
}

/// Full runtime setup state of the local client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSetupState {
    pub role: UserRole,
    pub engine: BackupEngine,
    pub kopia_tool_status: ToolStatus,
    pub syncthing_tool_status: ToolStatus,
    pub kopia_repository: KopiaRepositoryState,
    pub syncthing_folder: SyncthingFolderStatus,
    pub recovery_key_confirmed: bool,
    /// Defaults to false — must be explicitly opted into.
    pub health_report_consent: bool,
    pub offline_mode: bool,
}

/// Overall setup readiness level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupReadiness {
    Blocked,
    Warning,
    ReadyForTestBackup,
    ReadyForRestoreDrill,
    ProtectedEligible,
}

/// Result of the integration readiness check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationCheckResult {
    pub readiness: SetupReadiness,
    /// Reasons setup is blocked. Must be safe for display — no secrets or raw paths.
    pub blocking_reasons: Vec<String>,
    /// Non-blocking warnings.
    pub warning_reasons: Vec<String>,
}

impl ClientSetupState {
    /// Evaluate overall setup readiness from the current state.
    ///
    /// Tool-status failures are **blocking** in production mode and **warnings** in
    /// offline/mock mode. All other failures (repo check, recovery key, Syncthing
    /// error) are blocking regardless of offline mode.
    pub fn check_readiness(&self) -> IntegrationCheckResult {
        let mut blocking = Vec::new();
        let mut warnings = Vec::new();

        // Tool status: fail-closed in production, warn in offline/mock mode
        if self.offline_mode {
            if self.kopia_tool_status != ToolStatus::Ready {
                warnings.push(format!(
                    "Kopia binary not verified ({:?}) — offline mode active, real backups require a verified binary",
                    self.kopia_tool_status
                ));
            }
            if self.syncthing_tool_status != ToolStatus::Ready {
                warnings.push(format!(
                    "Syncthing binary not verified ({:?}) — offline mode active, real sync requires a verified binary",
                    self.syncthing_tool_status
                ));
            }
        } else {
            if self.kopia_tool_status != ToolStatus::Ready {
                blocking.push(format!(
                    "Kopia tool not ready: {:?}",
                    self.kopia_tool_status
                ));
            }
            if self.syncthing_tool_status != ToolStatus::Ready {
                blocking.push(format!(
                    "Syncthing tool not ready: {:?}",
                    self.syncthing_tool_status
                ));
            }
        }
        match self.kopia_repository.status {
            KopiaRepositoryStatus::NotConfigured => {
                blocking.push("Kopia repository not configured".to_string());
            }
            KopiaRepositoryStatus::CheckFailed => {
                blocking
                    .push("Kopia repository verification failed — investigate immediately".to_string());
            }
            _ => {}
        }

        if !self.recovery_key_confirmed {
            blocking.push("Recovery key backup has not been confirmed".to_string());
        }

        if self.syncthing_folder.state == SyncthingState::Error {
            blocking.push("Syncthing error — check Syncthing logs".to_string());
        }

        if self.syncthing_folder.state == SyncthingState::Stale {
            warnings.push("Syncthing folder is stale — peer data may be outdated".to_string());
        }
        if self.syncthing_folder.state == SyncthingState::NotConfigured {
            warnings
                .push("Syncthing not yet configured — peer replication is inactive".to_string());
        }

        let readiness = if !blocking.is_empty() {
            SetupReadiness::Blocked
        } else if !warnings.is_empty() {
            SetupReadiness::Warning
        } else {
            match &self.kopia_repository.status {
                KopiaRepositoryStatus::CheckPassed => {
                    if self.syncthing_folder.state == SyncthingState::InSync {
                        SetupReadiness::ReadyForRestoreDrill
                    } else {
                        SetupReadiness::ReadyForTestBackup
                    }
                }
                KopiaRepositoryStatus::Initialized | KopiaRepositoryStatus::Configured => {
                    SetupReadiness::ReadyForTestBackup
                }
                _ => SetupReadiness::Blocked,
            }
        };

        IntegrationCheckResult {
            readiness,
            blocking_reasons: blocking,
            warning_reasons: warnings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::UserRole;
    use crate::tools::ToolStatus;

    fn mock_ready_state() -> ClientSetupState {
        ClientSetupState {
            role: UserRole::DataOwner,
            engine: BackupEngine::Kopia,
            kopia_tool_status: ToolStatus::Ready,
            syncthing_tool_status: ToolStatus::Ready,
            kopia_repository: KopiaRepositoryState {
                status: KopiaRepositoryStatus::CheckPassed,
                snapshot_count: Some(3),
                last_snapshot_at: Some("2026-04-19T10:00:00Z".to_string()),
                repo_size_bytes: Some(1_073_741_824),
            },
            syncthing_folder: SyncthingFolderStatus {
                state: SyncthingState::InSync,
                peer_device_id: Some("ABCDEFG-HIJKLMN".to_string()),
                peer_connected: true,
                last_sync_at: Some("2026-04-19T11:00:00Z".to_string()),
                bytes_pending: Some(0),
            },
            recovery_key_confirmed: true,
            health_report_consent: false,
            offline_mode: true,
        }
    }

    #[test]
    fn ready_for_restore_drill_when_all_pass() {
        let state = mock_ready_state();
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::ReadyForRestoreDrill);
        assert!(result.blocking_reasons.is_empty());
        assert!(result.warning_reasons.is_empty());
    }

    // offline_mode: true → tool issues are warnings, not blockers
    #[test]
    fn warning_not_blocked_when_kopia_missing_in_offline_mode() {
        let mut state = mock_ready_state(); // offline_mode: true
        state.kopia_tool_status = ToolStatus::Missing;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Warning);
        assert!(result.blocking_reasons.is_empty());
        assert!(result.warning_reasons.iter().any(|r| r.contains("Kopia")));
    }

    #[test]
    fn warning_not_blocked_when_syncthing_mismatch_in_offline_mode() {
        let mut state = mock_ready_state(); // offline_mode: true
        state.syncthing_tool_status = ToolStatus::ChecksumMismatch;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Warning);
        assert!(result.blocking_reasons.is_empty());
        assert!(result
            .warning_reasons
            .iter()
            .any(|r| r.contains("Syncthing")));
    }

    // offline_mode: false → tool issues block setup
    #[test]
    fn blocked_when_kopia_tool_missing_in_production_mode() {
        let mut state = mock_ready_state();
        state.offline_mode = false;
        state.kopia_tool_status = ToolStatus::Missing;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
        assert!(result.blocking_reasons.iter().any(|r| r.contains("Kopia")));
    }

    #[test]
    fn blocked_when_kopia_tool_present_in_production_mode() {
        let mut state = mock_ready_state();
        state.offline_mode = false;
        state.kopia_tool_status = ToolStatus::Present;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
        assert!(result.blocking_reasons.iter().any(|r| r.contains("Kopia")));
    }

    #[test]
    fn blocked_when_syncthing_checksum_mismatch_in_production_mode() {
        let mut state = mock_ready_state();
        state.offline_mode = false;
        state.syncthing_tool_status = ToolStatus::ChecksumMismatch;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
        assert!(result
            .blocking_reasons
            .iter()
            .any(|r| r.contains("Syncthing")));
    }

    #[test]
    fn blocked_when_recovery_key_not_confirmed() {
        let mut state = mock_ready_state();
        state.recovery_key_confirmed = false;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
        assert!(result
            .blocking_reasons
            .iter()
            .any(|r| r.to_lowercase().contains("recovery")));
    }

    #[test]
    fn blocked_when_repo_check_failed() {
        let mut state = mock_ready_state();
        state.kopia_repository.status = KopiaRepositoryStatus::CheckFailed;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
    }

    #[test]
    fn blocked_when_syncthing_error() {
        let mut state = mock_ready_state();
        state.syncthing_folder.state = SyncthingState::Error;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Blocked);
    }

    #[test]
    fn warning_when_syncthing_stale() {
        let mut state = mock_ready_state();
        state.syncthing_folder.state = SyncthingState::Stale;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Warning);
        assert!(!result.warning_reasons.is_empty());
    }

    #[test]
    fn warning_when_syncthing_not_configured() {
        let mut state = mock_ready_state();
        state.syncthing_folder.state = SyncthingState::NotConfigured;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::Warning);
    }

    #[test]
    fn ready_for_test_backup_when_initialized_but_not_synced() {
        let mut state = mock_ready_state();
        state.kopia_repository.status = KopiaRepositoryStatus::Initialized;
        state.syncthing_folder.state = SyncthingState::FolderConfigured;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::ReadyForTestBackup);
    }

    #[test]
    fn ready_for_test_backup_when_check_passed_but_not_in_sync() {
        let mut state = mock_ready_state();
        state.syncthing_folder.state = SyncthingState::Syncing;
        let result = state.check_readiness();
        assert_eq!(result.readiness, SetupReadiness::ReadyForTestBackup);
    }
}
