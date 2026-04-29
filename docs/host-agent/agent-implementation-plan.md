# NAS Backup Buddy — Docker Host Agent: Agent Implementation Plan

## How to Use This Document

You are an implementation agent. Read this document once before writing any code.
Every architectural and structural decision is pre-decided here. Do not re-decide
them. If you encounter a genuine gap, choose the simplest option consistent with
existing decisions and note it in your stage report.

Work through stages 0–11 in order. At the end of every stage output a Stage Report
(template in *Stage Gates*). Do not proceed until every verification command in the
current stage passes.

---

## Before You Start

**Repo root**: the directory containing `apps/`, `docs/`, `CLAUDE.md`. All relative
paths in this document are from the repo root.

**Working directory for Go commands**: `apps/host-agent/` unless stated otherwise.

**Required tools on the build host** (confirm before starting):
```
docker --version        # Docker Engine 24+
docker compose version  # Compose v2 plugin (not docker-compose v1)
go version              # Go 1.22+
jq --version            # jq 1.6+
ssh-keygen -t ed25519 -help 2>&1 | head -1   # OpenSSH keygen
sftp -V 2>&1            # sftp client (openssh-client on Linux, built-in on macOS)
```

**Target runtime OS**: Linux (Ubuntu 22.04+ or Linux Mint 21+). Build host may be macOS
or Linux. All Docker containers run Alpine 3.19.

**No docker-compose v1**. Use `docker compose` (space, not hyphen) throughout.

---

## Pre-Decided Architecture

### Stack overview

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

### Language and dependencies

Go 1.22+. `apps/host-agent/go.mod` module path: `github.com/nasbb/host-agent`.

| Module | Version | Purpose |
|--------|---------|---------|
| `github.com/go-chi/chi/v5` | v5.1.0 | HTTP router |
| `github.com/rs/zerolog` | v1.32.0 | Structured JSON logging |
| `github.com/google/uuid` | v1.6.0 | UUID generation |
| `golang.org/x/crypto` | v0.22.0 | SSH public key parsing |

No ORM. No heavy frameworks. All state is plain JSON files.

### Go package names

| Directory under `apps/host-agent/src/` | Package name |
|----------------------------------------|-------------|
| (root: `src/`) | `main` |
| `api/` | `api` |
| `allocation/` | `allocation` |
| `sftp/` | `sftp` |
| `overlay/` | `overlay` |
| `bundle/` | `bundle` |
| `config/` | `config` |
| `events/` | `events` |
| `health/` | `health` |

Test files in `tests/integration/` use `package integration`.

### Container layout

**nasbb-agent**
- Build stage: `golang:1.22-alpine`; runtime: `alpine:3.19`
- Binary: `/usr/local/bin/nasbb-agent`
- Binds inside container on `0.0.0.0:7420`; Docker `ports` restricts host exposure to `127.0.0.1:7420`
- Volumes (RW): `nasbb-config:/config`, `nasbb-state:/state`, `nasbb-repos:/repos`, `nasbb-logs:/logs`
- No Docker socket. No Tailscale socket mount in default compose.

**nasbb-sftp**
- Build: `alpine:3.19` + openssh + jq
- Binds sshd on `0.0.0.0:2222` inside container; Docker `ports` restricts to `${NASBB_SFTP_BIND:-127.0.0.1}:2222` on host
- Volumes: `nasbb-state:/state` (RW — writes SFTP host keys on first run), `nasbb-repos:/repos` (RW)

### Shared volume layout

No symlinks anywhere. No allocId-named directories under `/repos/`.

```
nasbb-config/
  config.json
  agent.token                           # mode 0600
  allocations/
    {allocId}.json

nasbb-state/
  sftp-host-keys/
    ssh_host_ed25519_key                # generated once, persists across rebuilds
    ssh_host_ed25519_key.pub
  users/
    {username}/                         # e.g. nabb_a1b2c3d4
      user.json                         # {"username":"…","allocId":"…","active":true}
      authorized_keys                   # OpenSSH format; empty when inactive
  reload-trigger                        # agent creates; sftp entrypoint deletes after reload

nasbb-repos/
  {username}/                           # root:root 0755  ← OpenSSH ChrootDirectory
    repository/                         # {username}:nasbb 0700  ← data dir

nasbb-logs/
  events.jsonl                          # append-only redacted JSONL
```

`sshd_config` uses `ChrootDirectory /repos/%u` and `AuthorizedKeysFile /state/users/%u/authorized_keys`.
Both `%u` tokens expand to the Linux username, which is the directory name in both paths.

### Allocation state machine

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

Valid transitions table:

| From | To | Trigger |
|------|----|---------|
| DRAFT | PENDING_KEY | `POST /invite` |
| PENDING_KEY | READY | `POST /owner-response` |
| PENDING_KEY | EXPIRED | Background check: now > `inviteExpiresAt` |
| EXPIRED | PENDING_KEY | `POST /invite` (re-issue, new `inviteExpiresAt`) |
| READY | SUSPENDED | `POST /suspend` |
| SUSPENDED | READY | `POST /resume` (blocked if `quotaState == "critical"`) |
| DRAFT\|PENDING_KEY\|EXPIRED\|READY\|SUSPENDED | RETIRING | `POST /retire` |
| RETIRING | RETIRED | Background check: grace period elapsed |

`quotaEnforcedSuspend bool` (in allocation JSON) — set to `true` when the quota
poller suspends access. Cleared only when the quota poller sees usage drop below
critical threshold. Manual `/suspend` and `/resume` do NOT read or write this flag.

### Config schema

```json
{
  "schemaVersion": 1,
  "hostLabel": "My NAS",
  "storageRoot": "/repos",
  "advertisedCapacityBytes": 0,
  "defaultQuotaBytes": 53687091200,
  "defaultWarningThresholdPercent": 15,
  "defaultCriticalThresholdPercent": 5,
  "sftpPort": 2222,
  "sftpBindAddress": "127.0.0.1",
  "bandwidthCapBytesPerSecond": 0,
  "createdAt": "2026-04-28T00:00:00Z",
  "updatedAt": "2026-04-28T00:00:00Z"
}
```

Patchable via `PATCH /api/v1/config`: `hostLabel`, `advertisedCapacityBytes`,
`defaultQuotaBytes`, `defaultWarningThresholdPercent`, `defaultCriticalThresholdPercent`,
`bandwidthCapBytesPerSecond`.

`sftpPort` and `sftpBindAddress` are read from env at startup and written to config for
observability only; they are not writable via the API.

### Allocation schema

```json
{
  "schemaVersion": 1,
  "allocId": "alloc_a1b2c3d4e5f6",
  "matchId": "match-x7y8z9",
  "connectionName": "Alice offsite backup",
  "state": "DRAFT",
  "username": "nabb_a1b2c3d4",
  "repoPath": "/repos/nabb_a1b2c3d4/repository",
  "quotaBytes": 53687091200,
  "quotaMode": "soft",
  "quotaState": "ok",
  "quotaEnforcedSuspend": false,
  "usedBytes": 0,
  "warningThresholdPercent": 15,
  "criticalThresholdPercent": 5,
  "ownerDeviceLabel": "",
  "ownerPublicKey": "",
  "inviteExpiresAt": "",
  "inviteExportedAt": "",
  "ownerKeyImportedAt": "",
  "suspendedAt": "",
  "retirementInitiatedAt": "",
  "retirementGraceDays": 7,
  "retiredAt": "",
  "bandwidthCapBytesPerSecond": 0,
  "accessWindowEnabled": false,
  "accessWindowStart": "",
  "accessWindowEnd": "",
  "accessWindowEnforcement": "future",
  "lastQuotaCheckAt": "",
  "lastOwnerWriteAt": "",
  "createdAt": "2026-04-28T00:00:00Z",
  "updatedAt": "2026-04-28T00:00:00Z"
}
```

`accessWindowEnforcement` is always `"future"` in v1. Never change this value.

### ID formats

- `allocId`: `alloc_` + 12 random lowercase hex chars → `alloc_a1b2c3d4e5f6`
- `matchId`: `match-` + 6 random lowercase alphanumeric chars → `match-x7y8z9`
- `username`: `nabb_` + first 8 hex chars of the allocId hex part → `nabb_a1b2c3d4`
  Max 32 chars, valid Linux username characters only.

### Full API contract

**Auth**: all routes require `Authorization: Bearer {token}` except `GET /api/v1/info`.

**Format**: `Content-Type: application/json`. Timestamps: RFC3339 UTC. Bytes: int64.

**Status codes**: 200, 201, 400, 401, 404, 409, 500.

**Error body** (all non-2xx):
```json
{ "error": "human-readable message", "code": "MACHINE_CODE" }
```

Machine codes: `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_STATE`, `INVALID_KEY`,
`INVITE_EXPIRED`, `QUOTA_STILL_CRITICAL`, `ALLOC_ID_MISMATCH`,
`MATCH_ID_MISMATCH`, `INTERNAL`.

---

#### `GET /api/v1/info` — no auth required
```json
{ "version": "0.1.0", "ready": true }
```

#### `GET /api/v1/status`
```json
{
  "agentVersion": "0.1.0",
  "startedAt": "...",
  "configLoaded": true,
  "allocationCount": 2,
  "readyCount": 1,
  "storageRoot": "/repos",
  "storageAvailableBytes": 107374182400,
  "storageTotalBytes": 214748364800
}
```

#### `GET /api/v1/config`
Returns full config JSON. Never includes token.

#### `PATCH /api/v1/config`
Request: any subset of patchable config fields. Response: updated config JSON.

