//! SFTP target verification — native SSH/SFTP via libssh2 (no external binary).
//!
//! ## What this module does
//!
//! Uses the `ssh2` crate (Rust bindings to libssh2) to verify:
//! 1. TCP reachability — overlay network is up and SFTP port is open.
//! 2. SSH handshake — remote host presents a valid SSH host key.
//! 3. Host key fingerprint — Trust On First Use (TOFU) against stored fingerprints.
//! 4. Authentication — SSH public key auth (file path or agent) succeeds.
//! 5. Remote path — exists and is accessible.
//! 6. Write test — create and remove `.nasbb-probe-verify` directory.
//! 7. Quota — statvfs extension gives free space on the target path.
//!
//! ## TOFU fingerprint storage
//!
//! On first connection to a host:port, the SHA-256 fingerprint is stored in
//! `known_fingerprints.json` in the provided app-data directory. Subsequent
//! connections compare the live fingerprint against the stored value.
//! A changed fingerprint blocks the connection and returns `HostKeyMismatch`.
//!
//! ## Secret handling
//!
//! No passwords are accepted. SSH key is referenced by filesystem path; the key
//! contents are loaded by libssh2 and never stored or logged by this module.
//! Host, username, and remote path never appear in returned `message` strings.
//!
//! ## Platform availability
//!
//! Requires `libssh2` to be available at link time:
//! - macOS: built-in (`/usr/lib/libssh2.dylib`) or Homebrew.
//! - Linux: `sudo apt install libssh2-1-dev` / `sudo yum install libssh2-devel`.
//! - Windows: available via the OpenSSH optional feature or Git for Windows.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use ssh2::{HashType, Session};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

// ── Public types ──────────────────────────────────────────────────────────────

/// Outcome of the SFTP target verification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpVerifyStatus {
    /// TCP port unreachable — overlay network or SFTP daemon not running.
    Unreachable,
    /// SSH authentication failed (wrong key, user not allowed, etc.).
    AuthFailed,
    /// SSH host key does not match the stored TOFU fingerprint.
    HostKeyMismatch,
    /// SFTP target reached and auth succeeded, but the path was not found.
    PathNotFound,
    /// SFTP target reached, auth ok, path found, but write test failed.
    WriteTestFailed,
    /// Auth, path, and write test passed; free space below warning threshold.
    QuotaWarning,
    /// Auth, path access, and write test all passed.
    Ok,
    /// Unexpected error prevented the check (I/O error, session failure, etc.).
    Error,
}

/// Status of the host key fingerprint comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FingerprintStatus {
    /// First time seeing this host — fingerprint saved for future comparisons.
    New,
    /// Fingerprint matches the previously stored value.
    Matching,
    /// Fingerprint differs from stored value — potential MITM, connection blocked.
    Changed,
    /// Fingerprint could not be retrieved from the session.
    NotAvailable,
}

/// Result of the SFTP target verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpVerifyResult {
    pub status: SftpVerifyStatus,
    /// Safe display message — no host, user, path, or key material.
    pub message: String,
    /// Whether the write test was attempted and succeeded.
    pub write_test_passed: bool,
    /// SHA-256 fingerprint of the server's host key in `SHA256:base64` format.
    /// `None` if the fingerprint could not be retrieved.
    pub host_fingerprint: Option<String>,
    /// TOFU fingerprint comparison result.
    pub fingerprint_status: FingerprintStatus,
    /// Free bytes on the remote path's filesystem (from statvfs). `None` if the
    /// server does not support the statvfs SFTP extension.
    pub free_bytes: Option<u64>,
    /// True if `free_bytes` is below 1 GiB — warn the user to check quota.
    pub quota_warning: bool,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Verify the SFTP target using native libssh2 — no external `sftp` binary needed.
