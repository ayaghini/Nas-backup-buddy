//! Safe test sandbox for local Kopia + Syncthing integration testing.
//!
//! Creates an isolated directory under the OS temp dir with generated sample
//! files, an isolated Kopia config, and a pre-defined layout that keeps
//! source data strictly separate from the encrypted repository and transport.
//!
//! Safety guarantees:
//! - Source dir and repository dir are always distinct.
//! - Transport dir == repository dir (encrypted output only).
//! - Source and transport/repository never overlap.
//! - All paths stay under the OS temp dir — no user home/Desktop/Documents.
//! - A canary file is created with a known checksum for restore drill verification.
//!
//! The test lab password is a fixed constant because this sandbox contains
//! only generated test data — NOT real user data.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::syncthing::validate_transport_path;

/// Fixed test password for the sandbox repository.
/// This password protects GENERATED TEST DATA only — never real user files.
pub const TEST_LAB_PASSWORD: &str = "NASBB-test-sandbox-v1-NOT-FOR-REAL-DATA";

/// Sub-directory names under the lab root.
const SOURCE_SUBDIR: &str = "source";
const REPO_SUBDIR: &str = "repo";
const RESTORE_SUBDIR: &str = "restore";
const KOPIA_CACHE_SUBDIR: &str = ".kopia-cache";
const KOPIA_CONFIG_FILE: &str = ".kopia-config.json";

/// Name of the canary file that proves backup and restore integrity.
pub const CANARY_FILENAME: &str = "canary.txt";
/// Deterministic content for the canary file.
const CANARY_CONTENT: &[u8] =
    b"NASBB canary file v1 - generated test data - DO NOT USE FOR REAL BACKUPS\n";

#[derive(Debug, Error)]
pub enum TestLabError {
    #[error("failed to create test lab directory: {0}")]
    DirCreate(String),
    #[error("failed to write sample file: {0}")]
    FileWrite(String),
    #[error("test lab path already exists but is not a directory: {0}")]
    NotADirectory(String),
    #[error("transport path overlaps with source path — safety violation")]
    SafetyViolation,
    #[error("test lab not initialized — call create_test_lab first")]
    NotInitialized,
    #[error("canary file not found in restore directory")]
    CanaryNotFound,
    #[error("io error: {0}")]
    Io(String),
}

/// All paths for a test lab instance. Kept in Tauri state after creation.
#[derive(Debug, Clone)]
pub struct TestLabPaths {
    pub root: PathBuf,
    pub source_dir: PathBuf,
    pub repo_dir: PathBuf,
    pub restore_dir: PathBuf,
    pub kopia_cache_dir: PathBuf,
    pub kopia_config_path: PathBuf,
}

/// Public info about the test lab returned to the Tauri UI.
/// Contains only safe display values — no passwords.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestLabInfo {
    /// Redacted root path label (never expose full system paths to UI).
    pub root_label: String,
    /// Whether the lab directories were freshly created.
    pub is_fresh: bool,
    /// SHA-256 hex of the canary file (expected checksum for restore verification).
    pub canary_sha256: String,
    /// Number of sample files generated in the source directory.
    pub sample_file_count: usize,
}

/// Result of a canary checksum verification during restore drill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanaryVerifyResult {
    pub expected_sha256: String,
    pub observed_sha256: String,
    pub matches: bool,
}

/// Return the platform-appropriate test lab root directory.
/// Always resolves to temp dir / "nasbb-test-lab" — never user home or data dirs.
pub fn test_lab_root() -> PathBuf {
    std::env::temp_dir().join("nasbb-test-lab")
}

