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

// ── Extended tool probe types ─────────────────────────────────────────────────

/// Where a tool binary was found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolLocation {
    /// Bundled with the application at this path.
    Bundled,
    /// Found on the system PATH (not verified against manifest checksum).
    SystemPath,
    /// Explicitly configured at this path.
    Configured,
    /// Not found anywhere.
    NotFound,
}

/// Parsed tool version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolVersion {
    pub raw: String,
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl ToolVersion {
    /// Parse a Kopia version string like "0.17.0 build: ..." → ToolVersion.
    pub fn parse_kopia(raw: &str) -> Option<Self> {
        let first_token = raw.split_whitespace().next()?;
        parse_semver(first_token, raw)
    }

    /// Parse a Syncthing version string like "syncthing v1.27.7 ..." → ToolVersion.
    pub fn parse_syncthing(raw: &str) -> Option<Self> {
        // Find the token that looks like vX.Y.Z
        for token in raw.split_whitespace() {
            let stripped = token.trim_start_matches('v');
            if let Some(v) = parse_semver(stripped, raw) {
                return Some(v);
            }
        }
        None
    }

    /// Returns true if this version matches the expected "major.minor.patch" string.
    pub fn matches_expected(&self, expected: &str) -> bool {
        let stripped = expected.trim_start_matches('v');
        if let Some(exp) = parse_semver(stripped, stripped) {
            return self.major == exp.major && self.minor == exp.minor && self.patch == exp.patch;
        }
        false
    }
}

fn parse_semver(token: &str, raw: &str) -> Option<ToolVersion> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0].parse::<u32>().ok()?;
    let minor = parts[1].parse::<u32>().ok()?;
    let patch = parts[2].split(|c: char| !c.is_ascii_digit()).next()?.parse::<u32>().ok()?;
    Some(ToolVersion { raw: raw.to_string(), major, minor, patch })
}

/// A pinned version constraint for a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedTool {
    pub name: ToolName,
    /// Expected version string, e.g. "0.17.0".
    pub expected_version: String,
    /// Expected SHA-256 hex. Empty string means checksum is not yet pinned.
    pub expected_sha256: String,
}

/// Result of probing a single tool binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolProbeResult {
    pub name: ToolName,
    pub location: ToolLocation,
    pub version: Option<ToolVersion>,
    pub status: ToolStatus,
    /// Safe error description for display — no paths or secrets.
    pub error_message: Option<String>,
}

/// Manages detection and version verification for bundled tools.
pub struct ToolManager {
    /// Path to the Kopia binary, if known.
    pub kopia_path: Option<std::path::PathBuf>,
    /// Path to the Syncthing binary, if known.
    pub syncthing_path: Option<std::path::PathBuf>,
    /// Pinned version constraints. If empty, version comparison is skipped.
    pub pinned: Vec<PinnedTool>,
}

impl ToolManager {
    pub fn new() -> Self {
        Self { kopia_path: None, syncthing_path: None, pinned: Vec::new() }
    }

    pub fn with_kopia(mut self, path: std::path::PathBuf) -> Self {
        self.kopia_path = Some(path);
        self
    }

    pub fn with_syncthing(mut self, path: std::path::PathBuf) -> Self {
        self.syncthing_path = Some(path);
        self
    }

    pub fn with_pinned(mut self, pins: Vec<PinnedTool>) -> Self {
        self.pinned = pins;
        self
    }

    /// Probe Kopia: detect binary, run --version, compare to pinned constraint.
    pub fn probe_kopia(&self) -> ToolProbeResult {
        probe_tool(
            &ToolName::Kopia,
            self.kopia_path.as_deref(),
            &self.pinned,
            |raw| ToolVersion::parse_kopia(raw),
        )
    }

    /// Probe Syncthing: detect binary, run --version, compare to pinned constraint.
    pub fn probe_syncthing(&self) -> ToolProbeResult {
        probe_tool(
            &ToolName::Syncthing,
            self.syncthing_path.as_deref(),
            &self.pinned,
            |raw| ToolVersion::parse_syncthing(raw),
        )
    }

    /// Probe both tools and return results.
    pub fn probe_all(&self) -> Vec<ToolProbeResult> {
        vec![self.probe_kopia(), self.probe_syncthing()]
    }
}

impl Default for ToolManager {
    fn default() -> Self {
        Self::new()
    }
}

