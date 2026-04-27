//! Command planning for Kopia and Syncthing operations.
//!
//! These helpers build structured command plans but do NOT execute them.
//! Execution happens only when the user explicitly opts into a live run.
//!
//! Secret values (passwords, API keys) must never appear in command args or
//! in the display_command string. Use environment-variable strategy and mark
//! sensitive vars with `sensitive: true` so callers know not to log them.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

// ── Environment variable model ────────────────────────────────────────────────

/// An environment variable for a command plan.
/// Sensitive variables keep `value = None` to prevent accidental logging.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub name: String,
    /// Absent for sensitive variables to prevent accidental serialization.
    pub value: Option<String>,
    pub sensitive: bool,
}

impl EnvVar {
    pub fn plain(name: &str, value: &str) -> Self {
        Self {
            name: name.to_string(),
            value: Some(value.to_string()),
            sensitive: false,
        }
    }

    /// Create a sensitive env var. Value is never stored in this struct.
    pub fn sensitive(name: &str) -> Self {
        Self {
            name: name.to_string(),
            value: None,
            sensitive: true,
        }
    }
}

// ── Command plan ─────────────────────────────────────────────────────────────

/// A planned subprocess invocation. Never contains raw secret values in fields.
///
/// `args` may contain path values for internal use. `display_command` redacts
/// all sensitive args and paths for safe log/UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandPlan {
    pub executable: String,
    pub args: Vec<String>,
    pub env_vars: Vec<EnvVar>,
    /// Human-readable version with secrets replaced by [REDACTED].
    /// Safe to display in the UI or write to redacted logs.
    pub display_command: String,
}

// ── Kopia command planner ─────────────────────────────────────────────────────

pub struct KopiaPlanner {
    pub executable: String,
}

impl KopiaPlanner {
    pub fn new(executable: impl Into<String>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    /// Plan: detect the installed Kopia version.
    pub fn detect_version(&self) -> CommandPlan {
        let args = vec!["--version".to_string()];
        let display = format!("{} --version", self.executable);
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![],
            display_command: display,
        }
    }

    /// Plan: create a new encrypted Kopia repository at `repo_path`.
    /// Password must be set via KOPIA_PASSWORD env var — never passed as a CLI arg.
    pub fn create_repository(&self, repo_path: &str) -> CommandPlan {
        let args = vec![
            "repository".to_string(),
            "create".to_string(),
            "filesystem".to_string(),
            "--path".to_string(),
            repo_path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!(
                "{} repository create filesystem --path [REDACTED]",
                self.executable
            ),
        }
    }

    /// Plan: connect to an existing Kopia repository at `repo_path`.
    pub fn connect_repository(&self, repo_path: &str) -> CommandPlan {
        let args = vec![
            "repository".to_string(),
            "connect".to_string(),
            "filesystem".to_string(),
            "--path".to_string(),
            repo_path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!(
                "{} repository connect filesystem --path [REDACTED]",
                self.executable
            ),
        }
    }

    /// Plan: create a snapshot of `source_path`.
    /// Source path is redacted in display_command to avoid logging user paths.
    pub fn create_snapshot(&self, source_path: &str) -> CommandPlan {
        let args = vec![
            "snapshot".to_string(),
            "create".to_string(),
            source_path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!("{} snapshot create [REDACTED]", self.executable),
        }
    }

    /// Plan: run `kopia snapshot verify`.
    pub fn check_repository(&self) -> CommandPlan {
        CommandPlan {
            executable: self.executable.clone(),
            args: vec!["snapshot".to_string(), "verify".to_string()],
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!("{} snapshot verify", self.executable),
        }
    }

    /// Plan: list snapshots.
    pub fn list_snapshots(&self) -> CommandPlan {
        CommandPlan {
            executable: self.executable.clone(),
            args: vec!["snapshot".to_string(), "list".to_string()],
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!("{} snapshot list", self.executable),
        }
    }