///
/// `known_fingerprints_path`: path to the app-data JSON file used for TOFU
/// fingerprint storage. `None` means TOFU is disabled (fingerprint checked but
/// not stored; `New` is returned on every run instead of `Matching`).
pub fn verify_sftp_target(
    host: &str,
    port: u16,
    username: &str,
    remote_path: &str,
    key_path: Option<&str>,
    known_fingerprints_path: Option<&Path>,
) -> SftpVerifyResult {
    // Resolve host:port to a socket address with a short timeout.
    let addr_str = format!("{}:{}", host, port);
    let addr = match addr_str.to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => return err_result(SftpVerifyStatus::Unreachable,
            &format!("Could not resolve overlay host on port {port} — check overlay network")),
    };

    // ── Step 1: TCP connect ───────────────────────────────────────────────────
    let tcp = match TcpStream::connect_timeout(&addr, Duration::from_secs(10)) {
        Ok(t) => t,
        Err(_) => return err_result(SftpVerifyStatus::Unreachable,
            &format!("TCP connection timed out on port {port} — check overlay network and SFTP service")),
    };
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

    // ── Step 2: SSH handshake ─────────────────────────────────────────────────
    let mut session = match Session::new() {
        Ok(s) => s,
        Err(_) => return err_result(SftpVerifyStatus::Error, "Failed to create SSH session"),
    };
    session.set_tcp_stream(tcp);
    if let Err(e) = session.handshake() {
        return err_result(SftpVerifyStatus::Unreachable,
            &format!("SSH handshake failed — {} (check overlay network and SSH daemon on host)", e));
    }

    // ── Step 3: Fingerprint capture and TOFU check ────────────────────────────
    let fingerprint = session
        .host_key_hash(HashType::Sha256)
        .map(|bytes| format!("SHA256:{}", BASE64.encode(bytes)));

    let fingerprint_status = check_fingerprint_tofu(
        fingerprint.as_deref(), host, port, known_fingerprints_path,
    );

    if fingerprint_status == FingerprintStatus::Changed {
        return SftpVerifyResult {
            status: SftpVerifyStatus::HostKeyMismatch,
            message: "SSH host key has changed since the last verified connection. \
                      Verify the host identity out-of-band before proceeding. \
                      If the host was rebuilt, clear the stored fingerprint and reconnect."
                .to_string(),
            write_test_passed: false,
            host_fingerprint: fingerprint,
            fingerprint_status,
            free_bytes: None,
            quota_warning: false,
        };
    }

    // ── Step 4: Authentication ────────────────────────────────────────────────
    let auth_ok = try_authenticate(&session, username, key_path);
    if !auth_ok {
        return SftpVerifyResult {
            status: SftpVerifyStatus::AuthFailed,
            message: "SSH authentication failed — check SSH key configuration and that \
                      the public key is in the host's authorized_keys."
                .to_string(),
            write_test_passed: false,
            host_fingerprint: fingerprint,
            fingerprint_status,
            free_bytes: None,
            quota_warning: false,
        };
    }

    // ── Step 5: Open SFTP subsystem ───────────────────────────────────────────
    let sftp = match session.sftp() {
        Ok(s) => s,
        Err(_) => return SftpVerifyResult {
            status: SftpVerifyStatus::Error,
            message: "SFTP subsystem unavailable — the SSH server may not have SFTP enabled."
                .to_string(),
            write_test_passed: false,
            host_fingerprint: fingerprint,
            fingerprint_status,
            free_bytes: None,
            quota_warning: false,
        },
    };

    // ── Step 6: Verify remote path exists ────────────────────────────────────
    if sftp.stat(Path::new(remote_path)).is_err() {
        return SftpVerifyResult {
            status: SftpVerifyStatus::PathNotFound,
            message: "SFTP remote path not found — verify the path exists and the SFTP \
                      user has read access. (Path is not logged here.)"
                .to_string(),
            write_test_passed: false,
            host_fingerprint: fingerprint,
            fingerprint_status,
            free_bytes: None,
            quota_warning: false,
        };
    }

    // ── Step 7: Write test ────────────────────────────────────────────────────
    let probe_dir = format!("{}/.nasbb-probe-verify",
        remote_path.trim_end_matches('/'));
    let mkdir_ok = sftp.mkdir(Path::new(&probe_dir), 0o700).is_ok();
    let rmdir_ok = mkdir_ok && sftp.rmdir(Path::new(&probe_dir)).is_ok();
    let write_test_passed = mkdir_ok && rmdir_ok;

    // ── Step 8: Quota via statvfs ─────────────────────────────────────────────
    // `fstatvfs` operates on an open directory handle (ssh2::File), not on the
    // Sftp object directly. Opens the path as a directory, calls statvfs on the
    // handle, then drops it. Non-fatal if the server doesn't support the extension.
    let (free_bytes, quota_warning) = sftp_free_bytes(&sftp, remote_path);

    // ── Step 9: Save fingerprint on first use ─────────────────────────────────
    if fingerprint_status == FingerprintStatus::New {
        save_fingerprint_tofu(fingerprint.as_deref(), host, port, known_fingerprints_path);
    }

    if !write_test_passed {
        return SftpVerifyResult {
            status: SftpVerifyStatus::WriteTestFailed,
            message: "SFTP connected and path found, but write test failed — check that the \
                      SFTP user has write permission on the remote path."
                .to_string(),
            write_test_passed: false,
            host_fingerprint: fingerprint,
            fingerprint_status,
            free_bytes,
            quota_warning,
        };
    }

    let (status, message) = if quota_warning {
        (
            SftpVerifyStatus::QuotaWarning,
            "SFTP auth and write test passed — but free space on the remote path is below 1 GiB. \
             Check quota allocation with your peer."
                .to_string(),
        )
    } else {
        (
            SftpVerifyStatus::Ok,
            "SFTP verified — overlay/TCP reachable, SSH auth passed, remote path accessible, \
             write test passed."
                .to_string(),
        )
    };

    SftpVerifyResult {
        status,
        message,
        write_test_passed: true,
        host_fingerprint: fingerprint,
        fingerprint_status,
        free_bytes,
        quota_warning,
    }
}