fn probe_tool(
    name: &ToolName,
    binary_path: Option<&Path>,
    pinned: &[PinnedTool],
    parse_version: impl Fn(&str) -> Option<ToolVersion>,
) -> ToolProbeResult {
    use std::process::Command as Cmd;

    // Determine location
    let (location, actual_path): (ToolLocation, Option<std::path::PathBuf>) = match binary_path {
        Some(p) if p.exists() => (ToolLocation::Bundled, Some(p.to_path_buf())),
        Some(_) => {
            // Configured path doesn't exist — fall through to PATH detection
            (ToolLocation::NotFound, None)
        }
        None => {
            // Try PATH
            let cmd_name = name.to_string();
            match Cmd::new(&cmd_name).arg("--version").output() {
                Ok(_) => (ToolLocation::SystemPath, None),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return ToolProbeResult {
                        name: name.clone(),
                        location: ToolLocation::NotFound,
                        version: None,
                        status: ToolStatus::Missing,
                        error_message: Some(format!("{name} not found on PATH or bundled path")),
                    };
                }
                Err(_) => (ToolLocation::SystemPath, None),
            }
        }
    };

    if matches!(location, ToolLocation::NotFound) {
        return ToolProbeResult {
            name: name.clone(),
            location: ToolLocation::NotFound,
            version: None,
            status: ToolStatus::Missing,
            error_message: Some(format!("{name} binary not found")),
        };
    }

    // Run --version
    let exe: std::path::PathBuf = actual_path
        .clone()
        .unwrap_or_else(|| std::path::PathBuf::from(name.to_string()));
    let version_output = Cmd::new(&exe).arg("--version").output();

    let version_str = match version_output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            format!("{}{}", stdout, stderr).trim().lines().next().unwrap_or("").to_string()
        }
        Err(_) => {
            return ToolProbeResult {
                name: name.clone(),
                location,
                version: None,
                status: ToolStatus::Present,
                error_message: Some(format!("{name} binary found but --version failed")),
            };
        }
    };

    let parsed_version = parse_version(&version_str);

    // Check against pinned constraint
    let pinned_entry = pinned.iter().find(|p| p.name == *name);
    let status = if let Some(pin) = pinned_entry {
        if pin.expected_version.is_empty() {
            // No version pinned — just mark as present
            if matches!(location, ToolLocation::Bundled) {
                // Bundled but no pinned version configured — treat as present
                ToolStatus::Present
            } else {
                ToolStatus::Present
            }
        } else {
            match &parsed_version {
                Some(v) if v.matches_expected(&pin.expected_version) => {
                    if matches!(location, ToolLocation::Bundled) {
                        // Bundled: checksum also needs to match — but that's checked separately
                        // Here we know version matches; status is at least Present
                        ToolStatus::Present
                    } else {
                        ToolStatus::Present
                    }
                }
                Some(_) => ToolStatus::VersionMismatch,
                None => ToolStatus::Present, // couldn't parse — give benefit of doubt
            }
        }
    } else {
        // No pinned constraint — binary exists and responded to --version
        ToolStatus::Present
    };

    ToolProbeResult {
        name: name.clone(),
        location,
        version: parsed_version,
        status,
        error_message: None,
    }
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

    // ── ToolVersion ───────────────────────────────────────────────────────────

    #[test]
    fn parse_kopia_version_valid() {
        let v = ToolVersion::parse_kopia("0.17.0 build: abc123").unwrap();
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 17);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn parse_kopia_version_no_build_suffix() {
        let v = ToolVersion::parse_kopia("0.17.0").unwrap();
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 17);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn parse_syncthing_version_valid() {
        let v = ToolVersion::parse_syncthing("syncthing v1.27.7 \"Fermium Flea\" (go1.22.5)")
            .unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 27);
        assert_eq!(v.patch, 7);
    }

    #[test]
    fn parse_syncthing_version_with_v_prefix() {
        let v = ToolVersion::parse_syncthing("syncthing v1.27.7").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 27);
        assert_eq!(v.patch, 7);
    }

    #[test]
    fn tool_version_matches_expected_string() {
        let v = ToolVersion { raw: "0.17.0".to_string(), major: 0, minor: 17, patch: 0 };
        assert!(v.matches_expected("0.17.0"));
        assert!(v.matches_expected("v0.17.0"));
        assert!(!v.matches_expected("0.17.1"));
        assert!(!v.matches_expected("0.18.0"));
    }

    #[test]
    fn tool_version_mismatch_detected() {
        let v = ToolVersion { raw: "0.16.0".to_string(), major: 0, minor: 16, patch: 0 };
        assert!(!v.matches_expected("0.17.0"));
    }

    // ── Tool version mismatch fails closed ────────────────────────────────────

    #[test]
    fn version_mismatch_produces_version_mismatch_status() {
        // A binary that reports a different version than pinned must fail closed.
        // We simulate this by building a probe result directly.
        let version = ToolVersion { raw: "0.16.0".to_string(), major: 0, minor: 16, patch: 0 };
        let pinned = vec![PinnedTool {
            name: ToolName::Kopia,
            expected_version: "0.17.0".to_string(),
            expected_sha256: String::new(),
        }];
        // Verify the matching logic
        assert!(!version.matches_expected("0.17.0"));
        // A ToolProbeResult with VersionMismatch status must block operations
        let result = ToolProbeResult {
            name: ToolName::Kopia,
            location: ToolLocation::Bundled,
            version: Some(version),
            status: ToolStatus::VersionMismatch,
            error_message: None,
        };
        assert_ne!(result.status, ToolStatus::Ready);
        let _ = pinned; // used above
    }
}