#### `GET /api/v1/health`
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
      "lastOwnerWriteAt": "..."
    }
  ],
  "recentEvents": []
}
```

`sftpPublicExposureWarning` is `true` when `NASBB_SFTP_BIND` is not `127.0.0.1`/`::1`/
a `100.x.x.x` address AND `TAILSCALE_ADDRESS` is empty.

#### `GET /api/v1/overlay/status`
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

#### `GET /api/v1/sftp/status`
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

#### `GET /api/v1/storage/status`
```json
{
  "storageRoot": "/repos",
  "totalBytes": 214748364800,
  "availableBytes": 107374182400,
  "usedBytes": 107374182400,
  "allocationCount": 2
}
```

#### `GET /api/v1/allocations`
Response: `{ "allocations": [ ...AllocationSummary ] }`
AllocationSummary = full allocation JSON minus `ownerPublicKey`.

#### `POST /api/v1/allocations`
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
Side effects: generates allocId, matchId, username; creates `/repos/{username}/`
(root:root 0755) and `/repos/{username}/repository/` (root:root 0755 initially —
SFTP entrypoint corrects ownership to `{username}:nasbb 0700` on next reload);
creates `/state/users/{username}/user.json` and empty `authorized_keys` (0600);
triggers SFTP reload.

#### `GET /api/v1/allocations/{allocId}`
Response: AllocationSummary. 404 if not found.

#### `PATCH /api/v1/allocations/{allocId}`
Patchable: `connectionName`, `quotaBytes`, `bandwidthCapBytesPerSecond`,
`warningThresholdPercent`, `criticalThresholdPercent`, `accessWindowEnabled`,
`accessWindowStart`, `accessWindowEnd`, `retirementGraceDays`.

#### `POST /api/v1/allocations/{allocId}/invite`
Accepted states: `DRAFT`, `EXPIRED`.
Transitions: DRAFT→PENDING_KEY, EXPIRED→PENDING_KEY.
Sets `inviteExpiresAt = now + 90 days`, `inviteExportedAt = now`.
Response: Host Invite Bundle JSON.
409 `INVALID_STATE` if not DRAFT or EXPIRED.

#### `POST /api/v1/allocations/{allocId}/owner-response`
Accepted state: `PENDING_KEY`.
Request: Owner Access Response JSON.
Validates: `kind`, `allocId` match (→`ALLOC_ID_MISMATCH`), `matchId` match
(→`MATCH_ID_MISMATCH`), valid SSH public key (→`INVALID_KEY`),
`now < inviteExpiresAt` (→`INVITE_EXPIRED`).
On success: writes `ownerPublicKey` to allocation JSON and to
`/state/users/{username}/authorized_keys`; sets `user.json` active: true;
triggers reload; transitions to READY; logs `key.authorized`.
Response: AllocationSummary.

#### `POST /api/v1/allocations/{allocId}/suspend`
Accepted state: `READY`.
Truncates `authorized_keys`; sets `user.json` active: false; triggers reload;
sets `suspendedAt`; transitions to SUSPENDED.
Does NOT modify `quotaEnforcedSuspend`.

#### `POST /api/v1/allocations/{allocId}/resume`
Accepted state: `SUSPENDED`.
Runs a synchronous quota poll first. If `quotaState == "critical"`,
returns `409 QUOTA_STILL_CRITICAL`.
On success: writes `ownerPublicKey` back to `authorized_keys`; sets
`user.json` active: true; triggers reload; clears `suspendedAt`;
transitions to READY; logs `allocation.resumed`.

#### `POST /api/v1/allocations/{allocId}/retire`
Accepted states: all except RETIRING, RETIRED.
Request: `{ "graceDays": 7 }` (optional, defaults to `retirementGraceDays`).
Truncates `authorized_keys`; sets `user.json` active: false; triggers reload;
sets `retirementInitiatedAt`; transitions to RETIRING.
Does NOT delete `/repos/{username}/`.

#### `GET /api/v1/events`
Query: `?limit=50` (max 200), `?after=<RFC3339>`.
Response: `{ "events": [...] }` descending by timestamp.
```json
{
  "eventId": "evt_...",
  "timestamp": "...",
  "kind": "allocation.created|invite.exported|key.authorized|key.deauthorized|sftp.reload|quota.warning|quota.critical|quota.restored|allocation.suspended|allocation.resumed|allocation.retiring|allocation.retired|invite.expired",
  "allocId": "alloc_...",
  "message": "redacted human-readable summary"
}
```

### Bundle schemas

**Host Invite Bundle** (response of `POST /invite`, also safe to write to file):
```json
{
  "bundleVersion": 1,
  "kind": "nasbb.host_invite",
  "hostAgentVersion": "0.1.0",
  "matchId": "match-x7y8z9",
  "allocId": "alloc_a1b2c3d4e5f6",
  "connectionName": "Alice offsite backup",
  "overlay": {
    "provider": "tailscale",
    "host": "100.64.0.1",
    "note": "Host SFTP is reachable at this Tailscale address."
  },
  "sftp": {
    "host": "100.64.0.1",
    "port": 2222,
    "username": "nabb_a1b2c3d4",
    "path": "/repository"
  },
  "quota": { "quotaBytes": 53687091200, "quotaMode": "soft" },
  "hostKey": {
    "fingerprintSha256": "SHA256:...",
    "verificationNote": "Verify out-of-band before trusting the first connection."
  },
  "expiresAt": "2026-07-28T00:00:00Z"
}
```

When `TAILSCALE_ADDRESS` is not set: `overlay.host` and `sftp.host` are `""`;
`overlay.note` is `"SFTP host address not configured. Set TAILSCALE_ADDRESS before generating invites."`.

**Owner Access Response** (body of `POST /owner-response`):
```json
{
  "bundleVersion": 1,
  "kind": "nasbb.owner_access_response",
  "matchId": "match-x7y8z9",
  "allocId": "alloc_a1b2c3d4e5f6",
  "ownerDeviceLabel": "owner-laptop",
  "ownerPublicKey": "ssh-ed25519 AAAA...",
  "requestedSftpUsername": "nabb_a1b2c3d4",
  "createdAt": "..."
}
```

### Security constraints — implement exactly, no exceptions

1. Docker `ports` spec for nasbb-agent: `"127.0.0.1:${PORT}:7420"`. Agent binary
   binds `0.0.0.0:7420` inside the container; Docker restricts host-side exposure.
2. Token priority on startup: (a) `NASBB_API_TOKEN` env var if set — use it, write to
   `/config/agent.token` (mode 0600); (b) else read existing `/config/agent.token`;
   (c) else generate 32 `crypto/rand` bytes, hex-encode, write (mode 0600), print banner:
   ```
   ╔══════════════════════════════════════════════════════════╗
   ║  NASBB AGENT TOKEN                                       ║
   ║  {token}                                                 ║
   ║  Copy this into your desktop UI's agent settings.        ║
   ║  It will not be displayed again.                         ║
   ╚══════════════════════════════════════════════════════════╝
   ```
3. `GET /api/v1/info` is the only unauthenticated route.
4. API responses never include `ownerPublicKey`, token value, or raw filesystem paths.
5. Log redaction — apply to all log lines and event messages before writing:
   - `ssh-[a-z0-9]+ AAAA[A-Za-z0-9+/=]+` → `[REDACTED-PUBLIC-KEY]`
   - `Bearer [A-Fa-f0-9]{64}` → `[REDACTED-TOKEN]`
   - `/config/[^\s"]*` → `[CONFIG-PATH]`
6. `/state/users/{username}/authorized_keys` — mode 0600 inside SFTP container.
7. `/repos/{username}` — root:root 0755 (OpenSSH chroot requirement).
8. `/repos/{username}/repository` — {username}:nasbb 0700.
9. `sshd_config` must include: `PermitRootLogin no`, `PasswordAuthentication no`,
   `ForceCommand internal-sftp`, `AllowTcpForwarding no`, `StrictModes no`.
   `StrictModes no` is required because `authorized_keys` lives on a shared Docker
   volume where OpenSSH cannot verify ownership chain without this setting.
10. Startup exposure check: if `NASBB_SFTP_BIND` is not `127.0.0.1`/`::1`/`100.*`
    and `TAILSCALE_ADDRESS` is empty, log at WARN level and set
    `sftpPublicExposureWarning: true` in health/sftp-status responses.

### Tailscale integration (v1)

Check `TAILSCALE_ADDRESS` env var. If set: `mode: "env-configured"`, `available: true`,
`hostAddress: <value>`. If not set: `mode: "unconfigured"`, `available: false`.
Never fail startup on Tailscale status.

### Quota strategy

All v1 allocations: `quotaMode: "soft"`. Background goroutine (60-second ticker):
for each allocation in READY or SUSPENDED state, run:
```
du -sb /repos/{username}/repository
```
Parse bytes from first field. Update `usedBytes`, `lastQuotaCheckAt`.

Thresholds (evaluated after every poll):
- `usedBytes >= quotaBytes * (1 - criticalThresholdPercent/100)` → `quotaState: "critical"`.
  If state is READY: truncate `authorized_keys`, set `user.json` active: false,
  trigger reload, set `quotaEnforcedSuspend: true`, transition to SUSPENDED,
  log `quota.critical`.
- Else if `usedBytes >= quotaBytes * (1 - warningThresholdPercent/100)` →
  `quotaState: "warning"`. Log `quota.warning` on first entry only.
- Else → `quotaState: "ok"`. If transitioning from warning/critical: log `quota.restored`.
  If transitioning from critical and `quotaEnforcedSuspend == true`: re-authorize key,
  clear `quotaEnforcedSuspend`, transition SUSPENDED→READY.

### Access window policy (v1)

Fields stored and returned. `accessWindowEnforcement: "future"` always. No scheduler.

### SFTP restart behaviour

Container reload triggered by `/state/reload-trigger` interrupts active transfers.
Kopia's content-addressable format makes partial uploads safe; `kopia snapshot gc`
cleans orphaned packs. Document in `runbook.md`: schedule allocation changes outside
known backup windows.

### Host key persistence

SFTP host key generated into `nasbb-state` named volume on first SFTP container start.
Survives container image rebuilds and `docker compose down/up`. Lost only if
`nasbb-state` volume is explicitly deleted.

---

## Repository Layout

```
apps/host-agent/
  Makefile
  go.mod
  go.sum
  docker/
    agent/
      Dockerfile
      entrypoint.sh
    sftp/
      Dockerfile
      sshd_config
      entrypoint.sh
      reload-watcher.sh
  src/
    main.go
    api/
      server.go
      handlers.go
      middleware.go
    allocation/
      manager.go
      model.go
      lifecycle.go
    sftp/
      manager.go
      quota.go
      keys.go
    overlay/
      tailscale.go
    bundle/
      invite.go
      response.go
    config/
      config.go
    events/
      log.go
    health/
      health.go
  tests/
    integration/
      api_test.go
      allocation_test.go
      sftp_test.go
    scripts/
      verify.sh
  compose/
    docker-compose.yml
    .env.example
docs/host-agent/
  docker-host-agent-implementation.md  (source brief — do not modify)
  agent-implementation-plan.md         (this document)
  api-contract.md                      (produced in Stage 11)
  runbook.md                           (produced in Stage 10)
```

---

## Implementation Invariants

The test suite in Stage 10 must prove each one.

1. **Cross-allocation key isolation**: Key A cannot authenticate as username B.
2. **Cross-allocation path isolation**: Username A's chroot cannot list or access `repository/` belonging to username B.
3. **Suspension isolation**: Suspending or retiring allocation A does not modify allocation B's `authorized_keys` or state.
4. **Host key stability**: SFTP host key fingerprint is identical before and after a container image rebuild (volume not deleted).
5. **Auth coverage**: Every `/api/v1/*` route except `GET /api/v1/info` returns 401 without a valid token.
6. **No secret leakage**: No SSH public key material and no Bearer token appears in `events.jsonl` or any API response.
7. **Quota mode honesty**: `quotaMode` is always `"soft"` in v1. Never absent, never `"hard"`.
8. **Invite expiry enforced**: `POST /owner-response` returns 409 when `now > inviteExpiresAt`. SFTP access not granted.
9. **Quota critical = full block**: When `quotaState` → `"critical"` on a READY allocation, `authorized_keys` is cleared and `quotaEnforcedSuspend` is set. Warning does not block access.
10. **Retirement preserves data**: `POST /retire` removes SFTP access; `/repos/{username}/` and its contents are not deleted.

---

## Stage Gates

```
=== STAGE REPORT: Stage {N} — {Name} ===
Status: COMPLETE | BLOCKED
Files created:
  - relative/path/from/repo-root
Files modified:
  - relative/path/from/repo-root
Verification:
  Command: <exact command>
  Output: <trimmed actual output>
  Pass: YES | NO
Issues: <none | description of any deviation>
Next: Stage {N+1} — {Name}
```

BLOCKED means stop. Describe the blocker. Do not continue.

---

## Stage 0: Repository Scaffold and Tooling

**Goal**: Directory tree, Go module, Makefile, Dockerfiles, sshd_config — no Go logic.

### Steps

1. Create directory tree:
   ```bash
   mkdir -p apps/host-agent/{docker/{agent,sftp},src/{api,allocation,sftp,overlay,bundle,config,events,health},tests/{integration,scripts},compose,bin}
   mkdir -p docs/host-agent
   ```

2. Create `apps/host-agent/go.mod`:
   ```
   module github.com/nasbb/host-agent

   go 1.22

   require (
     github.com/go-chi/chi/v5 v5.1.0
     github.com/google/uuid v1.6.0
     github.com/rs/zerolog v1.32.0
     golang.org/x/crypto v0.22.0
   )
   ```

3. Run from `apps/host-agent/`:
   ```bash
   go mod tidy
   ```

4. Create `apps/host-agent/Makefile`:
   ```makefile
   .PHONY: build test lint docker-build docker-up docker-down verify

   build:
   	go build -o bin/nasbb-agent ./src/...

   test:
   	go test ./tests/...

   lint:
   	go vet ./src/... ./tests/...

   docker-build:
   	docker compose -f compose/docker-compose.yml build

   docker-up:
   	docker compose -f compose/docker-compose.yml up -d

   docker-down:
   	docker compose -f compose/docker-compose.yml down

   verify:
   	bash tests/scripts/verify.sh
   ```

5. Create `apps/host-agent/src/main.go` (stub):
   ```go
   package main

   import "fmt"

   func main() { fmt.Println("nasbb-agent scaffold") }
   ```

6. Create `apps/host-agent/docker/agent/Dockerfile`:
   ```dockerfile
   FROM golang:1.22-alpine AS builder
   WORKDIR /build
   COPY go.mod go.sum ./
   RUN go mod download
   COPY src/ ./src/
   RUN go build -o /nasbb-agent ./src/...

   FROM alpine:3.19
   RUN apk add --no-cache ca-certificates tzdata coreutils
   COPY --from=builder /nasbb-agent /usr/local/bin/nasbb-agent
   COPY docker/agent/entrypoint.sh /entrypoint.sh
   RUN chmod +x /entrypoint.sh
   ENTRYPOINT ["/entrypoint.sh"]
   ```
   `coreutils` provides GNU `du` with reliable `-sb` (bytes) support.

7. Create `apps/host-agent/docker/agent/entrypoint.sh`:
   ```sh
   #!/bin/sh
   set -e
   exec /usr/local/bin/nasbb-agent "$@"
   ```

8. Create `apps/host-agent/docker/sftp/Dockerfile`:
   ```dockerfile
   FROM alpine:3.19
   RUN apk add --no-cache openssh shadow bash jq
   RUN addgroup -S nasbb
   COPY docker/sftp/sshd_config /etc/ssh/sshd_config
   COPY docker/sftp/entrypoint.sh /entrypoint.sh
   COPY docker/sftp/reload-watcher.sh /reload-watcher.sh
   RUN chmod +x /entrypoint.sh /reload-watcher.sh
   EXPOSE 2222
   ENTRYPOINT ["/entrypoint.sh"]
   ```
   No `ssh-keygen -A` — host keys are generated into the state volume on first run.

9. Create `apps/host-agent/docker/sftp/sshd_config`:
   ```
   Port 2222
   ListenAddress 0.0.0.0
   HostKey /state/sftp-host-keys/ssh_host_ed25519_key
   PermitRootLogin no
   PasswordAuthentication no
   ChallengeResponseAuthentication no
   UsePAM no
   StrictModes no
   X11Forwarding no
   AllowTcpForwarding no
   PrintMotd no
   Subsystem sftp internal-sftp
   AuthorizedKeysFile /state/users/%u/authorized_keys
   Match Group nasbb
     ForceCommand internal-sftp
     ChrootDirectory /repos/%u
     AllowTcpForwarding no
     X11Forwarding no
   ```
   `StrictModes no`: required because `authorized_keys` is on a shared Docker volume
   where OpenSSH cannot verify the ownership chain of intermediate directories.

10. Create placeholder scripts (empty, implementation in Stage 3):
    ```bash
    touch apps/host-agent/docker/sftp/entrypoint.sh
    touch apps/host-agent/docker/sftp/reload-watcher.sh
    chmod +x apps/host-agent/docker/sftp/entrypoint.sh
    chmod +x apps/host-agent/docker/sftp/reload-watcher.sh
    ```

11. Create empty `apps/host-agent/compose/docker-compose.yml` and `compose/.env.example`.

### Verification

```bash
cd apps/host-agent
go build ./src/... 2>&1
go vet ./src/... 2>&1
ls docker/agent/Dockerfile docker/sftp/Dockerfile docker/sftp/sshd_config
grep "StrictModes no" docker/sftp/sshd_config
grep "coreutils" docker/agent/Dockerfile
```
Expected: zero errors, all files present, both greps match.

---

## Stage 1: Config, Token, Pairing Endpoint, and API Skeleton

**Goal**: Agent starts, generates/loads token, `GET /api/v1/info` returns 200 without auth,
all other routes return 401 without valid token, `GET /api/v1/status` returns JSON.

### Steps

1. Implement `src/config/config.go` (package `config`):

   `Config` struct with JSON tags matching the config schema above (all fields).

   ```go
   func Load(configDir string) (*Config, error)
   // Reads configDir/config.json. If missing: writes defaults, returns them.
   // Atomic write: write to temp file, os.Rename.

   func Save(cfg *Config, configDir string) error
   // Atomic write.

   func LoadOrSetToken(configDir string) (token string, newly bool, err error)
   // Priority: (a) NASBB_API_TOKEN env → write to configDir/agent.token (0600), newly=false.
   //           (b) read existing configDir/agent.token, newly=false.
   //           (c) generate crypto/rand 32 bytes, hex-encode, write (0600), newly=true.
   ```

2. Implement `src/events/log.go` (package `events`):

   ```go
   type Logger struct { logsDir string }

   func NewLogger(logsDir string) *Logger

   func (l *Logger) Append(kind, allocId, message string) error
   // Redact message, append JSON line to logsDir/events.jsonl.

   type EventRecord struct {
       EventID   string    `json:"eventId"`
       Timestamp time.Time `json:"timestamp"`
       Kind      string    `json:"kind"`
       AllocID   string    `json:"allocId"`
       Message   string    `json:"message"`
   }

   func (l *Logger) Query(limit int, after time.Time) ([]EventRecord, error)
   // Read events.jsonl, filter by after, sort descending, return up to limit.

   func Redact(s string) string
   // Apply the three redaction rules from Security Constraints §5.
   // Exported for use as a zerolog writer wrapper.
   ```

3. Implement `src/api/middleware.go` (package `api`):

   ```go
   func BearerAuth(token string) func(http.Handler) http.Handler
   // Extract "Authorization: Bearer {t}", crypto/subtle.ConstantTimeCompare.
   // On failure: 401 {"error":"unauthorized","code":"UNAUTHORIZED"}.
   ```

4. Implement `src/api/server.go` (package `api`):

   ```go
   type Server struct {
       cfg    *config.Config
       token  string
       events *events.Logger
       // (other deps added in later stages)
   }

   func New(cfg *config.Config, token string, events *events.Logger) *Server

   func (s *Server) Router() http.Handler
   // chi.NewRouter()
   // r.Get("/api/v1/info", s.handleInfo)         // NO middleware
   // r.Group(func(r chi.Router) {
   //     r.Use(BearerAuth(s.token))
   //     r.Get("/api/v1/status", s.handleStatus)
   //     // all other routes: 501 stub for now
   // })
   ```

   `handleInfo`: returns `{"version":"0.1.0","ready":true}`.

   `handleStatus`: returns full status JSON per the API contract (uses `syscall.Statfs`
   for storage bytes, `time.Since` for uptime, `manager.List()` for counts — stub
   counts to 0 until manager is wired in Stage 2).

5. Implement `src/main.go` (package `main`):

   Parse env vars into a struct:
   ```
   NASBB_CONFIG_DIR  default /config
   NASBB_STATE_DIR   default /state
   NASBB_REPOS_DIR   default /repos
   NASBB_LOG_DIR     default /logs
   NASBB_BIND_ADDR   default 0.0.0.0:7420
   NASBB_API_TOKEN   default ""
   TAILSCALE_ADDRESS default ""
   NASBB_SFTP_BIND   default 127.0.0.1
   NASBB_SFTP_PORT   default 2222
   NASBB_SFTP_HOST   default 127.0.0.1
   ```

   `NASBB_SFTP_HOST` is the address the agent uses when probing whether the SFTP
   service is reachable (TCP dial). Inside Docker Compose it is set to `nasbb-sftp`;
   outside Docker it defaults to `127.0.0.1`.

   Startup sequence:
   ```
   config.Load → config.LoadOrSetToken → if newly: print banner
   initialise zerolog (stderr, wrap writer with Redact)
   log startup env values (redacted)
   compute publicExposureWarning; if true: log WARN
   start http.Server
   ```

### Verification

Each stage runs its own fresh agent. Use `NASBB_API_TOKEN` to pre-set the token.

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-token-stage1 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!
sleep 1

# /info — no auth → 200
curl -sf http://127.0.0.1:7420/api/v1/info | jq .ready

# /status — valid token → 200
curl -sf -H "Authorization: Bearer test-token-stage1" \
  http://127.0.0.1:7420/api/v1/status | jq .agentVersion

# /status — no token → 401
curl -s -o /dev/null -w "%{http_code}" \
  http://127.0.0.1:7420/api/v1/status

# /status — wrong token → 401
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrongtoken" \
  http://127.0.0.1:7420/api/v1/status

kill $AGENT_PID; rm -rf "$TMPDIR"
```
Expected: `true`, `"0.1.0"`, `401`, `401`.

---

## Stage 2: Config API, Allocation CRUD, and JSON Persistence

**Goal**: `GET/PATCH /api/v1/config` work. Allocations create/list/get/patch,
persisted as JSON. Repo and state directories created on allocation creation.

### Steps

1. Implement `src/allocation/model.go` (package `allocation`):

   `Allocation` struct with JSON tags matching the allocation schema above.
   All timestamp fields are `string` (RFC3339, empty string = not set).
   Include helper: `func (a *Allocation) Summary() Allocation` — returns copy with
   `OwnerPublicKey` set to `""`.

2. Implement `src/allocation/manager.go` (package `allocation`):

   ```go
   type Manager struct {
       configDir string
       stateDir  string
       reposDir  string
       log       *events.Logger
   }

   func NewManager(configDir, stateDir, reposDir string, log *events.Logger) *Manager

   func (m *Manager) Create(req CreateRequest) (*Allocation, error)
   // CreateRequest: ConnectionName, QuotaBytes, BandwidthCapBytesPerSecond,
   //               AccessWindowEnabled, AccessWindowStart, AccessWindowEnd.
   // Generate allocId (uuid.New().String() → strip hyphens → take 12 chars → prefix "alloc_").
   // Generate matchId ("match-" + 6 random alphanumeric chars).
   // Derive username: "nabb_" + first 8 chars of the 12-char hex segment.
   // Set state DRAFT, quotaMode "soft", quotaState "ok",
   //   accessWindowEnforcement "future", schemaVersion 1.
   // Create directories:
   //   os.MkdirAll(reposDir+"/"+username, 0755)
   //   os.MkdirAll(reposDir+"/"+username+"/repository", 0755)
   //   (SFTP entrypoint corrects /repository ownership to {username}:nasbb on reload)
   // Write configDir/allocations/{allocId}.json (atomic).
   // Log "allocation.created".

   func (m *Manager) List() ([]*Allocation, error)
   // Read all *.json in configDir/allocations/. Ignore non-JSON files.

   func (m *Manager) Get(allocId string) (*Allocation, error)
   // Return NOT_FOUND error if file missing.

   func (m *Manager) Update(allocId string, patch PatchRequest) (*Allocation, error)
   // Apply only non-zero patchable fields. Save atomically.

   func (m *Manager) Save(alloc *Allocation) error
   // Atomic write to configDir/allocations/{allocId}.json.
   // Sets updatedAt = now.

   func (m *Manager) Transition(alloc *Allocation, newState string) error
   // Validate newState is reachable from alloc.State per the state machine table.
   // Set the relevant timestamp field:
   //   PENDING_KEY → inviteExportedAt
   //   READY       → ownerKeyImportedAt
   //   SUSPENDED   → suspendedAt
   //   RETIRING    → retirementInitiatedAt
   //   RETIRED     → retiredAt
   //   EXPIRED     → (no extra timestamp)
   // Save.
   ```

3. Implement handlers in `src/api/handlers.go` (package `api`):
   - `handleGetConfig`, `handlePatchConfig`
   - `handleListAllocations`, `handleCreateAllocation`,
     `handleGetAllocation`, `handlePatchAllocation`
   - All list/get responses must call `.Summary()` to strip `ownerPublicKey`.

4. Wire all handlers into `server.go`. Remove 501 stubs for these routes.
   Pass `*allocation.Manager` into `Server` struct.

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-token-s2 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1

H="Authorization: Bearer test-token-s2"
BASE="http://127.0.0.1:7420/api/v1"

# Config
curl -sf -H "$H" $BASE/config | jq .hostLabel
curl -sf -X PATCH -H "$H" -H "Content-Type: application/json" \
  -d '{"hostLabel":"Test"}' $BASE/config | jq .hostLabel

# Create allocation
A=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"AllocTest","quotaBytes":1073741824}' $BASE/allocations)
AID=$(echo $A | jq -r .allocId)
echo $A | jq '{state,quotaMode,accessWindowEnforcement}'

# List, get, patch
curl -sf -H "$H" $BASE/allocations | jq '.allocations | length'
curl -sf -H "$H" $BASE/allocations/$AID | jq .state
curl -sf -X PATCH -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"Updated"}' $BASE/allocations/$AID | jq .connectionName

# ownerPublicKey must not appear in summary
curl -sf -H "$H" $BASE/allocations/$AID | jq 'has("ownerPublicKey")'

# Files on disk
ls $TMPDIR/config/allocations/
ls $TMPDIR/repos/

kill $AGENT_PID; rm -rf "$TMPDIR"
```
Expected: `hostLabel` updates, allocation state `"DRAFT"`, quotaMode `"soft"`,
accessWindowEnforcement `"future"`, `has("ownerPublicKey")` → `false`, files on disk.

---

## Stage 3: SFTP Container and Per-Match Isolation

**Goal**: SFTP container starts cleanly, creates users from state volume, correct
directory ownership, reload-trigger mechanism works, two users cannot see each other's repo.

### Steps

1. Implement `apps/host-agent/docker/sftp/entrypoint.sh` (final, complete):

   ```bash
   #!/bin/bash
   set -euo pipefail

   STATE_DIR="${STATE_DIR:-/state}"
   REPOS_DIR="${REPOS_DIR:-/repos}"

   # Generate SFTP host key into state volume on first run.
   mkdir -p "$STATE_DIR/sftp-host-keys"
   if [ ! -f "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key" ]; then
     ssh-keygen -t ed25519 -f "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key" -N "" -q
     echo "[nasbb-sftp] Host key generated."
   fi
   chmod 600 "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key"
   chmod 644 "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key.pub"

   setup_users() {
     for user_dir in "$STATE_DIR/users"/*/; do
       [ -d "$user_dir" ] || continue
       USER_JSON="$user_dir/user.json"
       [ -f "$USER_JSON" ] || continue

       USERNAME=$(jq -r '.username // empty' "$USER_JSON")
       [ -n "$USERNAME" ] || continue

       # Create Linux user in nasbb group if missing.
       if ! id "$USERNAME" &>/dev/null; then
         adduser -D -H -G nasbb -s /sbin/nologin "$USERNAME"
       fi

       # Ensure chroot root: root:root 0755
       mkdir -p "$REPOS_DIR/$USERNAME"
       chown root:root "$REPOS_DIR/$USERNAME"
       chmod 755 "$REPOS_DIR/$USERNAME"

       # Ensure data dir: {username}:nasbb 0700
       mkdir -p "$REPOS_DIR/$USERNAME/repository"
       chown "$USERNAME:nasbb" "$REPOS_DIR/$USERNAME/repository"
       chmod 700 "$REPOS_DIR/$USERNAME/repository"

       # Ensure authorized_keys file exists with correct perms.
       AUTH_KEYS="$user_dir/authorized_keys"
       [ -f "$AUTH_KEYS" ] || touch "$AUTH_KEYS"
       chown "$USERNAME" "$AUTH_KEYS"
       chmod 600 "$AUTH_KEYS"
     done
   }

   setup_users

   if [ "${1:-}" = "--reload-only" ]; then
     exit 0
   fi

   /reload-watcher.sh "$STATE_DIR" &
   exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
   ```

2. Implement `apps/host-agent/docker/sftp/reload-watcher.sh` (final, complete):

   ```sh
   #!/bin/sh
   STATE_DIR="${1:-/state}"
   TRIGGER="$STATE_DIR/reload-trigger"
   while true; do
     if [ -f "$TRIGGER" ]; then
       rm -f "$TRIGGER"
       /entrypoint.sh --reload-only 2>&1 | sed 's/^/[reload] /'
       kill -HUP "$(cat /var/run/sshd.pid 2>/dev/null || echo 0)" 2>/dev/null || true
     fi
     sleep 5
   done
   ```

   Note: OpenSSH on Alpine writes its PID to `/var/run/sshd.pid` when started with `-D`.
   If that file is absent, the `kill -HUP` falls back silently; new authorized_keys files
   are still read on the next connection attempt because `AuthorizedKeysFile` is re-read
   per connection by default.

3. Implement `src/sftp/keys.go` (package `sftp`):

   ```go
   // ValidatePublicKey parses and validates an SSH authorized_keys entry.
   // Accepted types: ssh-ed25519, ecdsa-sha2-nistp256, ecdsa-sha2-nistp384,
   //                 ecdsa-sha2-nistp521, ssh-rsa.
   // Returns a non-nil error for malformed or unsupported key types.
   func ValidatePublicKey(keyLine string) error
   // Use golang.org/x/crypto/ssh.ParseAuthorizedKey.
   ```

4. Implement `src/sftp/manager.go` (package `sftp`):

   ```go
   type Manager struct {
       stateDir string
       reposDir string
   }

   func NewManager(stateDir, reposDir string) *Manager

   // ProvisionUser creates state/users/{username}/user.json (active:false)
   // and an empty authorized_keys (mode 0600). Triggers reload.
   func (m *Manager) ProvisionUser(alloc *allocation.Allocation) error

   // AuthorizeKey writes publicKey to authorized_keys, sets user.json active:true.
   // Validates key via ValidatePublicKey before writing. Triggers reload.
   func (m *Manager) AuthorizeKey(alloc *allocation.Allocation, publicKey string) error

   // DeauthorizeKey truncates (does not delete) authorized_keys,
   // sets user.json active:false. Triggers reload.
   func (m *Manager) DeauthorizeKey(username string) error

   // TriggerReload writes state/reload-trigger.
   func (m *Manager) TriggerReload() error

   // GetHostKeyFingerprint reads state/sftp-host-keys/ssh_host_ed25519_key.pub,
   // parses with ssh.ParseAuthorizedKey, returns ssh.FingerprintSHA256(pubKey).
   // Returns "" if the file does not exist yet (SFTP container not started).
   func (m *Manager) GetHostKeyFingerprint() (string, error)
   ```

5. Call `sftp.Manager.ProvisionUser(alloc)` from `allocation.Manager.Create`.
   Wire `*sftp.Manager` into `allocation.Manager`.

### Verification

```bash
cd apps/host-agent
docker build -f docker/sftp/Dockerfile -t nasbb-sftp-test .

STDIR=$(mktemp -d)
RPDIR=$(mktemp -d)

# Seed one user config
mkdir -p "$STDIR/users/nabb_a1b2c3d4"
cat > "$STDIR/users/nabb_a1b2c3d4/user.json" <<'EOF'
{"username":"nabb_a1b2c3d4","allocId":"alloc_a1b2c3d4e5f6","active":false}
EOF
touch "$STDIR/users/nabb_a1b2c3d4/authorized_keys"

docker run -d --name nasbb-sftp-s3 \
  -p 2222:2222 \
  -v "$STDIR:/state" \
  -v "$RPDIR:/repos" \
  nasbb-sftp-test
sleep 3

# Host key generated into state volume
ls "$STDIR/sftp-host-keys/ssh_host_ed25519_key.pub"

# User and directories exist
docker exec nasbb-sftp-s3 id nabb_a1b2c3d4
docker exec nasbb-sftp-s3 stat -c "%U:%G %a" /repos/nabb_a1b2c3d4
docker exec nasbb-sftp-s3 stat -c "%U:%G %a" /repos/nabb_a1b2c3d4/repository

# Add second user via reload trigger
mkdir -p "$STDIR/users/nabb_b1b2c3d4"
cat > "$STDIR/users/nabb_b1b2c3d4/user.json" <<'EOF'
{"username":"nabb_b1b2c3d4","allocId":"alloc_b1b2c3d4e5f6","active":false}
EOF
touch "$STDIR/users/nabb_b1b2c3d4/authorized_keys"
echo "1" > "$STDIR/reload-trigger"
sleep 7

docker exec nasbb-sftp-s3 id nabb_b1b2c3d4

# Cross-isolation: /repos/nabb_b1b2c3d4 contains only "repository", not nabb_a's dir
docker exec nasbb-sftp-s3 ls /repos/nabb_b1b2c3d4

docker rm -f nasbb-sftp-s3
rm -rf "$STDIR" "$RPDIR"
```
Expected: host key generated, user `nabb_a1b2c3d4` is `root:root 755` for chroot dir,
`nabb_a1b2c3d4:nasbb 700` for repository dir, second user added via reload,
`ls /repos/nabb_b1b2c3d4` shows only `repository`.

---

## Stage 4: Bundle Generation, Key Import, and SFTP Authorization

**Goal**: `/invite` generates a valid bundle from DRAFT and EXPIRED states.
`/owner-response` imports a key, SFTP `authorized_keys` is written, state → READY.
Expired invite returns 409.

### Steps

1. Implement `src/overlay/tailscale.go` (package `overlay`):

   ```go
   type Status struct {
       Provider               string
       Mode                   string  // "env-configured" | "unconfigured"
       Available              bool
       HostAddress            string
       SFTPExpectedHost       string
       SFTPPort               int
       PublicExposureWarning  bool
   }

   // GetStatus evaluates TAILSCALE_ADDRESS env and sftpBind to produce a Status.
   // publicExposureWarning = true when sftpBind is not 127.0.0.1, ::1, or 100.x.x.x
   //                         AND tailscaleAddr is "".
   func GetStatus(tailscaleAddr, sftpBind string, sftpPort int) Status
   ```

2. Implement `src/bundle/invite.go` (package `bundle`):

   ```go
   // Generate builds a HostInviteBundle from the allocation, config, overlay status,
   // and SFTP host key fingerprint.
   // expiresAt = time.Now().UTC().AddDate(0, 0, 90).
   // overlay.host and sftp.host = overlayStatus.HostAddress (empty string if unconfigured).
   func Generate(alloc *allocation.Allocation, cfg *config.Config,
       ov overlay.Status, fingerprint string) HostInviteBundle
   ```

3. Implement `src/bundle/response.go` (package `bundle`):

   ```go
   // Parse decodes and validates an Owner Access Response.
   // Returns typed errors for ALLOC_ID_MISMATCH, MATCH_ID_MISMATCH,
   // INVALID_KEY, INVITE_EXPIRED.
   func Parse(data []byte, alloc *allocation.Allocation) (*OwnerAccessResponse, error)
   ```

4. Implement `/invite` and `/owner-response` handlers in `src/api/handlers.go`:

   `handleGenerateInvite`:
   - Accept states: DRAFT, EXPIRED. Else: 409 INVALID_STATE.
   - Call `sftp.GetHostKeyFingerprint()`.
   - Call `bundle.Generate(...)`.
   - Set `alloc.InviteExpiresAt = now+90d`, `alloc.InviteExportedAt = now`.
   - Call `manager.Transition(alloc, "PENDING_KEY")`.
   - Log `invite.exported`.
   - Return bundle JSON.

   `handleImportOwnerResponse`:
   - Accept state: PENDING_KEY. Else: 409 INVALID_STATE.
   - Parse request body with `bundle.Parse(body, alloc)` — propagate typed errors.
   - If `INVITE_EXPIRED` error: return 409.
   - Call `sftp.AuthorizeKey(alloc, resp.OwnerPublicKey)`.
   - Set `alloc.OwnerPublicKey = resp.OwnerPublicKey`, `alloc.OwnerDeviceLabel`.
   - Set `alloc.OwnerKeyImportedAt = now`.
   - Call `manager.Transition(alloc, "READY")`.
   - Log `key.authorized`.
   - Return AllocationSummary (ownerPublicKey stripped).

5. Wire `*overlay.Status`, `*bundle` functions, and `*sftp.Manager` into Server.

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-s4 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1

H="Authorization: Bearer test-s4"
BASE="http://127.0.0.1:7420/api/v1"

AID=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"S4Test","quotaBytes":1073741824}' $BASE/allocations | jq -r .allocId)

