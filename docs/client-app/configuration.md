# Client App Configuration

## Config Philosophy

Configuration must be understandable to advanced users and safe for less experienced users. Non-secret settings should be stored as TOML. Secrets should be stored in the OS keychain where practical, with only references stored in TOML.

The local service must validate configuration before running backup, sync, health, or restore tasks.

## Required Settings

| Setting | Required | Notes |
| --- | --- | --- |
| Client role | Yes | `data_owner`, `storage_host`, or `reciprocal_match` |
| Source paths | Data owner modes | Paths to local data that Kopia snapshots |
| Remote repository target | Data owner modes | Kopia SFTP repository target on matched peer storage |
| Hosted peer-storage path | Host modes | Local folder where encrypted peer data is stored |
| Quota limit | Host modes | Maximum storage allowed for peer data |
| Backup engine | Yes | Default `Kopia`; restic is future optional support |
| Retention policy | Data owner modes | Default policy should be explicit and visible |
| Overlay peer address | Match setup | Tailscale, Headscale, or WireGuard address/hostname for matched peer |
| SFTP username | Match setup | Isolated account for the matched repository target |
| SFTP remote path | Match setup | Quota-bound host path for encrypted repository data |
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
| Remote target warning | Unreachable more than 24 hours |
| Remote target critical | Unreachable more than 72 hours |
| Free quota warning | Less than 15 percent |
| Free quota critical | Less than 5 percent |
| Peer offline warning | More than 24 hours |
| Peer offline critical | More than 7 days |
| Repository verification warning | Tool warning |
| Repository verification critical | Tool failure |
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
hosted_peer_storage_path = "/Volumes/NASBB/hosted-peers/jordan"

[remote_repository]
kind = "sftp"
overlay_host = "jordan-nas.tailnet.example"
sftp_user = "nasbb-match-123"
sftp_path = "/srv/nasbb/matches/match-123/repository"

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

[secrets]
kopia_repository_password_ref = "keychain:nasbb/kopia-main"
sftp_private_key_ref = "keychain:nasbb/sftp-match-123"
```

## Validation Rules

The service must reject configuration when:

- Any local cache/repository path is the same as a source path.
- Any source path is inside a local cache/repository path.
- Any local cache/repository path is inside a source path.
- Any source path is configured as a peer share, SFTP root, or optional Syncthing folder.
- Hosted peer-storage path is inside a source path.
- Remote SFTP target is missing for data owner modes after match setup.
- Overlay peer address is missing after match setup.
- Quota is missing for host modes.
- Backup engine is not supported.
- Health reporting is enabled without consent.
- Recovery key confirmation is missing for data owner modes.

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
  "remoteRepository": {
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
    "category": "remote_repository_unreachable",
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
- Raw SSH/SFTP logs.
- Raw Syncthing logs from optional mirror mode.
- Unredacted command lines containing local paths or secrets.
