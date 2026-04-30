//! Overlay and SFTP remote target reachability probes.
//!
//! ## Current probe capability
//!
//! The current probe is **TCP connect only**. It verifies that the overlay
//! network is up and that a port is accepting connections. It does NOT:
//! - Perform SSH or SFTP handshake
//! - Verify SSH host key
//! - Attempt authentication
//! - Confirm the remote path exists or is writable
//!
//! A `Reachable` result means "TCP port is open on the overlay network."
//! It does **not** mean "SFTP authentication succeeded."
//!
//! `AuthFailed` and `HostKeyMismatch` are reserved for a future SSH-handshake
//! probe or for mapping Kopia error output. They must not be returned by the
//! current TCP-only probe.
//!
//! All probe methods are non-secret: no passwords, keys, or sensitive identifiers
//! are used or transmitted. Host addresses, usernames, and paths are never
//! included in status messages.

use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::time::{Duration, Instant};

/// Which probe method was used to produce this result.
///
/// The UI must show different indicators depending on the method: a TCP probe
/// does NOT confirm SSH auth or host-key validity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeMethod {
    /// TCP connect only — confirms port is open, nothing more.
    TcpConnect,
    /// Reserved for a future SSH/SFTP handshake probe.
    SshHandshake,
}

/// Structured status of a remote SFTP/overlay target probe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteTargetStatus {
    /// No remote target has been configured yet.
    NotConfigured,
    /// TCP probe: port is open on the overlay network (SSH/SFTP auth NOT verified).
    /// SSH probe (future): SFTP handshake succeeded.
    Reachable,
    /// Reserved for future SSH-handshake probe: auth rejected after TCP connect.
    /// Must NOT be returned by TCP-only probes.
    AuthFailed,
    /// TCP probe timed out or was refused — overlay or service may be down.
    Unreachable,
    /// Reserved for future SSH-handshake probe: host key does not match.
    /// Must NOT be returned by TCP-only probes.
    HostKeyMismatch,
    /// SFTP target is reachable but the reported free space is below warning threshold.
    QuotaWarning,
    /// An unexpected error prevented the probe from completing.
    Error,
}

/// Result of a single remote target probe run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteTargetProbeResult {
    pub status: RemoteTargetStatus,
    /// The method used — callers must not treat TCP success as SFTP auth success.
    pub method: ProbeMethod,
    /// Round-trip latency for TCP connect, if the connection succeeded.
    pub latency_ms: Option<u64>,
    /// Redacted human-readable status message. Never contains host/user/path.
    pub message: String,
}

