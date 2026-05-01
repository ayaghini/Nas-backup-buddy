//! Overlay network detection, validation, and guided-setup command plans.
//!
//! ## Design
//!
//! NAS Backup Buddy treats the overlay network as "a private reachable address."
//! It does not mandate a specific VPN vendor. The supported providers are:
//! - **Tailscale** — easiest path; MagicDNS hostnames or 100.x.x.x IPs.
//! - **Headscale** — self-hosted Tailscale-compatible coordination server.
//! - **WireGuard** — manual, powerful; tunnel IPs exchanged out-of-band.
//! - **Custom** — any reachable private address the user controls.
//!
//! ## What this module does
//!
//! - Defines `OverlayProvider` and `OverlayMode` enums.
//! - Validates overlay metadata (no secrets; no private keys).
//! - Detects installed CLI tools with best-effort subprocess probes.
//! - Parses structured output from `tailscale status --json` (best-effort).
//! - Generates read-only command plans for verifying and understanding the overlay.
//! - Returns guided-setup steps for each provider.
//!
//! ## What this module does NOT do
//!
//! - Install VPN software.
//! - Run `tailscale login` or any auth command.
//! - Generate or store WireGuard private keys.
//! - Store Tailscale/Headscale auth keys.
//! - Mutate network configuration.
//!
//! All detection commands are non-destructive reads.

use serde::{Deserialize, Serialize};
use thiserror::Error;

// ── Provider / mode ──────────────────────────────────────────────────────────

/// Which overlay technology the user has (or wants to set up).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayProvider {
    Tailscale,
    Headscale,
    WireGuard,
    /// Any manually-entered private address not managed by the above.
    CustomReachableAddress,
    NotConfigured,
}

impl Default for OverlayProvider {
    fn default() -> Self {
        Self::NotConfigured
    }
}

impl std::fmt::Display for OverlayProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OverlayProvider::Tailscale => write!(f, "Tailscale"),
            OverlayProvider::Headscale => write!(f, "Headscale"),
            OverlayProvider::WireGuard => write!(f, "WireGuard"),
            OverlayProvider::CustomReachableAddress => write!(f, "Custom reachable address"),
            OverlayProvider::NotConfigured => write!(f, "Not configured"),
        }
    }
}

/// Whether the user already has an overlay or needs guided setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayMode {
    UseExisting,
    GuidedSetup,
}

// ── Non-secret metadata persisted locally ────────────────────────────────────

/// Non-secret overlay metadata stored in the local config.
///
/// No private keys, no auth tokens, no pre-auth keys are stored here.
/// If token support is added later, store only keychain references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayConfig {
    pub provider: OverlayProvider,
    pub mode: OverlayMode,
    /// This device's address/hostname on the overlay (e.g. 100.x.x.x or device.tailnet).
    pub local_address: String,
    /// The peer's address/hostname (the other machine in the match).
    pub peer_address: String,
    /// Headscale control server URL. Only relevant for Headscale provider.
    #[serde(default)]
    pub headscale_server_url: Option<String>,
    /// Free-form notes or last status message (non-secret, safe for display).
    #[serde(default)]
    pub notes: Option<String>,
}

// ── Validation ────────────────────────────────────────────────────────────────

#[derive(Debug, Error, PartialEq)]
pub enum OverlayError {
    #[error("peer_address must not be empty")]
    MissingPeerAddress,
    #[error("peer_address must not look like a local loopback address (127.x, ::1)")]
    LoopbackAddressRejected,
    #[error("headscale_server_url must be present for Headscale provider")]
    MissingHeadscaleServerUrl,
    #[error("headscale_server_url must start with https:// or http://")]
    InvalidHeadscaleServerUrl,
    #[error("custom address '{0}' does not appear private — verify it is not publicly exposed")]
    CustomAddressLooksPublic(String),
}

/// Returns true if the address looks like a private/overlay network address.
/// Best-effort heuristic — not a security control.
pub fn looks_private_or_overlay(addr: &str) -> bool {
    let a = addr.trim().to_lowercase();
    // RFC1918 / Tailscale CGNAT (100.64-127.x) / IPv6 ULA
    a.starts_with("10.")
        || a.starts_with("192.168.")
        || a.starts_with("172.16.")
        || a.starts_with("172.17.")
        || a.starts_with("172.18.")
        || a.starts_with("172.19.")
        || a.starts_with("172.2")
        || a.starts_with("172.3")
        // Tailscale CGNAT range 100.64/10
        || (a.starts_with("100.") && {
            let second: u8 = a.split('.').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            second >= 64
        })
        || a.ends_with(".ts.net")   // Tailscale MagicDNS
        || a.contains(".tailnet.") // common tailnet domain patterns
        || a.starts_with("fd")     // IPv6 ULA fd::/8
}

/// Validate overlay configuration — checks structural requirements only.
/// Does not probe network connectivity.
pub fn validate_overlay_config(cfg: &OverlayConfig) -> Result<(), OverlayError> {
    if cfg.peer_address.trim().is_empty() {
        return Err(OverlayError::MissingPeerAddress);
    }
    let peer = cfg.peer_address.trim();
    if peer == "127.0.0.1" || peer == "::1" || peer.starts_with("127.") {
        return Err(OverlayError::LoopbackAddressRejected);
    }
    if cfg.provider == OverlayProvider::Headscale {
        let url = cfg
            .headscale_server_url
            .as_deref()
            .map(str::trim)
            .unwrap_or("");
        if url.is_empty() {
            return Err(OverlayError::MissingHeadscaleServerUrl);
        }
        if !url.starts_with("https://") && !url.starts_with("http://") {
            return Err(OverlayError::InvalidHeadscaleServerUrl);
        }
    }
    if cfg.provider == OverlayProvider::CustomReachableAddress
        && !looks_private_or_overlay(peer)
    {
        return Err(OverlayError::CustomAddressLooksPublic(
            // Safe to include — it's the address the user just typed, not a secret
            peer.to_string(),
        ));
    }
    Ok(())
}

// ── Detection ────────────────────────────────────────────────────────────────

/// Result of attempting to detect an installed overlay tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayDetectionResult {
    pub provider: OverlayProvider,
    /// Whether the CLI binary is present on PATH.
    pub installed: bool,
    /// Whether it appears to be running/configured. None if unknown.
    pub running_or_configured: Option<bool>,
    /// Candidate addresses found (e.g. from `tailscale ip -4` or `wg show`).
    pub candidate_addresses: Vec<String>,
    /// Safe message for display — no secrets, no raw logs.
    pub message: String,
}

// ── Tailscale binary discovery ────────────────────────────────────────────────

/// Known locations for the Tailscale CLI binary, in priority order.
///
/// macOS: the GUI app from tailscale.com / App Store does NOT add the CLI to
/// PATH. The binary lives inside the .app bundle. We check that first, then
/// fall back to Homebrew and manual symlink locations.
///
/// Windows: auto-detect is best-effort; if not found here, PATH is tried first.
const TAILSCALE_KNOWN_PATHS: &[&str] = &[
    // macOS GUI app (tailscale.com download / App Store) — most common on macOS
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    // Homebrew (macOS Intel or Apple Silicon)
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    // Linux system package
    "/usr/bin/tailscale",
    "/usr/sbin/tailscale",
    // Windows common install locations (best-effort; try PATH first)
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
];

/// Find the Tailscale CLI binary.
///
/// 1. If `tailscale` resolves on the current PATH, return `"tailscale"` so
///    the command works in any terminal without extra config.
/// 2. Otherwise walk `TAILSCALE_KNOWN_PATHS` and return the first that exists.
/// 3. Return `None` if Tailscale is not found.
pub fn find_tailscale_binary() -> Option<String> {
    // Check PATH first — covers Homebrew installs where the user already has
    // it in PATH, or cases where the user ran "Install CLI" from the app.
    if probe_binary("tailscale") {
        return Some("tailscale".to_string());
    }
    // Walk known absolute paths
    for path in TAILSCALE_KNOWN_PATHS {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

/// Shell command to add the macOS GUI-app CLI to PATH permanently.
///
/// The Tailscale macOS GUI app offers two ways to make the CLI accessible:
/// A. GUI: menu bar icon → Preferences → "Install CLI" (requires approval).
/// B. Manual symlink (shown here). Works on both Intel and Apple Silicon.
pub const TAILSCALE_MACOS_ADD_TO_PATH_CMD: &str =
    "sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale";

// ── Structured Tailscale status ───────────────────────────────────────────────

/// Overall setup state for Tailscale, derived from detection results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TailscaleSetupState {
    /// CLI detected, connected, local address available.
    Ready,
    /// CLI works but BackendState is NeedsLogin or NeedsNodeKey.
    InstalledNeedsLogin,
    /// App binary exists at a known path but we cannot invoke the CLI.
    InstalledCliNotAccessible,
    /// No Tailscale binary found anywhere.
    NotInstalled,
    /// Detection failed unexpectedly.
    Error,
}

/// Rich Tailscale status returned by `get_tailscale_detail`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleDetail {
    /// Binary found at any known path or on PATH.
    pub installed: bool,
    /// Binary found AND we can successfully invoke it.
    pub cli_accessible: bool,
    /// Absolute path or `"tailscale"` if on PATH. `None` if not found.
    pub cli_path: Option<String>,
    /// True if `tailscale` works without a full path (i.e. is on PATH).
    pub on_path: bool,
    /// Daemon is running and this device is authenticated / connected.
    pub connected: bool,
    /// Needs authentication (BackendState is NeedsLogin or NeedsNodeKey).
    pub needs_login: bool,
    /// BackendState from `tailscale status --json` (e.g. "Running", "NeedsLogin").
    pub backend_state: Option<String>,
    /// URL to open to complete authentication (non-empty when NeedsLogin).
    pub auth_url: Option<String>,
    /// This device's Tailscale IPv4 address(es).
    pub self_ips: Vec<String>,
    /// MagicDNS hostname for this device (e.g. `my-mac.tailnet-name.ts.net`).
    pub self_dns_name: Option<String>,
    /// Tailnet-wide MagicDNS suffix (e.g. `tailnet-name.ts.net`).
    pub magic_dns_suffix: Option<String>,
    /// Human-readable tailnet name (e.g. `user@example.com`).
    pub tailnet_name: Option<String>,
    /// Number of peers visible in `tailscale status --json`.
    pub peer_count: usize,
    /// ISO-8601 UTC timestamp of when this status was last checked.
    pub last_checked_at: String,
    /// Human-readable summary based on setup_state.
    pub status_message: String,
    /// Overall setup state derived from detection results.
    pub setup_state: TailscaleSetupState,
}