# Invite from DRAFT
INVITE=$(curl -sf -X POST -H "$H" $BASE/allocations/$AID/invite)
echo "$INVITE" | jq .kind
curl -sf -H "$H" $BASE/allocations/$AID | jq .state  # PENDING_KEY

# Owner response
ssh-keygen -t ed25519 -f $TMPDIR/test-key -N "" -q
PUB=$(cat $TMPDIR/test-key.pub)
MATCHID=$(echo "$INVITE" | jq -r .matchId)
USR=$(curl -sf -H "$H" $BASE/allocations/$AID | jq -r .username)
RESP=$(jq -n --arg mid "$MATCHID" --arg aid "$AID" --arg key "$PUB" --arg usr "$USR" \
  '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$mid,allocId:$aid,
    ownerDeviceLabel:"test",ownerPublicKey:$key,requestedSftpUsername:$usr,
    createdAt:"2026-04-28T00:00:00Z"}')
curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d "$RESP" $BASE/allocations/$AID/owner-response | jq .state  # READY

grep "ssh-ed25519" $TMPDIR/state/users/$USR/authorized_keys && echo "PASS: key written"

# Expired invite test
AID2=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"ExpTest","quotaBytes":1073741824}' $BASE/allocations | jq -r .allocId)
curl -sf -X POST -H "$H" $BASE/allocations/$AID2/invite > /dev/null
# Backdate inviteExpiresAt in the allocation JSON
python3 -c "
import json; f='$TMPDIR/config/allocations/$AID2.json'
d=json.load(open(f)); d['inviteExpiresAt']='2020-01-01T00:00:00Z'; json.dump(d,open(f,'w'))"
MATCHID2=$(curl -sf -H "$H" $BASE/allocations/$AID2 | jq -r .matchId)
ssh-keygen -t ed25519 -f $TMPDIR/test-key2 -N "" -q
USR2=$(curl -sf -H "$H" $BASE/allocations/$AID2 | jq -r .username)
RESP2=$(jq -n --arg mid "$MATCHID2" --arg aid "$AID2" \
  --arg key "$(cat $TMPDIR/test-key2.pub)" --arg usr "$USR2" \
  '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$mid,allocId:$aid,
    ownerDeviceLabel:"t",ownerPublicKey:$key,requestedSftpUsername:$usr,
    createdAt:"2026-04-28T00:00:00Z"}')
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$H" \
  -H "Content-Type: application/json" -d "$RESP2" \
  $BASE/allocations/$AID2/owner-response)
