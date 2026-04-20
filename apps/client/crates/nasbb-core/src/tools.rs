//! Bundled tool manifest model and binary status checks.
//!
//! The client bundles pinned versions of Kopia and Syncthing.
//! This module defines the manifest shape, a validation check
//! that must pass before any backup or sync operation can run,
//! and the `check_tool_status` function that evaluates a binary at runtime.
//!
//! Pinned checksums and actual binaries are NOT committed here.
//! They are supplied at release time via a separate script and stored
//! in `src-tauri/binaries/`. See `docs/client-app/packaging-and-release.md`.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

/// Runtime status of a bundled tool binary.
///
/// The service must fail closed: any status other than `Ready` must block
/// backup and sync operations. The only exception is `Missing` in mock/offline
/// mode where real binaries are not expected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    /// Binary not found at the expected path.
    Missing,
    /// Binary exists but version was not checked.
    Present,
    /// Binary version does not match the manifest entry.
    VersionMismatch,
    /// Binary SHA-256 does not match the manifest entry.
    ChecksumMismatch,
    /// Binary exists, version matches, and checksum verified.
    Ready,
}

/// Supported tool names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolName {
    Kopia,
    Syncthing,
}

impl std::fmt::Display for ToolName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolName::Kopia => write!(f, "kopia"),
            ToolName::Syncthing => write!(f, "syncthing"),
        }
    }
}

/// Target platform triple (matches Tauri sidecar naming convention).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    X86_64Linux,
    Aarch64Linux,
    X86_64Windows,
    X86_64MacOs,
    Aarch64MacOs,
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Platform::X86_64Linux => write!(f, "x86_64-unknown-linux-gnu"),
            Platform::Aarch64Linux => write!(f, "aarch64-unknown-linux-gnu"),
            Platform::X86_64Windows => write!(f, "x86_64-pc-windows-msvc"),
            Platform::X86_64MacOs => write!(f, "x86_64-apple-darwin"),
            Platform::Aarch64MacOs => write!(f, "aarch64-apple-darwin"),
        }
    }
}

/// A single tool entry in the manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEntry {
    pub name: ToolName,
    pub version: String,
    pub platform: Platform,
    /// SHA-256 hex digest of the binary. Must be verified before execution.
    pub sha256: String,
    /// Path relative to the app resources directory.
    pub binary_path: String,
}

/// The full tool manifest. Loaded from a JSON file bundled with the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolManifest {
    pub manifest_version: u32,
    pub tools: Vec<ToolEntry>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("manifest version {0} is not supported (expected 1)")]
    UnsupportedVersion(u32),
    #[error("no entry found for {tool} on platform {platform}")]
    MissingEntry { tool: String, platform: String },
    #[error("duplicate entry for {tool} on platform {platform}")]
    DuplicateEntry { tool: String, platform: String },
    #[error("sha256 field is empty for {tool} on platform {platform}")]
    EmptyChecksum { tool: String, platform: String },
}

/// Validate that the manifest is well-formed.
///
/// This does NOT verify binary checksums on disk — that is done at
/// launch time by the Tauri sidecar initialisation code.
pub fn validate_manifest(manifest: &ToolManifest) -> Result<(), ManifestError> {
    if manifest.manifest_version != 1 {
        return Err(ManifestError::UnsupportedVersion(manifest.manifest_version));
    }
    let mut seen: Vec<(&ToolName, &Platform)> = Vec::new();
    for entry in &manifest.tools {
        if entry.sha256.is_empty() {
            return Err(ManifestError::EmptyChecksum {
                tool: entry.name.to_string(),
                platform: entry.platform.to_string(),
            });
        }
        if seen
            .iter()
            .any(|(n, p)| *n == &entry.name && *p == &entry.platform)
        {
            return Err(ManifestError::DuplicateEntry {
                tool: entry.name.to_string(),
                platform: entry.platform.to_string(),
            });
        }
        seen.push((&entry.name, &entry.platform));
    }
    Ok(())
}

