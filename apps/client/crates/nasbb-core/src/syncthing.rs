//! Syncthing detection and transport folder preparation.
//!
//! This module detects the Syncthing binary, reads its version, and prepares
//! a folder definition for transporting the encrypted Kopia repository.
//!
//! Safety rules enforced here:
//! - The transport folder must NEVER be a source folder or inside a source folder.
//! - The transport folder must NEVER have a source folder inside it.
//! - Source paths are never included in the returned config output.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Deserialize)]
pub enum SyncthingError {
    #[error("syncthing binary not found — ensure it is bundled or on PATH")]
    BinaryNotFound,
    #[error("version detection failed: {0}")]
    VersionFailed(String),
    #[error(
        "transport folder cannot be a source folder or overlap with a source folder — \
         only the encrypted repository path is safe to share via Syncthing"
    )]
    TransportFolderOverlapsSource,
    #[error("transport folder path is empty")]
    EmptyTransportPath,
    #[error("io error")]
    Io,
}

/// A Syncthing folder definition for the encrypted repository transport.
///
/// This is a config object — it does NOT start Syncthing or configure it via API.
/// Use it to generate a config snippet or display setup instructions.
///
/// Source paths are never included — the folder path is labeled "[REDACTED]" in display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportFolderDef {
    pub folder_id: String,
    pub folder_label: String,
    /// Always "[REDACTED]" in display/health output. Real path kept only for internal use.
    pub folder_path_display: String,
    /// The actual folder path for internal use only. Must equal the encrypted repository path.
    #[serde(skip_serializing)]
    pub folder_path_internal: PathBuf,
    pub folder_type: String,
    pub is_safety_validated: bool,
}

impl TransportFolderDef {
    /// Return a JSON snippet that can be added to a Syncthing config.
    /// The folder path is shown as [REDACTED] to avoid logging real paths.
    pub fn to_config_snippet(&self) -> String {
        serde_json::json!({
            "id": self.folder_id,
            "label": self.folder_label,
            "path": "[REDACTED — set to encrypted repository path]",
            "type": self.folder_type,
            "autoNormalize": true,
            "note": "Managed by NAS Backup Buddy — do not change path or type"
        })
        .to_string()
    }
}

/// Prepare a `TransportFolderDef` for the encrypted repository path without
/// requiring a Syncthing binary to be present or verified.
///
/// This is the correct function to use for config-generation and safety
/// validation workflows where Syncthing is not yet running.
/// All safety checks (source/transport overlap) are still enforced.
pub fn prepare_transport_folder_def(
    folder_id: &str,
    repo_path: &Path,
    source_folders: &[&Path],
) -> Result<TransportFolderDef, SyncthingError> {
    if repo_path.as_os_str().is_empty() {
        return Err(SyncthingError::EmptyTransportPath);
    }
    validate_transport_path(repo_path, source_folders)?;
    Ok(TransportFolderDef {
        folder_id: folder_id.to_string(),
        folder_label: "NAS Backup Buddy Repository".to_string(),
        folder_path_display: "[REDACTED]".to_string(),
        folder_path_internal: repo_path.to_path_buf(),
        folder_type: "sendreceive".to_string(),
        is_safety_validated: true,
    })
}

/// Arguments used to start the Syncthing daemon.
pub struct SyncthingStartArgs<'a> {
    pub binary_path: &'a std::path::Path,
    /// Syncthing `--home` directory (config + data). Persists device identity.
    pub home_dir: &'a std::path::Path,
    /// Optional path to write stderr for startup diagnostics.
    /// If None, stderr is discarded.
    pub stderr_log: Option<&'a std::path::Path>,
}

/// Start the Syncthing daemon and return the spawned child process.
///
/// Flags used:
/// - `serve`        — run the daemon (not a one-shot command)
/// - `--home`       — isolated config+data directory managed by the app
/// - `--no-browser` — suppress browser auto-open
/// - `--no-restart` — single-process mode; the app controls lifecycle
///
/// `--no-default-folder` was removed in Syncthing v2 and is intentionally omitted.
///
/// On macOS, strips the quarantine xattr before spawning so unsigned dev
/// binaries are not silently blocked by Gatekeeper.
pub fn start_syncthing_daemon(
    args: &SyncthingStartArgs<'_>,
) -> Result<std::process::Child, SyncthingError> {
    std::fs::create_dir_all(args.home_dir).map_err(|_| SyncthingError::Io)?;

    // Strip macOS quarantine bit — required for unsigned dev builds.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(args.binary_path)
            .output();
    }

    // Open stderr log file if requested, otherwise discard.
    let stderr_stdio: std::process::Stdio = args
        .stderr_log
        .and_then(|p| {
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(p)
                .ok()
        })
        .map(std::process::Stdio::from)
        .unwrap_or_else(std::process::Stdio::null);

    std::process::Command::new(args.binary_path)
        .args(["serve", "--home"])
        .arg(args.home_dir)
        .args(["--no-browser", "--no-restart"])
        .stdout(std::process::Stdio::null())
        .stderr(stderr_stdio)
        .spawn()
        .map_err(|_| SyncthingError::Io)
}