[ "$CODE" = "409" ] && echo "PASS: expired invite → 409" || echo "FAIL: got $CODE"

kill $AGENT_PID; rm -rf "$TMPDIR"
```
Expected: invite kind correct, state DRAFT→PENDING_KEY→READY, key in authorized_keys,
expired invite returns 409.

---

## Stage 5: Quota Monitoring and Health

**Goal**: Background quota poller updates `usedBytes`. `/health` and `/storage/status`
return correct data. Quota critical suspends SFTP access. `/resume` blocks when
still critical.

### Steps

1. Implement `src/sftp/quota.go` (package `sftp`):

   ```go
   type QuotaPoller struct {
       manager  *allocation.Manager
       sftp     *Manager
       reposDir string
       interval time.Duration  // 60s
   }

   func NewQuotaPoller(m *allocation.Manager, s *Manager, reposDir string) *QuotaPoller

   func (p *QuotaPoller) Start(ctx context.Context)
   // ticker at p.interval; each tick calls p.pollAll(ctx)

   func (p *QuotaPoller) PollOne(ctx context.Context, alloc *allocation.Allocation) error
   // Exported so lifecycle.Resume can call it synchronously.
   // Run: exec.CommandContext(ctx, "du", "-sb", alloc.RepoPath)
   // Parse first whitespace-delimited field as int64 bytes.
   // Update alloc.UsedBytes, alloc.LastQuotaCheckAt.
   // Evaluate thresholds and act per the Quota Strategy section.
   // Save alloc.
   ```

2. Update `src/allocation/lifecycle.go` `Resume` (see Stage 7 Step 1 for full lifecycle
   implementation). The resume logic must call `quotaPoller.PollOne(ctx, alloc)` before
   re-authorizing. If result is `quotaState == "critical"`: return `409 QUOTA_STILL_CRITICAL`.
   Wire `*QuotaPoller` into the lifecycle and handler.

3. Implement `src/health/health.go` (package `health`):

   ```go
   type Report struct { /* fields matching /health response schema */ }

   func Get(manager *allocation.Manager, sftp *sftp.Manager,
            overlay overlay.Status, logsDir, reposDir, sftpHost string,
            sftpPort int) *Report
   // sftpRunning: net.DialTimeout("tcp", sftpHost+":"+sftpPort, 2s) succeeds.
   // storageRootAvailable: os.Stat(reposDir) succeeds.
   // storageBytes: syscall.Statfs(reposDir).
   // recentEvents: logger.Query(10, time.Time{}).
   ```

4. Wire `GET /api/v1/health` and `GET /api/v1/storage/status` handlers.
   Start `QuotaPoller.Start(ctx)` goroutine in `main.go`.

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-s5 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1

H="Authorization: Bearer test-s5"
BASE="http://127.0.0.1:7420/api/v1"

curl -sf -H "$H" $BASE/health | jq '{agentRunning,storageRootAvailable}'
curl -sf -H "$H" $BASE/storage/status | jq .storageRoot
curl -sf -H "$H" $BASE/health | jq '[.allocations[].quotaMode] | unique'

# Write data, wait for poller, check usedBytes
AID=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"QuotaTest","quotaBytes":1073741824}' \
  $BASE/allocations | jq -r .allocId)
USR=$(curl -sf -H "$H" $BASE/allocations/$AID | jq -r .username)
mkdir -p $TMPDIR/repos/$USR/repository
dd if=/dev/zero of=$TMPDIR/repos/$USR/repository/pad bs=1M count=5 2>/dev/null
sleep 65
curl -sf -H "$H" $BASE/allocations/$AID | jq '.usedBytes > 0'

kill $AGENT_PID; rm -rf "$TMPDIR"
```
Expected: health returns valid JSON, quotaMode array is `["soft"]`,
`usedBytes > 0` → `true` after 65 s.