/// ISO-8601 UTC timestamp helper for overlay module.
/// Duplicated from sftp_verify to avoid cross-module dependency; renamed to avoid conflict.
fn overlay_now_utc_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = overlay_secs_to_ymd_hms(secs);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, mi, s)
}

fn overlay_secs_to_ymd_hms(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let s = secs % 60;
    let mins = secs / 60;
    let mi = mins % 60;
    let hours = mins / 60;
    let h = hours % 24;
    let days = hours / 24;
    let mut year = 1970u32;
    let mut rem = days;
    loop {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if rem < days_in_year { break; }
        rem -= days_in_year;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [31, if leap {29} else {28}, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u32;
    for &md in &month_days {
        if rem < md { break; }
        rem -= md;
        month += 1;
    }
    (year, month, rem as u32 + 1, h as u32, mi as u32, s as u32)
}

/// Query the full Tailscale status using the discovered binary.
///
/// Never returns an error — failures are represented in the returned struct
/// (e.g. `connected: false`, empty `self_ips`).
pub fn get_tailscale_detail() -> TailscaleDetail {
    let last_checked_at = overlay_now_utc_iso();
    let cli_path = find_tailscale_binary();
    let on_path = cli_path.as_deref() == Some("tailscale");

    // installed = binary file exists (either on PATH or at a known absolute path)
    // We consider it installed if find_tailscale_binary returned Some (it checks both)
    let installed = cli_path.is_some();

    let Some(bin) = &cli_path else {
        return TailscaleDetail {
            installed: false,
            cli_accessible: false,
            cli_path: None,
            on_path: false,
            connected: false,
            needs_login: false,
            backend_state: None,
            auth_url: None,
            self_ips: vec![],
            self_dns_name: None,
            magic_dns_suffix: None,
            tailnet_name: None,
            peer_count: 0,
            last_checked_at,
            status_message: "Tailscale not found. Install from https://tailscale.com/download".to_string(),
            setup_state: TailscaleSetupState::NotInstalled,
        };
    };

    // cli_accessible: binary exists AND we can invoke it (version check)
    let cli_accessible = run_binary_safe(bin, &["version"]).is_some();

    if !cli_accessible {
        return TailscaleDetail {
            installed,
            cli_accessible: false,
            cli_path: Some(bin.clone()),
            on_path,
            connected: false,
            needs_login: false,
            backend_state: None,
            auth_url: None,
            self_ips: vec![],
            self_dns_name: None,
            magic_dns_suffix: None,
            tailnet_name: None,
            peer_count: 0,
            last_checked_at,
            status_message: format!(
                "Tailscale found at '{}' but CLI is not accessible. Add it to PATH to allow the app to read status.",
                bin
            ),
            setup_state: TailscaleSetupState::InstalledCliNotAccessible,
        };
    }

    // Run `tailscale status --json` — best-effort, no auth side-effects.
    let json_out = run_binary_safe(bin, &["status", "--json"]);

    let (backend_state, auth_url, self_ips, self_dns_name, magic_dns_suffix, tailnet_name, peer_count) =
        if let Some(json) = &json_out {
            parse_tailscale_status_detail(json)
        } else {
            (None, None, vec![], None, None, None, 0)
        };

    // Also try `tailscale ip -4` as a fallback if JSON gave no IPs.
    let self_ips = if self_ips.is_empty() {
        run_binary_safe(bin, &["ip", "-4"])
            .map(|o| parse_tailscale_ipv4(&o))
            .unwrap_or_default()
    } else {
        self_ips
    };

    let needs_login = matches!(
        backend_state.as_deref(),
        Some("NeedsLogin") | Some("NeedsNodeKey")
    );
    let connected = backend_state.as_deref() == Some("Running") && !self_ips.is_empty();

    let setup_state = if connected {
        TailscaleSetupState::Ready
    } else if needs_login {
        TailscaleSetupState::InstalledNeedsLogin
    } else if cli_accessible {
        // CLI works but not connected for some other reason
        TailscaleSetupState::InstalledNeedsLogin
    } else {
        TailscaleSetupState::Error
    };

    let status_message = match &setup_state {
        TailscaleSetupState::Ready => {
            let dns = self_dns_name.as_deref().map(|d| format!(", DNS: {d}")).unwrap_or_default();
            format!("Tailscale connected. {} address(es){dns}.", self_ips.len())
        }
        TailscaleSetupState::InstalledNeedsLogin => {
            "Tailscale installed but not signed in. Open the Tailscale app and log in.".to_string()
        }
        TailscaleSetupState::InstalledCliNotAccessible => {
            format!("Tailscale found at '{}' but CLI is not accessible.", bin)
        }
        TailscaleSetupState::NotInstalled => {
            "Tailscale not found. Install from https://tailscale.com/download".to_string()
        }
        TailscaleSetupState::Error => {
            "Tailscale detection failed unexpectedly.".to_string()
        }
    };

    TailscaleDetail {
        installed,
        cli_accessible,
        cli_path: Some(bin.clone()),
        on_path,
        connected,
        needs_login,
        backend_state,
        auth_url,
        self_ips,
        self_dns_name,
        magic_dns_suffix,
        tailnet_name,
        peer_count,
        last_checked_at,
        status_message,
        setup_state,
    }
}

// ── On-demand Tailscale diagnostics and connect ───────────────────────────────

/// Result of `tailscale ping <peer>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscalePingResult {
    /// Peer replied to the ping.
    pub reachable: bool,
    /// Round-trip time in milliseconds if reachable.
    pub latency_ms: Option<u64>,
    /// How traffic reached the peer — "DERP(region)" or a direct IP:port string.
    pub via: Option<String>,
    /// Safe display message — peer address is not included.
    pub message: String,
}

/// Result of `tailscale up` (on-demand connect, no flags).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleConnectResult {
    /// Command exited successfully and Tailscale appears connected.
    pub success: bool,
    /// Tailscale requires authentication — show `auth_url` to the user.
    pub needs_auth: bool,
    /// Browser auth URL when `needs_auth` is true.
    pub auth_url: Option<String>,
    /// Safe display message.
    pub message: String,
}

/// Validate a peer address before passing it as a CLI argument.
///
/// Allows hostnames, IPv4, and IPv6 (brackets/colons). Rejects shell
/// metacharacters. The argument is passed directly to `Command::arg()`,
/// not through a shell, so this is defence-in-depth only.
pub fn is_valid_peer_address(peer: &str) -> bool {
    !peer.is_empty()
        && peer.len() <= 253
        && peer.chars().all(|c| {
            c.is_alphanumeric()
                || c == '.'
                || c == '-'
                || c == '_'
                || c == ':'
                || c == '['
                || c == ']'
                || c == '%'
        })
}

/// Build the bounded `tailscale ping` argument list for a given peer.
///
/// `--c=1`               — send exactly one ping packet.
/// `--timeout=5s`        — give up after 5 seconds.
/// `--until-direct=false` — do not wait to find a direct path (report DERP immediately).
///
/// Every element is passed as a separate `Command::arg` — never through a shell.
pub fn tailscale_ping_args(peer: &str) -> Vec<String> {
    vec![
        "ping".to_string(),
        "--c=1".to_string(),
        "--timeout=5s".to_string(),
        "--until-direct=false".to_string(),
        peer.to_string(),
    ]
}

/// Run `tailscale ping <peer>` — one-shot, bounded overlay diagnostic.
///
/// Never called automatically. Only invoked from an explicit user action.
/// No auth keys or network-mutation flags are used.
/// The peer address is validated before use.
/// Args are bounded so the command returns promptly.
pub fn ping_tailscale_peer(peer: &str) -> TailscalePingResult {
    if !is_valid_peer_address(peer) {
        return TailscalePingResult {
            reachable: false,
            latency_ms: None,
            via: None,
            message: "Invalid peer address — only hostnames and IPs are allowed.".to_string(),
        };
    }
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => return TailscalePingResult {
            reachable: false,
            latency_ms: None,
            via: None,
            message: "Tailscale CLI not found — install and add to PATH first.".to_string(),
        },
    };
    match std::process::Command::new(&bin)
        .args(tailscale_ping_args(peer))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
    {
        Err(_) => TailscalePingResult {
            reachable: false,
            latency_ms: None,
            via: None,
            message: "Failed to run tailscale ping — check CLI is accessible.".to_string(),
        },
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            parse_tailscale_ping_output(&stdout, &stderr)
        }
    }
}

