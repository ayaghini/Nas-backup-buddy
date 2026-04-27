# Client App Security And Safety

## Safety Goal

The client must make the safe path the easiest path. If the app is unsure whether a setup is safe, it should stop and explain the problem rather than continue.

## Threat Model

| Threat | Control |
| --- | --- |
| Peer attempts to read user data | Client-side encryption with Kopia before SFTP upload |
| User accidentally exposes live data | Source-folder safety validator blocks direct source shares and peer targets |
| User loses recovery password/key | Required key backup confirmation and restore drill |
| Ransomware changes source data | Snapshot retention and delayed pruning guidance |
| Peer disappears | Health checks, remote-target alerts, future peer replacement flow |
| Peer disk fills up | Quota checks and warning/critical thresholds |
| Tool binary is tampered with | Pinned tool manifest and checksum verification |
| Logs leak sensitive data | Log redaction before display or reporting |
| Telemetry leaks metadata | Explicit allowlist and consent |
| Restore silently fails | Canary checksum verification and Critical status on failure |

## Secret Handling

Rules:

- Backup passwords and private keys never leave the local machine.
- Secrets should be stored in the OS keychain where practical.
- TOML config stores references to secrets, not secret values.
- UI password fields pass values to the local service only for setup or unlock operations.
- The app must not log secrets or command arguments containing secrets.
- Diagnostic bundles must be redacted before export.

If OS keychain storage is unavailable, the app must warn the user and require explicit confirmation before using a local encrypted fallback.

## Telemetry Allowlist

Allowed:

- Client version.
- Match ID.
- Role.
- Last backup status and timestamp.
- Last remote repository reachability status and timestamp.
- Last restore drill status and timestamp.
- Repository size.
- Available quota percent.
- Peer online/offline state.
- Disk health summary.
- Redacted error category and message.

Disallowed:

- Backup password.
- Private keys.
- Source file names.
- Source file contents.
- Full local source paths.
- Raw Kopia logs.
- Raw SSH/SFTP logs.
- Raw Syncthing logs from optional mirror mode.
- Unredacted stack traces or command lines.

## Log Redaction

The service must redact before logs reach the UI or web app.

Redact:

- Source paths.
- User home directories.
- Repository passwords.
- Pairing tokens.
- Device tokens.
- Any command-line argument marked sensitive.

Display logs as operational events where possible:

- `backup_started`
- `backup_completed`
- `backup_failed`
- `remote_target_unreachable`
- `repository_check_failed`
- `restore_drill_failed`
- `canary_checksum_mismatch`

## Local Permissions

The app should request the minimum permissions needed to:

- Read selected source folders.
- Write encrypted repository data to selected remote targets.
- Write hosted peer-storage data.
- Execute bundled tools.
- Store and read local config and secret references.

The app should not request broad disk access until the user selects folders that require it.

## Tool And Update Verification

Bundled Kopia and any bundled helper tools must be controlled by a manifest with:

- Tool name.
- Version.
- Platform.
- Download/source reference.
- Expected checksum.
- License.

The service must fail closed when:

- A bundled binary is missing.
- Version does not match the manifest.
- Checksum does not match the manifest.
- Tool execution returns an unsupported version.

App updates should be signed where practical. Release notes must call out bundled tool version changes and rollback guidance.

## Failure Behavior

| Failure | Required Client Behavior |
| --- | --- |
| Restore fails | Mark Critical, block Protected, stop pruning, create incident payload |
| Canary mismatch | Mark Critical, block Protected, preserve logs, create incident payload |
| Password/key missing | Mark Critical, block Protected, require new protected setup |
| Source folder selected as peer target/share | Block setup and explain safe folder layout |
| Backup stale more than 24 hours | Warning |
| Backup stale more than 72 hours | Critical |
| Remote repository unreachable more than 24 hours | Warning |
| Remote repository unreachable more than 72 hours | Critical |
| Free quota below 15 percent | Warning |
| Free quota below 5 percent | Critical |
| Peer offline more than 24 hours | Warning |
| Peer offline more than 7 days | Critical |
| Telemetry contains disallowed data | Stop telemetry path and mark local privacy incident |

## Protected Status Gate

The client must block Protected status until:

- Backup snapshot exists.
- Remote encrypted repository is reachable on peer storage.
- Restore drill completed.
- Canary checksum matches.
- User confirmed recovery password/key backup.
- Retention policy is configured.
- Peer quota has buffer.
- No critical health alerts exist.

## Diagnostic Bundle Rules

Diagnostic bundles may include:

- Client version.
- Platform.
- Tool versions.
- Redacted health report.
- Redacted operational event log.
- Config shape without secret values and without full source paths.

Diagnostic bundles must not include:

- Passwords.
- Keys.
- Pairing tokens.
- Full local source paths.
- File names from source folders.
- Raw tool logs.