---

## Stage 6: Overlay Status, SFTP Status, and Exposure Check

**Goal**: `/overlay/status` and `/sftp/status` return correct data.
Startup warning logs and `publicExposureWarning: true` when SFTP is non-loopback
and `TAILSCALE_ADDRESS` is unset.

### Steps

1. Wire `GET /api/v1/overlay/status` handler: call `overlay.GetStatus(...)`, return JSON.

2. Wire `GET /api/v1/sftp/status` handler:
   - `running`: TCP dial `NASBB_SFTP_HOST:{NASBB_SFTP_PORT}` with 2 s timeout.
   - `hostKeyFingerprintSha256`: call `sftp.GetHostKeyFingerprint()`.
   - `activeUserCount`: count non-empty `authorized_keys` files in `{stateDir}/users/`.
   - `bindAddress`: value of `NASBB_SFTP_BIND` env.
   - `publicExposureWarning`: from `overlay.GetStatus(...)`.

3. In `main.go` startup sequence (after loading config, before starting HTTP server):
   ```go
   ov := overlay.GetStatus(tailscaleAddr, sftpBind, sftpPort)
   if ov.PublicExposureWarning {
       log.Warn().Msg("SECURITY WARNING: SFTP is bound to " + sftpBind +
           " without a configured TAILSCALE_ADDRESS. " +
           "Access is not restricted to a private overlay network. " +
           "Set TAILSCALE_ADDRESS or NASBB_SFTP_BIND=127.0.0.1 in your .env file.")
   }
   ```

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)

# Test 1: normal startup — no warning
NASBB_API_TOKEN=test-s6 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1
H="Authorization: Bearer test-s6"
curl -sf -H "$H" http://127.0.0.1:7420/api/v1/overlay/status | jq .mode
curl -sf -H "$H" http://127.0.0.1:7420/api/v1/sftp/status | jq .bindAddress
kill $AGENT_PID

# Test 2: exposure warning
NASBB_API_TOKEN=test-s6b \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
NASBB_SFTP_BIND=0.0.0.0 \
  /tmp/nasbb-agent 2>&1 | head -10 | grep -i "SECURITY WARNING" \
  && echo "PASS: exposure warning logged" || echo "FAIL"