    /// Plan: create a new encrypted SFTP repository on the peer storage host.
    ///
    /// All SFTP connection details (host, username, path) are redacted in display_command
    /// to prevent them from appearing in UI or logs. The SSH key path is also redacted.
    /// Repository encryption password is set via KOPIA_PASSWORD env var only.
    pub fn create_sftp_repository(&self, host: &str, user: &str, path: &str, port: u16) -> CommandPlan {
        let args = vec![
            "repository".to_string(),
            "create".to_string(),
            "sftp".to_string(),
            "--host".to_string(),
            host.to_string(),
            "--port".to_string(),
            port.to_string(),
            "--username".to_string(),
            user.to_string(),
            "--path".to_string(),
            path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!(
                "{} repository create sftp --host [REDACTED] --port {} --username [REDACTED] --path [REDACTED]",
                self.executable, port
            ),
        }
    }

    /// Plan: connect to an existing encrypted SFTP repository on peer storage.
    ///
    /// Same redaction rules as `create_sftp_repository`.
    pub fn connect_sftp_repository(&self, host: &str, user: &str, path: &str, port: u16) -> CommandPlan {
        let args = vec![
            "repository".to_string(),
            "connect".to_string(),
            "sftp".to_string(),
            "--host".to_string(),
            host.to_string(),
            "--port".to_string(),
            port.to_string(),
            "--username".to_string(),
            user.to_string(),
            "--path".to_string(),
            path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!(
                "{} repository connect sftp --host [REDACTED] --port {} --username [REDACTED] --path [REDACTED]",
                self.executable, port
            ),
        }
    }

    /// Plan: restore a snapshot to a clean destination.
    /// `snapshot_id` is not a secret. `dest_path` is redacted to avoid logging user paths.
    pub fn restore_snapshot(&self, snapshot_id: &str, dest_path: &str) -> CommandPlan {
        let args = vec![
            "restore".to_string(),
            snapshot_id.to_string(),
            dest_path.to_string(),
        ];
        CommandPlan {
            executable: self.executable.clone(),
            args,
            env_vars: vec![EnvVar::sensitive("KOPIA_PASSWORD")],
            display_command: format!("{} restore {} [REDACTED]", self.executable, snapshot_id),
        }
    }
}

// ── Syncthing planner ─────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum SyncthingPlanError {
    #[error(
        "source folder path must not be used as a Syncthing folder: {0} — \
         only the encrypted repository path is allowed as the shared folder"
    )]
    SourceFolderRejected(String),
}

/// Validate that a proposed Syncthing folder path does not overlap with any source folder.
///
/// The Syncthing shared folder for a data-owner must always be the encrypted
/// repository path — never a source folder or any ancestor/descendant of a source folder.
pub fn validate_syncthing_folder_path(
    proposed: &str,
    source_folders: &[&str],
) -> Result<(), SyncthingPlanError> {
    let proposed_path = Path::new(proposed);
    for &src in source_folders {
        let src_path = Path::new(src);
        // Reject: exact match, proposed inside source, or source inside proposed
        if proposed_path == src_path
            || proposed_path.starts_with(src_path)
            || src_path.starts_with(proposed_path)
        {
            return Err(SyncthingPlanError::SourceFolderRejected(
                proposed.to_string(),
            ));
        }
    }
    Ok(())
}

/// A planned Syncthing REST API call.
/// API key is never stored here — it must come from the OS keychain at call time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncthingApiPlan {
    pub method: String,
    pub endpoint: String,
    /// Request body summary (no secrets, paths replaced with [REDACTED]).
    pub body_summary: String,
    /// Always true for Syncthing REST calls — reminds callers to inject API key.
    pub requires_api_key: bool,
    /// Safe to display in the UI or redacted logs.
    pub display_command: String,
}

pub struct SyncthingPlanner {
    pub api_url: String,
}

impl SyncthingPlanner {
    pub fn new(api_url: impl Into<String>) -> Self {
        Self {
            api_url: api_url.into(),
        }
    }

