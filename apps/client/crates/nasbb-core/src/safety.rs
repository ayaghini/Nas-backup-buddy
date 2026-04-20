//! Safe folder layout validation.
//!
//! Enforces the invariants that prevent accidental data exposure:
//! - Source folders must never be shared directly with peers.
//! - The encrypted repository must not be inside a source folder.
//! - Source folders must not be inside the encrypted repository.
//! - Peer-hosted storage must not be inside a source folder.
//!
//! These checks are the primary safety control for preventing
//! unencrypted data from reaching peers.

use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum SafetyError {
    #[error("direct source folder sharing is not allowed: {0:?}")]
    DirectSourceShare(std::path::PathBuf),
    #[error("repository path must not be inside a source folder: repo={0:?} src={1:?}")]
    RepoInsideSource(std::path::PathBuf, std::path::PathBuf),
    #[error("source folder must not be inside the repository path: src={0:?} repo={1:?}")]
    SourceInsideRepo(std::path::PathBuf, std::path::PathBuf),
    #[error("hosted peer storage must not be inside a source folder: hosted={0:?} src={1:?}")]
    HostedInsideSource(std::path::PathBuf, std::path::PathBuf),
}

/// Validate the folder layout before creating any Kopia or Syncthing configuration.
///
/// `source_folders`      — folders the user backs up (must stay local and encrypted)
/// `repository_path`     — local path for the encrypted Kopia repository
/// `hosted_storage_path` — path offered to peers (host role only)
pub fn validate_folder_layout(
    source_folders: &[&Path],
    repository_path: &Path,
    hosted_storage_path: Option<&Path>,
) -> Result<(), SafetyError> {
    for &src in source_folders {
        // Reject direct sharing: repo == source
        if src == repository_path {
            return Err(SafetyError::DirectSourceShare(src.to_path_buf()));
        }
        // Reject: repo is a subdirectory of source (unencrypted data would be inside the repo)
        if repository_path.starts_with(src) {
            return Err(SafetyError::RepoInsideSource(
                repository_path.to_path_buf(),
                src.to_path_buf(),
            ));
        }
        // Reject: source is a subdirectory of repo (plaintext would be synced with the repo)
        if src.starts_with(repository_path) {
            return Err(SafetyError::SourceInsideRepo(
                src.to_path_buf(),
                repository_path.to_path_buf(),
            ));
        }
        // Reject: hosted storage is inside source (would expose unencrypted paths to peers)
        if let Some(hosted) = hosted_storage_path {
            if hosted.starts_with(src) {
                return Err(SafetyError::HostedInsideSource(
                    hosted.to_path_buf(),
                    src.to_path_buf(),
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn valid_layout_passes() {
        assert!(validate_folder_layout(
            &[Path::new("/home/user/docs")],
            Path::new("/home/user/.nasbb-repo"),
            Some(Path::new("/mnt/peer-storage")),
        )
        .is_ok());
    }

    #[test]
    fn rejects_direct_source_share() {
        let result = validate_folder_layout(
            &[Path::new("/home/user/docs")],
            Path::new("/home/user/docs"),
            None,
        );
        assert!(matches!(result, Err(SafetyError::DirectSourceShare(_))));
    }

    #[test]
    fn rejects_repo_inside_source() {
        let result = validate_folder_layout(
            &[Path::new("/home/user/docs")],
            Path::new("/home/user/docs/hidden-repo"),
            None,
        );
        assert!(matches!(result, Err(SafetyError::RepoInsideSource(_, _))));
    }

    #[test]
    fn rejects_source_inside_repo() {
        let result = validate_folder_layout(
            &[Path::new("/home/user/.nasbb-repo/documents")],
            Path::new("/home/user/.nasbb-repo"),
            None,
        );
        assert!(matches!(result, Err(SafetyError::SourceInsideRepo(_, _))));
    }

    #[test]
    fn rejects_hosted_inside_source() {
        let result = validate_folder_layout(
            &[Path::new("/home/user/docs")],
            Path::new("/home/user/.nasbb-repo"),
            Some(Path::new("/home/user/docs/peer-folder")),
        );
        assert!(matches!(result, Err(SafetyError::HostedInsideSource(_, _))));
    }

    #[test]
    fn multiple_sources_all_checked() {
        // First source is fine, second is inside the repo
        let result = validate_folder_layout(
            &[
                Path::new("/home/user/photos"),
                Path::new("/home/user/.nasbb-repo/extra"),
            ],
            Path::new("/home/user/.nasbb-repo"),
            None,
        );
        assert!(matches!(result, Err(SafetyError::SourceInsideRepo(_, _))));
    }
}