rm -rf "$TMPDIR"
```
Expected: overlay mode `"unconfigured"`, sftp bindAddress `"127.0.0.1"`,
exposure warning logged when `NASBB_SFTP_BIND=0.0.0.0`.

---

## Stage 7: Lifecycle — Suspend, Resume, Retire, Background Checks

**Goal**: Full lifecycle works end-to-end. Background goroutines handle invite expiry
and retirement grace. Invariants 1, 2, and 10 hold.

### Steps

1. Implement `src/allocation/lifecycle.go` (package `allocation`):

   ```go
   type Lifecycle struct {
       manager     *Manager
       sftp        *sftp.Manager
       quotaPoller *sftp.QuotaPoller
       log         *events.Logger
   }

   func NewLifecycle(m *Manager, s *sftp.Manager, q *sftp.QuotaPoller,
                     log *events.Logger) *Lifecycle

   func (l *Lifecycle) Suspend(allocId string) (*Allocation, error)
   // Require state READY. Else: 409 INVALID_STATE.
   // sftp.DeauthorizeKey(alloc.Username).
   // Set alloc.SuspendedAt = now.
   // Do NOT read or write alloc.QuotaEnforcedSuspend.
   // Transition → SUSPENDED. Log "allocation.suspended".

   func (l *Lifecycle) Resume(allocId string) (*Allocation, error)
   // Require state SUSPENDED. Else: 409 INVALID_STATE.
   // Require alloc.OwnerPublicKey != "". Else: 409 INVALID_STATE (no key to restore).
   // quotaPoller.PollOne(ctx, alloc) — if quotaState == "critical": 409 QUOTA_STILL_CRITICAL.
   // sftp.AuthorizeKey(alloc, alloc.OwnerPublicKey).
   // Clear alloc.SuspendedAt.
   // Transition → READY. Log "allocation.resumed".

   func (l *Lifecycle) Retire(allocId string, graceDays int) (*Allocation, error)
   // Reject states RETIRING, RETIRED (409 INVALID_STATE).
   // sftp.DeauthorizeKey(alloc.Username) if alloc has a username.
   // Set alloc.RetirementInitiatedAt = now.
   // Set alloc.RetirementGraceDays = graceDays.
   // Transition → RETIRING. Log "allocation.retiring".
   // Do NOT delete /repos/{username}/.

   // StartBackground starts two goroutines that run hourly:
   //   - Expiry checker: PENDING_KEY allocations past inviteExpiresAt → EXPIRED,
   //                     log "invite.expired".
   //   - Retirement checker: RETIRING allocations past grace period → RETIRED,
   //                         set retiredAt, log "allocation.retired".
   func (l *Lifecycle) StartBackground(ctx context.Context)
   ```

2. Wire `/suspend`, `/resume`, `/retire` handlers. Call `lifecycle.StartBackground(ctx)` in `main.go`.

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-s7 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1

H="Authorization: Bearer test-s7"
BASE="http://127.0.0.1:7420/api/v1"

# Create and fully authorize allocation A
AID=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"A","quotaBytes":1073741824}' $BASE/allocations | jq -r .allocId)
INVITE=$(curl -sf -X POST -H "$H" $BASE/allocations/$AID/invite)
ssh-keygen -t ed25519 -f $TMPDIR/key-a -N "" -q
MATCHID=$(echo "$INVITE" | jq -r .matchId)
USR_A=$(curl -sf -H "$H" $BASE/allocations/$AID | jq -r .username)
curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d "$(jq -n --arg m "$MATCHID" --arg a "$AID" --arg k "$(cat $TMPDIR/key-a.pub)" \
    --arg u "$USR_A" '{bundleVersion:1,kind:"nasbb.owner_access_response",
    matchId:$m,allocId:$a,ownerDeviceLabel:"t",ownerPublicKey:$k,
    requestedSftpUsername:$u,createdAt:"2026-04-28T00:00:00Z"}')" \
  $BASE/allocations/$AID/owner-response > /dev/null

# Create allocation B (stays DRAFT)
BID=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"B","quotaBytes":1073741824}' $BASE/allocations | jq -r .allocId)

# Suspend A
curl -sf -X POST -H "$H" $BASE/allocations/$AID/suspend | jq .state
wc -c < $TMPDIR/state/users/$USR_A/authorized_keys   # expect 0
curl -sf -H "$H" $BASE/allocations/$BID | jq .state  # expect DRAFT (unaffected)

# Resume A
curl -sf -X POST -H "$H" $BASE/allocations/$AID/resume | jq .state
[ "$(wc -c < $TMPDIR/state/users/$USR_A/authorized_keys)" -gt 0 ] \
  && echo "PASS: key restored" || echo "FAIL"

# Retire A
curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"graceDays":0}' $BASE/allocations/$AID/retire | jq .state
wc -c < $TMPDIR/state/users/$USR_A/authorized_keys   # expect 0
ls $TMPDIR/repos/$USR_A/repository && echo "PASS: data preserved"
curl -sf -H "$H" $BASE/allocations/$BID | jq .state  # expect DRAFT (unaffected)

kill $AGENT_PID; rm -rf "$TMPDIR"
```
Expected: lifecycle transitions READY→SUSPENDED→READY→RETIRING, authorized_keys cleared
on suspend/retire, data preserved, B state unchanged.

---

## Stage 8: Events and Log Redaction

**Goal**: All state transitions emit events. `/events` endpoint returns them.
No sensitive data in any log or event output.

### Steps

1. Audit every call to `manager.Transition` and `sftp.*` in all packages. Each must
   call `events.Append` with the correct `kind`. Required kinds:
   `allocation.created`, `invite.exported`, `key.authorized`, `key.deauthorized`,
   `sftp.reload`, `quota.warning`, `quota.critical`, `quota.restored`,
   `allocation.suspended`, `allocation.resumed`, `allocation.retiring`,
   `allocation.retired`, `invite.expired`.

2. Wire `GET /api/v1/events` handler.

3. Wrap zerolog's output writer in `main.go`:
   ```go
   log.Logger = zerolog.New(zerolog.ConsoleWriter{
       Out: &redactWriter{w: os.Stderr},
       TimeFormat: time.RFC3339,
   })
   // redactWriter is an io.Writer that calls events.Redact on each Write call.
   ```

4. Write unit tests in `tests/integration/api_test.go`:
   ```go
   func TestRedact(t *testing.T) {
       cases := []struct{ in, want string }{
           {"ssh-ed25519 AAAAfakekey comment", "[REDACTED-PUBLIC-KEY] comment"},
           {"Bearer " + strings.Repeat("a", 64), "[REDACTED-TOKEN]"},
           {"/config/agent.token read failed", "[CONFIG-PATH] read failed"},
       }
       for _, c := range cases {
           got := events.Redact(c.in)
           if got != c.want {
               t.Errorf("Redact(%q) = %q, want %q", c.in, got, c.want)
           }
       }
   }
   ```

### Verification

```bash
cd apps/host-agent
go build -o /tmp/nasbb-agent ./src/...

TMPDIR=$(mktemp -d)
NASBB_API_TOKEN=test-s8 \
NASBB_CONFIG_DIR=$TMPDIR/config \
NASBB_STATE_DIR=$TMPDIR/state \
NASBB_REPOS_DIR=$TMPDIR/repos \
NASBB_LOG_DIR=$TMPDIR/logs \
  /tmp/nasbb-agent &
AGENT_PID=$!; sleep 1

H="Authorization: Bearer test-s8"
curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"ETest","quotaBytes":1073741824}' \
  http://127.0.0.1:7420/api/v1/allocations > /dev/null

curl -sf -H "$H" "http://127.0.0.1:7420/api/v1/events?limit=10" | jq '.events | length'

# No public key material in events response
curl -sf -H "$H" "http://127.0.0.1:7420/api/v1/events?limit=200" \
  | grep -oE "AAAA[A-Za-z0-9+/]{10,}" \
  && echo "FAIL: key material found" || echo "PASS: no key material"

# No token in events.jsonl
grep -oE "Bearer [A-Fa-f0-9]{8,}" $TMPDIR/logs/events.jsonl \
  && echo "FAIL: token in log" || echo "PASS: no token in log"

kill $AGENT_PID

# Unit test
go test ./tests/integration/... -run TestRedact -v
rm -rf "$TMPDIR"
```
Expected: events endpoint returns records, both security checks PASS, TestRedact passes.

---

## Stage 9: Full Docker Compose and Environment Template

**Goal**: `docker compose up` starts both containers cleanly. All volumes named and
persisted. SFTP defaults to `127.0.0.1:2222`. Compose is the only way to run in production.

### Steps

1. Create `apps/host-agent/compose/docker-compose.yml`:

   ```yaml
   services:
     nasbb-agent:
       build:
         context: ..
         dockerfile: docker/agent/Dockerfile
       container_name: nasbb-agent
       restart: unless-stopped
       ports:
         - "127.0.0.1:${NASBB_API_PORT:-7420}:7420"
       environment:
         NASBB_CONFIG_DIR: /config
         NASBB_STATE_DIR: /state
         NASBB_REPOS_DIR: /repos
         NASBB_LOG_DIR: /logs
         NASBB_BIND_ADDR: "0.0.0.0:7420"
         NASBB_API_TOKEN: "${NASBB_API_TOKEN:-}"
         NASBB_SFTP_BIND: "${NASBB_SFTP_BIND:-127.0.0.1}"
         NASBB_SFTP_PORT: "${NASBB_SFTP_PORT:-2222}"
         NASBB_SFTP_HOST: "nasbb-sftp"
         TAILSCALE_ADDRESS: "${TAILSCALE_ADDRESS:-}"
       volumes:
         - nasbb-config:/config
         - nasbb-state:/state
         - nasbb-repos:/repos
         - nasbb-logs:/logs
       networks:
         - nasbb-internal
       depends_on:
         - nasbb-sftp

     nasbb-sftp:
       build:
         context: ..
         dockerfile: docker/sftp/Dockerfile
       container_name: nasbb-sftp
       restart: unless-stopped
       ports:
         - "${NASBB_SFTP_BIND:-127.0.0.1}:${NASBB_SFTP_PORT:-2222}:2222"
       environment:
         STATE_DIR: /state
         REPOS_DIR: /repos
       volumes:
         - nasbb-state:/state
         - nasbb-repos:/repos
       networks:
         - nasbb-internal

   volumes:
     nasbb-config:
       name: nasbb-config
     nasbb-state:
       name: nasbb-state
     nasbb-repos:
       name: nasbb-repos
     nasbb-logs:
       name: nasbb-logs

   networks:
     nasbb-internal:
       driver: bridge
   ```

   Key design notes:
   - No `version:` key (Compose v2 does not require it).
   - `NASBB_SFTP_HOST: "nasbb-sftp"` inside the agent container means the agent
     TCP-probes the SFTP container by service name.
   - `NASBB_BIND_ADDR: 0.0.0.0:7420` inside the container is safe; Docker `ports`
     restricts host exposure to `127.0.0.1:{NASBB_API_PORT}`.
   - `nasbb-sftp` mounts `nasbb-state` RW because it writes SFTP host keys on first run.
   - Advanced Tailscale socket (not in default): add
     `- /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock:ro`
     under `nasbb-agent.volumes` if richer status is wanted.

2. Create `apps/host-agent/compose/.env.example`:

   ```
   # NAS Backup Buddy Host Agent — Environment Configuration
   # Copy to .env, edit, then:  docker compose -f compose/docker-compose.yml up -d

   # Management API port (127.0.0.1 on host)
   NASBB_API_PORT=7420

   # Pre-set API token (optional). If unset, a token is generated on first start
   # and printed once to container logs. Retrieve with:
   #   docker compose -f compose/docker-compose.yml logs nasbb-agent
   # NASBB_API_TOKEN=your-chosen-secret-token

   # SFTP service
   # Default 127.0.0.1 = loopback only (SFTP not reachable from owner machines).
   # Set NASBB_SFTP_BIND to your Tailscale IP to allow owner access.
   # WARNING: 0.0.0.0 exposes SFTP on all interfaces including public ones.
   NASBB_SFTP_PORT=2222
   NASBB_SFTP_BIND=127.0.0.1

   # Tailscale overlay address for invite bundles and health status.
   # Set to your Tailscale IP or MagicDNS hostname.
   # Example: TAILSCALE_ADDRESS=100.64.0.1
   # Example: TAILSCALE_ADDRESS=myhost.example.ts.net
   TAILSCALE_ADDRESS=
   ```

