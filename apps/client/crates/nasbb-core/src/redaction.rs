//! Telemetry and log redaction.
//!
//! The health report sent to the web API must use an explicit allowlist.
//! This module provides a best-effort line-level redaction pass for
//! structured log lines before they are stored or displayed.
//!
//! Redacted patterns:
//! - Password/key/secret/token key-value pairs
//! - Bare tokens that look like base64 strings (≥32 chars, limited charset)
//! - Absolute filesystem paths (≥3 path components)
//!
//! Note: line-level redaction is a defence-in-depth measure.
//! The primary control is the health report allowlist — raw log lines
//! must never be sent to the web API.

const REDACTED: &str = "[REDACTED]";

/// Sensitive key names that must not appear in exported logs.
const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passphrase",
    "pass",
    "key",
    "secret",
    "token",
    "pairing",
    "auth",
    "credential",
    "private",
    "seed",
];

/// Returns true if the character is a valid base64 character.
fn is_base64_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='
}

/// Returns true if the string looks like a base64 token (≥32 chars, all base64 chars).
fn looks_like_token(s: &str) -> bool {
    s.len() >= 32 && s.chars().all(is_base64_char)
}

/// Returns true if the string looks like an absolute path (starts with / or X:\).
fn looks_like_path(s: &str) -> bool {
    // Unix absolute path with ≥3 components
    if s.starts_with('/') {
        let components = s.split('/').filter(|c| !c.is_empty()).count();
        return components >= 2;
    }
    // Windows absolute path
    if s.len() >= 3 {
        let bytes = s.as_bytes();
        if bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
            return true;
        }
    }
    false
}

/// Redact a single log line.
///
/// This is a simple word-by-word pass. It does not parse structured formats.
/// For structured logs, prefer stripping fields at the source.
pub fn redact_line(line: &str) -> String {
    // Check for key=value or key: value patterns with sensitive key names
    let lower = line.to_lowercase();
    for key in SENSITIVE_KEYS {
        if lower.contains(key) {
            // Find the key, then redact everything after the = or : separator on that segment
            if let Some(pos) = lower.find(key) {
                let rest = &line[pos + key.len()..];
                let trimmed = rest.trim_start();
                if trimmed.starts_with('=') || trimmed.starts_with(':') {
                    let before = &line[..pos + key.len()];
                    let sep_pos = rest.find(|c| c == '=' || c == ':').unwrap();
                    let sep = &rest[sep_pos..=sep_pos];
                    // Find end of value after optional whitespace following the separator.
                    let value_start = sep_pos
                        + 1
                        + rest[sep_pos + 1..]
                            .chars()
                            .take_while(|c| c.is_whitespace())
                            .map(char::len_utf8)
                            .sum::<usize>();
                    let value_end = rest[value_start..]
                        .find(char::is_whitespace)
                        .map(|i| value_start + i)
                        .unwrap_or(rest.len());
                    let after = &rest[value_end..];
                    return format!("{}{}{}{}", before, sep, REDACTED, after);
                }
            }
        }
    }

    // Redact word-by-word for tokens and paths
    let words: Vec<&str> = line.split_whitespace().collect();
    let mut result = line.to_string();
    for word in words {
        // Strip trailing punctuation for matching
        let stripped = word
            .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '\\' && c != ':');
        if looks_like_token(stripped) || looks_like_path(stripped) {
            result = result.replacen(word, REDACTED, 1);
        }
    }
    result
}

/// Returns true if the line is safe to include in a telemetry export as-is.
pub fn is_safe_for_telemetry(line: &str) -> bool {
    redact_line(line) == line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_line_passes_through() {
        let line = "backup completed: 42 files, 1.2 GB";
        assert_eq!(redact_line(line), line);
        assert!(is_safe_for_telemetry(line));
    }

    #[test]
    fn redacts_password_kv() {
        let line = "connecting with password=hunter2";
        let result = redact_line(line);
        assert!(!result.contains("hunter2"));
        assert!(result.contains(REDACTED));
    }

    #[test]
    fn redacts_secret_colon() {
        let line = "token: abcdefghijklmnopqrstuvwxyz12345678";
        let result = redact_line(line);
        assert!(!result.contains("abcdefghijklmnopqrstuvwxyz12345678"));
    }

    #[test]
    fn redacts_absolute_unix_path() {
        let line = "restoring to /home/alice/documents/restored";
        let result = redact_line(line);
        assert!(
            !result.contains("/home/alice/documents/restored"),
            "got: {result}"
        );
    }

    #[test]
    fn short_path_not_redacted() {
        // Single-component paths are not redacted (e.g. "/tmp")
        let line = "temp dir is /tmp";
        let result = redact_line(line);
        // /tmp has 1 component — should NOT be redacted by path rule
        // (it may still be fine to keep in logs)
        assert_eq!(result, line);
    }

    #[test]
    fn password_not_in_telemetry() {
        assert!(!is_safe_for_telemetry("password=secret123"));
    }

    #[test]
    fn health_summary_is_safe() {
        let line = "last_backup_age_hours=2.5 free_quota_percent=65.0 repository_check=ok";
        assert!(is_safe_for_telemetry(line));
    }
}