/// Parse output from `tailscale ping`. Exported for unit tests.
pub fn parse_tailscale_ping_output(stdout: &str, _stderr: &str) -> TailscalePingResult {
    let text = stdout;

    // A successful pong line starts with "pong from" (possibly with leading whitespace).
    // "timeout waiting for pong from ..." also contains "pong from" but starts with "timeout".
    let has_pong = text.lines().any(|l| l.trim_start().starts_with("pong from"));

    if has_pong {
        return TailscalePingResult {
            reachable: true,
            latency_ms: extract_latency_ms(text),
            via: extract_via(text),
            message: "Tailscale ping succeeded — overlay path is reachable.".to_string(),
        };
    }

    let msg = if text.contains("no tailscale connection") || text.contains("no connection") {
        "Peer is not reachable on the overlay — check device sharing/invite."
    } else if text.contains("timeout") || text.contains("timed out") {
        "Tailscale ping timed out — peer may be offline or unreachable."
    } else {
        "Tailscale ping did not receive a reply."
    };

    TailscalePingResult {
        reachable: false,
        latency_ms: None,
        via: None,
        message: msg.to_string(),
    }
}

fn extract_latency_ms(text: &str) -> Option<u64> {
    let in_pos = text.rfind(" in ")?;
    let after = &text[in_pos + 4..];
    let ms_pos = after.find("ms")?;
    after[..ms_pos].trim().parse::<f64>().ok().map(|f| f as u64)
}

fn extract_via(text: &str) -> Option<String> {
    let via_pos = text.find(" via ")?;
    let after = &text[via_pos + 5..];
    let end = after.find(|c: char| c == ' ' || c == '\n' || c == '\r').unwrap_or(after.len());
    let via = &after[..end];
    if via.is_empty() { None } else { Some(via.to_string()) }
}

/// Run `tailscale up` with no flags — explicit on-demand connect.
///
/// Must only be called from an explicit, confirmed user action.
/// Never run automatically. Never passes auth keys, routes, ACLs,
/// SSH-enable, serve/funnel, or any network-mutation flag.
///
/// If Tailscale requires authentication, `needs_auth` is set and
/// the auth URL is returned so the UI can display it. The caller
/// must refresh the Tailscale status after this returns.
pub fn tailscale_connect() -> TailscaleConnectResult {
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => return TailscaleConnectResult {
            success: false,
            needs_auth: false,
            auth_url: None,
            message: "Tailscale CLI not found.".to_string(),
        },
    };
    match std::process::Command::new(&bin)
        .arg("up")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
    {
        Err(_) => TailscaleConnectResult {
            success: false,
            needs_auth: false,
            auth_url: None,
            message: "Failed to run tailscale up — check CLI is accessible.".to_string(),
        },
        Ok(out) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            parse_tailscale_up_output(&combined, out.status.success())
        }
    }
}

/// Parse output from `tailscale up`. Exported for unit tests.
pub fn parse_tailscale_up_output(output: &str, exit_ok: bool) -> TailscaleConnectResult {
    // Auth URL lines start with https://
    let auth_url = output
        .lines()
        .find(|l| l.trim_start().starts_with("https://"))
        .map(|l| l.trim().to_string());

    if auth_url.is_some()
        || output.contains("NeedsLogin")
        || output.contains("To authenticate")
        || output.contains("Log in")
    {
        return TailscaleConnectResult {
            success: false,
            needs_auth: true,
            auth_url,
            message: "Tailscale needs authentication. Open the Tailscale app and sign in, \
                      or use the auth URL below."
                .to_string(),
        };
    }

    // Empty output is only success when the process exited cleanly.
    // Empty output with a non-zero exit code is not a success.
    if exit_ok {
        TailscaleConnectResult {
            success: true,
            needs_auth: false,
            auth_url: None,
            message: "tailscale up completed — check the Status card to confirm connection.".to_string(),
        }
    } else {
        TailscaleConnectResult {
            success: false,
            needs_auth: false,
            auth_url: None,
            message: "tailscale up finished but connection state is unclear — check Tailscale status.".to_string(),
        }
    }
}