3. Write `docs/host-agent/runbook.md` with these sections:
   - **Prerequisites**: Docker Engine 24+, Docker Compose v2, Ubuntu 22.04+/Linux Mint 21+,
     Tailscale installed on the host.
   - **First run**: `cp compose/.env.example compose/.env`, optionally set
     `NASBB_API_TOKEN`, run `docker compose -f compose/docker-compose.yml up -d`,
     then `docker compose -f compose/docker-compose.yml logs nasbb-agent` to retrieve token.
   - **Configure Tailscale**: set `TAILSCALE_ADDRESS` in `.env`, restart stack.
   - **Create an allocation**: POST via UI or curl, export invite file, send to owner,
     import owner response, verify SFTP.
   - **SFTP bind warning**: if owners cannot connect, check `NASBB_SFTP_BIND` is set
     to the Tailscale address, not `127.0.0.1`.
   - **Quota exceeded**: increase `quotaBytes` via `PATCH /api/v1/allocations/{id}`,
     then call `POST /resume`.
   - **SFTP interruption note**: avoid adding allocations during scheduled backup windows;
     the reload takes ≤ 10 s.
   - **Volume safety**: never run `docker volume rm nasbb-state`; this deletes the SFTP
     host key and invalidates all owner SSH known-hosts entries.
   - **Troubleshooting**: lost token (check logs), SFTP not reachable (check bind), health
     shows no allocations (stack not started or volumes not mounted).

### Verification

```bash
cd apps/host-agent

# Pre-set a token so we can test without parsing logs
export NASBB_API_TOKEN=compose-test-token

# Build and start
make docker-build
make docker-up
sleep 10

# Both containers running
docker ps --format "{{.Names}}: {{.Status}}" | grep nasbb

# API responds with pre-set token
curl -sf -H "Authorization: Bearer compose-test-token" \
  http://127.0.0.1:7420/api/v1/status | jq .agentVersion

# Health responds
curl -sf -H "Authorization: Bearer compose-test-token" \
  http://127.0.0.1:7420/api/v1/health | jq '{agentRunning,sftpRunning}'

# SFTP host key generated
docker exec nasbb-sftp test -f /state/sftp-host-keys/ssh_host_ed25519_key.pub \
  && echo "PASS: host key present"

make docker-down
unset NASBB_API_TOKEN
```
Expected: both containers running, status returns version, health returns both true,
host key present.

---

## Stage 10: Test Suite and Verification Script

**Goal**: Unit/integration tests cover all implementation invariants. `verify.sh` runs
the full end-to-end check against a live stack and prints a `[PASS]`/`[FAIL]` line
for every item.

### Steps

1. Write `tests/integration/api_test.go` (package `integration`) covering:
   - Auth: missing token → 401; wrong token → 401; correct token → 200.
   - `GET /api/v1/info` with no token → 200.
   - Config GET and PATCH roundtrip.
   - Allocation: create, list, get, patch. Invalid state transitions return 409.
   - `ownerPublicKey` absent from all summary/list responses.
   - `quotaMode == "soft"` on every allocation.
   - `accessWindowEnforcement == "future"` on every allocation.
   - Invite: DRAFT→PENDING_KEY; re-invite from EXPIRED→PENDING_KEY.
   - Owner response: PENDING_KEY→READY; wrong allocId→409; wrong matchId→409;
     invalid key→400; expired invite→409.
   - Suspend: READY→SUSPENDED; authorized_keys empty after.
   - Resume: SUSPENDED→READY; authorized_keys restored after.
   - Retire: →RETIRING; authorized_keys empty; data directory exists.
   - Events: actions produce expected event kinds; `GET /events` returns them.
   - `TestRedact` (as specified in Stage 8).

   Use `net/http/httptest` to start the server inline — no subprocess required.
   All tests set `NASBB_API_TOKEN=test` and use temp directories.

2. Write `tests/integration/sftp_test.go` (package `integration`):
   Uses Docker. Skip with `t.Skip()` if env `NASBB_SKIP_DOCKER=true`.
   Uses `exec.Command("sftp", ...)` — no additional Go SFTP library needed.

   Tests:
   - SFTP auth succeeds for alloc A username + key A. (Invariant 1a)
   - SFTP auth fails for alloc B username + key A. (Invariant 1a)
   - From alloc A's SFTP session: `ls /` shows only `repository`, not any other
     username directory. (Invariant 1b)
   - Suspend A: SFTP auth fails for alloc A. Alloc B session unaffected. (Invariants 2, 3)
   - Resume A: SFTP auth succeeds again. (Invariant 2)
   - Retire A: SFTP auth fails; `/repos/{usernameA}/repository` dir still present
     on host volume mount. (Invariants 2, 10)
   - Rebuild SFTP image, restart container, re-check fingerprint: identical. (Invariant 4)

   Helper `sftpAuth(t, keyFile, username, port string) bool`:
   ```go
   func sftpAuth(t *testing.T, keyFile, username string, port int) bool {
       t.Helper()
       cmd := exec.Command("sftp",
           "-i", keyFile,
           "-P", strconv.Itoa(port),
           "-o", "StrictHostKeyChecking=no",
           "-o", "UserKnownHostsFile=/dev/null",
           "-o", "BatchMode=yes",
           "-b", "/dev/stdin",
           username+"@127.0.0.1",
       )
       cmd.Stdin = strings.NewReader("ls\n")
       err := cmd.Run()
       return err == nil
   }
   ```

3. Write `tests/scripts/verify.sh` — complete implementation:

   ```bash
   #!/usr/bin/env bash
   # verify.sh — end-to-end verification of the NAS Backup Buddy host agent.
   # Run from apps/host-agent/ after "make docker-up".
   # Requires: docker, curl, jq, ssh-keygen, sftp.
   set -euo pipefail

   PASS=0; FAIL=0
   BASE="http://127.0.0.1:7420/api/v1"
   TOKEN="${NASBB_API_TOKEN:-compose-test-token}"
   H="Authorization: Bearer $TOKEN"
   SFTP_PORT="${NASBB_SFTP_PORT:-2222}"
   TMPKEYS=$(mktemp -d)
   trap 'rm -rf "$TMPKEYS"' EXIT

   pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
   fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
   check() { [ "$1" = "$2" ] && pass "$3" || fail "$3 (got '$1', want '$2')"; }

   # ── Stack health ──────────────────────────────────────────────────────────
   docker ps --format "{{.Names}}" | grep -q "nasbb-agent" \
     && pass "Docker compose stack starts cleanly" || fail "nasbb-agent not running"
   docker ps --format "{{.Names}}" | grep -q "nasbb-sftp" \
     && pass "SFTP container running" || fail "nasbb-sftp not running"

   # ── Auth ──────────────────────────────────────────────────────────────────
   CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/info)
   check "$CODE" "200" "GET /api/v1/info returns 200 without auth"

   CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/status)
   check "$CODE" "401" "GET /api/v1/status returns 401 without token"

   CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$H" $BASE/status)
   check "$CODE" "200" "GET /api/v1/status returns 200 with correct token"

   # ── Config ────────────────────────────────────────────────────────────────
   LABEL=$(curl -sf -H "$H" $BASE/config | jq -r .hostLabel)
   [ -n "$LABEL" ] && pass "GET /api/v1/config returns host configuration" \
     || fail "GET /api/v1/config"

   LABEL2=$(curl -sf -X PATCH -H "$H" -H "Content-Type: application/json" \
     -d '{"hostLabel":"verify-test-host"}' $BASE/config | jq -r .hostLabel)
   check "$LABEL2" "verify-test-host" "PATCH /api/v1/config updates host label"

   # ── Allocations ───────────────────────────────────────────────────────────
   AID_A=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
     -d '{"connectionName":"VerifyA","quotaBytes":1073741824}' \
     $BASE/allocations | jq -r .allocId)
   AID_B=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
     -d '{"connectionName":"VerifyB","quotaBytes":1073741824}' \
     $BASE/allocations | jq -r .allocId)
   COUNT=$(curl -sf -H "$H" $BASE/allocations | jq '.allocations | length')
   [ "$COUNT" -ge 2 ] && pass "Create two allocations" || fail "Create two allocations"

   QM=$(curl -sf -H "$H" $BASE/allocations | \
     jq '[.allocations[].quotaMode] | unique | .[]' -r)
   check "$QM" "soft" 'Quota mode is "soft" for all allocations'

   # ── Invite ────────────────────────────────────────────────────────────────
   INVITE_A=$(curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/invite)
   STATE_A=$(curl -sf -H "$H" $BASE/allocations/$AID_A | jq -r .state)
   check "$STATE_A" "PENDING_KEY" "Generate invite for allocation A (DRAFT → PENDING_KEY)"

   MATCH_A=$(echo "$INVITE_A" | jq -r .matchId)
   USR_A=$(curl -sf -H "$H" $BASE/allocations/$AID_A | jq -r .username)

   # ── Owner response ────────────────────────────────────────────────────────
   ssh-keygen -t ed25519 -f "$TMPKEYS/key-a" -N "" -q
   ssh-keygen -t ed25519 -f "$TMPKEYS/key-b" -N "" -q
   PUB_A=$(cat "$TMPKEYS/key-a.pub")

   RESP_A=$(jq -n --arg m "$MATCH_A" --arg a "$AID_A" --arg k "$PUB_A" --arg u "$USR_A" \
     '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$m,allocId:$a,
       ownerDeviceLabel:"verify",ownerPublicKey:$k,requestedSftpUsername:$u,
       createdAt:"2026-04-28T00:00:00Z"}')
   STATE_A=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
     -d "$RESP_A" $BASE/allocations/$AID_A/owner-response | jq -r .state)
   check "$STATE_A" "READY" "Import owner key for allocation A (PENDING_KEY → READY)"

   # Give SFTP reload time to apply
   sleep 7

   # ── SFTP auth tests ───────────────────────────────────────────────────────
   sftp_auth() {
     local keyfile="$1" user="$2"
     echo "ls" | sftp -i "$keyfile" -P "$SFTP_PORT" \
       -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
       -o BatchMode=yes -b /dev/stdin \
       "${user}@127.0.0.1" &>/dev/null
   }

   sftp_auth "$TMPKEYS/key-a" "$USR_A" \
     && pass "SFTP auth works for allocation A" || fail "SFTP auth works for allocation A"

   USR_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .username)
   ! sftp_auth "$TMPKEYS/key-a" "$USR_B" \
     && pass "Allocation A key cannot authenticate as allocation B username" \
     || fail "Allocation A key cannot authenticate as allocation B username"

   # ── Write test ────────────────────────────────────────────────────────────
   echo "put /dev/null /repository/verify-probe" | sftp \
     -i "$TMPKEYS/key-a" -P "$SFTP_PORT" \
     -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
     -o BatchMode=yes -b /dev/stdin \
     "${USR_A}@127.0.0.1" &>/dev/null \
     && pass "Write test succeeds inside allocation A repository" \
     || fail "Write test succeeds inside allocation A repository"

   # ── Suspend / resume ──────────────────────────────────────────────────────
   curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/suspend > /dev/null
   sleep 7
   ! sftp_auth "$TMPKEYS/key-a" "$USR_A" \
     && pass "Suspend blocks SFTP access for allocation A" \
     || fail "Suspend blocks SFTP access for allocation A"

   sftp_auth "$TMPKEYS/key-b" "$USR_B" 2>/dev/null || true  # B not set up, just verify state
   STATE_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .state)
   check "$STATE_B" "DRAFT" "Allocation B unaffected by suspend of A"

   curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/resume > /dev/null
   sleep 7
   sftp_auth "$TMPKEYS/key-a" "$USR_A" \
     && pass "Resume restores SFTP access for allocation A" \
     || fail "Resume restores SFTP access for allocation A"

   # ── Retire ────────────────────────────────────────────────────────────────
   curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
     -d '{"graceDays":0}' $BASE/allocations/$AID_A/retire > /dev/null
   sleep 7
   ! sftp_auth "$TMPKEYS/key-a" "$USR_A" \
     && pass "Retire disables SFTP access for allocation A" \
     || fail "Retire disables SFTP access for allocation A"

   docker exec nasbb-sftp test -d "/repos/$USR_A/repository" \
     && pass "Repository data preserved after retire" \
     || fail "Repository data preserved after retire"

   STATE_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .state)
   check "$STATE_B" "DRAFT" "Allocation B unaffected by retire of A"

   # ── Invite expiry ─────────────────────────────────────────────────────────
   AID_EXP=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
     -d '{"connectionName":"ExpTest","quotaBytes":1073741824}' \
     $BASE/allocations | jq -r .allocId)
   curl -sf -X POST -H "$H" $BASE/allocations/$AID_EXP/invite > /dev/null
   # Backdate the expiry via PATCH is not supported; test via direct JSON edit on volume
   docker exec nasbb-agent sh -c \
     "f=/config/allocations/${AID_EXP}.json; \
      tmp=\$(mktemp); \
      jq '.inviteExpiresAt=\"2020-01-01T00:00:00Z\"' \$f > \$tmp && mv \$tmp \$f"
   MATCH_EXP=$(curl -sf -H "$H" $BASE/allocations/$AID_EXP | jq -r .matchId)
   USR_EXP=$(curl -sf -H "$H" $BASE/allocations/$AID_EXP | jq -r .username)
   ssh-keygen -t ed25519 -f "$TMPKEYS/key-exp" -N "" -q
   CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$H" \
     -H "Content-Type: application/json" \
     -d "$(jq -n --arg m "$MATCH_EXP" --arg a "$AID_EXP" \
       --arg k "$(cat $TMPKEYS/key-exp.pub)" --arg u "$USR_EXP" \
       '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$m,allocId:$a,
         ownerDeviceLabel:"t",ownerPublicKey:$k,requestedSftpUsername:$u,
         createdAt:"2026-04-28T00:00:00Z"}')" \
     $BASE/allocations/$AID_EXP/owner-response)
   check "$CODE" "409" "Expired invite rejected with 409 INVITE_EXPIRED"

   # ── Host key stability ────────────────────────────────────────────────────
   FP1=$(docker exec nasbb-sftp \
     ssh-keygen -lf /state/sftp-host-keys/ssh_host_ed25519_key.pub | awk '{print $2}')
   docker compose -f compose/docker-compose.yml build nasbb-sftp --quiet
   docker compose -f compose/docker-compose.yml up -d nasbb-sftp
   sleep 5
   FP2=$(docker exec nasbb-sftp \
     ssh-keygen -lf /state/sftp-host-keys/ssh_host_ed25519_key.pub | awk '{print $2}')
   check "$FP1" "$FP2" "SFTP host key unchanged after container rebuild"

   # ── Log cleanliness ───────────────────────────────────────────────────────
   LOG=$(docker exec nasbb-agent cat /logs/events.jsonl 2>/dev/null || true)
   echo "$LOG" | grep -oE "AAAA[A-Za-z0-9+/]{10,}" \
     && fail "No public key material in event log" \
     || pass "No public key material in event log"
   echo "$LOG" | grep -oE "Bearer [A-Fa-f0-9]{8,}" \
     && fail "No Bearer token in event log" \
     || pass "No Bearer token in event log"

   # ── Health ────────────────────────────────────────────────────────────────
   HEALTHY=$(curl -sf -H "$H" $BASE/health | jq '.agentRunning and .storageRootAvailable')
   check "$HEALTHY" "true" "Health endpoint reports status and capacity"

   # ── Summary ───────────────────────────────────────────────────────────────
   echo ""
   echo "Results: $PASS passed, $FAIL failed"
   [ "$FAIL" -eq 0 ] || exit 1
   ```