/// Probe TCP reachability to an overlay host on the given port.
///
/// Performs DNS resolution followed by TCP connect with a 5-second timeout.
/// Returns `NotConfigured` if host is empty, `Unreachable` on failure,
/// or `Reachable` (TCP only) on success.
///
/// **No secrets are used or transmitted.** The probe is safe to run at any
/// point without exposing credentials to logs or the UI.
///
/// **`Reachable` does not mean SFTP authentication succeeded.**
/// Use `method == ProbeMethod::TcpConnect` to guard against misinterpretation.
pub fn probe_tcp_reachability(host: &str, port: u16) -> RemoteTargetProbeResult {
    if host.trim().is_empty() {
        return RemoteTargetProbeResult {
            status: RemoteTargetStatus::NotConfigured,
            method: ProbeMethod::TcpConnect,
            latency_ms: None,
            message: "Remote target host is not configured".to_string(),
        };
    }

    use std::net::ToSocketAddrs;
    let addr_str = format!("{}:{}", host, port);
    let addrs: Vec<_> = match addr_str.to_socket_addrs() {
        Ok(a) => a.collect(),
        Err(_) => {
            return RemoteTargetProbeResult {
                status: RemoteTargetStatus::Error,
                method: ProbeMethod::TcpConnect,
                latency_ms: None,
                message: "Cannot resolve peer overlay address — check overlay host configuration"
                    .to_string(),
            };
        }
    };

    if addrs.is_empty() {
        return RemoteTargetProbeResult {
            status: RemoteTargetStatus::Error,
            method: ProbeMethod::TcpConnect,
            latency_ms: None,
            message: "Overlay address resolved to no usable addresses".to_string(),
        };
    }

    let start = Instant::now();
    let mut last_err = String::new();
    for addr in &addrs {
        match TcpStream::connect_timeout(addr, Duration::from_secs(5)) {
            Ok(_) => {
                let latency = start.elapsed().as_millis() as u64;
                return RemoteTargetProbeResult {
                    status: RemoteTargetStatus::Reachable,
                    method: ProbeMethod::TcpConnect,
                    latency_ms: Some(latency),
                    // Explicit: TCP port open only, NOT SSH/SFTP auth verified
                    message: format!("TCP port {} reachable (overlay network OK; SSH/SFTP auth not verified)", port),
                };
            }
            Err(e) => { last_err = e.to_string(); continue; }
        }
    }

    RemoteTargetProbeResult {
        status: RemoteTargetStatus::Unreachable,
        method: ProbeMethod::TcpConnect,
        latency_ms: None,
        message: format!(
            "TCP port {} not reachable — {} (verify overlay network and remote SFTP service)",
            port, last_err
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_host_returns_not_configured() {
        let result = probe_tcp_reachability("", 22);
        assert_eq!(result.status, RemoteTargetStatus::NotConfigured);
    }

    #[test]
    fn whitespace_host_returns_not_configured() {
        let result = probe_tcp_reachability("   ", 22);
        assert_eq!(result.status, RemoteTargetStatus::NotConfigured);
    }

    #[test]
    fn invalid_host_returns_error_or_unreachable() {
        // An invalid hostname that can never resolve should return Error or Unreachable.
        let result = probe_tcp_reachability("this-is-definitely-not-a-real-host.invalid", 22);
        assert!(
            matches!(
                result.status,
                RemoteTargetStatus::Error | RemoteTargetStatus::Unreachable
            ),
            "Expected Error or Unreachable for invalid host, got {:?}",
            result.status
        );
    }

    #[test]
    fn unreachable_port_on_localhost_is_unreachable() {
        // Port 19999 is almost certainly not open on the test machine.
        let result = probe_tcp_reachability("127.0.0.1", 19999);
        assert_eq!(result.status, RemoteTargetStatus::Unreachable);
    }

    #[test]
    fn probe_message_never_contains_host() {
        let result = probe_tcp_reachability("secret-peer.tailnet.example", 22);
        assert!(!result.message.contains("secret-peer.tailnet.example"));
    }

    #[test]
    fn tcp_probe_method_is_tcp_connect() {
        let result = probe_tcp_reachability("127.0.0.1", 19999);
        assert_eq!(result.method, ProbeMethod::TcpConnect);
    }

    #[test]
    fn not_configured_uses_tcp_connect_method() {
        let result = probe_tcp_reachability("", 22);
        assert_eq!(result.method, ProbeMethod::TcpConnect);
    }

    #[test]
    fn tcp_probe_never_returns_auth_failed() {
        // TCP-only probe must not return AuthFailed — that is reserved for future SSH probes.
        let hosts = ["", "127.0.0.1", "this-host-does-not-resolve.invalid"];
        for host in hosts {
            let result = probe_tcp_reachability(host, 19999);
            assert_ne!(
                result.status,
                RemoteTargetStatus::AuthFailed,
                "TCP probe must never return AuthFailed for host={host:?}"
            );
        }
    }

    #[test]
    fn tcp_probe_never_returns_host_key_mismatch() {
        // TCP-only probe must not return HostKeyMismatch — reserved for future SSH probes.
        let hosts = ["", "127.0.0.1", "no-host.invalid"];
        for host in hosts {
            let result = probe_tcp_reachability(host, 19999);
            assert_ne!(
                result.status,
                RemoteTargetStatus::HostKeyMismatch,
                "TCP probe must never return HostKeyMismatch for host={host:?}"
            );
        }
    }

    #[test]
    fn reachable_result_includes_tcp_only_disclaimer_in_message() {
        // When TCP succeeds, the message must indicate it's TCP-only, not full SFTP auth.
        // We can only test this if the loopback port is open.
        // Use a port that is likely open (we can't guarantee it, so accept both outcomes).
        let result = probe_tcp_reachability("127.0.0.1", 22);
        if result.status == RemoteTargetStatus::Reachable {
            // If port 22 happened to be open, message must mention TCP and not claim SFTP success
            assert!(
                result.message.to_lowercase().contains("tcp"),
                "Reachable message must mention TCP: {}",
                result.message
            );
        }
        // If port 22 is not open, the test passes trivially — no false claim of SFTP success
    }
}