/// Result of a live Syncthing status probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncthingRunStatus {
    /// Syncthing binary was found (bundled or on PATH).
    pub binary_present: bool,
    /// Version string from `syncthing --version`, if the binary ran.
    pub binary_version: Option<String>,
    /// Whether the Syncthing daemon is reachable on its REST API port.
    pub is_running: bool,
    /// The port Syncthing listens on (default 8384).
    pub api_port: u16,
    /// URL of the Syncthing web UI.
    pub web_ui_url: String,
    /// Human-readable guidance based on detected state.
    pub setup_guidance: String,
}

/// Probe whether the Syncthing binary is present and whether the daemon is running.
///
/// Running detection uses a TCP connect to 127.0.0.1:8384 with a short timeout —
/// no Syncthing API key or REST call is needed.
pub fn probe_syncthing_status(binary_path: Option<&std::path::Path>) -> SyncthingRunStatus {
    let api_port: u16 = 8384;

    // Step 1: check binary
    let (binary_present, binary_version) = match binary_path {
        Some(p) if p.exists() => {
            let version = SyncthingRunner::new(p).probe_version().ok();
            (true, version)
        }
        _ => {
            // Try system PATH as fallback
            use std::process::Command;
            match Command::new("syncthing").arg("--version").output() {
                Ok(out) => {
                    let line = String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    (true, if line.is_empty() { None } else { Some(line) })
                }
                Err(_) => (false, None),
            }
        }
    };

    // Step 2: TCP connect probe — succeeds only if Syncthing daemon is listening
    let is_running = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], api_port)),
        std::time::Duration::from_millis(600),
    )
    .is_ok();

    let setup_guidance = if !binary_present {
        "Syncthing is not installed. Download from https://syncthing.net or install via your \
         package manager (brew install syncthing on macOS)."
            .to_string()
    } else if !is_running {
        "Syncthing is installed but not running. Start it from your applications folder \
         or run `syncthing` in a terminal. On macOS you can also enable it as a launch agent."
            .to_string()
    } else {
        format!(
            "Syncthing is running. Open http://127.0.0.1:{api_port} in your browser to \
             find your device ID under Actions → Show ID."
        )
    };

    SyncthingRunStatus {
        binary_present,
        binary_version,
        is_running,
        api_port,
        web_ui_url: format!("http://127.0.0.1:{api_port}"),
        setup_guidance,
    }
}

pub struct SyncthingRunner {
    pub binary_path: PathBuf,
}

impl SyncthingRunner {
    pub fn new(binary_path: impl Into<PathBuf>) -> Self {
        Self {
            binary_path: binary_path.into(),
        }
    }

    /// Run `syncthing --version` to verify the binary exists and is runnable.
    pub fn probe_version(&self) -> Result<String, SyncthingError> {
        let output = Command::new(&self.binary_path)
            .arg("--version")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    SyncthingError::BinaryNotFound
                } else {
                    SyncthingError::VersionFailed(e.to_string())
                }
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let first_line = stdout.lines().next().unwrap_or("").trim().to_string();
        if first_line.is_empty() {
            Err(SyncthingError::VersionFailed(
                "no output from --version".to_string(),
            ))
        } else {
            Ok(first_line)
        }
    }

    /// Prepare a `TransportFolderDef` for the encrypted repository path.
    ///
    /// Delegates to the binary-free `prepare_transport_folder_def` function.
    /// Use this method when a `SyncthingRunner` context is available (e.g.,
    /// after probing the binary). For config-only preparation without a
    /// binary dependency, call `prepare_transport_folder_def` directly.
    pub fn prepare_transport_folder(
        &self,
        folder_id: &str,
        repo_path: &Path,
        source_folders: &[&Path],
    ) -> Result<TransportFolderDef, SyncthingError> {
        prepare_transport_folder_def(folder_id, repo_path, source_folders)
    }
}