### Verification

```bash
cd apps/host-agent
NASBB_API_TOKEN=compose-test-token make docker-up
sleep 10
go test ./tests/integration/... -run TestRedact -v
NASBB_API_TOKEN=compose-test-token make verify
make docker-down
```
Expected: `TestRedact` passes, all `[PASS]` lines, `0 failed`.

---

## Stage 11: Final API Contract Report

**Goal**: `docs/host-agent/api-contract.md` is the sole document a desktop UI agent
needs to implement the UI — no source code reading required.

### Write `docs/host-agent/api-contract.md` with these sections in order

1. **Overview** — purpose, source location (`apps/host-agent/`), compose entry point.
2. **Container architecture** — ASCII diagram (copy Stack Overview from this document),
   service list: image, internal port, host port, volumes, key env vars.
3. **Port list** — every port, which interface binds it on the host, what controls that,
   and what needs to change for Tailscale access.
4. **Volume list** — every named volume, what each service reads vs. writes, what
   must never be deleted and why.
5. **API protocol** — REST/JSON, base path `/api/v1/`, Bearer token auth header,
   `GET /api/v1/info` unauthenticated.
6. **First-run pairing flow** — numbered steps from `docker compose up` to desktop UI
   connected. No `docker exec` required.
7. **Full endpoint reference** — for every endpoint: method, path, auth required,
   request schema (JSON), success response schema (JSON), all error codes returned,
   state transition side effects.
8. **Error code reference** — table of all machine codes and their meanings.
9. **Allocation state machine** — the transition table, `quotaEnforcedSuspend` semantics.
10. **Host Invite Bundle schema** — field-by-field (type, description, constraints).
    What the bundle looks like when `TAILSCALE_ADDRESS` is not set.
11. **Owner Access Response schema** — field-by-field.
12. **SFTP isolation strategy** — per-user chroot, username format, directory layout,
    `ChrootDirectory /repos/%u` and `AuthorizedKeysFile /state/users/%u/authorized_keys`
    resolution, no symlinks.
13. **Quota strategy** — soft quota, `du` polling, `quotaState` values, critical = full
    SFTP block + `quotaEnforcedSuspend`, resume guard, ZFS/XFS hard quota upgrade path.
14. **Access window policy** — fields stored, `accessWindowEnforcement: "future"`,
    no scheduler in v1. UI must display "not yet enforced" label.
15. **Bandwidth policy** — fields stored, advisory only, no enforcement in v1.
16. **SFTP bind and exposure model** — default `127.0.0.1`, how to configure for
    Tailscale (`NASBB_SFTP_BIND`), `publicExposureWarning` flag and when it fires.
17. **Host key persistence** — stored in `nasbb-state` volume, survives rebuilds,
    lost only on volume deletion, impact on owner known-hosts.
18. **SFTP restart behaviour** — brief interruption on reload, Kopia safety, timing guidance.
19. **Security decisions** — token auth, localhost API, no owner secrets stored,
    redaction rules, chroot + `StrictModes no` rationale.
20. **Implementation invariants** — the 10 invariants, reference to `verify.sh` checks.
21. **Known v1 limitations** — the 8 items from *Known Acceptable Limitations* below.
22. **UI integration notes** — discovery via `GET /api/v1/info`, token entry flow,
    recommended polling (health: 30 s, events: 60 s), bundle file format for file
    picker import/export, how to display `quotaState`, `quotaEnforcedSuspend`,
    `accessWindowEnforcement: "future"`, and `publicExposureWarning`.

### Verification

```bash
for section in "Container architecture" "Port list" "Volume list" \
  "First-run pairing" "Full endpoint" "Error code" "state machine" \
  "Invite Bundle" "Access Response" "SFTP isolation" "Quota strategy" \
  "Access window" "Bandwidth" "SFTP bind" "Host key" "SFTP restart" \
  "Security decisions" "Implementation invariants" "Known v1 limitations" \
  "UI integration"; do
  grep -qi "$section" docs/host-agent/api-contract.md \
    && echo "FOUND: $section" || echo "MISSING: $section"
done
```
Expected: all 20 sections found.

---

## Security Checklist

Verify each item before marking the implementation complete:

- [ ] `ports:` for `nasbb-agent` is `"127.0.0.1:${PORT}:7420"` (not `"0.0.0.0:…"`).
- [ ] `NASBB_SFTP_BIND` defaults to `127.0.0.1` in `.env.example` and compose.
- [ ] `agent.token` file mode is 0600.
- [ ] `GET /api/v1/info` returns 200 with no auth; all other routes return 401.
- [ ] No API response includes `ownerPublicKey` in list or summary output.
- [ ] `authorized_keys` files are mode 0600 inside the SFTP container.
- [ ] `/repos/{username}` is root:root 0755. `/repos/{username}/repository` is {username}:nasbb 0700.
- [ ] `sshd_config` contains `PermitRootLogin no`, `PasswordAuthentication no`,
      `ForceCommand internal-sftp`, `AllowTcpForwarding no`, `StrictModes no`.
- [ ] `events.jsonl` contains no SSH public key material (`grep "AAAA" /logs/events.jsonl`).
- [ ] `events.jsonl` contains no Bearer tokens.
- [ ] No symlinks under `/repos/` or `/state/` (verified by Stage 3 test).
- [ ] `quotaMode` is never absent and never `"hard"` in any response.
- [ ] `accessWindowEnforcement` is always `"future"` in every allocation response.
- [ ] Startup warning logged when `NASBB_SFTP_BIND != 127.0.0.1` and `TAILSCALE_ADDRESS` unset.
- [ ] Manual `/suspend` does not modify `quotaEnforcedSuspend`.
- [ ] `POST /retire` does not delete `/repos/{username}/`.

---

## Known Acceptable Limitations (v1)

Document all of these in `api-contract.md`. Do not attempt to fix them.

1. **Soft quota only**: `du` polling, 60-second granularity. Hard quota requires ZFS
   dataset quota (`zfs set quota=N`) or XFS project quota — both are infrastructure
   changes, no agent code change needed.
2. **Advisory bandwidth**: Cap fields stored and returned; no `tc`/iptables enforcement.
3. **Access windows not enforced**: Fields exist, `accessWindowEnforcement: "future"`.
4. **SFTP reload pause**: ≤ 10 s interruption when allocations change. Kopia retries.
5. **Host-managed Tailscale**: Operator installs Tailscale externally; `TAILSCALE_ADDRESS`
   provides the address to the agent.
6. **Retirement does not delete data**: Host operator cleans up `/repos/{username}/`
   manually after confirming retirement.
7. **No signed health reports**: Unsigned; suitable for local UI. Web app will require signing.
8. **Ed25519 host key only**: Single host key type; RSA/ECDSA host keys not generated.