/// Parse detailed fields from `tailscale status --json` output.
///
/// Returns `(backend_state, auth_url, self_ips, self_dns_name, magic_dns_suffix,
///           tailnet_name, peer_count)`.
/// Best-effort minimal JSON extraction — avoids pulling in serde_json here.
pub fn parse_tailscale_status_detail(
    json: &str,
) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>, Option<String>, usize) {
    let extract_str = |key: &str, text: &str| -> Option<String> {
        let needle = format!("\"{key}\"");
        let pos = text.find(&needle)?;
        let after = &text[pos + needle.len()..];
        let after = after.trim_start_matches(|c: char| c == ':' || c == ' ');
        if after.starts_with('"') {
            let rest = &after[1..];
            let end = rest.find('"')?;
            let val = &rest[..end];
            if val.is_empty() { None } else { Some(val.to_string()) }
        } else {
            None
        }
    };

    let backend_state = extract_str("BackendState", json);
    let auth_url = extract_str("AuthURL", json);

    // Self block: extract TailscaleIPs array and DNSName
    let mut self_ips = Vec::new();
    let mut self_dns_name: Option<String> = None;

    if let Some(self_pos) = json.find("\"Self\"") {
        // Find the closing brace of the Self object (heuristic: next top-level "}")
        let self_json = &json[self_pos..];
        let end = find_object_end(self_json).unwrap_or(self_json.len());
        let block = &self_json[..end];

        // Extract TailscaleIPs array
        if let Some(ips_pos) = block.find("\"TailscaleIPs\"") {
            let after = &block[ips_pos + "\"TailscaleIPs\"".len()..];
            if let Some(arr_start) = after.find('[') {
                let arr = &after[arr_start + 1..];
                if let Some(arr_end) = arr.find(']') {
                    for part in arr[..arr_end].split(',') {
                        let ip = part.trim().trim_matches('"');
                        if !ip.is_empty() && !ip.contains("fd") {
                            // Only IPv4 (skip IPv6 fd:: addresses for simplicity)
                            if ip.chars().all(|c| c.is_ascii_digit() || c == '.') {
                                self_ips.push(ip.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Also accept old TailAddr field
        if self_ips.is_empty() {
            if let Some(addr) = extract_str("TailAddr", block) {
                self_ips.push(addr);
            }
        }

        // DNS name (strip trailing dot from e.g. "my-mac.tailnet.ts.net.")
        self_dns_name = extract_str("DNSName", block)
            .map(|s| s.trim_end_matches('.').to_string())
            .filter(|s| !s.is_empty());
    }

    // MagicDNSSuffix and CurrentTailnet
    let magic_dns_suffix = extract_str("MagicDNSSuffix", json)
        .map(|s| s.trim_end_matches('.').to_string());

    let tailnet_name = {
        // Look in CurrentTailnet.Name first, fall back to top-level
        let ct_pos = json.find("\"CurrentTailnet\"");
        if let Some(pos) = ct_pos {
            let block = &json[pos..];
            let end = find_object_end(block).unwrap_or(block.len());
            extract_str("Name", &block[..end])
        } else {
            None
        }
    };

    // Peer count: count "\"Peer\"" occurrences or count top-level peer keys
    // Simpler: count occurrences of "\"HostName\"" inside the Peer block
    let peer_count = {
        if let Some(peer_pos) = json.find("\"Peer\"") {
            let peer_json = &json[peer_pos..];
            // Count entries by counting nodeKey occurrences which are unique per peer
            peer_json.matches("\"NodeKey\"").count()
        } else {
            0
        }
    };

    (backend_state, auth_url, self_ips, self_dns_name, magic_dns_suffix, tailnet_name, peer_count)
}

/// Heuristic: find the index just past the closing `}` of the first JSON object
/// starting at the beginning of `s` (which must start with `"{key}"`).
fn find_object_end(s: &str) -> Option<usize> {
    let start = s.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, ch) in s[start..].char_indices() {
        if escaped { escaped = false; continue; }
        if ch == '\\' && in_string { escaped = true; continue; }
        if ch == '"' { in_string = !in_string; continue; }
        if in_string { continue; }
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(start + i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

// ── Parse helpers (kept for tests) ───────────────────────────────────────────

/// Parse Tailscale IPv4 addresses from `tailscale ip -4` output.
/// Returns a list of addresses, one per line, ignoring blank lines.
pub fn parse_tailscale_ipv4(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .map(str::to_string)
        .collect()
}

/// Parse `tailscale status --json` to find this device's self address.
/// Kept for backwards compatibility — `parse_tailscale_status_detail` is the richer version.
pub fn parse_tailscale_status_json(json: &str) -> Vec<String> {
    let (_, _, ips, _, _, _, _) = parse_tailscale_status_detail(json);
    ips
}

/// Parse `wg show` output for the local interface address.
/// Lines like `interface: wg0`, `address: 10.x.x.x/24` etc.
/// Returns a vec of address strings, stripped of CIDR notation.
pub fn parse_wg_show(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|l| {
            let t = l.trim();
            // "  address: 10.x.x.x/24" or similar
            if t.to_lowercase().starts_with("address:") || t.to_lowercase().starts_with("endpoint:") {
                let val = t.splitn(2, ':').nth(1).unwrap_or("").trim();
                // Strip CIDR notation and port if present
                let addr = val.split('/').next().unwrap_or(val);
                let addr = addr.split(':').next().unwrap_or(addr); // strip :port for endpoints
                let addr = addr.trim().trim_matches('[').trim_matches(']');
                if !addr.is_empty() {
                    return Some(addr.to_string());
                }
            }
            None
        })
        .collect()
}

/// Detect overlay tools installed on this system.
///
/// Runs read-only CLI commands with no auth side effects.
/// Returns one `OverlayDetectionResult` per provider attempted.
/// Never fails — all errors are captured in the `message` field.
pub fn detect_overlay_tools() -> Vec<OverlayDetectionResult> {
    vec![
        detect_tailscale(),
        detect_wireguard(),
    ]
}

/// Run a binary (by name or absolute path) with args; return stdout on success.
fn run_binary_safe(binary: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

/// Return true if `name` is resolvable on the current PATH.
fn probe_binary(name: &str) -> bool {
    std::process::Command::new(name)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|_| true)
        .unwrap_or(false)
}

fn detect_tailscale() -> OverlayDetectionResult {
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => {
            let hint = if cfg!(target_os = "macos") {
                "Tailscale not found. Install the GUI app from https://tailscale.com/download/mac \
                 (not `brew install tailscale`), then open it and sign in via the menu bar."
            } else {
                "Tailscale not found. Install with: curl -fsSL https://tailscale.com/install.sh | sh"
            };
            return OverlayDetectionResult {
                provider: OverlayProvider::Tailscale,
                installed: false,
                running_or_configured: None,
                candidate_addresses: vec![],
                message: hint.to_string(),
            };
        }
    };

    let detail = get_tailscale_detail();

    // Include full path in message when not on PATH so users know to use it or add a symlink.
    let path_note = if detail.on_path {
        String::new()
    } else {
        format!(" (CLI at {bin} — not yet on PATH; see 'Add to PATH' step)")
    };

    let message = if detail.connected {
        let dns = detail.self_dns_name
            .as_deref()
            .map(|d| format!(", DNS: {d}"))
            .unwrap_or_default();
        format!("Tailscale running. {} address(es) found{dns}{path_note}.", detail.self_ips.len())
    } else if detail.needs_login {
        format!("Tailscale found but not signed in — open the app or run the auth command.{path_note}")
    } else {
        format!("Tailscale found but not connected.{path_note}")
    };

    // candidate_addresses: prefer MagicDNS hostname (most stable), then IPs
    let mut candidates = vec![];
    if let Some(dns) = &detail.self_dns_name {
        candidates.push(dns.clone());
    }
    candidates.extend(detail.self_ips.clone());

    OverlayDetectionResult {
        provider: OverlayProvider::Tailscale,
        installed: true,
        running_or_configured: Some(detail.connected),
        candidate_addresses: candidates,
        message,
    }
}

fn detect_wireguard() -> OverlayDetectionResult {
    let has_wg = probe_binary("wg") || probe_binary("wg-quick");
    if !has_wg {
        return OverlayDetectionResult {
            provider: OverlayProvider::WireGuard,
            installed: false,
            running_or_configured: None,
            candidate_addresses: vec![],
            message: "wg/wg-quick not found on PATH".to_string(),
        };
    }

    // `wg show` may need root — try without sudo; parse if it succeeds
    let addrs = run_binary_safe("wg", &["show"])
        .map(|out| parse_wg_show(&out))
        .unwrap_or_default();

    let running = !addrs.is_empty();
    let message = if running {
        format!("WireGuard interfaces found. {} address(es) detected.", addrs.len())
    } else {
        "WireGuard tools found. Run 'sudo wg show' manually to see active interfaces.".to_string()
    };

    OverlayDetectionResult {
        provider: OverlayProvider::WireGuard,
        installed: true,
        running_or_configured: Some(running),
        candidate_addresses: addrs,
        message,
    }
}

// ── Command plans for overlay verification ────────────────────────────────────

/// A single read-only command a user can run to verify their overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayVerifyStep {
    pub label: String,
    pub display_command: String,
    pub note: Option<String>,
}

/// Read-only verification steps for a given provider.
///
/// For Tailscale, uses the discovered binary path so commands work even if
/// the CLI is not on PATH (e.g. macOS GUI app install).
/// These steps are display-only — the app does not execute them.
pub fn overlay_verify_steps(provider: &OverlayProvider, peer_address: &str) -> Vec<OverlayVerifyStep> {
    match provider {
        OverlayProvider::Tailscale | OverlayProvider::Headscale => {
            let ts = find_tailscale_binary().unwrap_or_else(|| "tailscale".to_string());
            let path_note = if ts == "tailscale" {
                None
            } else {
                Some(format!(
                    "Using full path because Tailscale is not on PATH. \
                     To use short commands, run: {TAILSCALE_MACOS_ADD_TO_PATH_CMD}"
                ))
            };
            vec![
                OverlayVerifyStep {
                    label: "Check Tailscale status".to_string(),
                    display_command: format!("{ts} status"),
                    note: Some("Shows all connected devices and their addresses. Both machines must appear.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Show this device's overlay IP".to_string(),
                    display_command: format!("{ts} ip -4"),
                    note: Some("This is your local_address — give it to your peer for their connection bundle.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Show this device's MagicDNS hostname".to_string(),
                    display_command: format!("{ts} status --json\n# Look for \"DNSName\" in the \"Self\" block, e.g. \"my-mac.tailnet-name.ts.net\""),
                    note: Some("MagicDNS hostname is more stable than an IP — use it in the bundle if available.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Ping the peer".to_string(),
                    display_command: format!("ping {peer_address}"),
                    note: Some("Confirm the peer is reachable on the overlay before running SFTP.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Test SFTP port reachability".to_string(),
                    display_command: format!("# Use the app's Probe Overlay/TCP button to test {peer_address}:22\n# This is cross-platform and does not require nc/netcat."),
                    note: path_note,
                },
            ]
        }
        OverlayProvider::WireGuard => {
            vec![
                OverlayVerifyStep {
                    label: "Show WireGuard interfaces".to_string(),
                    display_command: "sudo wg show".to_string(),
                    note: Some("Lists interfaces, peers, and last-handshake times. Root required on Linux.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Ping the peer tunnel IP".to_string(),
                    display_command: format!("ping {peer_address}"),
                    note: Some("The peer's WireGuard tunnel IP, not their LAN IP.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Test SFTP port reachability".to_string(),
                    display_command: format!("# Use the app's Probe Overlay/TCP button to test {peer_address}:22"),
                    note: None,
                },
            ]
        }
        OverlayProvider::CustomReachableAddress => {
            vec![
                OverlayVerifyStep {
                    label: "Ping the peer address".to_string(),
                    display_command: format!("ping {peer_address}"),
                    note: Some("Confirm the address is reachable.".to_string()),
                },
                OverlayVerifyStep {
                    label: "Test SFTP port (TCP only — not SSH auth)".to_string(),
                    display_command: format!("# Use the app's Probe Overlay/TCP button to test {peer_address}:22"),
                    note: Some("TCP connect only — does not verify SSH authentication.".to_string()),
                },
            ]
        }
        OverlayProvider::NotConfigured => vec![],
    }
}

/// Guided setup steps for Tailscale — cross-platform, single guide.
///
/// Does not branch on compile-time OS because the app may be run on any
/// platform and the user needs guidance for their actual machine, not the
/// build host. All auth steps are marked manual.
pub fn tailscale_setup_guide() -> Vec<OverlayVerifyStep> {
    let bin = find_tailscale_binary();
    let ts = bin.as_deref().unwrap_or("tailscale");
    let already_installed = bin.is_some();

    let mut steps = vec![];

    // ── Step 1: Download / install reference (always shown) ───────────────────
    // Shown even when already installed so users know where to get it on the
    // peer's machine and as a cross-platform reference.
    steps.push(OverlayVerifyStep {
        label: if already_installed {
            "Tailscale detected — install on the peer's machine if needed".to_string()
        } else {
            "Install Tailscale on this machine (and the peer's)".to_string()
        },
        display_command:
            "# Official download page (all platforms):\n\
             #   https://tailscale.com/download\n\
             #\n\
             # macOS:        Download the GUI app. Use the app's 'Install CLI'\n\
             #               option (Preferences) to get the CLI on PATH.\n\
             #               Advanced: sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale\n\
             #               Note: `brew install tailscale` installs a headless daemon,\n\
             #               not the GUI app — use it only if you want the background service.\n\
             # Windows:      Install Tailscale for Windows. Reopen your terminal after install.\n\
             #               If `tailscale` is not found, add the install directory to PATH\n\
             #               or use the full path (see Tailscale docs).\n\
             # Linux:        curl -fsSL https://tailscale.com/install.sh | sh\n\
             #               The installer adds `tailscale` to PATH automatically.\n\
             # Raspberry Pi: Use the Linux installer — ARM packages are included."
                .to_string(),
        note: Some(
            if already_installed {
                "Each user installs on their own device independently.".to_string()
            } else {
                "Install on both machines. This app does not run the installer. Each user installs on their own device.".to_string()
            }
        ),
    });

    // ── Step 2: Sign in (manual — never automated) ───────────────────────────
    steps.push(OverlayVerifyStep {
        label: if already_installed { "Sign in to Tailscale on this machine (if not already)".to_string() }
               else { "Sign in to Tailscale after installing".to_string() },
        display_command:
            "# macOS:   Click the Tailscale menu bar icon → 'Log in...' → browser opens.\n\
             # Windows: Click the Tailscale tray icon → 'Log in...' → browser opens.\n\
             # Linux:   Run in a terminal (the app never runs this automatically):\n\
             tailscale up\n\
             #\n\
             # Each user signs in to their own Tailscale account.\n\
             # A shared account is NOT required.\n\
             # To connect two separate users, the Storage Host shares their device\n\
             # or sends a tailnet invite — see: https://tailscale.com/kb/1084/sharing"
                .to_string(),
        note: Some("The app never opens auth flows automatically. Interactive auth must be completed by you.".to_string()),
    });

    // ── Step 3: Make CLI accessible (if not on PATH) ──────────────────────────
    if bin.as_deref() != Some("tailscale") {
        let note_text = if already_installed {
            format!("Tailscale found at '{ts}' but not on PATH. Run one of the options above, then open a new terminal.")
        } else {
            "After installing and signing in, make the CLI accessible so the app can read status.".to_string()
        };
        steps.push(OverlayVerifyStep {
            label: "Make Tailscale CLI accessible on PATH".to_string(),
            display_command:
                "# macOS option A (recommended): menu bar → Preferences → 'Install CLI'\n\
                 # macOS option B (symlink):\n\
                 sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale\n\
                 # Windows: add the Tailscale install directory to your PATH environment variable\n\
                 #          (System Settings → Environment Variables → Path → Add)\n\
                 # Linux/Pi: the installer handles PATH — restart your terminal if needed\n\
                 #\n\
                 # Verify: open a new terminal and run:  tailscale version"
                    .to_string(),
            note: Some(note_text),
        });
    }

    // ── Step 4: Verify both devices are reachable ─────────────────────────────
    steps.push(OverlayVerifyStep {
        label: "Confirm this device is connected and get its overlay address".to_string(),
        display_command: format!(
            "{ts} status           # shows connected peers and addresses\n\
             {ts} ip -4             # this device's Tailscale IPv4\n\
             {ts} status --json\n\
             # Look for \"DNSName\" in the \"Self\" block — e.g. \"my-mac.tailnet-name.ts.net\""
        ),
        note: Some("Both devices must be reachable to each other — via sharing, invite, or a shared tailnet. A shared account is not required.".to_string()),
    });

    // ── Step 5: Verify connectivity to peer ──────────────────────────────────
    steps.push(OverlayVerifyStep {
        label: "Confirm overlay connectivity to your peer".to_string(),
        display_command: "ping <peer-tailscale-hostname-or-ip>".to_string(),
        note: Some("Replace with the Storage Host's MagicDNS hostname or IP. Must succeed before configuring SFTP.".to_string()),
    });

    steps
}

/// Guided setup steps for WireGuard (manual / advanced).
pub fn wireguard_setup_guide() -> Vec<OverlayVerifyStep> {
    vec![
        OverlayVerifyStep {
            label: "Install WireGuard".to_string(),
            display_command:
                "# macOS: brew install wireguard-tools\n\
                 # Linux (Debian/Ubuntu): sudo apt install wireguard\n\
                 # Linux (Fedora): sudo dnf install wireguard-tools"
                    .to_string(),
            note: None,
        },
        OverlayVerifyStep {
            label: "Generate keypair on this machine (PRIVATE KEY — LOCAL ONLY)".to_string(),
            display_command:
                "wg genkey | tee /tmp/wg-privatekey | wg pubkey > /tmp/wg-publickey\n\
                 # Move private key to a secure location — NEVER share it\n\
                 # cat /tmp/wg-publickey   # share this with your peer"
                    .to_string(),
            note: Some(
                "Private key stays local. Exchange only public keys with your peer out-of-band. \
                 Delete /tmp/wg-privatekey immediately after copying to your WireGuard config."
                    .to_string(),
            ),
        },
        OverlayVerifyStep {
            label: "Create WireGuard interface config".to_string(),
            display_command:
                "# /etc/wireguard/wg0.conf (example)\n\
                 [Interface]\n\
                 Address = 10.99.0.1/24\n\
                 PrivateKey = <your-private-key>\n\
                 ListenPort = 51820\n\n\
                 [Peer]\n\
                 PublicKey = <peer-public-key>\n\
                 AllowedIPs = 10.99.0.2/32\n\
                 Endpoint = <peer-public-ip>:51820\n\
                 PersistentKeepalive = 25"
                    .to_string(),
            note: Some("Both machines need a matching config. AllowedIPs must include the peer's tunnel IP. PersistentKeepalive=25 helps behind NAT.".to_string()),
        },
        OverlayVerifyStep {
            label: "Bring up the WireGuard interface".to_string(),
            display_command: "sudo wg-quick up wg0".to_string(),
            note: Some("Run on both machines.".to_string()),
        },
        OverlayVerifyStep {
            label: "Verify tunnel connectivity".to_string(),
            display_command: "sudo wg show\nping 10.99.0.2".to_string(),
            note: Some("Replace 10.99.0.2 with your peer's tunnel IP. Confirm handshake and reachability before configuring SFTP.".to_string()),
        },
    ]
}

/// Guided setup steps for Headscale (self-hosted Tailscale control server).
pub fn headscale_setup_guide(server_url: Option<&str>) -> Vec<OverlayVerifyStep> {
    let url = server_url.unwrap_or("<your-headscale-server>");
    let ts = find_tailscale_binary().unwrap_or_else(|| "tailscale".to_string());
    vec![
        OverlayVerifyStep {
            label: "Ensure Headscale server is running".to_string(),
            display_command: format!(
                "# Headscale control server: {url}\n\
                 # Both machines must join this Headscale network.\n\
                 # See https://headscale.net for server setup."
            ),
            note: Some("Headscale is a self-hosted Tailscale-compatible control server. You must operate it yourself.".to_string()),
        },
        OverlayVerifyStep {
            label: "Install Tailscale client".to_string(),
            display_command:
                "# macOS GUI app (recommended): https://tailscale.com/download/mac\n\
                 # Linux: curl -fsSL https://tailscale.com/install.sh | sh\n\
                 # Note: on macOS you can also use `brew install tailscale` for the headless version."
                    .to_string(),
            note: Some("Install on both machines. The Tailscale client works with Headscale as the control server.".to_string()),
        },
        OverlayVerifyStep {
            label: "Connect to Headscale control server (run manually)".to_string(),
            display_command: format!("{ts} up --login-server {url}\n# Opens browser auth — run yourself. Repeat on the peer machine."),
            note: Some("The app never runs this command automatically. Both peers must use the same Headscale server.".to_string()),
        },
        OverlayVerifyStep {
            label: "Verify both devices are registered".to_string(),
            display_command: format!("{ts} status\n# Both machines should appear with Headscale-assigned addresses."),
            note: Some("Run on each machine.".to_string()),
        },
        OverlayVerifyStep {
            label: "Get this device's overlay address".to_string(),
            display_command: format!("{ts} ip -4"),
            note: Some("Give this address to your peer for the owner connection bundle.".to_string()),
        },
    ]
}

// ── Tailscale Funnel support ──────────────────────────────────────────────────

const FUNNEL_TCP_PUBLIC_PORT: u16 = 443;

/// Current Tailscale Funnel state for this machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelStatus {
    /// True if a TCP funnel rule is active on port 443.
    pub enabled: bool,
    /// The machine's MagicDNS hostname (e.g. `my-mac.tailnet.ts.net`).
    pub public_hostname: Option<String>,
    /// The local port being forwarded through the funnel.
    pub local_port: Option<u16>,
    /// The public port (always 443 for TCP funnel in this app).
    pub public_port: u16,
    /// Tailnet has not activated Funnel — user must visit activation_url.
    pub needs_activation: bool,
    /// URL to visit to activate Funnel for this tailnet.
    pub activation_url: Option<String>,
    pub message: String,
}

/// Result of enabling Tailscale Funnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelEnableResult {
    pub success: bool,
    pub needs_activation: bool,
    pub activation_url: Option<String>,
    pub public_hostname: Option<String>,
    pub message: String,
}

/// Result of disabling Tailscale Funnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelDisableResult {
    pub success: bool,
    pub message: String,
}

/// Run a Tailscale CLI command with a hard timeout.
///
/// Spawns the process in a thread and waits on a channel with `timeout_secs`.
/// Returns the combined stdout+stderr on success, or a timeout/spawn error string.
/// The spawned process is orphaned on timeout (acceptable for short CLI commands).
fn run_tailscale_cmd(bin: &str, args: Vec<String>, timeout_secs: u64) -> Result<(String, bool), String> {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    let bin_owned = bin.to_string();
    let (tx, rx) = mpsc::channel::<std::io::Result<std::process::Output>>();

    thread::spawn(move || {
        let result = std::process::Command::new(&bin_owned)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(Ok(out)) => {
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            Ok((text, out.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run tailscale: {e}")),
        Err(_) => Err(format!(
            "TIMEOUT: Tailscale CLI did not respond within {timeout_secs}s — \
             the daemon may be unavailable or this CLI version may not support \
             background funnel. Try running the command manually in a terminal."
        )),
    }
}

/// Query the current Tailscale Funnel status by running `tailscale funnel status`.
pub fn get_funnel_status() -> FunnelStatus {
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => return FunnelStatus {
            enabled: false, public_hostname: None, local_port: None,
            public_port: FUNNEL_TCP_PUBLIC_PORT, needs_activation: false,
            activation_url: None,
            message: "Tailscale CLI not found — install Tailscale first.".to_string(),
        },
    };
    match run_tailscale_cmd(&bin, vec!["funnel".into(), "status".into()], 4) {
        Err(e) => FunnelStatus {
            enabled: false, public_hostname: None, local_port: None,
            public_port: FUNNEL_TCP_PUBLIC_PORT, needs_activation: false,
            activation_url: None,
            message: e,
        },
        Ok((text, _)) => parse_funnel_status_output(&text),
    }
}

/// Enable Tailscale Funnel for TCP on port 443, forwarding to `local_port`.
///
/// Runs: `tailscale funnel --bg --tcp=443 localhost:<local_port>`
///
/// Must only be called from an explicit, confirmed user action.
/// No auth keys, ACLs, or other mutation flags are passed.
pub fn enable_funnel(local_port: u16) -> FunnelEnableResult {
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => return FunnelEnableResult {
            success: false, needs_activation: false, activation_url: None,
            public_hostname: None,
            message: "Tailscale CLI not found — install Tailscale first.".to_string(),
        },
    };
    let local_target = format!("localhost:{local_port}");
    let args = vec![
        "funnel".to_string(),
        "--bg".to_string(),
        "--tcp=443".to_string(),
        local_target,
    ];
    match run_tailscale_cmd(&bin, args, 15) {
        Err(e) => FunnelEnableResult {
            success: false, needs_activation: false, activation_url: None,
            public_hostname: None,
            message: e,
        },
        Ok((text, exit_ok)) => parse_funnel_enable_output(&text, exit_ok),
    }
}

/// Disable Tailscale Funnel by running `tailscale funnel reset`.
///
/// Must only be called from an explicit, confirmed user action.
pub fn disable_funnel() -> FunnelDisableResult {
    let bin = match find_tailscale_binary() {
        Some(b) => b,
        None => return FunnelDisableResult {
            success: false,
            message: "Tailscale CLI not found — install Tailscale first.".to_string(),
        },
    };
    match run_tailscale_cmd(&bin, vec!["funnel".into(), "reset".into()], 15) {
        Err(e) => FunnelDisableResult { success: false, message: e },
        Ok((_, true)) => FunnelDisableResult {
            success: true,
            message: "Funnel disabled — SFTP is no longer publicly accessible via Funnel.".to_string(),
        },
        Ok((_, false)) => FunnelDisableResult {
            success: false,
            message: "tailscale funnel reset failed — check Tailscale status.".to_string(),
        },
    }
}

/// Parse output from `tailscale funnel status`. Exported for unit tests.
pub fn parse_funnel_status_output(text: &str) -> FunnelStatus {
    let needs_activation = funnel_text_needs_activation(text);
    if needs_activation {
        return FunnelStatus {
            enabled: false, public_hostname: None, local_port: None,
            public_port: FUNNEL_TCP_PUBLIC_PORT, needs_activation: true,
            activation_url: extract_funnel_activation_url(text),
            message: "Tailscale Funnel is not enabled for your tailnet. Visit the activation URL to enable it.".to_string(),
        };
    }
    let local_port = extract_tcp_local_port(text);
    let public_hostname = extract_funnel_hostname(text);
    let enabled = local_port.is_some();
    FunnelStatus {
        enabled,
        public_hostname,
        local_port,
        public_port: FUNNEL_TCP_PUBLIC_PORT,
        needs_activation: false,
        activation_url: None,
        message: if enabled {
            format!("Funnel active: TCP port {} is publicly accessible.", FUNNEL_TCP_PUBLIC_PORT)
        } else {
            "No Funnel configured.".to_string()
        },
    }
}

/// Parse output from `tailscale funnel --bg --tcp=443 ...`. Exported for unit tests.
pub fn parse_funnel_enable_output(text: &str, exit_ok: bool) -> FunnelEnableResult {
    let needs_activation = funnel_text_needs_activation(text);
    if needs_activation {
        return FunnelEnableResult {
            success: false, needs_activation: true,
            activation_url: extract_funnel_activation_url(text),
            public_hostname: None,
            message: "Tailscale Funnel is not enabled for your tailnet. Visit the activation URL to enable it, then try again.".to_string(),
        };
    }
    if !exit_ok {
        return FunnelEnableResult {
            success: false, needs_activation: false, activation_url: None,
            public_hostname: None,
            message: "tailscale funnel command failed — check that Tailscale is running and you are signed in.".to_string(),
        };
    }
    FunnelEnableResult {
        success: true, needs_activation: false, activation_url: None,
        public_hostname: extract_funnel_hostname(text),
        message: format!(
            "Funnel enabled — TCP port {} is now publicly accessible. \
             Set NASBB_SFTP_PUBLIC_PORT={} in your host env to embed this port in invite bundles.",
            FUNNEL_TCP_PUBLIC_PORT, FUNNEL_TCP_PUBLIC_PORT
        ),
    }
}

fn funnel_text_needs_activation(text: &str) -> bool {
    text.contains("funnel is disabled")
        || text.contains("Funnel not enabled")
        || text.contains("funnel not enabled")
        || text.contains("Funnel not available")
}

fn extract_funnel_activation_url(text: &str) -> Option<String> {
    text.lines()
        .find(|l| l.trim().starts_with("https://login.tailscale.com"))
        .map(|l| l.trim().to_string())
}

fn extract_tcp_local_port(text: &str) -> Option<u16> {
    for line in text.lines() {
        let t = line.trim();
        if t.contains("tcp://localhost:") || t.contains("tcp://127.0.0.1:") {
            let colon_pos = t.rfind(':')?;
            let port_str = t[colon_pos + 1..].split_whitespace().next()?;
            return port_str.parse::<u16>().ok();
        }
    }
    None
}

fn extract_funnel_hostname(text: &str) -> Option<String> {
    for line in text.lines() {
        let t = line.trim();
        // Match "my-machine.tailnet.ts.net:443" or "my-machine.tailnet.ts.net:443 (tailnet+internet)"
        if (t.ends_with(".ts.net:443") || t.contains(".ts.net:443 ")) && !t.starts_with('#') {
            return t.splitn(2, ':').next().map(|s| s.to_string());
        }
        // Match plain hostname in "Available on the internet:" block
        if t.ends_with(".ts.net") && !t.starts_with('#') && !t.starts_with('|') && !t.contains(' ') {
            return Some(t.to_string());
        }
    }
    None
}

// ── Compatibility matrix ──────────────────────────────────────────────────────

/// A single row in the overlay compatibility matrix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityEntry {
    pub machine_a: String,
    pub machine_b: String,
    pub compatible: bool,
    pub note: String,
}

/// Returns the overlay compatibility matrix as structured data.
pub fn compatibility_matrix() -> Vec<CompatibilityEntry> {
    vec![
        // ── Tailscale ─────────────────────────────────────────────────────────
        CompatibilityEntry {
            machine_a: "Tailscale".to_string(),
            machine_b: "Tailscale (shared/invited/reachable)".to_string(),
            compatible: true,
            note: "Works if both devices can reach each other — via device sharing, tailnet invite, or a shared tailnet. A shared Tailscale account is not required.".to_string(),
        },
        CompatibilityEntry {
            machine_a: "Tailscale client".to_string(),
            machine_b: "Headscale (joined to same server)".to_string(),
            compatible: true,
            note: "Only works when the Tailscale client is explicitly joined to that Headscale control server (tailscale up --login-server <url>), not when it is on a separate Tailscale tailnet.".to_string(),
        },
        CompatibilityEntry {
            machine_a: "Tailscale tailnet".to_string(),
            machine_b: "Separate Headscale network".to_string(),
            compatible: false,
            note: "A standard Tailscale tailnet cannot reach a separate Headscale network automatically. Routing between them requires explicit bridging.".to_string(),
        },
        // ── Headscale ─────────────────────────────────────────────────────────
        CompatibilityEntry {
            machine_a: "Headscale".to_string(),
            machine_b: "Headscale (same server)".to_string(),
            compatible: true,
            note: "Works when both devices are joined to the same self-hosted Headscale server.".to_string(),
        },
        // ── WireGuard ─────────────────────────────────────────────────────────
        CompatibilityEntry {
            machine_a: "WireGuard".to_string(),
            machine_b: "WireGuard (matching tunnel)".to_string(),
            compatible: true,
            note: "Both users must configure matching WireGuard configs with each other as a peer. Works when the tunnel is up on both sides.".to_string(),
        },
        CompatibilityEntry {
            machine_a: "Tailscale".to_string(),
            machine_b: "Plain WireGuard".to_string(),
            compatible: false,
            note: "Not interoperable unless manually routed or bridged. Use the same technology on both sides.".to_string(),
        },
        // ── Custom ────────────────────────────────────────────────────────────
        CompatibilityEntry {
            machine_a: "Custom address".to_string(),
            machine_b: "Any".to_string(),
            compatible: true,
            note: "Works only if the address is intentionally reachable and on a secured private path. The app verifies TCP reachability only.".to_string(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Provider display ──────────────────────────────────────────────────────

    #[test]
    fn provider_display_names_are_human_readable() {
        assert_eq!(OverlayProvider::Tailscale.to_string(), "Tailscale");
        assert_eq!(OverlayProvider::WireGuard.to_string(), "WireGuard");
        assert_eq!(OverlayProvider::NotConfigured.to_string(), "Not configured");
    }

    // ── looks_private_or_overlay ─────────────────────────────────────────────

    #[test]
    fn tailscale_cgnat_is_private() {
        assert!(looks_private_or_overlay("100.64.0.1"));
        assert!(looks_private_or_overlay("100.127.255.254"));
    }

    #[test]
    fn rfc1918_is_private() {
        assert!(looks_private_or_overlay("10.0.0.1"));
        assert!(looks_private_or_overlay("192.168.1.100"));
        assert!(looks_private_or_overlay("172.16.0.50"));
    }

    #[test]
    fn tailscale_magic_dns_is_private() {
        assert!(looks_private_or_overlay("my-machine.tail1234.ts.net"));
    }

    #[test]
    fn public_ip_is_not_private() {
        assert!(!looks_private_or_overlay("8.8.8.8"));
        assert!(!looks_private_or_overlay("203.0.113.5"));
        assert!(!looks_private_or_overlay("1.2.3.4"));
    }

    // ── validate_overlay_config ───────────────────────────────────────────────

    #[test]
    fn valid_tailscale_config_passes() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Tailscale,
            mode: OverlayMode::UseExisting,
            local_address: "100.64.0.1".to_string(),
            peer_address: "100.64.0.2".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(validate_overlay_config(&cfg).is_ok());
    }

    #[test]
    fn rejects_loopback_peer_address() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Tailscale,
            mode: OverlayMode::UseExisting,
            local_address: "100.64.0.1".to_string(),
            peer_address: "127.0.0.1".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(matches!(
            validate_overlay_config(&cfg),
            Err(OverlayError::LoopbackAddressRejected)
        ));
    }

    #[test]
    fn rejects_empty_peer_address() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Tailscale,
            mode: OverlayMode::UseExisting,
            local_address: "".to_string(),
            peer_address: "".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(matches!(
            validate_overlay_config(&cfg),
            Err(OverlayError::MissingPeerAddress)
        ));
    }

    #[test]
    fn headscale_requires_server_url() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Headscale,
            mode: OverlayMode::UseExisting,
            local_address: "100.64.0.1".to_string(),
            peer_address: "100.64.0.2".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(matches!(
            validate_overlay_config(&cfg),
            Err(OverlayError::MissingHeadscaleServerUrl)
        ));
    }

    #[test]
    fn headscale_with_url_passes() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Headscale,
            mode: OverlayMode::UseExisting,
            local_address: "100.64.0.1".to_string(),
            peer_address: "100.64.0.2".to_string(),
            headscale_server_url: Some("https://hs.example.com".to_string()),
            notes: None,
        };
        assert!(validate_overlay_config(&cfg).is_ok());
    }

    #[test]
    fn headscale_invalid_url_rejected() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::Headscale,
            mode: OverlayMode::UseExisting,
            local_address: "100.64.0.1".to_string(),
            peer_address: "100.64.0.2".to_string(),
            headscale_server_url: Some("ftp://hs.example.com".to_string()),
            notes: None,
        };
        assert!(matches!(
            validate_overlay_config(&cfg),
            Err(OverlayError::InvalidHeadscaleServerUrl)
        ));
    }

    #[test]
    fn custom_address_public_ip_rejected() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::CustomReachableAddress,
            mode: OverlayMode::UseExisting,
            local_address: "".to_string(),
            peer_address: "1.2.3.4".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(matches!(
            validate_overlay_config(&cfg),
            Err(OverlayError::CustomAddressLooksPublic(_))
        ));
    }

    #[test]
    fn custom_address_private_ip_passes() {
        let cfg = OverlayConfig {
            provider: OverlayProvider::CustomReachableAddress,
            mode: OverlayMode::UseExisting,
            local_address: "".to_string(),
            peer_address: "192.168.1.50".to_string(),
            headscale_server_url: None,
            notes: None,
        };
        assert!(validate_overlay_config(&cfg).is_ok());
    }

    // ── parse_tailscale_ipv4 ──────────────────────────────────────────────────

    #[test]
    fn parse_tailscale_ipv4_single_address() {
        let out = "100.64.0.1\n";
        assert_eq!(parse_tailscale_ipv4(out), vec!["100.64.0.1"]);
    }

    #[test]
    fn parse_tailscale_ipv4_ignores_blank_lines() {
        let out = "\n100.64.0.5\n\n";
        assert_eq!(parse_tailscale_ipv4(out), vec!["100.64.0.5"]);
    }

    #[test]
    fn parse_tailscale_ipv4_empty_returns_empty() {
        assert!(parse_tailscale_ipv4("").is_empty());
    }

    // ── parse_tailscale_status_json ───────────────────────────────────────────

    #[test]
    fn parse_tailscale_status_json_finds_self_addr() {
        let json = r#"{
  "Self": {
    "ID": "nodeabc",
    "HostName": "my-machine",
    "TailAddr": "100.64.1.10",
    "OS": "linux"
  }
}"#;
        let addrs = parse_tailscale_status_json(json);
        assert_eq!(addrs, vec!["100.64.1.10"]);
    }

    #[test]
    fn parse_tailscale_status_json_empty_returns_empty() {
        assert!(parse_tailscale_status_json("{}").is_empty());
        assert!(parse_tailscale_status_json("").is_empty());
    }

    // ── parse_wg_show ─────────────────────────────────────────────────────────

    #[test]
    fn parse_wg_show_finds_address() {
        let out = "interface: wg0\n  address: 10.99.0.1/24\n  public key: AABBCCDD\n";
        let addrs = parse_wg_show(out);
        assert!(addrs.contains(&"10.99.0.1".to_string()));
    }

    #[test]
    fn parse_wg_show_strips_cidr() {
        let out = "  address: 10.0.0.1/30\n";
        let addrs = parse_wg_show(out);
        assert_eq!(addrs, vec!["10.0.0.1"]);
    }

    #[test]
    fn parse_wg_show_empty_returns_empty() {
        assert!(parse_wg_show("").is_empty());
    }

    // ── overlay_verify_steps ──────────────────────────────────────────────────

    #[test]
    fn tailscale_verify_steps_do_not_contain_auth_commands() {
        let steps = overlay_verify_steps(&OverlayProvider::Tailscale, "100.64.0.2");
        for step in &steps {
            assert!(
                !step.display_command.contains("tailscale up"),
                "Verify steps must not include auth/login commands: {}",
                step.display_command
            );
            assert!(
                !step.display_command.contains("tailscale login"),
                "Verify steps must not include login commands: {}",
                step.display_command
            );
        }
    }

    #[test]
    fn wireguard_verify_steps_do_not_generate_keys() {
        let steps = overlay_verify_steps(&OverlayProvider::WireGuard, "10.99.0.2");
        for step in &steps {
            assert!(
                !step.display_command.contains("genkey"),
                "Verify steps must not include key generation: {}",
                step.display_command
            );
        }
    }

    #[test]
    fn tailscale_setup_guide_marks_login_as_manual() {
        let guide = tailscale_setup_guide();
        // The sign-in step must exist. On macOS it uses the menu bar flow (no
        // `tailscale up`); on Linux it shows `tailscale up`. Either way the
        // step must make clear that the app never runs the auth command itself.
        let signin_step = guide.iter().find(|s| {
            let cmd = &s.display_command;
            let label = &s.label;
            cmd.contains("tailscale up")
                || cmd.contains("Log in")
                || cmd.contains("menu bar")
                || label.to_lowercase().contains("sign in")
                || label.to_lowercase().contains("log in")
        });
        assert!(signin_step.is_some(), "Setup guide must include a sign-in step");

        // The step must communicate that the app never automates auth.
        let cmd = &signin_step.unwrap().display_command;
        let note = signin_step.unwrap().note.as_deref().unwrap_or("");
        let combined = format!("{cmd} {note}");
        assert!(
            combined.contains("never") || combined.contains("yourself") || combined.contains("manually")
                || combined.contains("app") || combined.contains("automatically"),
            "Sign-in step must clarify the app does not run it automatically:\ncmd={cmd}\nnote={note}"
        );
    }

    #[test]
    fn wireguard_setup_guide_warns_about_private_key() {
        let guide = wireguard_setup_guide();
        let keygen_step = guide.iter().find(|s| s.display_command.contains("genkey"));
        assert!(keygen_step.is_some());
        let note = keygen_step.unwrap().note.as_deref().unwrap_or("");
        assert!(
            note.contains("private") || note.contains("NEVER"),
            "WireGuard keygen step must warn about private key: {note}"
        );
    }

    #[test]
    fn compatibility_matrix_has_tailscale_entry() {
        let matrix = compatibility_matrix();
        assert!(!matrix.is_empty());
        let ts = matrix.iter().find(|e| e.machine_a.contains("Tailscale") && e.compatible);
        assert!(ts.is_some());
    }

    #[test]
    fn tailscale_wireguard_incompatibility_is_documented() {
        let matrix = compatibility_matrix();
        let entry = matrix.iter().find(|e| {
            e.machine_a.contains("Tailscale") && e.machine_b.contains("WireGuard")
        });
        assert!(entry.is_some());
        assert!(!entry.unwrap().compatible);
    }

    // ── Cross-user product model requirements ─────────────────────────────────

    #[test]
    fn tailscale_setup_guide_does_not_require_same_account() {
        let guide = tailscale_setup_guide();
        let all_text: String = guide.iter()
            .flat_map(|s| [s.display_command.as_str(), s.note.as_deref().unwrap_or("")])
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            !all_text.contains("same account"),
            "Setup guide must not require a shared account: {all_text}"
        );
        assert!(
            !all_text.contains("same tailnet"),
            "Setup guide must not require a shared tailnet (use sharing/invite wording): {all_text}"
        );
    }

    #[test]
    fn setup_guide_never_auto_runs_auth_commands() {
        for guide in [tailscale_setup_guide()] {
            for step in &guide {
                // These commands must only appear in display_command for the user to run manually,
                // never as something the app would run. The note must clarify this.
                let is_auth_step = step.display_command.contains("tailscale up")
                    || step.display_command.contains("tailscale login");
                if is_auth_step {
                    let note = step.note.as_deref().unwrap_or("");
                    let combined = format!("{} {note}", step.display_command);
                    assert!(
                        combined.contains("never") || combined.contains("yourself")
                            || combined.contains("manually") || combined.contains("automatically"),
                        "Auth step must state the app does not run it: cmd={}", step.display_command
                    );
                }
                // No step should silently embed an auth token or key
                assert!(
                    !step.display_command.contains("authkey"),
                    "Setup guide must not include auth keys: {}", step.display_command
                );
            }
        }
    }

    #[test]
    fn compatibility_matrix_does_not_require_same_account() {
        let matrix = compatibility_matrix();
        for entry in &matrix {
            assert!(
                !entry.note.contains("same account"),
                "Compatibility matrix must not require a shared account: {}", entry.note
            );
        }
        // Tailscale-to-Tailscale compatible entry should mention sharing/invite
        let ts_ts = matrix.iter().find(|e| {
            e.machine_a.contains("Tailscale")
                && e.machine_b.contains("Tailscale")
                && !e.machine_b.contains("WireGuard")
                && e.compatible
        });
        assert!(ts_ts.is_some(), "Must have a compatible Tailscale-to-Tailscale entry");
        let note = &ts_ts.unwrap().note;
        assert!(
            note.contains("shar") || note.contains("invite"),
            "Tailscale-Tailscale note must mention sharing or invite: {note}"
        );
    }

    #[test]
    fn compatibility_matrix_has_headscale_entry() {
        let matrix = compatibility_matrix();
        let entry = matrix.iter().find(|e| e.machine_b.contains("Headscale") && e.compatible);
        assert!(entry.is_some(), "Must have a compatible Headscale entry");
    }

    #[test]
    fn tailscale_to_separate_headscale_is_not_compatible() {
        let matrix = compatibility_matrix();
        // A standard Tailscale tailnet cannot reach a separate Headscale network.
        let entry = matrix.iter().find(|e| {
            e.machine_a.to_lowercase().contains("tailscale tailnet")
                && e.machine_b.to_lowercase().contains("separate headscale")
        });
        assert!(entry.is_some(), "Matrix must document Tailscale-tailnet vs separate-Headscale incompatibility");
        assert!(!entry.unwrap().compatible, "Separate Tailscale and Headscale networks must be marked incompatible");
    }

    #[test]
    fn tailscale_client_joined_to_headscale_is_compatible() {
        let matrix = compatibility_matrix();
        // A Tailscale *client* explicitly joined to a Headscale server is compatible.
        let entry = matrix.iter().find(|e| {
            e.machine_a.to_lowercase().contains("tailscale client")
                && e.machine_b.to_lowercase().contains("headscale")
                && e.compatible
        });
        assert!(entry.is_some(), "Matrix must show Tailscale-client+Headscale as compatible when joined to same server");
        // The note must clarify this requires explicit joining, not just being on any Tailscale tailnet.
        let note = &entry.unwrap().note;
        assert!(
            note.contains("joined") || note.contains("login-server") || note.contains("explicitly"),
            "Note must clarify explicit Headscale join is required: {note}"
        );
    }

    #[test]
    fn headscale_to_headscale_same_server_is_compatible() {
        let matrix = compatibility_matrix();
        let entry = matrix.iter().find(|e| {
            e.machine_a.to_lowercase().contains("headscale")
                && e.machine_b.to_lowercase().contains("headscale")
                && e.compatible
        });
        assert!(entry.is_some(), "Matrix must have Headscale-to-Headscale compatible entry");
    }

    #[test]
    fn setup_guide_is_cross_platform() {
        let guide = tailscale_setup_guide();
        let all_cmds: String = guide.iter().map(|s| s.display_command.as_str()).collect::<Vec<_>>().join("\n");
        // Must reference official download page
        assert!(
            all_cmds.contains("tailscale.com/download"),
            "Setup guide must reference official download page: {all_cmds}"
        );
        // Must mention Linux install path
        assert!(
            all_cmds.contains("install.sh") || all_cmds.contains("Linux"),
            "Setup guide must mention Linux install: {all_cmds}"
        );
        // Must mention macOS GUI path
        assert!(
            all_cmds.contains("macOS") || all_cmds.contains("menu bar"),
            "Setup guide must mention macOS GUI path: {all_cmds}"
        );
        // Must mention Windows
        assert!(
            all_cmds.contains("Windows"),
            "Setup guide must mention Windows: {all_cmds}"
        );
    }

    // ── is_valid_peer_address ─────────────────────────────────────────────────

    #[test]
    fn valid_peer_hostname() {
        assert!(is_valid_peer_address("my-mac.tailnet.ts.net"));
    }

    #[test]
    fn valid_peer_ipv4() {
        assert!(is_valid_peer_address("100.64.0.1"));
    }

    #[test]
    fn valid_peer_ipv6_brackets() {
        assert!(is_valid_peer_address("[fd7a::1]"));
    }

    #[test]
    fn empty_peer_rejected() {
        assert!(!is_valid_peer_address(""));
    }

    #[test]
    fn peer_with_semicolon_rejected() {
        assert!(!is_valid_peer_address("host; rm -rf /"));
    }

    #[test]
    fn peer_with_pipe_rejected() {
        assert!(!is_valid_peer_address("host|badcmd"));
    }

    #[test]
    fn peer_with_backtick_rejected() {
        assert!(!is_valid_peer_address("host`id`"));
    }

    // ── parse_tailscale_ping_output ───────────────────────────────────────────

    #[test]
    fn pong_detected_as_reachable() {
        let stdout = "pong from my-mac.tailnet.ts.net (100.64.0.1) via DERP(nyc) in 34ms\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert!(r.reachable);
        assert!(r.latency_ms.is_some(), "should have latency");
    }

    #[test]
    fn pong_extracts_latency_ms() {
        let stdout = "pong from peer (100.64.0.1) via 100.64.0.2:41641 in 12ms\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert_eq!(r.latency_ms, Some(12));
    }

    #[test]
    fn pong_extracts_derp_via() {
        let stdout = "pong from peer (100.64.0.1) via DERP(sao) in 45ms\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert_eq!(r.via.as_deref(), Some("DERP(sao)"));
    }

    #[test]
    fn pong_extracts_direct_via() {
        let stdout = "pong from peer (100.64.0.1) via 100.64.0.2:41641 in 12ms\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert_eq!(r.via.as_deref(), Some("100.64.0.2:41641"));
    }

    #[test]
    fn timeout_is_not_reachable() {
        let stdout = "timeout waiting for pong from 100.64.0.1\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert!(!r.reachable);
        assert!(r.message.contains("timeout") || r.message.contains("timed out") || r.message.contains("reply"), "message: {}", r.message);
    }

    #[test]
    fn no_connection_is_not_reachable() {
        let stdout = "no tailscale connection to unknown-host\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert!(!r.reachable);
    }

    #[test]
    fn ping_message_does_not_leak_peer_ip() {
        let stdout = "timeout waiting for pong from 100.99.88.77\n";
        let r = parse_tailscale_ping_output(stdout, "");
        assert!(!r.message.contains("100.99.88.77"), "message must not contain peer IP: {}", r.message);
    }

    // ── parse_tailscale_up_output ─────────────────────────────────────────────

    #[test]
    fn tailscale_ping_args_are_bounded() {
        let args = tailscale_ping_args("peer.example.com");
        // Must contain the count, timeout, and direct-path bounds
        assert!(args.iter().any(|a| a.contains("--c=")), "must bound ping count: {args:?}");
        assert!(args.iter().any(|a| a.contains("--timeout=")), "must bound timeout: {args:?}");
        assert!(args.iter().any(|a| a.contains("--until-direct")), "must set until-direct: {args:?}");
        // Peer is the last argument
        assert_eq!(args.last().map(|s| s.as_str()), Some("peer.example.com"));
    }

    #[test]
    fn tailscale_ping_args_contain_no_shell_metacharacters_for_valid_peer() {
        let args = tailscale_ping_args("my-mac.tailnet.ts.net");
        for arg in &args {
            assert!(!arg.contains(';'), "arg must not contain semicolon: {arg}");
            assert!(!arg.contains('|'), "arg must not contain pipe: {arg}");
            assert!(!arg.contains('&'), "arg must not contain ampersand: {arg}");
        }
    }

    #[test]
    fn empty_output_exit_ok_is_success() {
        let r = parse_tailscale_up_output("", true);
        assert!(r.success);
        assert!(!r.needs_auth);
    }

    #[test]
    fn empty_output_exit_fail_is_not_success() {
        // Regression: empty output with non-zero exit must NOT report success.
        let r = parse_tailscale_up_output("", false);
        assert!(!r.success, "empty output + non-zero exit must not be success");
        assert!(!r.needs_auth);
    }

    #[test]
    fn auth_url_in_output_means_needs_auth() {
        let output = "To authenticate, visit:\nhttps://login.tailscale.com/a/abcdef123\n";
        let r = parse_tailscale_up_output(output, false);
        assert!(!r.success);
        assert!(r.needs_auth);
        assert_eq!(r.auth_url.as_deref(), Some("https://login.tailscale.com/a/abcdef123"));
    }

    #[test]
    fn needs_login_keyword_means_needs_auth() {
        let r = parse_tailscale_up_output("NeedsLogin\n", false);
        assert!(r.needs_auth);
        assert!(!r.success);
    }

    #[test]
    fn success_keyword_is_success() {
        let r = parse_tailscale_up_output("Success.\n", true);
        assert!(r.success);
        assert!(!r.needs_auth);
    }

    #[test]
    fn non_zero_exit_without_auth_url_is_unclear() {
        let r = parse_tailscale_up_output("some unexpected error\n", false);
        assert!(!r.success);
        assert!(!r.needs_auth);
    }
}