/// Look up a tool entry by name and platform. Returns an error if not found.
/// Callers must fail closed: if the manifest lookup fails, do not proceed.
pub fn get_tool_entry<'a>(
    manifest: &'a ToolManifest,
    name: &ToolName,
    platform: &Platform,
) -> Result<&'a ToolEntry, ManifestError> {
    manifest
        .tools
        .iter()
        .find(|e| &e.name == name && &e.platform == platform)
        .ok_or_else(|| ManifestError::MissingEntry {
            tool: name.to_string(),
            platform: platform.to_string(),
        })
}

/// Detect whether a named binary is accessible on the system PATH.
///
/// Attempts to run `<name> --version` and inspects the launch error to distinguish
/// "binary not found" from other failures. Returns `ToolStatus::Present` if the
/// binary launches (even with a non-zero exit code), `ToolStatus::Missing` if it
/// cannot be found.
///
/// `Present` is NOT the same as `Ready`. Callers must still verify the binary
/// against the tool manifest checksum before using it in backup/sync operations.
pub fn detect_tool_on_path(name: &str) -> ToolStatus {
    use std::process::Command;
    match Command::new(name).arg("--version").output() {
        Ok(_) => ToolStatus::Present,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => ToolStatus::Missing,
        // Binary was found but failed to run for another reason — still present
        Err(_) => ToolStatus::Present,
    }
}

/// Check the on-disk status of a tool binary against its manifest entry.
///
/// Fails closed: any ambiguity (missing binary, empty checksum, checksum mismatch,
/// unreadable file) returns a non-`Ready` status to block backup/sync operations.
/// Only `ToolStatus::Ready` means the binary is present AND its SHA-256 matches
/// the manifest entry.
pub fn check_tool_status(entry: &ToolEntry, binary_path: Option<&Path>) -> ToolStatus {
    let path = match binary_path {
        Some(p) => p,
        None => return ToolStatus::Missing,
    };

    if !path.exists() {
        return ToolStatus::Missing;
    }

    if entry.sha256.is_empty() {
        // Fail closed: an empty checksum in the manifest means it has not been
        // filled in yet (scaffold/placeholder). Never accept as ready.
        return ToolStatus::ChecksumMismatch;
    }

    match verify_sha256(path, &entry.sha256) {
        Ok(true) => ToolStatus::Ready,
        Ok(false) => ToolStatus::ChecksumMismatch,
        Err(_) => ToolStatus::Missing,
    }
}