// ── Authentication helper ─────────────────────────────────────────────────────

fn try_authenticate(session: &Session, username: &str, key_path: Option<&str>) -> bool {
    // If a key path is given, use pubkey file auth.
    if let Some(key) = key_path.filter(|k| !k.trim().is_empty()) {
        if session
            .userauth_pubkey_file(username, None, Path::new(key), None)
            .is_ok()
        {
            return session.authenticated();
        }
    }

    // Fall back to SSH agent (works when the key is loaded in ssh-agent/macOS Keychain).
    if session.userauth_agent(username).is_ok() && session.authenticated() {
        return true;
    }

    session.authenticated()
}

// ── TOFU fingerprint storage ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct KnownEntry {
    fingerprint: String,
    first_seen_utc: String,
}

type KnownHosts = HashMap<String, KnownEntry>;

fn tofu_key(host: &str, port: u16) -> String {
    format!("{}:{}", host.to_lowercase(), port)
}

fn load_known_hosts(path: &Path) -> KnownHosts {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn check_fingerprint_tofu(
    fingerprint: Option<&str>,
    host: &str,
    port: u16,
    path: Option<&Path>,
) -> FingerprintStatus {
    let Some(fp) = fingerprint else {
        return FingerprintStatus::NotAvailable;
    };
    let Some(path) = path else {
        // TOFU disabled — always treat as New so the fingerprint is shown to the user.
        return FingerprintStatus::New;
    };
    let key = tofu_key(host, port);
    let known = load_known_hosts(path);
    match known.get(&key) {
        None => FingerprintStatus::New,
        Some(entry) if entry.fingerprint == fp => FingerprintStatus::Matching,
        Some(_) => FingerprintStatus::Changed,
    }
}

fn save_fingerprint_tofu(
    fingerprint: Option<&str>,
    host: &str,
    port: u16,
    path: Option<&Path>,
) {
    let (Some(fp), Some(path)) = (fingerprint, path) else {
        return;
    };
    let key = tofu_key(host, port);
    let mut known = load_known_hosts(path);
    known.insert(key, KnownEntry {
        fingerprint: fp.to_string(),
        first_seen_utc: now_utc_iso(),
    });
    if let Ok(json) = serde_json::to_string_pretty(&known) {
        let _ = std::fs::write(path, json);
    }
}

fn now_utc_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple ISO-8601 UTC — avoids pulling in chrono.
    let (y, mo, d, h, mi, s) = secs_to_ymd_hms(secs);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, mi, s)
}

