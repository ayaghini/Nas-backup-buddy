//! Bundled tool manifest model.
//!
//! The client bundles pinned versions of Kopia and Syncthing.
//! This module defines the manifest shape and a validation check
//! that must pass before any backup or sync operation can run.
//!
//! Pinned checksums and actual binaries are NOT committed here.
//! They are supplied at release time via a separate script and stored
//! in `src-tauri/binaries/`. See `docs/client-app/packaging-and-release.md`.

use serde::{Deserialize, Serialize};
use thiserror::Error;

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
        if seen.iter().any(|(n, p)| *n == &entry.name && *p == &entry.platform) {
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
        assert!(matches!(validate_manifest(&m), Err(ManifestError::UnsupportedVersion(2))));
    }

    #[test]
    fn rejects_empty_checksum() {
        let mut m = sample_manifest();
        m.tools[0].sha256 = String::new();
        assert!(matches!(validate_manifest(&m), Err(ManifestError::EmptyChecksum { .. })));
    }

    #[test]
    fn rejects_duplicate_entry() {
        let mut m = sample_manifest();
        m.tools.push(m.tools[0].clone());
        assert!(matches!(validate_manifest(&m), Err(ManifestError::DuplicateEntry { .. })));
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
}
