# ADR 0003: Docker Host Agent Architecture

## Status

Accepted.

## Context

The host-side Docker runtime requires decisions on language, container structure,
SFTP isolation, quota strategy, overlay integration, API auth, invite expiry,
SFTP bind safety, and pairing flow. These were left open in the source brief.

## Decisions

### Language: Go 1.22+

Single static binary, no runtime dependency, minimal Alpine image. First-class
HTTP and SSH libraries. Dependencies: chi (routing), zerolog (logging), uuid,
`golang.org/x/crypto` (SSH key validation). No ORM, no heavy frameworks.

### Container structure: two containers

`nasbb-agent` (Go API) and `nasbb-sftp` (Alpine + OpenSSH) share four named
volumes. Separation isolates the management plane from the data plane. No Docker
socket. User lifecycle changes communicated via a file-based reload trigger
in the shared `nasbb-state` volume. Both containers mount `nasbb-state` RW:
agent writes user configs and authorized_keys; SFTP container writes its host
keys on first start.

### SFTP isolation: per-user chroot, no symlinks

Each allocation gets a Linux user `nabb_{8hex}` in the `nasbb` group.
Directory layout: `/repos/{username}/` (root:root 0755) is the OpenSSH
`ChrootDirectory`; `/repos/{username}/repository/` ({username}:nasbb 0700)
is the data dir. `AuthorizedKeysFile /state/users/%u/authorized_keys`.
Both `%u` substitutions resolve to the Linux username, which is used as the
directory name throughout. No symlinks. No allocId-named directories under
`/repos/`.

### SFTP bind default: fail-closed at 127.0.0.1

Default `NASBB_SFTP_BIND=127.0.0.1`. SFTP is not network-reachable until the
operator explicitly sets a Tailscale or other private address. Agent logs a
`SECURITY WARNING` on startup and sets `publicExposureWarning: true` in all
status responses when the SFTP bind is non-loopback and `TAILSCALE_ADDRESS` is
not configured.

### Quota: agent-enforced soft quota (v1)

Docker named volumes do not expose filesystem quota APIs. Agent polls `du -sb`
every 60 s. At critical threshold: SFTP access removed (authorized_keys cleared),
`quotaEnforcedSuspend: true` set. `POST /resume` re-checks usage before
re-authorizing; returns `409 QUOTA_STILL_CRITICAL` if still over threshold.
`quotaMode` is always `"soft"` in v1 API responses.

Hard quota upgrade path: replace the named volume with a ZFS dataset
(`zfs set quota=N`) or XFS project quota mount. No agent code change required.

### Tailscale: env-configured (v1)

`TAILSCALE_ADDRESS` env var provides the overlay address. No socket mount in
the default compose. Socket mount is documented as an advanced option (commented
out in compose). This avoids TUN/CAP_NET_ADMIN requirements and platform-specific
socket paths.

### API auth: generated Bearer token with safe first-run pairing

Token generated from `crypto/rand` on first start, written to `/config/agent.token`
(mode 0600), printed to stdout in a bordered block once. Operator can also
pre-set `NASBB_API_TOKEN` in `.env`. `GET /api/v1/info` requires no auth so the
UI can confirm the agent is running before prompting for the token. No `docker exec`
or volume mount required after startup.

### Invite expiry: enforced

`POST /invite` sets `inviteExpiresAt` to 90 days from now. `POST /owner-response`
returns `409 INVITE_EXPIRED` if the current time is after `inviteExpiresAt`.
Background goroutine (hourly) transitions `PENDING_KEY` allocations with expired
invites to an `EXPIRED` state. `POST /invite` on an `EXPIRED` allocation
re-issues the invite and transitions back to `PENDING_KEY`.

### Access windows: stored, not enforced (v1)

Fields exist in the schema and API. `accessWindowEnforcement: "future"` is always
returned in allocation responses. No scheduler. Enforcement is planned in a
future phase. The field exists so the UI can display a correct label without
conditional logic based on version.

### Bandwidth: advisory (v1)

Bandwidth cap fields are stored and returned. No `tc`/iptables enforcement.

## Consequences

Positive:
- No Docker socket exposure.
- Fail-closed SFTP bind prevents accidental public exposure.
- No symlinks; directory layout matches `sshd_config` substitutions exactly.
- Hard quota upgrade is a volume-swap, not a code change.
- First-run pairing requires no `docker exec` or filesystem access.
- Invite expiry provides meaningful security with minimal complexity.

Negative:
- Soft quota only: brief over-quota window between 60-second polls.
- Brief SFTP user-setup pause (≤ 10 s) when allocations change.
- Host-managed Tailscale requires operator to install Tailscale externally.
- Retirement does not auto-delete data in v1; host must clean up manually.

## Follow-Up

- Implement per `agent-implementation-plan.md`.
- After Phase 1 POC, evaluate container-managed Tailscale if host-managed proves
  too difficult for NAS users.
- After Phase 2 alpha, evaluate ZFS dataset quota based on what filesystems
  alpha users have.
- Post-v1: automated retirement data deletion with configurable policy.