/// Create (or reuse) the test lab at `root`.
///
/// Returns TestLabPaths for internal use (stored in Tauri state) and
/// TestLabInfo for display (returned to the UI).
///
/// Fails with SafetyViolation if the directory layout would violate the rule
/// that the transport folder must not overlap with the source folder.
pub fn create_test_lab(root: &Path) -> Result<(TestLabPaths, TestLabInfo), TestLabError> {
    // Validate that root itself is not a protected system location.
    // We only allow paths under temp dir.
    let temp = std::env::temp_dir();
    if !root.starts_with(&temp) {
        return Err(TestLabError::SafetyViolation);
    }

    let source_dir = root.join(SOURCE_SUBDIR);
    let repo_dir = root.join(REPO_SUBDIR);
    let restore_dir = root.join(RESTORE_SUBDIR);
    let cache_dir = root.join(KOPIA_CACHE_SUBDIR);
    let config_path = root.join(KOPIA_CONFIG_FILE);

    // Safety: verify transport (repo) never overlaps with source
    validate_transport_path(&repo_dir, &[&source_dir])
        .map_err(|_| TestLabError::SafetyViolation)?;

    // Create directory structure
    for dir in [root, &source_dir, &restore_dir, &cache_dir] {
        if dir.exists() && !dir.is_dir() {
            return Err(TestLabError::NotADirectory(
                dir.to_string_lossy().into_owned(),
            ));
        }
        std::fs::create_dir_all(dir)
            .map_err(|e| TestLabError::DirCreate(e.to_string()))?;
    }

    // repo_dir must exist for kopia create to work, but should be empty initially
    if !repo_dir.exists() {
        std::fs::create_dir_all(&repo_dir)
            .map_err(|e| TestLabError::DirCreate(e.to_string()))?;
    }

    // Generate sample files in source_dir
    let sample_count = generate_sample_files(&source_dir)?;
    let canary_sha256 = compute_canary_sha256(&source_dir.join(CANARY_FILENAME))?;

    let paths = TestLabPaths {
        root: root.to_path_buf(),
        source_dir,
        repo_dir,
        restore_dir,
        kopia_cache_dir: cache_dir,
        kopia_config_path: config_path,
    };

    let info = TestLabInfo {
        root_label: format!("[TEMP]/{}", root.file_name().unwrap_or_default().to_string_lossy()),
        is_fresh: true,
        canary_sha256,
        sample_file_count: sample_count,
    };

    Ok((paths, info))
}

/// Write generated sample files into `source_dir`. Returns the count created.
fn generate_sample_files(source_dir: &Path) -> Result<usize, TestLabError> {
    let files: &[(&str, &[u8])] = &[
        (CANARY_FILENAME, CANARY_CONTENT),
        (
            "sample-document.txt",
            b"This is a sample document for NAS Backup Buddy integration testing.\n\
              It contains no real user data. Safe to delete after testing.\n",
        ),
        (
            "sample-notes.txt",
            b"Test lab notes file.\n\
              Created by NAS Backup Buddy test lab - NOT a real file.\n",
        ),
        (
            "README.txt",
            b"NAS Backup Buddy Test Lab - Source Data\n\
              =======================================\n\
              This directory contains GENERATED TEST DATA only.\n\
              It was created to test the Kopia backup + restore flow.\n\
              None of these files contain real personal data.\n\
              Safe to delete: rm -rf /tmp/nasbb-test-lab\n",
        ),
    ];

    for (name, content) in files {
        let path = source_dir.join(name);
        std::fs::write(&path, content)
            .map_err(|e| TestLabError::FileWrite(e.to_string()))?;
    }
    Ok(files.len())
}

/// Compute the SHA-256 of the canary file.
pub fn compute_canary_sha256(canary_path: &Path) -> Result<String, TestLabError> {
    let bytes = std::fs::read(canary_path)
        .map_err(|e| TestLabError::Io(e.to_string()))?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}

/// Clear and re-create the restore directory so it is empty before a drill.
pub fn prepare_restore_dir(restore_dir: &Path) -> Result<(), TestLabError> {
    if restore_dir.exists() {
        std::fs::remove_dir_all(restore_dir)
            .map_err(|e| TestLabError::Io(e.to_string()))?;
    }
    std::fs::create_dir_all(restore_dir)
        .map_err(|e| TestLabError::DirCreate(e.to_string()))?;
    Ok(())
}

/// Search for the canary file under `restore_dir` (including subdirectories).
///
/// Kopia may restore into a nested path that mirrors the original source.
/// This scan finds the canary file wherever it ends up.
pub fn find_restored_canary(restore_dir: &Path) -> Option<PathBuf> {
    // Check direct location first (most likely result)
    let direct = restore_dir.join(CANARY_FILENAME);
    if direct.exists() {
        return Some(direct);
    }
    // Recursive scan for deeper nesting
    find_file_recursive(restore_dir, CANARY_FILENAME)
}

fn find_file_recursive(dir: &Path, filename: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().map(|n| n == filename).unwrap_or(false) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, filename) {
                return Some(found);
            }
        }
    }
    None
}

