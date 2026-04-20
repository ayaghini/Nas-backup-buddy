//! Config model and validation for NAS Backup Buddy.
//!
//! Non-secret settings are stored as TOML in the OS app-data directory.
//! Secrets (passwords, pairing tokens) are stored in the OS keyring and
//! referenced here by ID only — never by value.
//!
//! See `docs/client-app/configuration.md` for the full config spec.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

/// The user's role in a backup match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    DataOwner,
    StorageHost,
    ReciprocalMatch,
}

/// Top-level app configuration. Persisted as TOML in the OS app-data dir.
/// Secret values are never stored here; use `*_ref` fields for keyring references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NasbbConfig {
    /// User-visible role. Drives validation and UI behaviour.
    pub role: UserRole,
    /// Folders whose contents are backed up (data-owner modes only).
    /// Required for `DataOwner` and `ReciprocalMatch`.
    pub source_folders: Vec<PathBuf>,
    /// Local path for the encrypted Kopia repository (data-owner modes only).
    /// Required for `DataOwner` and `ReciprocalMatch`; not required for pure `StorageHost`.
    pub repository_path: Option<PathBuf>,
    /// Path offered to peers for their encrypted repository (host modes only).
    /// Required when role is `StorageHost` or `ReciprocalMatch`.
    pub hosted_storage_path: Option<PathBuf>,
    /// Maximum storage offered to peers in GB (host modes only).
    /// Required and non-zero when role is `StorageHost` or `ReciprocalMatch`.
    pub hosted_quota_gb: u64,
    /// Kopia retention policy: keep N most-recent snapshots.
    pub retention_keep_last: u32,
    /// Kopia retention policy: keep one snapshot per day for N days.
    pub retention_keep_daily: u32,
    /// Kopia retention policy: keep one snapshot per week for N weeks.
    pub retention_keep_weekly: u32,
    /// Kopia retention policy: keep one snapshot per month for N months.
    pub retention_keep_monthly: u32,
    /// URL of the web coordination service. None until the web API is real.
    pub web_api_url: Option<String>,
    /// Keyring reference for the pairing token — not the token itself.
    pub pairing_token_ref: Option<String>,
}

#[derive(Debug, Error, PartialEq)]
pub enum ConfigError {
    #[error("at least one source folder is required for data-owner roles")]
    NoSourceFolders,
    #[error("repository_path is required for data-owner roles")]
    MissingRepositoryPath,
    #[error("repository path must not equal a source folder: {0:?}")]
    DirectSourceShare(PathBuf),
    #[error("repository path must not be inside a source folder: repo={0:?} src={1:?}")]
    RepoInsideSource(PathBuf, PathBuf),
    #[error("source folder must not be inside the repository path: src={0:?} repo={1:?}")]
    SourceInsideRepo(PathBuf, PathBuf),
    #[error("retention_keep_last must be at least 1")]
    InvalidRetention,
    // Host-role errors
    #[error("hosted_storage_path is required for role {0:?}")]
    MissingHostedStorage(UserRole),
    #[error("hosted_quota_gb must be greater than 0 for role {0:?}")]
    InvalidHostedQuota(UserRole),
    #[error("hosted storage path must not be inside a source folder: hosted={0:?} src={1:?}")]
    HostedStorageInsideSource(PathBuf, PathBuf),
}

fn is_host_role(role: &UserRole) -> bool {
    matches!(role, UserRole::StorageHost | UserRole::ReciprocalMatch)
}

fn is_data_owner_role(role: &UserRole) -> bool {
    matches!(role, UserRole::DataOwner | UserRole::ReciprocalMatch)
}

