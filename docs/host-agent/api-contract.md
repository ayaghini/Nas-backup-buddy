# NAS Backup Buddy — Host Agent API Contract

> **Audience**: Desktop UI implementors. Read this document instead of the source code.
> Source location: `apps/host-agent/`. Compose entry point: `apps/host-agent/compose/docker-compose.yml`.

---

## Container architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Docker Compose stack                                              │
│                                                                    │
│  nasbb-agent (Go 1.22)           nasbb-sftp (Alpine + OpenSSH)    │
│  127.0.0.1:7420 REST API         127.0.0.1:2222 SFTP (default)    │
│  Manages allocations             Per-match chroot users           │
│  Writes user/key config          Reads user/key config on reload  │
│         │                                 │                        │
│         └─────── nasbb-state (RW both) ───┘                        │
│         │        nasbb-config (agent RW)                           │
│         └─────── nasbb-repos  (RW both) ──┘                        │
│                  nasbb-logs   (agent RW)                           │
└────────────────────────────────────────────────────────────────────┘
```

| Service | Image | Internal port | Host port | Key env vars |
|---------|-------|---------------|-----------|--------------|
| `nasbb-agent` | Go 1.22 / Alpine 3.19 | 7420 | `127.0.0.1:${NASBB_API_PORT:-7420}` | `NASBB_API_TOKEN`, `TAILSCALE_ADDRESS`, `NASBB_SFTP_BIND/PORT/HOST` |
| `nasbb-sftp` | Alpine 3.19 + OpenSSH | 2222 | `${NASBB_SFTP_BIND:-127.0.0.1}:${NASBB_SFTP_PORT:-2222}` | `STATE_DIR`, `REPOS_DIR` |

---

## Port list

| Port | Interface (host) | Controlled by | Change for Tailscale access |
|------|-----------------|---------------|-----------------------------|
| 7420 (agent API) | `127.0.0.1` always | `docker-compose.yml` `ports:` hardcoded | Not needed — use SSH tunnel or VPN to the host |
| 2222 (SFTP) | `NASBB_SFTP_BIND` (default `127.0.0.1`) | `.env` → compose `ports:` | Set `NASBB_SFTP_BIND=<tailscale-ip>` in `.env` |

---

## Volume list

| Volume | Read by | Written by | Never delete if… |
|--------|---------|-----------|------------------|
| `nasbb-config` | agent | agent | Active allocations exist |
| `nasbb-state` | agent, sftp | agent (user dirs), sftp (host key) | Owners have connected (host key) |
| `nasbb-repos` | sftp | sftp | Any allocation is READY |
| `nasbb-logs` | agent | agent | Audit trail is needed |

**Critical**: `nasbb-state` contains the SFTP host key. Deleting this volume invalidates all owner `known_hosts` entries.

---

## API protocol

- **Transport**: HTTP/1.1, JSON body
- **Base path**: `/api/v1/`
- **Auth**: `Authorization: Bearer <token>` on all routes except `GET /api/v1/info`
- **Content-Type**: `application/json` for requests with a body
- **Timestamps**: RFC3339 UTC
- **Integers**: `int64` for byte counts

**Error body** (all non-2xx):
```json
{ "error": "human-readable message", "code": "MACHINE_CODE" }
```

**Machine codes**: `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_STATE`, `INVALID_KEY`, `INVITE_EXPIRED`, `QUOTA_STILL_CRITICAL`, `ALLOC_ID_MISMATCH`, `MATCH_ID_MISMATCH`, `INTERNAL`

---

## First-run pairing flow

1. Copy `.env.example` → `.env`, optionally set `NASBB_API_TOKEN`.
2. `docker compose -f compose/docker-compose.yml up -d`
3. If token was not pre-set: `docker compose logs nasbb-agent` — copy the token from the banner.
4. Enter the token in the desktop UI's agent settings.
5. UI calls `GET /api/v1/info` to confirm connectivity, then `GET /api/v1/status` to confirm auth.
6. Set `TAILSCALE_ADDRESS` and `NASBB_SFTP_BIND` in `.env`, restart stack.
7. Create an allocation via `POST /api/v1/allocations`, generate invite, share with owner.
8. Import owner's response via `POST /owner-response` — allocation moves to READY.

---

## Full endpoint reference

### `GET /api/v1/info` — no auth required
```json
{ "version": "0.1.0", "ready": true }
```

---

### `GET /api/v1/status`
```json
{
  "agentVersion": "0.1.0",
  "startedAt": "2026-04-28T00:00:00Z",
  "configLoaded": true,
  "allocationCount": 2,
  "readyCount": 1,
  "storageRoot": "/repos",
  "storageAvailableBytes": 107374182400,
  "storageTotalBytes": 214748364800
}
```

---

### `GET /api/v1/config`
Returns full config object. Never includes the API token.

### `PATCH /api/v1/config`
Request: any subset of patchable fields.

Patchable: `hostLabel`, `advertisedCapacityBytes`, `defaultQuotaBytes`, `defaultWarningThresholdPercent`, `defaultCriticalThresholdPercent`, `bandwidthCapBytesPerSecond`.

`sftpPort` and `sftpBindAddress` are read from env at startup and stored for observability only — not writable via the API.

---

### `GET /api/v1/health`
```json
{
  "agentRunning": true,
  "sftpRunning": true,
  "sftpBindAddress": "127.0.0.1",
  "sftpPublicExposureWarning": false,
  "overlayStatus": "connected|disconnected|unconfigured",
  "storageRootAvailable": true,
  "allocations": [
    {
      "allocId": "alloc_a1b2c3d4e5f6",
      "state": "READY",
      "quotaMode": "soft",
      "quotaBytes": 53687091200,
      "usedBytes": 1073741824,
      "freeBytes": 52613349376,
      "warningThresholdPercent": 15,
      "criticalThresholdPercent": 5,
      "quotaState": "ok",
      "quotaEnforcedSuspend": false,
      "sftpAccessActive": true,
      "lastOwnerWriteAt": ""
    }
  ],
  "recentEvents": []
}
```

`sftpPublicExposureWarning` is `true` when `NASBB_SFTP_BIND` is not `127.0.0.1`/`::1`/`100.x.x.x` AND `TAILSCALE_ADDRESS` is empty.

---

### `GET /api/v1/overlay/status`
```json
{
  "provider": "tailscale",
  "mode": "env-configured|unconfigured",
  "available": true,
  "hostAddress": "100.64.0.1",
  "sftpExpectedHost": "100.64.0.1",
  "sftpPort": 2222,
  "publicExposureWarning": false
}
```

---

### `GET /api/v1/sftp/status`
```json
{
  "running": true,
  "bindAddress": "127.0.0.1",
  "port": 2222,
  "publicExposureWarning": false,
  "hostKeyFingerprintSha256": "SHA256:...",
  "activeUserCount": 1
}
```

---

### `GET /api/v1/storage/status`
```json
{
  "storageRoot": "/repos",
  "totalBytes": 214748364800,
  "availableBytes": 107374182400,
  "usedBytes": 107374182400,
  "allocationCount": 2
}
```

---

### `GET /api/v1/allocations`
Response: `{ "allocations": [ ...AllocationSummary ] }`

`AllocationSummary` = full allocation object with `ownerPublicKey` omitted.

### `POST /api/v1/allocations`
Request:
```json
{
  "connectionName": "Alice offsite backup",
  "quotaBytes": 53687091200,
  "bandwidthCapBytesPerSecond": 0,
  "accessWindowEnabled": false,
  "accessWindowStart": "",
  "accessWindowEnd": ""
}
```
Response: `201` + AllocationSummary.

Side effects: creates `/repos/{username}/` and `/repos/{username}/repository/`; creates `/state/users/{username}/user.json` and empty `authorized_keys`; triggers SFTP reload.

### `GET /api/v1/allocations/{allocId}`
Response: AllocationSummary. `404 NOT_FOUND` if missing.

### `PATCH /api/v1/allocations/{allocId}`
Patchable: `connectionName`, `quotaBytes`, `bandwidthCapBytesPerSecond`, `warningThresholdPercent`, `criticalThresholdPercent`, `accessWindowEnabled`, `accessWindowStart`, `accessWindowEnd`, `retirementGraceDays`.

### `POST /api/v1/allocations/{allocId}/invite`
Accepted states: `DRAFT`, `EXPIRED`. Transitions to `PENDING_KEY`.

Sets `inviteExpiresAt = now + 90 days`, `inviteExportedAt = now`.

Returns: Host Invite Bundle JSON.

Errors: `409 INVALID_STATE` if not DRAFT or EXPIRED.

### `POST /api/v1/allocations/{allocId}/owner-response`
Accepted state: `PENDING_KEY`. Transitions to `READY`.

Request: Owner Access Response JSON.

Validates: `kind`, `allocId` match (`ALLOC_ID_MISMATCH`), `matchId` match (`MATCH_ID_MISMATCH`), valid SSH public key (`INVALID_KEY`), `now < inviteExpiresAt` (`INVITE_EXPIRED`).

Side effects: writes key to `authorized_keys`; sets `user.json` active: true; triggers SFTP reload; logs `key.authorized`.

### `POST /api/v1/allocations/{allocId}/suspend`
Accepted state: `READY`. Transitions to `SUSPENDED`.

Clears `authorized_keys`; sets `user.json` active: false; triggers reload; sets `suspendedAt`. Does NOT modify `quotaEnforcedSuspend`.

### `POST /api/v1/allocations/{allocId}/resume`
Accepted state: `SUSPENDED`. Transitions to `READY`.

Runs a synchronous quota poll first. If `quotaState == "critical"`: returns `409 QUOTA_STILL_CRITICAL`.

On success: restores key to `authorized_keys`; sets `user.json` active: true; triggers reload; clears `suspendedAt`.

### `POST /api/v1/allocations/{allocId}/retire`
Accepted states: all except `RETIRING`, `RETIRED`.

Request: `{ "graceDays": 7 }` (optional, defaults to `retirementGraceDays`).

Clears `authorized_keys`; triggers reload; sets `retirementInitiatedAt`. Does NOT delete `/repos/{username}/`.

After grace period elapses (checked hourly), transitions to `RETIRED`.

### `GET /api/v1/events`
Query params: `?limit=50` (max 200), `?after=<RFC3339>`.

Response: `{ "events": [...] }` descending by timestamp.
```json
{
  "eventId": "evt_...",
  "timestamp": "2026-04-28T00:00:00Z",
  "kind": "allocation.created",
  "allocId": "alloc_...",
  "message": "redacted human-readable summary"
}
```

Event kinds: `allocation.created`, `invite.exported`, `key.authorized`, `key.deauthorized`, `sftp.reload`, `quota.warning`, `quota.critical`, `quota.restored`, `allocation.suspended`, `allocation.resumed`, `allocation.retiring`, `allocation.retired`, `invite.expired`

---

## Error code reference

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | Missing or invalid Bearer token |
| `NOT_FOUND` | Allocation does not exist |
| `INVALID_STATE` | Requested transition not valid from current state |
| `INVALID_KEY` | SSH public key is malformed or unsupported type |
| `INVITE_EXPIRED` | `inviteExpiresAt` has passed |
| `QUOTA_STILL_CRITICAL` | Cannot resume — quota still above critical threshold |
| `ALLOC_ID_MISMATCH` | `allocId` in owner response doesn't match URL |
| `MATCH_ID_MISMATCH` | `matchId` in owner response doesn't match allocation |
| `INTERNAL` | Unexpected server error |

---

## Allocation state machine

```
DRAFT ──/invite──► PENDING_KEY ──/owner-response──► READY ──/suspend──► SUSPENDED
                        │               ▲                        │             │
                    bg expiry      /invite                    /retire      /resume
                        │         (re-issue)                     │             │
                        ▼                                        ▼             ▼
                     EXPIRED ──/invite──► PENDING_KEY        RETIRING ──bg──► RETIRED
                        │
                     /retire
                        ▼
                     RETIRING