/// Verify the canary file at `restored_canary_path` against `expected_sha256`.
pub fn verify_canary(
    restored_canary_path: &Path,
    expected_sha256: &str,
) -> Result<CanaryVerifyResult, TestLabError> {
    let observed = compute_canary_sha256(restored_canary_path)?;
    Ok(CanaryVerifyResult {
        expected_sha256: expected_sha256.to_string(),
        observed_sha256: observed.clone(),
        matches: observed == expected_sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lab_root_is_under_temp_dir() {
        let root = test_lab_root();
        let temp = std::env::temp_dir();
        assert!(root.starts_with(&temp));
    }

    #[test]
    fn create_test_lab_rejects_non_temp_path() {
        let result = create_test_lab(Path::new("/home/user/nasbb-test"));
        assert!(matches!(result, Err(TestLabError::SafetyViolation)));
    }

    #[test]
    fn create_test_lab_in_temp_succeeds() {
        let root = std::env::temp_dir().join("nasbb-test-lab-unit-test");
        let _ = std::fs::remove_dir_all(&root);
        let result = create_test_lab(&root);
        assert!(result.is_ok(), "Expected Ok but got: {:?}", result.err());
        let (paths, info) = result.unwrap();
        assert!(paths.source_dir.exists());
        assert!(paths.restore_dir.exists());
        assert!(!info.canary_sha256.is_empty());
        assert_eq!(info.sample_file_count, 4);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn canary_file_content_produces_stable_checksum() {
        // Write canary to temp file and verify checksum
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), CANARY_CONTENT).unwrap();
        let sha = compute_canary_sha256(tmp.path()).unwrap();
        assert_eq!(sha.len(), 64);
        // Checksum should be deterministic
        let sha2 = compute_canary_sha256(tmp.path()).unwrap();
        assert_eq!(sha, sha2);
    }

    #[test]
    fn canary_verify_passes_when_checksums_match() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), CANARY_CONTENT).unwrap();
        let expected = compute_canary_sha256(tmp.path()).unwrap();
        let result = verify_canary(tmp.path(), &expected).unwrap();
        assert!(result.matches);
    }

    #[test]
    fn canary_verify_fails_when_content_differs() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), CANARY_CONTENT).unwrap();
        let result = verify_canary(tmp.path(), &"0".repeat(64)).unwrap();
        assert!(!result.matches);
        assert_ne!(result.expected_sha256, result.observed_sha256);
    }

    #[test]
    fn repo_dir_does_not_overlap_with_source_dir() {
        let root = std::env::temp_dir().join("nasbb-test-lab-overlap-test");
        let _ = std::fs::remove_dir_all(&root);
        let result = create_test_lab(&root);
        if let Ok((paths, _)) = result {
            // Transport folder is the repo dir — must not overlap source
            assert_ne!(paths.repo_dir, paths.source_dir);
            assert!(
                !paths.repo_dir.starts_with(&paths.source_dir),
                "repo_dir must not be inside source_dir"
            );
            assert!(
                !paths.source_dir.starts_with(&paths.repo_dir),
                "source_dir must not be inside repo_dir"
            );
            let _ = std::fs::remove_dir_all(&root);
        }
    }

    #[test]
    fn find_restored_canary_finds_direct_file() {
        let tmp_dir = tempfile::TempDir::new().unwrap();
        let canary = tmp_dir.path().join(CANARY_FILENAME);
        std::fs::write(&canary, CANARY_CONTENT).unwrap();
        let found = find_restored_canary(tmp_dir.path());
        assert!(found.is_some());
        assert_eq!(found.unwrap().file_name().unwrap(), CANARY_FILENAME);
    }

    #[test]
    fn find_restored_canary_finds_nested_file() {
        let tmp_dir = tempfile::TempDir::new().unwrap();
        let nested = tmp_dir.path().join("subdir");
        std::fs::create_dir_all(&nested).unwrap();
        let canary = nested.join(CANARY_FILENAME);
        std::fs::write(&canary, CANARY_CONTENT).unwrap();
        let found = find_restored_canary(tmp_dir.path());
        assert!(found.is_some());
    }

    #[test]
    fn find_restored_canary_returns_none_when_missing() {
        let tmp_dir = tempfile::TempDir::new().unwrap();
        assert!(find_restored_canary(tmp_dir.path()).is_none());
    }
}