/// Validate the config for safety violations and role-specific invariants.
/// Call before writing to disk and before the service starts.
pub fn validate_config(cfg: &NasbbConfig) -> Result<(), ConfigError> {
    if cfg.retention_keep_last < 1 {
        return Err(ConfigError::InvalidRetention);
    }

    // ── Source-folder / repository checks (data-owner roles) ─────────────────
    if is_data_owner_role(&cfg.role) {
        if cfg.source_folders.is_empty() {
            return Err(ConfigError::NoSourceFolders);
        }
        let repository_path = cfg
            .repository_path
            .as_ref()
            .ok_or(ConfigError::MissingRepositoryPath)?;

        for src in &cfg.source_folders {
            if src == repository_path {
                return Err(ConfigError::DirectSourceShare(src.clone()));
            }
            if repository_path.starts_with(src) {
                return Err(ConfigError::RepoInsideSource(
                    repository_path.clone(),
                    src.clone(),
                ));
            }
            if src.starts_with(repository_path) {
                return Err(ConfigError::SourceInsideRepo(
                    src.clone(),
                    repository_path.clone(),
                ));
            }
        }
    }

    // ── Host-role checks ─────────────────────────────────────────────────────
    if is_host_role(&cfg.role) {
        // hosted_storage_path is required
        let hosted = cfg
            .hosted_storage_path
            .as_ref()
            .ok_or_else(|| ConfigError::MissingHostedStorage(cfg.role.clone()))?;

        // quota must be non-zero
        if cfg.hosted_quota_gb == 0 {
            return Err(ConfigError::InvalidHostedQuota(cfg.role.clone()));
        }

        // Hosted path must not be inside any configured source folder.
        // Pure host mode can have no source folders at all.
        for src in &cfg.source_folders {
            if hosted.starts_with(src) {
                return Err(ConfigError::HostedStorageInsideSource(
                    hosted.clone(),
                    src.clone(),
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner_config() -> NasbbConfig {
        NasbbConfig {
            role: UserRole::DataOwner,
            source_folders: vec![PathBuf::from("/home/user/documents")],
            repository_path: Some(PathBuf::from("/home/user/.nasbb-repo")),
            hosted_storage_path: None,
            hosted_quota_gb: 0,
            retention_keep_last: 5,
            retention_keep_daily: 7,
            retention_keep_weekly: 4,
            retention_keep_monthly: 3,
            web_api_url: None,
            pairing_token_ref: None,
        }
    }

    fn host_config() -> NasbbConfig {
        NasbbConfig {
            role: UserRole::StorageHost,
            source_folders: vec![],
            repository_path: None,
            hosted_storage_path: Some(PathBuf::from("/mnt/peer-storage")),
            hosted_quota_gb: 1024,
            retention_keep_last: 5,
            retention_keep_daily: 7,
            retention_keep_weekly: 4,
            retention_keep_monthly: 3,
            web_api_url: None,
            pairing_token_ref: None,
        }
    }

    fn reciprocal_config() -> NasbbConfig {
        NasbbConfig {
            role: UserRole::ReciprocalMatch,
            source_folders: vec![PathBuf::from("/home/user/documents")],
            repository_path: Some(PathBuf::from("/home/user/.nasbb-repo")),
            ..host_config()
        }
    }

    // ── DataOwner ─────────────────────────────────────────────────────────────

    #[test]
    fn data_owner_valid_passes() {
        assert!(validate_config(&owner_config()).is_ok());
    }

    #[test]
    fn data_owner_without_hosted_storage_passes() {
        let cfg = owner_config(); // hosted_storage_path = None, hosted_quota_gb = 0
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn rejects_empty_source_folders() {
        let mut cfg = owner_config();
        cfg.source_folders = vec![];
        assert!(matches!(validate_config(&cfg), Err(ConfigError::NoSourceFolders)));
    }

    #[test]
    fn data_owner_missing_repository_fails() {
        let mut cfg = owner_config();
        cfg.repository_path = None;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::MissingRepositoryPath)
        ));
    }

    #[test]
    fn rejects_repo_equal_to_source() {
        let mut cfg = owner_config();
        cfg.repository_path = Some(PathBuf::from("/home/user/documents"));
        assert!(matches!(validate_config(&cfg), Err(ConfigError::DirectSourceShare(_))));
    }

    #[test]
    fn rejects_repo_inside_source() {
        let mut cfg = owner_config();
        cfg.repository_path = Some(PathBuf::from("/home/user/documents/backup-repo"));
        assert!(matches!(validate_config(&cfg), Err(ConfigError::RepoInsideSource(_, _))));
    }

    #[test]
    fn rejects_source_inside_repo() {
        let mut cfg = owner_config();
        cfg.source_folders = vec![PathBuf::from("/home/user/.nasbb-repo/documents")];
        assert!(matches!(validate_config(&cfg), Err(ConfigError::SourceInsideRepo(_, _))));
    }

    #[test]
    fn rejects_zero_retention() {
        let mut cfg = owner_config();
        cfg.retention_keep_last = 0;
        assert!(matches!(validate_config(&cfg), Err(ConfigError::InvalidRetention)));
    }

    // ── StorageHost ───────────────────────────────────────────────────────────

    #[test]
    fn storage_host_valid_passes() {
        assert!(validate_config(&host_config()).is_ok());
    }

    #[test]
    fn storage_host_without_source_or_repository_passes() {
        let cfg = host_config();
        assert!(cfg.source_folders.is_empty());
        assert!(cfg.repository_path.is_none());
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn storage_host_missing_hosted_path_fails() {
        let mut cfg = host_config();
        cfg.hosted_storage_path = None;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::MissingHostedStorage(UserRole::StorageHost))
        ));
    }

    #[test]
    fn storage_host_zero_quota_fails() {
        let mut cfg = host_config();
        cfg.hosted_quota_gb = 0;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::InvalidHostedQuota(UserRole::StorageHost))
        ));
    }

    #[test]
    fn storage_host_hosted_inside_source_fails() {
        let mut cfg = host_config();
        cfg.source_folders = vec![PathBuf::from("/home/user/documents")];
        cfg.hosted_storage_path = Some(PathBuf::from("/home/user/documents/peer-data"));
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::HostedStorageInsideSource(_, _))
        ));
    }

    // ── ReciprocalMatch ───────────────────────────────────────────────────────

    #[test]
    fn reciprocal_match_valid_passes() {
        assert!(validate_config(&reciprocal_config()).is_ok());
    }

    #[test]
    fn reciprocal_match_missing_hosted_path_fails() {
        let mut cfg = reciprocal_config();
        cfg.hosted_storage_path = None;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::MissingHostedStorage(UserRole::ReciprocalMatch))
        ));
    }

    #[test]
    fn reciprocal_match_missing_repository_fails() {
        let mut cfg = reciprocal_config();
        cfg.repository_path = None;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::MissingRepositoryPath)
        ));
    }

    #[test]
    fn reciprocal_match_zero_quota_fails() {
        let mut cfg = reciprocal_config();
        cfg.hosted_quota_gb = 0;
        assert!(matches!(
            validate_config(&cfg),
            Err(ConfigError::InvalidHostedQuota(UserRole::ReciprocalMatch))
        ));
    }

    // ── TOML round-trip ───────────────────────────────────────────────────────

    #[test]
    fn owner_config_toml_round_trip() {
        let original = owner_config();
        let toml_str = toml::to_string(&original).expect("serialize to TOML");

        // Verify no secrets appear in the TOML output
        assert!(!toml_str.contains("password"));
        assert!(!toml_str.contains("secret"));
        assert!(!toml_str.contains("token_value")); // only refs allowed

        let restored: NasbbConfig = toml::from_str(&toml_str).expect("deserialize from TOML");
        assert_eq!(restored.role, original.role);
        assert_eq!(restored.source_folders, original.source_folders);
        assert_eq!(restored.repository_path, original.repository_path);
        assert_eq!(restored.retention_keep_last, original.retention_keep_last);
    }

    #[test]
    fn host_config_toml_round_trip() {
        let original = host_config();
        let toml_str = toml::to_string(&original).expect("serialize to TOML");
        let restored: NasbbConfig = toml::from_str(&toml_str).expect("deserialize from TOML");
        assert_eq!(restored.role, original.role);
        assert_eq!(restored.hosted_quota_gb, original.hosted_quota_gb);
        assert_eq!(restored.hosted_storage_path, original.hosted_storage_path);
    }

    #[test]
    fn toml_does_not_serialize_secret_values() {
        // pairing_token_ref stores a keyring reference like "keychain:nasbb/token",
        // never the token value itself. Verify the field name matches docs.
        let mut cfg = owner_config();
        cfg.pairing_token_ref = Some("keychain:nasbb/pairing".to_string());
        let toml_str = toml::to_string(&cfg).expect("serialize");
        assert!(toml_str.contains("pairing_token_ref"));
        // The value is a ref, not a token — just verify the field is present
        assert!(toml_str.contains("keychain:nasbb/pairing"));
    }
}
