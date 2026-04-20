# Client App Configuration

## Config Philosophy

Configuration must be understandable to advanced users and safe for less experienced users. Non-secret settings should be stored as TOML. Secrets should be stored in the OS keychain where practical, with only references stored in TOML.

The local service must validate configuration before running backup, sync, health, or restore tasks.

## Required Settings

| Setting | Required | Notes |
| --- | --- | --- |
| Client role | Yes | `data_owner`, `storage_host`, or `reciprocal_match` |
| Source paths | Data owner modes | Paths to local data that Kopia snapshots |
| Encrypted repository path | Data owner modes | Local Kopia repository path; Syncthing may replicate this |
| Hosted peer-storage path | Host modes | Local folder where encrypted peer data is stored |
| Quota limit | Host modes | Maximum storage allowed for peer data |
| Backup engine | Yes | Default `Kopia`; restic is future optional support |
| Retention policy | Data owner modes | Default policy should be explicit and visible |
| Syncthing device ID | Match setup | Device ID for matched peer |
| Syncthing folder ID | Match setup | Folder ID for encrypted repository replication |
| Web app pairing token | Pairing | Short-lived token from the web app |
| Health-report consent | Yes | User must explicitly allow metadata reporting |
| Recovery key confirmation | Data owner modes | User confirms password/key is saved outside the platform |

## Safe Defaults

| Area | Default |
| --- | --- |
| Backup engine | Kopia |
| Backup schedule | Daily |
| Restore drill warning | Older than 30 days |
| Stale backup warning | More than 24 hours |
| Stale backup critical | More than 72 hours |
| Stale sync warning | More than 24 hours |
| Stale sync critical | More than 72 hours |
| Free quota warning | Less than 15 percent |
| Free quota critical | Less than 5 percent |
| Peer offline warning | More than 24 hours |
| Peer offline critical | More than 7 days |
| Repository check warning | Tool warning |
| Repository check critical | Tool failure |
| Source folder sync | Always blocked |
| Health reporting | Off until explicit consent |

## Example TOML Shape

This is illustrative and should be refined during implementation.

```toml
client_id = "local-generated-id"
role = "reciprocal_match"
backup_engine = "kopia"
health_report_consent = false
web_pairing_token_ref = "keychain:nasbb/pairing-token"

[paths]
source_paths = ["/Users/alex/Documents", "/Users/alex/Pictures"]
encrypted_repository_path = "/Users/alex/NASBB/repositories/main"
hosted_peer_storage_path = "/Volumes/NASBB/hosted-peers/jordan"

[quota]
hosted_peer_quota_gb = 2048
critical_free_percent = 5
warning_free_percent = 15

[retention]
keep_daily = 7
keep_weekly = 4
keep_monthly = 6

[schedule]
backup = "daily"
restore_drill_frequency_days = 30

[syncthing]
peer_device_id = "DEVICE-ID-FROM-MATCH"
repository_folder_id = "nasbb-repo-match-id"

[secrets]
kopia_repository_password_ref = "keychain:nasbb/kopia-main"
```

## Validation Rules

The service must reject configuration when:

- Any source path is the same as the encrypted repository path.
- Any source path is inside the encrypted repository path.
- The encrypted repository path is inside a source path.
- Any source path is configured as a Syncthing folder.
- Hosted peer-storage path is inside a source path.
- Quota is missing for host modes.
- Backup engine is not supported.
- Health reporting is enabled without consent.
- Recovery key confirmation is missing for data owner modes.
- Required Syncthing device or folder IDs are missing after match setup.

## Health Report Shape

Health reports should contain only allowlisted operational metadata:

```json
{
  "clientVersion": "0.1.0",
  "matchId": "match-id",
  "role": "reciprocal_match",
  "lastBackup": {
    "status": "ok",
    "timestamp": "2026-04-19T12:00:00Z"
  },
  "lastSync": {
    "status": "warning",
    "timestamp": "2026-04-19T11:30:00Z"
  },
  "lastRestoreDrill": {
    "status": "pass",
    "timestamp": "2026-04-10T09:00:00Z"
  },
  "repositorySizeGb": 187.4,
  "availableQuotaPercent": 90.8,
  "peerOnlineState": "online",
  "diskHealthSummary": "ok",
  "error": {
    "category": "sync_stale",
    "message": "Redacted operational message"
  }
}
```

## Disallowed Telemetry

Never include:

- Backup passwords.
- Private keys.
- Source file names.
- Source file contents.
- Full local source paths.
- Raw Kopia logs.
- Raw Syncthing logs.
- Unredacted command lines containing local paths or secrets.