/// Compute the SHA-256 of the file at `path` and compare it to `expected_hex`.
///
/// Returns `Ok(true)` if they match, `Ok(false)` if they do not, or `Err` if the
/// file cannot be read.
fn verify_sha256(path: &Path, expected_hex: &str) -> Result<bool, std::io::Error> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path)?;
    let actual = hex::encode(Sha256::digest(&bytes));
    Ok(actual == expected_hex.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> ToolManifest {
        ToolManifest {
            manifest_version: 1,
            tools: vec![
                ToolEntry {
                    name: ToolName::Kopia,
                    version: "0.17.0".to_string(),
                    platform: Platform::X86_64Linux,
                    sha256: "a".repeat(64),
                    binary_path: "binaries/kopia-x86_64-unknown-linux-gnu".to_string(),
                },
                ToolEntry {
                    name: ToolName::Syncthing,
                    version: "1.27.7".to_string(),
                    platform: Platform::X86_64Linux,
                    sha256: "b".repeat(64),
                    binary_path: "binaries/syncthing-x86_64-unknown-linux-gnu".to_string(),
                },
            ],
        }
    }

    #[test]
    fn valid_manifest_passes() {
        assert!(validate_manifest(&sample_manifest()).is_ok());
    }

    #[test]
    fn rejects_unsupported_version() {
        let mut m = sample_manifest();
        m.manifest_version = 2;
        assert!(matches!(
            validate_manifest(&m),
            Err(ManifestError::UnsupportedVersion(2))
        ));
    }

    #[test]
    fn rejects_empty_checksum() {
        let mut m = sample_manifest();
        m.tools[0].sha256 = String::new();
        assert!(matches!(
            validate_manifest(&m),
            Err(ManifestError::EmptyChecksum { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_entry() {
        let mut m = sample_manifest();
        m.tools.push(m.tools[0].clone());
        assert!(matches!(
            validate_manifest(&m),
            Err(ManifestError::DuplicateEntry { .. })
        ));
    }

    #[test]
    fn get_tool_entry_found() {
        let m = sample_manifest();
        let entry = get_tool_entry(&m, &ToolName::Kopia, &Platform::X86_64Linux);
        assert!(entry.is_ok());
        assert_eq!(entry.unwrap().version, "0.17.0");
    }

    #[test]
    fn get_tool_entry_not_found_fails_closed() {
        let m = sample_manifest();
        let result = get_tool_entry(&m, &ToolName::Kopia, &Platform::Aarch64MacOs);
        assert!(matches!(result, Err(ManifestError::MissingEntry { .. })));
    }

    // ── check_tool_status ─────────────────────────────────────────────────────

    fn kopia_entry() -> ToolEntry {
        ToolEntry {
            name: ToolName::Kopia,
            version: "0.17.0".to_string(),
            platform: Platform::X86_64Linux,
            sha256: "a".repeat(64),
            binary_path: "binaries/kopia".to_string(),
        }
    }

    fn syncthing_entry() -> ToolEntry {
        ToolEntry {
            name: ToolName::Syncthing,
            version: "1.27.7".to_string(),
            platform: Platform::X86_64Linux,
            sha256: "b".repeat(64),
            binary_path: "binaries/syncthing".to_string(),
        }
    }

    #[test]
    fn check_tool_status_missing_when_no_path() {
        assert_eq!(check_tool_status(&kopia_entry(), None), ToolStatus::Missing);
    }

    #[test]
    fn check_tool_status_kopia_missing_when_path_does_not_exist() {
        let path = std::path::Path::new("/nonexistent/kopia");
        assert_eq!(
            check_tool_status(&kopia_entry(), Some(path)),
            ToolStatus::Missing
        );
    }

    #[test]
    fn check_tool_status_syncthing_missing_when_path_does_not_exist() {
        let path = std::path::Path::new("/nonexistent/syncthing");
        assert_eq!(
            check_tool_status(&syncthing_entry(), Some(path)),
            ToolStatus::Missing
        );
    }

    #[test]
    fn check_tool_status_checksum_mismatch_when_empty_checksum() {
        let mut entry = kopia_entry();
        entry.sha256 = String::new();
        // Use a temp file so path exists
        let tmp = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(
            check_tool_status(&entry, Some(tmp.path())),
            ToolStatus::ChecksumMismatch
        );
    }

    #[test]
    fn check_tool_status_checksum_mismatch_with_wrong_hash() {
        let mut entry = kopia_entry();
        // Valid hex format but definitely wrong value for any real file
        entry.sha256 = "0".repeat(64);
        let tmp = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(
            check_tool_status(&entry, Some(tmp.path())),
            ToolStatus::ChecksumMismatch
        );
    }

    #[test]
    fn check_tool_status_ready_when_checksum_matches() {
        use sha2::{Digest, Sha256};
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let contents = std::fs::read(tmp.path()).unwrap();
        let actual_hash = hex::encode(Sha256::digest(&contents));

        let mut entry = kopia_entry();
        entry.sha256 = actual_hash;
        assert_eq!(
            check_tool_status(&entry, Some(tmp.path())),
            ToolStatus::Ready
        );
    }

    #[test]
    fn check_tool_status_ready_for_syncthing_entry_with_matching_hash() {
        use sha2::{Digest, Sha256};
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let contents = std::fs::read(tmp.path()).unwrap();
        let actual_hash = hex::encode(Sha256::digest(&contents));

        let mut entry = syncthing_entry();
        entry.sha256 = actual_hash;
        assert_eq!(
            check_tool_status(&entry, Some(tmp.path())),
            ToolStatus::Ready
        );
    }

    #[test]
    fn verify_sha256_returns_true_for_matching_hash() {
        use sha2::{Digest, Sha256};
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let contents = std::fs::read(tmp.path()).unwrap();
        let expected = hex::encode(Sha256::digest(&contents));
        assert!(verify_sha256(tmp.path(), &expected).unwrap());
    }

    #[test]
    fn verify_sha256_returns_false_for_wrong_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        assert!(!verify_sha256(tmp.path(), &"0".repeat(64)).unwrap());
    }
}