fn secs_to_ymd_hms(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let s = secs % 60;
    let mins = secs / 60;
    let mi = mins % 60;
    let hours = mins / 60;
    let h = hours % 24;
    let days = hours / 24;
    // Gregorian calendar from epoch (1970-01-01).
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

// ── Quota via statvfs ─────────────────────────────────────────────────────────

/// Query free bytes on the remote path using the SFTP fstatvfs extension.
///
/// Opens the path as a directory handle and calls `fstatvfs` (OpenSSH extension).
/// Returns `(None, false)` if the server doesn't support the extension — non-fatal.
fn sftp_free_bytes(sftp: &ssh2::Sftp, path: &str) -> (Option<u64>, bool) {
    let mut dir = match sftp.opendir(Path::new(path)) {
        Ok(d) => d,
        Err(_) => return (None, false),
    };
    match dir.statvfs() {
        Ok(stat) => {
            let free = stat.f_frsize.saturating_mul(stat.f_bavail);
            let warn = free < 1_073_741_824; // warn below 1 GiB
            (Some(free), warn)
        }
        Err(_) => (None, false),
    }
}

// ── Result builder helpers ────────────────────────────────────────────────────

fn err_result(status: SftpVerifyStatus, message: &str) -> SftpVerifyResult {
    SftpVerifyResult {
        status,
        message: message.to_string(),
        write_test_passed: false,
        host_fingerprint: None,
        fingerprint_status: FingerprintStatus::NotAvailable,
        free_bytes: None,
        quota_warning: false,
    }
}

// ── Map verify status → health string ────────────────────────────────────────

/// Map `SftpVerifyStatus` to the `remote_target_status` string used in `HealthReport`.
pub fn sftp_status_to_health_string(status: &SftpVerifyStatus) -> &'static str {
    match status {
        SftpVerifyStatus::Ok => "reachable",
        SftpVerifyStatus::QuotaWarning => "quota_warning",
        SftpVerifyStatus::AuthFailed => "auth_failed",
        SftpVerifyStatus::HostKeyMismatch => "host_key_mismatch",
        SftpVerifyStatus::Unreachable => "unreachable",
        SftpVerifyStatus::PathNotFound => "error",
        SftpVerifyStatus::WriteTestFailed => "error",
        SftpVerifyStatus::Error => "error",
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ── sftp_status_to_health_string ──────────────────────────────────────────

    #[test]
    fn ok_maps_to_reachable() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::Ok), "reachable");
    }

    #[test]
    fn quota_warning_maps_to_quota_warning() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::QuotaWarning), "quota_warning");
    }

    #[test]
    fn auth_failed_maps_to_auth_failed_string() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::AuthFailed), "auth_failed");
    }

    #[test]
    fn host_key_mismatch_maps_to_host_key_mismatch_string() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::HostKeyMismatch), "host_key_mismatch");
    }

    #[test]
    fn unreachable_maps_to_unreachable_string() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::Unreachable), "unreachable");
    }

    #[test]
    fn path_not_found_maps_to_error() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::PathNotFound), "error");
    }

    #[test]
    fn write_test_failed_maps_to_error() {
        assert_eq!(sftp_status_to_health_string(&SftpVerifyStatus::WriteTestFailed), "error");
    }

    // ── TOFU fingerprint storage ──────────────────────────────────────────────

    #[test]
    fn new_host_returns_new_status() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        let status = check_fingerprint_tofu(Some("SHA256:abc"), "host.example", 22, Some(&path));
        assert_eq!(status, FingerprintStatus::New);
    }

    #[test]
    fn saved_fingerprint_returns_matching() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        save_fingerprint_tofu(Some("SHA256:abc123"), "host.example", 22, Some(&path));
        let status = check_fingerprint_tofu(Some("SHA256:abc123"), "host.example", 22, Some(&path));
        assert_eq!(status, FingerprintStatus::Matching);
    }

    #[test]
    fn changed_fingerprint_returns_changed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        save_fingerprint_tofu(Some("SHA256:abc123"), "host.example", 22, Some(&path));
        let status = check_fingerprint_tofu(Some("SHA256:different"), "host.example", 22, Some(&path));
        assert_eq!(status, FingerprintStatus::Changed);
    }

    #[test]
    fn different_ports_stored_independently() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        save_fingerprint_tofu(Some("SHA256:fp22"), "h", 22, Some(&path));
        save_fingerprint_tofu(Some("SHA256:fp2222"), "h", 2222, Some(&path));
        assert_eq!(check_fingerprint_tofu(Some("SHA256:fp22"), "h", 22, Some(&path)), FingerprintStatus::Matching);
        assert_eq!(check_fingerprint_tofu(Some("SHA256:fp2222"), "h", 2222, Some(&path)), FingerprintStatus::Matching);
        assert_eq!(check_fingerprint_tofu(Some("SHA256:fp2222"), "h", 22, Some(&path)), FingerprintStatus::Changed);
    }

    #[test]
    fn none_fingerprint_returns_not_available() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        let status = check_fingerprint_tofu(None, "h", 22, Some(&path));
        assert_eq!(status, FingerprintStatus::NotAvailable);
    }

    #[test]
    fn none_path_returns_new_every_time() {
        let status = check_fingerprint_tofu(Some("SHA256:fp"), "h", 22, None);
        assert_eq!(status, FingerprintStatus::New);
    }

    #[test]
    fn host_key_is_case_normalised() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        save_fingerprint_tofu(Some("SHA256:fp"), "HOST.EXAMPLE", 22, Some(&path));
        let status = check_fingerprint_tofu(Some("SHA256:fp"), "host.example", 22, Some(&path));
        assert_eq!(status, FingerprintStatus::Matching);
    }

    #[test]
    fn known_fingerprints_file_is_valid_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("known_fingerprints.json");
        save_fingerprint_tofu(Some("SHA256:fp1"), "h1", 22, Some(&path));
        save_fingerprint_tofu(Some("SHA256:fp2"), "h2", 2222, Some(&path));
        let content = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed["h1:22"].is_object());
        assert!(parsed["h2:2222"].is_object());
    }

    #[test]
    fn err_result_has_not_available_fingerprint_status() {
        let r = err_result(SftpVerifyStatus::Unreachable, "test");
        assert_eq!(r.fingerprint_status, FingerprintStatus::NotAvailable);
        assert!(r.host_fingerprint.is_none());
    }

    #[test]
    fn unreachable_host_returns_unreachable_status() {
        // 192.0.2.0/24 is TEST-NET — guaranteed unreachable.
        let r = verify_sftp_target("192.0.2.1", 22, "user", "/path", None, None);
        assert!(
            matches!(r.status, SftpVerifyStatus::Unreachable | SftpVerifyStatus::Error),
            "expected Unreachable or Error, got {:?}", r.status
        );
    }

    // ── now_utc_iso ───────────────────────────────────────────────────────────

    #[test]
    fn now_utc_iso_has_correct_format() {
        let ts = now_utc_iso();
        // YYYY-MM-DDTHH:MM:SSZ — 20 characters
        assert_eq!(ts.len(), 20, "unexpected timestamp: {ts}");
        assert!(ts.ends_with('Z'), "must end with Z: {ts}");
        assert_eq!(&ts[4..5], "-", "must have dash after year: {ts}");
    }
}