```

| From | To | Trigger |
|------|----|---------|
| DRAFT | PENDING_KEY | `POST /invite` |
| PENDING_KEY | READY | `POST /owner-response` |
| PENDING_KEY | EXPIRED | Background check: `now > inviteExpiresAt` |
| EXPIRED | PENDING_KEY | `POST /invite` (re-issue) |
| READY | SUSPENDED | `POST /suspend` |
| SUSPENDED | READY | `POST /resume` (blocked if `quotaState == "critical"`) |
| DRAFT\|PENDING_KEY\|EXPIRED\|READY\|SUSPENDED | RETIRING | `POST /retire` |
| RETIRING | RETIRED | Background check: grace period elapsed |

**`quotaEnforcedSuspend`**: set to `true` only by the quota poller when it auto-suspends a READY allocation for exceeding the critical threshold. Cleared only when the quota poller sees usage drop below critical and auto-resumes. Manual `/suspend` and `/resume` never read or write this flag.

---

## Host Invite Bundle schema

Returned by `POST /invite`. Safe to write to a file for out-of-band transfer.

| Field | Type | Description |
|-------|------|-------------|
| `bundleVersion` | int | Always `1` |
| `kind` | string | Always `"nasbb.host_invite"` |
| `hostAgentVersion` | string | Agent semver |
| `matchId` | string | `match-` + 6 random alphanumeric |
| `allocId` | string | `alloc_` + 12 hex chars |
| `connectionName` | string | Human label |
| `overlay.provider` | string | Always `"tailscale"` in v1 |
| `overlay.host` | string | Tailscale address, or `""` if unconfigured |
| `overlay.note` | string | Human note; warns if address not configured |
| `sftp.host` | string | Same as `overlay.host` |
| `sftp.port` | int | SFTP port (default 2222) |
| `sftp.username` | string | `nabb_` + 8 hex chars |
| `sftp.path` | string | Always `"/repository"` |
| `quota.quotaBytes` | int64 | Allocated bytes |
| `quota.quotaMode` | string | Always `"soft"` |
| `hostKey.fingerprintSha256` | string | SHA-256 fingerprint of SFTP host key |
| `hostKey.verificationNote` | string | Prompt to verify out-of-band |
| `expiresAt` | RFC3339 | `now + 90 days` |

When `TAILSCALE_ADDRESS` is set, `overlay.host` and `sftp.host` use that advertised value. For cross-account Tailscale sharing, this should be the host's shared `100.x` Tailscale IPv4 unless the owner has already confirmed that the MagicDNS name resolves from their account. When `TAILSCALE_ADDRESS` is not set, the current agent falls back to the SFTP bind address when it is non-empty and not `0.0.0.0`; otherwise it falls back to `127.0.0.1`, which is suitable only for local testing.

---

## Owner Access Response schema

Submitted by the owner's client to `POST /owner-response`.

| Field | Type | Description |
|-------|------|-------------|
| `bundleVersion` | int | Always `1` |
| `kind` | string | Always `"nasbb.owner_access_response"` |
| `matchId` | string | Must match allocation's `matchId` |
| `allocId` | string | Must match allocation's `allocId` |
| `ownerDeviceLabel` | string | Human label for the owner device |
| `ownerPublicKey` | string | OpenSSH authorized_keys line |
| `requestedSftpUsername` | string | Must match allocation's `username` |
| `createdAt` | RFC3339 | When the response was created |

---

## SFTP isolation strategy

Each allocation gets a dedicated Linux user (`nabb_` + 8 hex chars) and a chroot jail.

- **ChrootDirectory**: `/repos/{username}` — root:root 0755 (OpenSSH requirement)
- **Data directory**: `/repos/{username}/repository` — `{username}:nasbb` 0700
- **AuthorizedKeysFile**: `/state/users/{username}/authorized_keys` — 0600
- **`StrictModes no`**: required because `authorized_keys` lives on a Docker volume where OpenSSH cannot verify the ownership chain of parent directories
- No symlinks anywhere under `/repos/` or `/state/`
- `ForceCommand internal-sftp` prevents shell access
- `AllowTcpForwarding no` prevents tunneling

Username format: `nabb_` + first 8 hex chars of the allocation's 12-char hex segment. Max 32 chars. Valid Linux username characters only.

---

## Quota strategy

All v1 allocations use **soft quota** (`quotaMode: "soft"`).

A background goroutine polls every 60 seconds using `du -sb /repos/{username}/repository` for each allocation in `READY` or `SUSPENDED` state.

**`quotaState` transitions**:

| Condition | quotaState | Effect |
|-----------|-----------|--------|
| `usedBytes >= quotaBytes × (1 - criticalThresholdPercent/100)` | `"critical"` | If READY: clear `authorized_keys`, set `quotaEnforcedSuspend=true`, transition READY→SUSPENDED |
| `usedBytes >= quotaBytes × (1 - warningThresholdPercent/100)` | `"warning"` | Log `quota.warning` on first entry |
| Otherwise | `"ok"` | If transitioning from critical and `quotaEnforcedSuspend`: restore key, clear flag, SUSPENDED→READY |

`POST /resume` runs a synchronous poll before re-authorizing. If `quotaState == "critical"` after the poll, it returns `409 QUOTA_STILL_CRITICAL`.

Warning threshold does not block access. Only critical blocks access.

---

## Access window policy

Fields `accessWindowEnabled`, `accessWindowStart`, `accessWindowEnd`, and `accessWindowEnforcement` are stored and returned in all allocation responses. `accessWindowEnforcement` is always `"future"` in v1 — **no scheduler exists**. The UI must display an "access window not yet enforced" label next to any configured window.

---

## Bandwidth policy

`bandwidthCapBytesPerSecond` is stored and returned for observability. No traffic shaping (`tc`/`iptables`) is implemented in v1. The value is advisory only. Hard enforcement requires infrastructure changes (e.g., network namespace QoS).

---

## SFTP bind and exposure model

Default: `NASBB_SFTP_BIND=127.0.0.1` — SFTP is loopback-only and not reachable by remote owners.

To allow owner access over Tailscale:
1. Set `NASBB_SFTP_BIND=<tailscale-ip>` in `.env`
2. Set `TAILSCALE_ADDRESS=<tailscale-ip>` in `.env`
3. Restart the stack

If `NASBB_SFTP_BIND` is not `127.0.0.1`/`::1`/`100.x.x.x` AND `TAILSCALE_ADDRESS` is empty, the agent logs a `SECURITY WARNING` at startup and sets `sftpPublicExposureWarning: true` in `/health` and `/sftp/status` responses. The UI should surface this prominently.

---

## Host key persistence

The SFTP container generates an Ed25519 host key into `nasbb-state` named volume on first start. The key survives:
- Container image rebuilds
- `docker compose down` / `docker compose up`
- Agent restarts

The key is lost only if `nasbb-state` volume is explicitly deleted (`docker volume rm nasbb-state`). If this happens, all owner machines will see an SSH host key mismatch and must update their `~/.ssh/known_hosts`.

---

## SFTP restart behaviour

The reload-watcher polls for `/state/reload-trigger` every 5 seconds. When triggered (e.g., by invite import or key deauthorization), it re-runs user setup and sends `SIGHUP` to sshd. Active SFTP transfers are interrupted for up to 10 seconds.

Kopia's content-addressable format makes partial uploads safe — orphaned packs are cleaned by `kopia snapshot gc`. Schedule allocation changes outside known backup windows to avoid interruption.

---

## Security decisions

1. **Localhost-only API**: `docker-compose.yml` hardcodes `127.0.0.1:7420` — the API is never exposed to the network.
2. **Bearer token auth**: all routes except `GET /info` require a token. Token stored at `/config/agent.token` (mode 0600).
3. **No owner secrets stored in plaintext**: only the SSH public key (not private key) is stored. Backup encryption keys never touch the agent.
4. **`ownerPublicKey` never returned**: omitted from all GET/LIST API responses.
5. **Log redaction**: three patterns applied to all log lines and event messages — public keys, Bearer tokens, config file paths.
6. **Chroot + `StrictModes no`**: chroot enforces per-user isolation; `StrictModes no` is required for Docker volume mounts where OpenSSH cannot verify directory ownership.
7. **`ForceCommand internal-sftp` + `AllowTcpForwarding no`**: prevents shell access and tunneling.

---

## Implementation invariants

These are verified by `tests/scripts/verify.sh` and `tests/integration/api_test.go`:

1. Key A cannot authenticate as username B.
2. Username A's chroot cannot list or access `repository/` belonging to username B.
3. Suspending or retiring allocation A does not modify allocation B's `authorized_keys` or state.
4. SFTP host key fingerprint is identical before and after a container image rebuild (volume not deleted).
5. Every `/api/v1/*` route except `GET /api/v1/info` returns 401 without a valid token.
6. No SSH public key material and no Bearer token appears in `events.jsonl` or any API response.
7. `quotaMode` is always `"soft"` in v1. Never absent, never `"hard"`.
8. `POST /owner-response` returns 409 when `now > inviteExpiresAt`. SFTP access not granted.
9. When `quotaState` → `"critical"` on a READY allocation, `authorized_keys` is cleared and `quotaEnforcedSuspend` is set. Warning does not block access.
10. `POST /retire` removes SFTP access; `/repos/{username}/` and its contents are not deleted.

---

## Known v1 limitations

1. **Soft quota only**: 60-second polling granularity. Hard quota requires ZFS dataset quota or XFS project quota — both are infrastructure changes, no agent code change needed.
2. **Advisory bandwidth**: cap fields stored and returned; no `tc`/iptables enforcement.
3. **Access windows not enforced**: fields exist, `accessWindowEnforcement: "future"`.
4. **SFTP reload pause**: up to 10 s interruption when allocations change. Kopia retries safely.
5. **Host-managed Tailscale**: operator installs Tailscale externally; `TAILSCALE_ADDRESS` provides the address to the agent.
6. **Retirement does not delete data**: host operator cleans up `/repos/{username}/` manually after confirming retirement.
7. **No signed health reports**: unsigned; suitable for local UI. Web app will require signing.
8. **Ed25519 host key only**: single host key type; RSA/ECDSA host keys not generated.

---

## UI integration notes

- **Discovery**: call `GET /api/v1/info` (no auth). If `ready: true`, the agent is running.
- **Token entry**: prompt the user to paste the token shown in container logs on first start.
- **Recommended polling**: health every 30 s (`GET /health`), events every 60 s (`GET /events?limit=50`).
- **Bundle file format**: Host Invite Bundle and Owner Access Response are JSON files. Use a file picker for import/export.
- **`quotaState` display**: `"ok"` → green, `"warning"` → yellow (access still active), `"critical"` → red (SFTP blocked, `quotaEnforcedSuspend: true`).
- **`accessWindowEnforcement: "future"`**: display "Access window configured — not yet enforced" rather than implying it is active.
- **`publicExposureWarning: true`**: show a prominent warning banner — SFTP may be publicly accessible without Tailscale protection.
- **Invite expiry**: `expiresAt` in the bundle is 90 days from generation. Display a countdown; prompt the host to re-invite if expired.