/// Validate that `transport_path` does not overlap with any source folder.
///
/// This must always be called before configuring any Syncthing folder.
/// Fail closed: any overlap returns an error.
pub fn validate_transport_path(
    transport_path: &Path,
    source_folders: &[&Path],
) -> Result<(), SyncthingError> {
    for &src in source_folders {
        if transport_path == src
            || transport_path.starts_with(src)
            || src.starts_with(transport_path)
        {
            return Err(SyncthingError::TransportFolderOverlapsSource);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(p: &str) -> PathBuf {
        PathBuf::from(p)
    }

    // ── Source / transport overlap checks ─────────────────────────────────────

    #[test]
    fn transport_cannot_equal_source_folder() {
        let src_path = src("/home/user/documents");
        let result = validate_transport_path(&src_path, &[&src_path]);
        assert!(matches!(
            result,
            Err(SyncthingError::TransportFolderOverlapsSource)
        ));
    }

    #[test]
    fn transport_cannot_be_inside_source_folder() {
        let source = src("/home/user/documents");
        let transport = src("/home/user/documents/repo");
        let result = validate_transport_path(&transport, &[&source]);
        assert!(matches!(
            result,
            Err(SyncthingError::TransportFolderOverlapsSource)
        ));
    }

    #[test]
    fn source_folder_cannot_be_inside_transport_folder() {
        let source = src("/home/user/documents/subdir");
        let transport = src("/home/user/documents");
        let result = validate_transport_path(&transport, &[&source]);
        assert!(matches!(
            result,
            Err(SyncthingError::TransportFolderOverlapsSource)
        ));
    }

    #[test]
    fn transport_allowed_when_no_overlap() {
        let source = src("/home/user/documents");
        let transport = src("/home/user/.nasbb-repo");
        assert!(validate_transport_path(&transport, &[&source]).is_ok());
    }

    #[test]
    fn transport_allowed_when_no_source_folders() {
        let transport = src("/mnt/peer-storage");
        assert!(validate_transport_path(&transport, &[]).is_ok());
    }

    #[test]
    fn transport_allowed_for_unrelated_path() {
        let source = src("/home/user/documents");
        let transport = src("/mnt/nasbb-repo");
        assert!(validate_transport_path(&transport, &[&source]).is_ok());
    }

    #[test]
    fn transport_folder_def_config_snippet_redacts_path() {
        let def = TransportFolderDef {
            folder_id: "nasbb-test".to_string(),
            folder_label: "NAS Backup Buddy Repository".to_string(),
            folder_path_display: "[REDACTED]".to_string(),
            folder_path_internal: PathBuf::from("/home/user/.nasbb-repo"),
            folder_type: "sendreceive".to_string(),
            is_safety_validated: true,
        };
        let snippet = def.to_config_snippet();
        assert!(!snippet.contains("/home/user/.nasbb-repo"));
        assert!(snippet.contains("[REDACTED"));
    }

    #[test]
    fn transport_folder_def_serialization_omits_internal_path() {
        let def = TransportFolderDef {
            folder_id: "nasbb-test".to_string(),
            folder_label: "test".to_string(),
            folder_path_display: "[REDACTED]".to_string(),
            folder_path_internal: PathBuf::from("/home/user/.nasbb-repo"),
            folder_type: "sendreceive".to_string(),
            is_safety_validated: true,
        };
        let json = serde_json::to_string(&def).unwrap();
        assert!(!json.contains("/home/user/.nasbb-repo"));
    }

    // ── prepare_transport_folder_def free function ────────────────────────────

    #[test]
    fn free_fn_does_not_require_binary() {
        // prepare_transport_folder_def must work with no SyncthingRunner/binary.
        let repo = src("/home/user/.nasbb-repo");
        let source = src("/home/user/documents");
        let result = prepare_transport_folder_def("nasbb-test", &repo, &[&source]);
        assert!(result.is_ok());
        let def = result.unwrap();
        assert!(def.is_safety_validated);
        assert_eq!(def.folder_path_display, "[REDACTED]");
    }

    #[test]
    fn free_fn_rejects_source_overlap() {
        let source = src("/home/user/documents");
        let result = prepare_transport_folder_def("id", &source, &[&source]);
        assert!(matches!(
            result,
            Err(SyncthingError::TransportFolderOverlapsSource)
        ));
    }

    #[test]
    fn free_fn_rejects_empty_path() {
        let empty = PathBuf::from("");
        let result = prepare_transport_folder_def("id", &empty, &[]);
        assert!(matches!(result, Err(SyncthingError::EmptyTransportPath)));
    }

    #[test]
    fn runner_prepare_delegates_to_free_fn() {
        // SyncthingRunner::prepare_transport_folder must produce the same
        // result as the free function — it is only a thin delegation wrapper.
        let repo = src("/home/user/.nasbb-repo");
        let source = src("/home/user/documents");
        let runner = SyncthingRunner::new("/usr/bin/syncthing");
        let via_runner = runner.prepare_transport_folder("id", &repo, &[&source]);
        let via_free = prepare_transport_folder_def("id", &repo, &[&source]);
        assert!(via_runner.is_ok());
        assert!(via_free.is_ok());
        assert_eq!(via_runner.unwrap().folder_id, via_free.unwrap().folder_id);
    }
}