    /// Plan: get Syncthing version.
    pub fn detect_version(&self) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "GET".to_string(),
            endpoint: format!("{}/rest/system/version", self.api_url),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: "GET /rest/system/version  [X-API-Key: REDACTED]".to_string(),
        }
    }

    /// Plan: read the local device ID from Syncthing status.
    pub fn get_local_device_id(&self) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "GET".to_string(),
            endpoint: format!("{}/rest/system/status", self.api_url),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: "GET /rest/system/status  [X-API-Key: REDACTED]".to_string(),
        }
    }

    /// Plan: add a peer device to Syncthing. Device ID is public, not a secret.
    pub fn add_peer_device(&self, peer_device_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "POST".to_string(),
            endpoint: format!("{}/rest/config/devices", self.api_url),
            body_summary: format!(r#"{{"deviceID":"{}","name":"nasbb-peer"}}"#, peer_device_id),
            requires_api_key: true,
            display_command: format!(
                "POST /rest/config/devices  deviceID={peer_device_id}  [X-API-Key: REDACTED]"
            ),
        }
    }

    /// Plan: create a Syncthing folder share for the encrypted repository.
    ///
    /// `folder_path` MUST be the encrypted repository path — this function
    /// rejects any path that overlaps with a source folder.
    pub fn create_repository_folder(
        &self,
        folder_id: &str,
        folder_path: &str,
        source_folders: &[&str],
    ) -> Result<SyncthingApiPlan, SyncthingPlanError> {
        validate_syncthing_folder_path(folder_path, source_folders)?;
        Ok(SyncthingApiPlan {
            method: "POST".to_string(),
            endpoint: format!("{}/rest/config/folders", self.api_url),
            body_summary: format!(
                r#"{{"id":"{}","path":"[REDACTED]","type":"sendreceive"}}"#,
                folder_id
            ),
            requires_api_key: true,
            display_command: format!(
                "POST /rest/config/folders  id={folder_id}  path=[REDACTED]  type=sendreceive  [X-API-Key: REDACTED]"
            ),
        })
    }

    /// Plan: check the sync status of a folder.
    pub fn check_folder_status(&self, folder_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "GET".to_string(),
            endpoint: format!("{}/rest/db/status?folder={}", self.api_url, folder_id),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: format!(
                "GET /rest/db/status?folder={folder_id}  [X-API-Key: REDACTED]"
            ),
        }
    }

    /// Plan: check peer connection state.
    pub fn check_peer_connection(&self, peer_device_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "GET".to_string(),
            endpoint: format!("{}/rest/system/connections", self.api_url),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: format!(
                "GET /rest/system/connections  (checking {peer_device_id})  [X-API-Key: REDACTED]"
            ),
        }
    }

    /// Plan: pause a Syncthing folder.
    pub fn pause_folder(&self, folder_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "POST".to_string(),
            endpoint: format!("{}/rest/db/pause?folder={}", self.api_url, folder_id),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: format!(
                "POST /rest/db/pause?folder={folder_id}  [X-API-Key: REDACTED]"
            ),
        }
    }

    /// Plan: resume a paused Syncthing folder.
    pub fn resume_folder(&self, folder_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "POST".to_string(),
            endpoint: format!("{}/rest/db/resume?folder={}", self.api_url, folder_id),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: format!(
                "POST /rest/db/resume?folder={folder_id}  [X-API-Key: REDACTED]"
            ),
        }
    }

    /// Plan: remove a folder from Syncthing configuration.
    pub fn remove_folder(&self, folder_id: &str) -> SyncthingApiPlan {
        SyncthingApiPlan {
            method: "DELETE".to_string(),
            endpoint: format!("{}/rest/config/folders/{}", self.api_url, folder_id),
            body_summary: String::new(),
            requires_api_key: true,
            display_command: format!(
                "DELETE /rest/config/folders/{folder_id}  [X-API-Key: REDACTED]"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kopia() -> KopiaPlanner {
        KopiaPlanner::new("/usr/local/bin/kopia")
    }

    fn syncthing() -> SyncthingPlanner {
        SyncthingPlanner::new("http://127.0.0.1:8384")
    }

    // ── Kopia: secrets must not appear in plans ──────────────────────────────

    #[test]
    fn kopia_version_plan_has_no_secret_env_vars() {
        let plan = kopia().detect_version();
        assert!(plan.env_vars.iter().all(|e| !e.sensitive));
    }

    #[test]
    fn kopia_create_repo_password_not_in_args() {
        let plan = kopia().create_repository("/home/user/.nasbb-repo");
        assert!(plan
            .args
            .iter()
            .all(|a| !a.to_lowercase().contains("password")));
        assert!(plan
            .env_vars
            .iter()
            .any(|e| e.name == "KOPIA_PASSWORD" && e.sensitive && e.value.is_none()));
    }

    #[test]
    fn kopia_create_repo_display_redacts_path() {
        let plan = kopia().create_repository("/home/user/.nasbb-repo");
        assert!(!plan.display_command.contains("/home/user/.nasbb-repo"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn kopia_connect_repo_display_redacts_path() {
        let plan = kopia().connect_repository("/mnt/encrypted-repo");
        assert!(!plan.display_command.contains("/mnt/encrypted-repo"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn kopia_snapshot_display_redacts_source_path() {
        let plan = kopia().create_snapshot("/home/user/documents");
        assert!(!plan.display_command.contains("/home/user/documents"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn kopia_restore_display_redacts_dest_but_keeps_snapshot_id() {
        let plan = kopia().restore_snapshot("snap-abc123", "/tmp/restore-test");
        // Snapshot ID is not secret — it can appear in display
        assert!(plan.display_command.contains("snap-abc123"));
        // Destination path must be redacted
        assert!(!plan.display_command.contains("/tmp/restore-test"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn all_kopia_secret_env_vars_have_no_value() {
        let plans = vec![
            kopia().create_repository("/repo"),
            kopia().connect_repository("/repo"),
            kopia().create_snapshot("/src"),
            kopia().check_repository(),
            kopia().list_snapshots(),
            kopia().restore_snapshot("snap1", "/dest"),
        ];
        for plan in plans {
            for env_var in &plan.env_vars {
                if env_var.sensitive {
                    assert!(
                        env_var.value.is_none(),
                        "Sensitive env var {} must not store a value",
                        env_var.name
                    );
                }
            }
        }
    }

    // ── Syncthing: API key always redacted, source folders rejected ──────────

    #[test]
    fn syncthing_all_plans_redact_api_key_in_display() {
        let folder_plan = syncthing()
            .create_repository_folder("nasbb-repo", "/home/user/.nasbb-repo", &[])
            .unwrap();
        let plans: Vec<String> = vec![
            syncthing().detect_version().display_command,
            syncthing().get_local_device_id().display_command,
            syncthing().add_peer_device("PEER-ID-1").display_command,
            folder_plan.display_command,
            syncthing()
                .check_folder_status("nasbb-repo")
                .display_command,
            syncthing()
                .check_peer_connection("PEER-ID-1")
                .display_command,
            syncthing().pause_folder("nasbb-repo").display_command,
            syncthing().resume_folder("nasbb-repo").display_command,
            syncthing().remove_folder("nasbb-repo").display_command,
        ];
        for display in plans {
            assert!(
                display.contains("[REDACTED]") || display.to_uppercase().contains("REDACTED"),
                "Syncthing display_command must mention REDACTED: {display}"
            );
        }
    }

    #[test]
    fn syncthing_rejects_exact_source_folder_as_shared_folder() {
        let sources = ["/home/user/documents"];
        let result =
            syncthing().create_repository_folder("nasbb-repo", "/home/user/documents", &sources);
        assert!(matches!(
            result,
            Err(SyncthingPlanError::SourceFolderRejected(_))
        ));
    }

    #[test]
    fn syncthing_rejects_subfolder_of_source() {
        let sources = ["/home/user/documents"];
        let result = syncthing().create_repository_folder(
            "nasbb-repo",
            "/home/user/documents/subdir",
            &sources,
        );
        assert!(matches!(
            result,
            Err(SyncthingPlanError::SourceFolderRejected(_))
        ));
    }

    #[test]
    fn syncthing_rejects_parent_of_source() {
        // A parent of a source folder would expose the source listing
        let result = validate_syncthing_folder_path("/home/user", &["/home/user/documents"]);
        assert!(matches!(
            result,
            Err(SyncthingPlanError::SourceFolderRejected(_))
        ));
    }

    #[test]
    fn syncthing_kopia_repo_path_is_the_allowed_data_owner_folder() {
        // This is the key safety constraint: the repository path (not a source folder) is allowed
        let sources = ["/home/user/documents", "/home/user/photos"];
        let result =
            syncthing().create_repository_folder("nasbb-repo", "/home/user/.nasbb-repo", &sources);
        assert!(
            result.is_ok(),
            "Repository path must be allowed as Syncthing folder"
        );
    }

    #[test]
    fn syncthing_folder_plan_body_redacts_path() {
        let sources: [&str; 0] = [];
        let plan = syncthing()
            .create_repository_folder("nasbb-repo", "/home/user/.nasbb-repo", &sources)
            .unwrap();
        assert!(!plan.body_summary.contains("/home/user/.nasbb-repo"));
        assert!(plan.body_summary.contains("[REDACTED]"));
    }

    #[test]
    fn syncthing_folder_plan_display_redacts_path() {
        let sources: [&str; 0] = [];
        let plan = syncthing()
            .create_repository_folder("nasbb-repo", "/home/user/.nasbb-repo", &sources)
            .unwrap();
        assert!(!plan.display_command.contains("/home/user/.nasbb-repo"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn syncthing_hosted_peer_path_is_allowed() {
        // Storage host's peer-storage path is not a source folder — must be allowed
        let sources: [&str; 0] = [];
        let result =
            syncthing().create_repository_folder("peer-folder", "/mnt/peer-storage", &sources);
        assert!(result.is_ok());
    }

    // ── Kopia SFTP planner ────────────────────────────────────────────────────

    #[test]
    fn sftp_create_display_redacts_host_user_path() {
        let plan = kopia().create_sftp_repository("secret-peer.tailnet", "nasbb-user", "/srv/repo", 22);
        assert!(!plan.display_command.contains("secret-peer.tailnet"));
        assert!(!plan.display_command.contains("nasbb-user"));
        assert!(!plan.display_command.contains("/srv/repo"));
        assert!(plan.display_command.contains("[REDACTED]"));
    }

    #[test]
    fn sftp_connect_display_redacts_host_user_path() {
        let plan = kopia().connect_sftp_repository("peer.example", "alice", "/data/repo", 2222);
        assert!(!plan.display_command.contains("peer.example"));
        assert!(!plan.display_command.contains("alice"));
        assert!(!plan.display_command.contains("/data/repo"));
        assert!(plan.display_command.contains("[REDACTED]"));
        // Port is not secret — it can appear in display
        assert!(plan.display_command.contains("2222"));
    }

    #[test]
    fn sftp_create_uses_kopia_password_env_not_arg() {
        let plan = kopia().create_sftp_repository("host", "user", "/path", 22);
        // Password must not appear in args
        assert!(plan.args.iter().all(|a| !a.to_lowercase().contains("password")));
        // KOPIA_PASSWORD must be listed as a sensitive env var
        assert!(plan
            .env_vars
            .iter()
            .any(|e| e.name == "KOPIA_PASSWORD" && e.sensitive && e.value.is_none()));
    }

    #[test]
    fn sftp_connect_uses_kopia_password_env_not_arg() {
        let plan = kopia().connect_sftp_repository("host", "user", "/path", 22);
        assert!(plan.args.iter().all(|a| !a.to_lowercase().contains("password")));
        assert!(plan
            .env_vars
            .iter()
            .any(|e| e.name == "KOPIA_PASSWORD" && e.sensitive && e.value.is_none()));
    }

    #[test]
    fn sftp_create_args_include_sftp_subcommand() {
        let plan = kopia().create_sftp_repository("h", "u", "/p", 22);
        assert!(plan.args.contains(&"repository".to_string()));
        assert!(plan.args.contains(&"create".to_string()));
        assert!(plan.args.contains(&"sftp".to_string()));
    }

    #[test]
    fn sftp_connect_args_include_sftp_subcommand() {
        let plan = kopia().connect_sftp_repository("h", "u", "/p", 22);
        assert!(plan.args.contains(&"repository".to_string()));
        assert!(plan.args.contains(&"connect".to_string()));
        assert!(plan.args.contains(&"sftp".to_string()));
    }

    #[test]
    fn all_sftp_secret_env_vars_have_no_value() {
        let sftp_plans = vec![
            kopia().create_sftp_repository("h", "u", "/p", 22),
            kopia().connect_sftp_repository("h", "u", "/p", 22),
        ];
        for plan in sftp_plans {
            for env_var in &plan.env_vars {
                if env_var.sensitive {
                    assert!(
                        env_var.value.is_none(),
                        "Sensitive env var {} must not store a value",
                        env_var.name
                    );
                }
            }
        }
    }
}
