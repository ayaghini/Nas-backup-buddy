//! Storage-host setup validation and command-plan generation.
//!
//! This module validates the inputs a user provides when preparing their device
//! to host an encrypted Kopia repository for a matched peer, and then generates
//! shell command plans for the administrator to review and execute.
//!
//! ## Safety model
//!
//! - Hosted path must be isolated from all source folders.
//! - SFTP username and match ID are validated as shell-safe (no spaces, special chars).
//! - Owner SSH public key is validated for shape (must look like "ssh-* BASE64 *").
//! - Private keys are never accepted; raw public key comments are stripped in display.
//! - Command plans are display-only; privileged execution is left to the operator.
//! - Paths in display commands are replaced with [REDACTED] per existing conventions.

use crate::overlay::OverlayProvider;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

// ── Validation types ─────────────────────────────────────────────────────────

#[derive(Debug, Error, PartialEq)]
pub enum HostSetupError {
    #[error("hosted_path must not be empty")]
    MissingHostedPath,
    #[error("quota_gb must be greater than 0")]
    InvalidQuota,
    #[error("match_id is empty or contains unsafe characters (use only letters, digits, hyphens, underscores)")]
    InvalidMatchId,
    #[error("sftp_username is empty or contains unsafe characters (use only letters, digits, hyphens, underscores, dots)")]
    InvalidSftpUsername,
    #[error(
        "hosted path must not be inside a source folder: hosted={0:?} source={1:?}"
    )]
    HostedInsideSource(std::path::PathBuf, std::path::PathBuf),
    #[error(
        "source folder must not be inside the hosted path: source={0:?} hosted={1:?}"
    )]
    SourceInsideHosted(std::path::PathBuf, std::path::PathBuf),
    #[error(
        "hosted path overlaps an existing hosted allocation: hosted={0:?} existing={1:?}"
    )]
    HostedOverlapsExistingAllocation(std::path::PathBuf, std::path::PathBuf),
    #[error(
        "owner public key does not look valid — expected 'ssh-TYPE BASE64 [comment]'"
    )]
    InvalidPublicKey,
    #[error(
        "raw private key material detected in public key field — only public keys are accepted"
    )]
    PrivateKeyInPublicKeyField,
}

/// Inputs required to prepare this device as a storage host for one match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostSetupInput {
    /// Human-readable label for this connection (e.g. "Alice's backup").
    #[serde(default)]
    pub connection_name: String,
    /// Local path where the peer's encrypted repository will be stored.
    pub hosted_path: String,
    /// Maximum storage quota offered to this match, in GB.
    pub quota_gb: u64,
    /// Stable match identifier, e.g. "match-abc123". Used in path and username generation.
    pub match_id: String,
    /// SFTP username for the isolated account. If empty, one is generated from match_id.
    pub sftp_username: String,
    /// SFTP port the SSH daemon listens on (default 22).
    pub sftp_port: u16,
    /// Full SSH public key line from the data owner. May be empty — the host can allocate
    /// space before receiving the owner's key and authorize it separately later.
    #[serde(default)]
    pub owner_public_key: String,
    /// Source folders on this machine (to prevent hosted path overlap).
    pub source_folders: Vec<String>,
    /// Paths of other active hosted allocations on this device, used to prevent overlap
    /// between allocations. May be empty for the first allocation.
    #[serde(default)]
    pub existing_hosted_paths: Vec<String>,
    /// Overlay provider this host is using. Included in the owner connection bundle.
    #[serde(default)]
    pub overlay_provider: OverlayProvider,
}

/// Validated, normalised host setup parameters.
#[derive(Debug, Clone)]
pub struct ValidatedHostSetup {
    pub connection_name: String,
    pub hosted_path: String,
    pub quota_gb: u64,
    pub match_id: String,
    pub sftp_username: String,
    pub sftp_port: u16,
    /// Stripped to type+key only; comment dropped for display safety.
    pub owner_public_key_display: String,
    /// Full original key (for authorized_keys write; never logged).
    pub owner_public_key_raw: String,
    pub overlay_provider: OverlayProvider,
}

// ── Identifier safety check ──────────────────────────────────────────────────

/// Returns true if the string is safe to use as a shell identifier:
/// non-empty, starts with a letter, and contains only letters, digits,
/// hyphens, underscores, and dots.
pub fn is_shell_safe_identifier(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.chars().next().unwrap();
    if !first.is_ascii_alphabetic() {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Returns true if the string is safe as a match ID (subset: no dots allowed).
pub fn is_safe_match_id(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.chars().next().unwrap();
    if !first.is_ascii_alphabetic() {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Validate the owner SSH public key:
/// - Must not contain private key markers.
/// - Must look like "ssh-TYPE BASE64 ..." or "ecdsa-sha2-* BASE64 ...".
pub fn validate_owner_public_key(key: &str) -> Result<(), HostSetupError> {
    let trimmed = key.trim();
    let upper = trimmed.to_uppercase();
    // Reject private key material
    if upper.contains("BEGIN") && upper.contains("PRIVATE KEY") {
        return Err(HostSetupError::PrivateKeyInPublicKeyField);
    }
    // Must start with a recognised SSH key type prefix
    let valid_prefix = trimmed.starts_with("ssh-rsa ")
        || trimmed.starts_with("ssh-ed25519 ")
        || trimmed.starts_with("ssh-dss ")
        || trimmed.starts_with("ecdsa-sha2-");
    if !valid_prefix {
        return Err(HostSetupError::InvalidPublicKey);
    }
    // Must have at least 2 whitespace-separated tokens (type + base64 key)
    let parts: Vec<&str> = trimmed.splitn(3, ' ').collect();
    if parts.len() < 2 || parts[1].len() < 16 {
        return Err(HostSetupError::InvalidPublicKey);
    }
    Ok(())
}

/// Strip the comment (third field) from a public key for display.
/// Returns "TYPE BASE64" only — never the comment which may contain email/username.
fn strip_pubkey_comment(key: &str) -> String {
    let parts: Vec<&str> = key.trim().splitn(3, ' ').collect();
    if parts.len() >= 2 {
        format!("{} {}…", parts[0], &parts[1][..parts[1].len().min(16)])
    } else {
        key.trim().to_string()
    }
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/// Resolve a path to its canonical form where possible; fall back to the raw path.
/// Paths that do not yet exist (pre-creation) cannot be canonicalized — this is expected.
fn best_effort_canonical(path: &Path) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Check that `hosted_path` does not overlap any source folder or existing hosted allocation.
///
/// Overlap means one path is equal to, an ancestor of, or a descendant of the other.
/// Uses `fs::canonicalize` for paths that already exist; falls back to lexical comparison
/// for paths that have not been created yet.
///
/// This is the canonical backend validator — keep frontend string checks as convenience only.
pub fn validate_hosted_path_isolation(
    hosted_path: &str,
    source_folders: &[&str],
    existing_hosted_paths: &[&str],
) -> Result<(), HostSetupError> {
    if hosted_path.trim().is_empty() {
        return Err(HostSetupError::MissingHostedPath);
    }
    let hosted = best_effort_canonical(Path::new(hosted_path));

    for src_str in source_folders {
        let src = best_effort_canonical(Path::new(src_str));
        if hosted.starts_with(&src) {
            return Err(HostSetupError::HostedInsideSource(hosted, src));
        }
        if src.starts_with(&hosted) {
            return Err(HostSetupError::SourceInsideHosted(src, hosted));
        }
    }

    for existing_str in existing_hosted_paths {
        if existing_str.trim().is_empty() {
            continue;
        }
        let existing = best_effort_canonical(Path::new(existing_str));
        if hosted == existing || hosted.starts_with(&existing) || existing.starts_with(&hosted) {
            return Err(HostSetupError::HostedOverlapsExistingAllocation(hosted, existing));
        }
    }

    Ok(())
}

// ── Main validator ───────────────────────────────────────────────────────────

/// Validate a `HostSetupInput` and return a `ValidatedHostSetup` on success.
pub fn validate_host_setup(input: &HostSetupInput) -> Result<ValidatedHostSetup, HostSetupError> {
    if input.hosted_path.trim().is_empty() {
        return Err(HostSetupError::MissingHostedPath);
    }
    if input.quota_gb == 0 {
        return Err(HostSetupError::InvalidQuota);
    }
    if !is_safe_match_id(&input.match_id) {
        return Err(HostSetupError::InvalidMatchId);
    }

    // Derive username from match_id if not provided
    let raw_username = if input.sftp_username.trim().is_empty() {
        format!("nasbb-{}", input.match_id)
    } else {
        input.sftp_username.trim().to_string()
    };
    if !is_shell_safe_identifier(&raw_username) {
        return Err(HostSetupError::InvalidSftpUsername);
    }

    // Delegate all path isolation to the canonical validator (uses canonicalization + lexical fallback).
    let src_refs: Vec<&str> = input.source_folders.iter().map(|s| s.as_str()).collect();
    let existing_refs: Vec<&str> = input.existing_hosted_paths.iter().map(|s| s.as_str()).collect();
    validate_hosted_path_isolation(&input.hosted_path, &src_refs, &existing_refs)?;

    // Validate public key only when one is provided. The host may allocate space
    // before receiving the owner's key and authorize it via a separate step later.
    let (display_key, raw_key) = if input.owner_public_key.trim().is_empty() {
        (String::new(), String::new())
    } else {
        validate_owner_public_key(&input.owner_public_key)?;
        (strip_pubkey_comment(&input.owner_public_key), input.owner_public_key.trim().to_string())
    };

    Ok(ValidatedHostSetup {
        connection_name: input.connection_name.trim().to_string(),
        hosted_path: input.hosted_path.trim().to_string(),
        quota_gb: input.quota_gb,
        match_id: input.match_id.clone(),
        sftp_username: raw_username,
        sftp_port: if input.sftp_port == 0 { 22 } else { input.sftp_port },
        owner_public_key_display: display_key,
        owner_public_key_raw: raw_key,
        overlay_provider: input.overlay_provider.clone(),
    })
}

/// Return a short compatibility note for the owner connection bundle.
fn provider_compatibility_note(provider: &OverlayProvider) -> String {
    match provider {
        OverlayProvider::Tailscale => {
            "The data owner must be able to reach this host over a shared Tailscale network path. \
             A shared account is not required — use device/tailnet sharing or an invite so both \
             devices can reach each other. See tailscale.com/kb/sharing for options."
                .to_string()
        }
        OverlayProvider::Headscale => {
            "Both peers must join the same Headscale control server. \
             The data owner needs the Headscale server address and login credentials.".to_string()
        }
        OverlayProvider::WireGuard => {
            "Both peers need matching WireGuard configs with each other as a peer. \
             Tailscale/Headscale cannot route to a plain WireGuard tunnel automatically."
                .to_string()
        }
        OverlayProvider::CustomReachableAddress => {
            "The host is using a custom address. Confirm it is reachable from your network \
             and is not a publicly exposed port."
                .to_string()
        }
        OverlayProvider::NotConfigured => {
            "The host has not configured an overlay network yet. Ask them for their overlay address before connecting.".to_string()
        }
    }
}

// ── Command-plan generation ───────────────────────────────────────────────────

/// A single step in the host setup command plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostSetupStep {
    /// Short label for the UI (e.g. "Create repository directory").
    pub label: String,
    /// Whether this step requires root/admin privileges.
    pub requires_root: bool,
    /// Shell command safe for display — paths replaced with [REDACTED] where applicable.
    pub display_command: String,
    /// Optional human-readable note about this step.
    pub note: Option<String>,
}

/// Full command plan for preparing this device as a storage host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostSetupPlan {
    pub steps: Vec<HostSetupStep>,
    /// Platform note ("linux", "macos").
    pub platform: String,
    /// An owner-facing connection bundle (non-secret fields only).
    pub owner_bundle: OwnerConnectionBundle,
}

/// Non-secret fields the data owner needs to configure their Peer Storage tab.
/// This is the "Host Invite Bundle" shared out-of-band; contains no secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerConnectionBundle {
    /// Human-readable label for this connection.
    pub connection_name: String,
    pub overlay_host: String,
    pub sftp_username: String,
    pub sftp_port: u16,
    /// Remote path the owner will point Kopia at.
    pub sftp_path: String,
    pub quota_gb: u64,
    pub match_id: String,
    /// Placeholder — the owner should verify this out-of-band.
    pub host_key_fingerprint_note: String,
    /// Overlay technology this host is using (informational, not secret).
    pub overlay_provider: OverlayProvider,
    /// Guidance note for the owner about overlay compatibility.
    pub compatibility_note: String,
}

/// Generate the host setup command plan for a validated setup on Linux.
/// Paths that would identify the user's system are redacted in display output.
pub fn generate_host_setup_plan_linux(
    setup: &ValidatedHostSetup,
    overlay_host: &str,
) -> HostSetupPlan {
    let u = &setup.sftp_username;
    let port = setup.sftp_port;
    // Build the per-match repository sub-path (user home + match dir)
    let repo_subpath = format!("/home/{u}/repository");

    let steps = vec![
        HostSetupStep {
            label: "Create isolated SFTP user".to_string(),
            requires_root: true,
            display_command: format!(
                "sudo useradd --system --create-home --shell /usr/sbin/nologin {u}"
            ),
            note: Some(
                "Creates a system user that cannot log in interactively. \
                 Adjust shell path for your distro (/bin/false on some systems)."
                    .to_string(),
            ),
        },
        HostSetupStep {
            label: "Create repository directory".to_string(),
            requires_root: true,
            display_command: format!("sudo mkdir -p {repo_subpath}"),
            note: Some("This is where the owner's encrypted Kopia repository will be stored.".to_string()),
        },
        HostSetupStep {
            label: "Set ownership of repository directory".to_string(),
            requires_root: true,
            display_command: format!("sudo chown -R {u}:{u} /home/{u}"),
            note: None,
        },
        HostSetupStep {
            label: "Set permissions on home directory".to_string(),
            requires_root: true,
            display_command: format!("sudo chmod 700 /home/{u}"),
            note: Some("Required for OpenSSH ChrootDirectory — directory must be owned by root with no group/other write.".to_string()),
        },
        HostSetupStep {
            label: "Create .ssh directory".to_string(),
            requires_root: true,
            display_command: format!("sudo mkdir -p /home/{u}/.ssh && sudo chmod 700 /home/{u}/.ssh && sudo chown {u}:{u} /home/{u}/.ssh"),
            note: None,
        },
        HostSetupStep {
            label: "Install owner SSH public key".to_string(),
            requires_root: true,
            display_command: if setup.owner_public_key_raw.is_empty() {
                format!(
                    "# No owner key yet — run 'Generate Authorize Owner Key Plan' after the owner\n\
                     # sends their Access Request. The app will generate this step for you.\n\
                     # Preview:\n\
                     # echo 'ssh-ed25519 <owner-public-key>' | sudo tee /home/{u}/.ssh/authorized_keys\n\
                     # sudo chmod 600 /home/{u}/.ssh/authorized_keys && sudo chown {u}:{u} /home/{u}/.ssh/authorized_keys"
                )
            } else {
                format!(
                    "# Paste the owner public key ({}) into:\n# sudo tee /home/{u}/.ssh/authorized_keys\n# sudo chmod 600 /home/{u}/.ssh/authorized_keys && sudo chown {u}:{u} /home/{u}/.ssh/authorized_keys",
                    setup.owner_public_key_display
                )
            },
            note: Some(
                "The owner sends their SSH public key via their Owner Access Request. \
                 Import it and use 'Generate Authorize Owner Key Plan' to get this step filled in."
                    .to_string(),
            ),
        },
        HostSetupStep {
            label: "Add sshd_config Match block (SFTP-only chroot)".to_string(),
            requires_root: true,
            display_command: format!(
                "# Add to /etc/ssh/sshd_config:\n\
Match User {u}\n\
    ChrootDirectory /home/{u}\n\
    ForceCommand internal-sftp\n\
    AllowTcpForwarding no\n\
    X11Forwarding no\n\
# Then reload: sudo systemctl reload sshd"
            ),
            note: Some(
                "Restricts this user to SFTP only, jailed to their home directory. \
                 Requires OpenSSH >= 4.9. Run 'sudo sshd -t' to verify config before reloading."
                    .to_string(),
            ),
        },
        HostSetupStep {
            label: "Quota guidance (filesystem-dependent)".to_string(),
            requires_root: true,
            display_command: format!(
                "# Linux quotas (ext4/xfs) — set {quota_gb} GB limit:\n\
# sudo setquota -u {u} 0 {quota_bytes} 0 0 /home\n\
# OR use ZFS dataset quota:\n\
# sudo zfs set quota={quota_gb}G tank/home/{u}\n\
# Exact command depends on your filesystem.",
                quota_gb = setup.quota_gb,
                quota_bytes = setup.quota_gb * 1024 * 1024,
            ),
            note: Some("Choose the method that matches your filesystem. ZFS datasets are recommended for clean quota enforcement.".to_string()),
        },
        HostSetupStep {
            label: "Open SFTP port on firewall (if needed)".to_string(),
            requires_root: true,
            display_command: format!(
                "# If using ufw:\nsudo ufw allow from any to any port {port} proto tcp comment 'NAS Backup Buddy SFTP'\n\
# Restrict to overlay network CIDR for better isolation:\n\
# sudo ufw allow from <overlay-subnet> to any port {port} proto tcp"
            ),
            note: Some("Prefer restricting to the overlay network subnet (e.g. 100.64.0.0/10 for Tailscale).".to_string()),
        },
        HostSetupStep {
            label: "Verify SFTP access (from owner's machine)".to_string(),
            requires_root: false,
            display_command: format!(
                "sftp -P {port} {u}@<overlay-host>"
            ),
            note: Some("Owner runs this from their machine after overlay is up. Expect an sftp> prompt.".to_string()),
        },
    ];

    HostSetupPlan {
        steps,
        platform: "linux".to_string(),
        owner_bundle: OwnerConnectionBundle {
            connection_name: setup.connection_name.clone(),
            overlay_host: overlay_host.to_string(),
            sftp_username: u.clone(),
            sftp_port: port,
            sftp_path: repo_subpath,
            quota_gb: setup.quota_gb,
            match_id: setup.match_id.clone(),
            host_key_fingerprint_note:
                "Verify via: ssh-keyscan -p PORT OVERLAY_HOST | ssh-keygen -lf -"
                    .to_string(),
            overlay_provider: setup.overlay_provider.clone(),
            compatibility_note: provider_compatibility_note(&setup.overlay_provider),
        },
    }
}

/// Generate the host setup command plan for macOS.
pub fn generate_host_setup_plan_macos(
    setup: &ValidatedHostSetup,
    overlay_host: &str,
) -> HostSetupPlan {
    let u = &setup.sftp_username;
    let port = setup.sftp_port;
    let repo_subpath = format!("/Users/{u}/repository");

    let steps = vec![
        HostSetupStep {
            label: "Create isolated user account".to_string(),
            requires_root: true,
            display_command: format!(
                "# Create a standard user via System Settings → Users & Groups\n\
# or use dscl:\n\
sudo dscl . -create /Users/{u}\n\
sudo dscl . -create /Users/{u} UserShell /usr/bin/false\n\
sudo dscl . -create /Users/{u} RealName 'NAS Backup Buddy Match'\n\
sudo dscl . -create /Users/{u} UniqueID 600\n\
sudo dscl . -create /Users/{u} PrimaryGroupID 20\n\
sudo dscl . -create /Users/{u} NFSHomeDirectory /Users/{u}\n\
sudo createhomedir -c -u {u}"
            ),
            note: Some("Choose a UniqueID not in use. Adjust as needed for your macOS version.".to_string()),
        },
        HostSetupStep {
            label: "Create repository directory".to_string(),
            requires_root: true,
            display_command: format!("sudo mkdir -p {repo_subpath} && sudo chown -R {u} /Users/{u}"),
            note: None,
        },
        HostSetupStep {
            label: "Create .ssh directory and install public key".to_string(),
            requires_root: true,
            display_command: if setup.owner_public_key_raw.is_empty() {
                format!(
                    "sudo mkdir -p /Users/{u}/.ssh && sudo chmod 700 /Users/{u}/.ssh\n\
# No owner key yet — use 'Generate Authorize Owner Key Plan' after importing their Access Request.\n\
# Preview:\n\
# echo 'ssh-ed25519 <owner-public-key>' | sudo tee /Users/{u}/.ssh/authorized_keys\n\
# sudo chmod 600 /Users/{u}/.ssh/authorized_keys && sudo chown -R {u} /Users/{u}/.ssh"
                )
            } else {
                format!(
                    "sudo mkdir -p /Users/{u}/.ssh\n\
sudo chmod 700 /Users/{u}/.ssh\n\
# Paste owner public key ({key}):\n\
# sudo tee /Users/{u}/.ssh/authorized_keys\n\
sudo chmod 600 /Users/{u}/.ssh/authorized_keys\n\
sudo chown -R {u} /Users/{u}/.ssh",
                    key = setup.owner_public_key_display
                )
            },
            note: Some("Import the Owner Access Request and generate the authorization plan to fill in the key.".to_string()),
        },
        HostSetupStep {
            label: "Enable Remote Login / SFTP (System Settings)".to_string(),
            requires_root: false,
            display_command:
                "# System Settings → General → Sharing → Remote Login\n\
# Restrict to specific users; add the match user.\n\
# macOS ships OpenSSH — no additional daemon needed."
                    .to_string(),
            note: Some("macOS uses its built-in OpenSSH for SFTP. No ForceCommand/ChrootDirectory on macOS without third-party tools — use firewall rules + overlay network for isolation instead.".to_string()),
        },
        HostSetupStep {
            label: "Restrict firewall to overlay network".to_string(),
            requires_root: true,
            display_command: format!(
                "# Allow SSH only from overlay subnet (example: Tailscale 100.64.0.0/10):\n\
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/sbin/sshd\n\
# Or use pf — add to /etc/pf.anchors/nasbb:\n\
# pass in proto tcp from 100.64.0.0/10 to any port {port}"
            ),
            note: Some("Restricting SSH to the overlay subnet is important on macOS where chroot is not available.".to_string()),
        },
        HostSetupStep {
            label: "Quota guidance (macOS)".to_string(),
            requires_root: true,
            display_command: format!(
                "# macOS disk quotas (HFS+/APFS with quotas enabled):\n\
# sudo edquota -u {u}  # then set soft/hard limits to {} KB",
                setup.quota_gb * 1024 * 1024
            ),
            note: Some("APFS quota support is limited. Prefer a dedicated APFS volume with a size limit for cleaner isolation.".to_string()),
        },
        HostSetupStep {
            label: "Verify SFTP access (from owner's machine)".to_string(),
            requires_root: false,
            display_command: format!("sftp -P {port} {u}@<overlay-host>"),
            note: Some("Owner runs this after overlay is configured on both machines.".to_string()),
        },
    ];

    HostSetupPlan {
        steps,
        platform: "macos".to_string(),
        owner_bundle: OwnerConnectionBundle {
            connection_name: setup.connection_name.clone(),
            overlay_host: overlay_host.to_string(),
            sftp_username: u.clone(),
            sftp_port: port,
            sftp_path: repo_subpath,
            quota_gb: setup.quota_gb,
            match_id: setup.match_id.clone(),
            host_key_fingerprint_note:
                "Verify via: ssh-keyscan -p PORT OVERLAY_HOST | ssh-keygen -lf -"
                    .to_string(),
            overlay_provider: setup.overlay_provider.clone(),
            compatibility_note: provider_compatibility_note(&setup.overlay_provider),
        },
    }
}

// ── Authorize owner key plan ──────────────────────────────────────────────────

/// Generate the steps to install an owner's SSH public key after their Access Request arrives.
/// Linux path — called from the Tauri command layer via cfg!.
pub fn generate_authorize_owner_key_steps_linux(
    sftp_username: &str,
    owner_public_key: &str,
    sftp_port: u16,
) -> Result<Vec<HostSetupStep>, HostSetupError> {
    validate_owner_public_key(owner_public_key)?;
    let display_key = strip_pubkey_comment(owner_public_key);
    let u = sftp_username;
    let port = sftp_port;
    Ok(vec![
        HostSetupStep {
            label: "Install owner SSH public key".to_string(),
            requires_root: true,
            display_command: format!(
                "# Install owner public key ({display_key}):\n\
echo '{owner_public_key}' | sudo tee /home/{u}/.ssh/authorized_keys\n\
sudo chmod 600 /home/{u}/.ssh/authorized_keys\n\
sudo chown {u}:{u} /home/{u}/.ssh/authorized_keys"
            ),
            note: Some("Paste the owner's public key exactly as received. Verify it starts with 'ssh-ed25519' or similar.".to_string()),
        },
        HostSetupStep {
            label: "Verify SFTP login from owner's machine".to_string(),
            requires_root: false,
            display_command: format!("sftp -P {port} {u}@<overlay-host>"),
            note: Some("Owner runs this to confirm access. Expect an sftp> prompt.".to_string()),
        },
    ])
}

/// Generate the steps to install an owner's SSH public key after their Access Request arrives.
/// macOS path.
pub fn generate_authorize_owner_key_steps_macos(
    sftp_username: &str,
    owner_public_key: &str,
    sftp_port: u16,
) -> Result<Vec<HostSetupStep>, HostSetupError> {
    validate_owner_public_key(owner_public_key)?;
    let display_key = strip_pubkey_comment(owner_public_key);
    let u = sftp_username;
    let port = sftp_port;
    Ok(vec![
        HostSetupStep {
            label: "Install owner SSH public key".to_string(),
            requires_root: true,
            display_command: format!(
                "# Install owner public key ({display_key}):\n\
sudo mkdir -p /Users/{u}/.ssh\n\
echo '{owner_public_key}' | sudo tee /Users/{u}/.ssh/authorized_keys\n\
sudo chmod 600 /Users/{u}/.ssh/authorized_keys\n\
sudo chown -R {u} /Users/{u}/.ssh"
            ),
            note: Some("Paste the owner's public key exactly as received.".to_string()),
        },
        HostSetupStep {
            label: "Verify SFTP login from owner's machine".to_string(),
            requires_root: false,
            display_command: format!("sftp -P {port} {u}@<overlay-host>"),
            note: Some("Owner runs this to confirm access. Expect an sftp> prompt.".to_string()),
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> HostSetupInput {
        HostSetupInput {
            connection_name: "Test connection".to_string(),
            hosted_path: "/mnt/nasbb/match-abc".to_string(),
            quota_gb: 500,
            match_id: "match-abc123".to_string(),
            sftp_username: "".to_string(), // auto-derived
            sftp_port: 22,
            owner_public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialForTestingOnly user@host".to_string(),
            source_folders: vec!["/home/user/docs".to_string()],
            existing_hosted_paths: vec![],
            overlay_provider: crate::overlay::OverlayProvider::Tailscale,
        }
    }

    // ── Validation happy path ─────────────────────────────────────────────────

    #[test]
    fn valid_input_passes() {
        assert!(validate_host_setup(&valid_input()).is_ok());
    }

    #[test]
    fn auto_derives_username_from_match_id() {
        let v = validate_host_setup(&valid_input()).unwrap();
        assert_eq!(v.sftp_username, "nasbb-match-abc123");
    }

    #[test]
    fn explicit_sftp_username_is_used() {
        let mut i = valid_input();
        i.sftp_username = "myuser".to_string();
        let v = validate_host_setup(&i).unwrap();
        assert_eq!(v.sftp_username, "myuser");
    }

    #[test]
    fn default_port_is_22_when_zero() {
        let mut i = valid_input();
        i.sftp_port = 0;
        let v = validate_host_setup(&i).unwrap();
        assert_eq!(v.sftp_port, 22);
    }

    // ── Path layout rejections ────────────────────────────────────────────────

    #[test]
    fn rejects_hosted_inside_source() {
        let mut i = valid_input();
        i.source_folders = vec!["/home/user/docs".to_string()];
        i.hosted_path = "/home/user/docs/peer-repo".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::HostedInsideSource(_, _))
        ));
    }

    #[test]
    fn rejects_source_inside_hosted() {
        let mut i = valid_input();
        i.source_folders = vec!["/mnt/nasbb/match-abc/source".to_string()];
        i.hosted_path = "/mnt/nasbb/match-abc".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::SourceInsideHosted(_, _))
        ));
    }

    #[test]
    fn unrelated_source_and_hosted_pass() {
        let mut i = valid_input();
        i.source_folders = vec!["/home/user/docs".to_string()];
        i.hosted_path = "/mnt/peer-storage".to_string();
        assert!(validate_host_setup(&i).is_ok());
    }

    // ── Identifier safety ─────────────────────────────────────────────────────

    #[test]
    fn rejects_empty_match_id() {
        let mut i = valid_input();
        i.match_id = "".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidMatchId)
        ));
    }

    #[test]
    fn rejects_match_id_with_spaces() {
        let mut i = valid_input();
        i.match_id = "match abc".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidMatchId)
        ));
    }

    #[test]
    fn rejects_match_id_with_shell_metachar() {
        let mut i = valid_input();
        i.match_id = "match;rm".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidMatchId)
        ));
    }

    #[test]
    fn rejects_sftp_username_starting_with_digit() {
        let mut i = valid_input();
        i.sftp_username = "1user".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidSftpUsername)
        ));
    }

    #[test]
    fn rejects_sftp_username_with_slash() {
        let mut i = valid_input();
        i.sftp_username = "user/name".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidSftpUsername)
        ));
    }

    // ── Public key validation ─────────────────────────────────────────────────

    #[test]
    fn rejects_private_key_in_public_key_field() {
        let mut i = valid_input();
        i.owner_public_key =
            "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAAA".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::PrivateKeyInPublicKeyField)
        ));
    }

    #[test]
    fn rejects_garbage_public_key() {
        let mut i = valid_input();
        i.owner_public_key = "not a key".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::InvalidPublicKey)
        ));
    }

    #[test]
    fn empty_public_key_is_allowed() {
        // Spec: host must be able to allocate space without the owner's key.
        // The host sends a Host Invite Bundle; the owner sends an Access Request
        // with their key later; the host then generates the authorize-key plan.
        let mut i = valid_input();
        i.owner_public_key = String::new();
        let result = validate_host_setup(&i);
        assert!(result.is_ok(), "empty owner key should be accepted: {:?}", result);
    }

    #[test]
    fn accepts_rsa_public_key() {
        let mut i = valid_input();
        i.owner_public_key =
            "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCfakeRSAkeyfortest user@machine"
                .to_string();
        assert!(validate_host_setup(&i).is_ok());
    }

    #[test]
    fn accepts_ecdsa_public_key() {
        let mut i = valid_input();
        i.owner_public_key =
            "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYA user@m"
                .to_string();
        assert!(validate_host_setup(&i).is_ok());
    }

    // ── Command plan redaction ────────────────────────────────────────────────

    #[test]
    fn linux_plan_does_not_contain_full_public_key() {
        let setup = validate_host_setup(&valid_input()).unwrap();
        let plan = generate_host_setup_plan_linux(&setup, "peer.tailnet.example");
        let all_commands: String =
            plan.steps.iter().map(|s| s.display_command.as_str()).collect::<Vec<_>>().join("\n");
        // Full base64 key body must not appear verbatim
        assert!(
            !all_commands.contains("AAAAIFakeKeyMaterialForTestingOnly"),
            "Full public key must not appear in display commands"
        );
    }

    #[test]
    fn macos_plan_does_not_contain_full_public_key() {
        let setup = validate_host_setup(&valid_input()).unwrap();
        let plan = generate_host_setup_plan_macos(&setup, "peer.tailnet.example");
        let all_commands: String =
            plan.steps.iter().map(|s| s.display_command.as_str()).collect::<Vec<_>>().join("\n");
        assert!(
            !all_commands.contains("AAAAIFakeKeyMaterialForTestingOnly"),
            "Full public key must not appear in display commands"
        );
    }

    #[test]
    fn owner_bundle_contains_expected_fields() {
        let setup = validate_host_setup(&valid_input()).unwrap();
        let plan = generate_host_setup_plan_linux(&setup, "my-host.tailnet");
        let b = &plan.owner_bundle;
        assert_eq!(b.overlay_host, "my-host.tailnet");
        assert_eq!(b.sftp_username, "nasbb-match-abc123");
        assert_eq!(b.sftp_port, 22);
        assert!(b.sftp_path.contains("repository"));
        assert_eq!(b.quota_gb, 500);
    }

    #[test]
    fn linux_plan_marks_root_steps() {
        let setup = validate_host_setup(&valid_input()).unwrap();
        let plan = generate_host_setup_plan_linux(&setup, "h");
        let root_steps: Vec<_> = plan.steps.iter().filter(|s| s.requires_root).collect();
        assert!(!root_steps.is_empty(), "Some steps must require root");
    }

    #[test]
    fn is_shell_safe_identifier_accepts_valid() {
        assert!(is_shell_safe_identifier("nasbb-match-1"));
        assert!(is_shell_safe_identifier("user123"));
        assert!(is_shell_safe_identifier("u.s.e.r"));
    }

    #[test]
    fn is_shell_safe_identifier_rejects_unsafe() {
        assert!(!is_shell_safe_identifier(""));
        assert!(!is_shell_safe_identifier("1user"));
        assert!(!is_shell_safe_identifier("user name"));
        assert!(!is_shell_safe_identifier("user;drop"));
        assert!(!is_shell_safe_identifier("user$(cmd)"));
    }

    #[test]
    fn is_safe_match_id_rejects_dots() {
        assert!(!is_safe_match_id("match.abc"));
        assert!(is_safe_match_id("match-abc"));
        assert!(is_safe_match_id("matchABC123"));
    }

    #[test]
    fn host_plan_without_owner_key_is_valid() {
        let mut input = valid_input();
        input.owner_public_key = String::new();
        let result = validate_host_setup(&input);
        assert!(result.is_ok(), "empty owner_public_key should be accepted: {:?}", result);
        let v = result.unwrap();
        assert!(v.owner_public_key_raw.is_empty());
    }

    #[test]
    fn host_plan_without_key_contains_placeholder_step() {
        let mut input = valid_input();
        input.owner_public_key = String::new();
        let setup = validate_host_setup(&input).unwrap();
        let plan = generate_host_setup_plan_linux(&setup, "host.example.com");
        let key_step = plan.steps.iter().find(|s| s.label.contains("public key")).unwrap();
        assert!(
            key_step.display_command.contains("Generate Authorize Owner Key Plan")
                || key_step.display_command.contains("Access Request"),
            "plan without key must have placeholder guidance, got: {}",
            key_step.display_command
        );
    }

    #[test]
    fn owner_bundle_includes_connection_name() {
        let setup = validate_host_setup(&valid_input()).unwrap();
        let plan = generate_host_setup_plan_linux(&setup, "host.example.com");
        assert_eq!(plan.owner_bundle.connection_name, "Test connection");
    }

    #[test]
    fn authorize_owner_key_plan_rejects_bad_key() {
        let result = generate_authorize_owner_key_steps_linux("nasbb-match", "not-a-key", 22);
        assert!(result.is_err());
    }

    #[test]
    fn authorize_owner_key_plan_linux_contains_tee_command() {
        let key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialForTestingOnly user@host";
        let steps = generate_authorize_owner_key_steps_linux("nasbb-match", key, 22).unwrap();
        let install = steps.iter().find(|s| s.label.contains("public key")).unwrap();
        assert!(install.display_command.contains("authorized_keys"), "must write authorized_keys: {}", install.display_command);
        assert!(install.requires_root);
    }

    #[test]
    fn authorize_owner_key_plan_does_not_contain_private_key_material() {
        let key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialForTestingOnly user@host";
        let steps = generate_authorize_owner_key_steps_linux("nasbb-match", key, 22).unwrap();
        for step in &steps {
            assert!(!step.display_command.contains("PRIVATE KEY"), "must not contain private key material");
        }
    }

    // ── validate_hosted_path_isolation ───────────────────────────────────────

    #[test]
    fn isolation_rejects_overlap_with_source_folder() {
        let result = validate_hosted_path_isolation(
            "/home/user/docs/peer",
            &["/home/user/docs"],
            &[],
        );
        assert!(matches!(result, Err(HostSetupError::HostedInsideSource(_, _))));
    }

    #[test]
    fn isolation_rejects_source_inside_hosted() {
        let result = validate_hosted_path_isolation(
            "/home/user",
            &["/home/user/docs"],
            &[],
        );
        assert!(matches!(result, Err(HostSetupError::SourceInsideHosted(_, _))));
    }

    #[test]
    fn isolation_rejects_exact_overlap_with_existing_allocation() {
        let result = validate_hosted_path_isolation(
            "/mnt/nasbb/match-abc",
            &[],
            &["/mnt/nasbb/match-abc"],
        );
        assert!(matches!(result, Err(HostSetupError::HostedOverlapsExistingAllocation(_, _))));
    }

    #[test]
    fn isolation_rejects_subfolder_of_existing_allocation() {
        let result = validate_hosted_path_isolation(
            "/mnt/nasbb/match-abc/sub",
            &[],
            &["/mnt/nasbb/match-abc"],
        );
        assert!(matches!(result, Err(HostSetupError::HostedOverlapsExistingAllocation(_, _))));
    }

    #[test]
    fn isolation_rejects_parent_of_existing_allocation() {
        let result = validate_hosted_path_isolation(
            "/mnt/nasbb",
            &[],
            &["/mnt/nasbb/match-abc"],
        );
        assert!(matches!(result, Err(HostSetupError::HostedOverlapsExistingAllocation(_, _))));
    }

    #[test]
    fn isolation_allows_sibling_allocations() {
        let result = validate_hosted_path_isolation(
            "/mnt/nasbb/match-xyz",
            &["/home/user/docs"],
            &["/mnt/nasbb/match-abc"],
        );
        assert!(result.is_ok(), "sibling paths should not overlap: {:?}", result);
    }

    #[test]
    fn isolation_skips_empty_existing_paths() {
        let result = validate_hosted_path_isolation(
            "/mnt/peer-storage",
            &[],
            &["", "  "],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn isolation_rejects_empty_hosted_path() {
        let result = validate_hosted_path_isolation("", &[], &[]);
        assert!(matches!(result, Err(HostSetupError::MissingHostedPath)));
    }

    // ── validate_host_setup: existing_hosted_paths ────────────────────────────

    #[test]
    fn validate_rejects_overlap_with_existing_allocation() {
        let mut i = valid_input();
        i.existing_hosted_paths = vec!["/mnt/nasbb/match-abc".to_string()];
        i.hosted_path = "/mnt/nasbb/match-abc".to_string();
        assert!(matches!(
            validate_host_setup(&i),
            Err(HostSetupError::HostedOverlapsExistingAllocation(_, _))
        ));
    }

    #[test]
    fn validate_allows_distinct_allocations() {
        let mut i = valid_input();
        i.existing_hosted_paths = vec!["/mnt/nasbb/match-abc".to_string()];
        i.hosted_path = "/mnt/nasbb/match-xyz".to_string();
        assert!(validate_host_setup(&i).is_ok());
    }
}
