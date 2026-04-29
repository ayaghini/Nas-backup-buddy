# Docker Host Agent Implementation Brief

## Purpose

This document is the implementation brief for a Docker-based NAS Backup Buddy storage-host runtime.

The goal is to let a storage host run a prepackaged Docker setup that provides the required services for hosting encrypted peer backup repositories. The host should not need to manually create Linux users, edit `sshd_config`, install SFTP packages, wire Tailscale by hand, or learn Docker internals after the initial runtime is installed. Most configuration should happen through the NAS Backup Buddy desktop UI via a local API exposed by the host agent.

The implementation agent should treat this document as the source prompt for designing and building the first testable Docker host setup from start to finish.

## Product Context

NAS Backup Buddy enables reciprocal offsite backup between homelab users.

The default backup flow is:

```text
Data owner source folders
  -> Kopia encrypts snapshots locally
  -> SFTP over private overlay network
  -> storage host receives encrypted repository data
  -> owner verifies backup and restore health
```

The storage host must never receive backup passwords, private keys, plaintext source files, or plaintext file names from the data owner. The host provides isolated storage and network reachability only.

The desktop app now has a Docker-backed Host tab for storage providers. The owner-side flow is being consolidated into the planned Peer tab, which should handle Host Invite Bundle import, Owner Access Response generation, SFTP checks, Kopia repository creation, restore drills, and health checks.

## Project Goal

Build a ready-for-test Docker host runtime for Linux hosts, starting with Ubuntu or Linux Mint.

The host runtime must:

- Provide a preconfigured hosting environment for encrypted Kopia repositories over SFTP.
- Support multiple matches/users on one host.
- Guarantee data isolation between matches to the strongest practical level for the selected v1 design.
- Expose a local API for the NAS Backup Buddy desktop UI.
- Allow the desktop UI to create, inspect, update, authorize, suspend, and retire hosted allocations.
- Minimize direct Docker interaction after installation.
- Support a streamlined owner/host exchange, ideally using one host invite file and one owner response file, with no repeated manual back-and-forth.
- Produce a clear API and communication report at the end of implementation so the desktop UI can implement against it.

## Non-Goals

Do not implement owner-side backups inside this host container in v1. The data owner should still run Kopia from their own machine, with encryption secrets kept locally.

Do not build a paid marketplace, payment flow, reputation system, or cloud backend.

Do not require the host to expose public inbound ports. Prefer private overlay reachability.

Do not store data owner backup passwords, owner private keys, source file names, source file contents, or raw owner-side Kopia logs.

Do not assume all future platforms behave like Linux. Start with Linux, but avoid design choices that block later NAS or cross-platform packaging.

## Target User Experience

The desired host experience is:

1. User installs Docker or uses an existing Docker-capable NAS/server.
2. User starts the NAS Backup Buddy host runtime from a supplied command, compose file, or UI-driven launcher.
3. Host runtime initializes required services and persistent volumes.
4. User opens the NAS Backup Buddy desktop UI.
5. Desktop UI discovers or connects to the local host agent API.
6. User authenticates to the host agent locally.
7. User configures host settings through the UI:
   - storage root
   - advertised capacity
   - per-match quota
   - Tailscale or overlay mode
   - bandwidth policy
   - access windows
   - match labels and lifecycle actions
8. Host sends a Host Invite Bundle to the data owner.
9. Owner imports the invite, generates or selects an SSH key, and returns one Owner Access Response.
10. Host imports the owner response through the UI.
11. Host agent authorizes the owner key and marks the allocation ready.
12. Owner verifies overlay, SFTP auth, write access, and Kopia repository connection.

The host should not need to manually run `useradd`, edit `authorized_keys`, edit `sshd_config`, or inspect container internals during normal setup.

## Implementation Autonomy

The implementing agent should use best engineering judgment for the internal architecture.

Technical decisions intentionally left open:

- Programming language for the host agent.
- Whether to use one container or multiple containers.
- Whether to use OpenSSH, an embedded SFTP server, or another mature SFTP implementation.
- Whether Tailscale runs as a sidecar, inside the host agent stack, or is host-managed for v1.
- How per-match isolation is implemented internally.
- Which quota mechanism is used for v1.
- Whether the local API is REST, gRPC, JSON-RPC, or another practical local protocol.
- How local API authentication is implemented.
- How the UI discovers the local host agent.

The agent must document these decisions and the reasons for them in the final implementation report.

## Required Security Model

The Docker host runtime must follow these rules:

- Data owner backup encryption happens before data reaches the host.
- Host cannot read owner plaintext data.
- Host cannot access owner backup password.
- Host cannot access owner private SSH key.
- Each match gets a separate isolated storage allocation.
- One match must not be able to read, write, list, or delete another match's repository data.
- Deleting or retiring one match must not affect other matches.
- API responses must not include sensitive secrets.
- Logs must redact authentication tokens, API keys, owner public key comments if they contain identifying data, full host filesystem paths where possible, and raw command output that may contain sensitive data.
- Default network exposure must be local-only for management and private-overlay-only for SFTP.

## Isolation Requirements

Multiple hosted matches are a core requirement.

The implementation must provide a concrete isolation strategy and test it.

Minimum v1 isolation requirements:

- Separate match IDs.
- Separate repository directories.
- Separate SFTP credentials or equivalent per-match authorization boundary.
- Owner public key for match A must not authorize access to match B.
- SFTP path for match A must not allow traversal into match B.
- API calls for match A must not expose match B details unless listing all allocations as an authenticated host admin.
- Retirement/suspension for one match must not affect active matches.

Preferred stronger isolation options, if practical:

- Per-match Unix users inside the SFTP container.
- Per-match chroot or equivalent SFTP root.
- Per-match container, namespace, or service boundary if operationally reasonable.
- Per-match filesystem dataset/subvolume where available.
- Read-only management paths except where writes are required.

If true filesystem quota or chroot cannot be guaranteed in the selected v1 design, the implementation must state that clearly and provide the strongest available fallback.

## Quota Requirements

The host UI must allow the host to assign capacity per match.

The implementation must distinguish:

- Hard quota: enforced by filesystem, dataset, project quota, container storage limit, or other kernel/storage feature.
- Soft quota: monitored by the agent and surfaced as warnings/critical status.
- Advisory quota: visible policy only, not enforced.

For v1 Linux, prefer a real hard quota where practical. If the selected implementation cannot guarantee hard quota on a plain Docker volume, provide a documented path for stronger quota support on filesystems such as ZFS, Btrfs, XFS project quotas, or ext4 quotas.

The API must report quota mode for every allocation:

```json
{
  "quotaMode": "hard|soft|advisory|unknown",
  "quotaBytes": 536870912000,
  "usedBytes": 123456789,
  "freeBytes": 536747455211,
  "warningThresholdPercent": 15,
  "criticalThresholdPercent": 5
}
```

## Network And Overlay Requirements

The storage host should be reachable over a private overlay network.

The implementation should support Tailscale first. The agent may choose one of these models:

- Host-managed Tailscale: the host installs and authenticates Tailscale outside Docker. The container uses host networking or receives the overlay address.
- Container-managed Tailscale: a Tailscale sidecar or built-in service joins the tailnet and routes SFTP traffic.
- Hybrid: support both, with host-managed as the simpler/safer default if that is best for v1.

The host agent must expose enough status for the UI to show:

- Tailscale installed or unavailable.
- Tailscale authenticated or needs login.
- local overlay address or MagicDNS name if available.
- SFTP reachable locally.
- SFTP expected port.
- whether SFTP is bound to local/private interfaces only.
- whether public exposure is detected or suspected.

Do not require public router port forwarding for v1.

## Bandwidth And Access-Time Policy

The host should be able to define basic resource policy for hosted matches.

Required v1 policy fields:

- Optional upload/download bandwidth cap per match or globally.
- Optional allowed access window.
- Optional maintenance window.
- Pause/suspend allocation.
- Resume allocation.

The implementation agent should choose the practical enforcement mechanism. Examples include SFTP server limits, traffic shaping, container networking controls, process-level throttling, scheduled authorization changes, firewall rules, or a clearly documented monitored-only fallback.

If enforcement is not reliable in Docker-only v1, expose the policy as advisory/monitored and state the limitation clearly in the final report.

## Host Agent API

The Docker runtime must expose a management API for the desktop UI.

Default requirement:

- Bind management API to localhost by default.
- Use an explicit admin token, pairing token, mutual local trust mechanism, or another suitable local auth design.
- Never expose management API publicly by default.
- Return JSON or another strongly documented structured format.
- Version the API from the start.

The implementing agent should design the final API. At minimum, the API must support these operations:

- Get host runtime status.
- Get overlay/Tailscale status.
- Get SFTP service status.
- Get storage root and capacity status.
- List hosted allocations.
- Create hosted allocation draft.
- Update hosted allocation policy.
- Generate Host Invite Bundle.
- Import Owner Access Response.
- Authorize owner public key.
- Suspend allocation.
- Resume allocation.
- Retire allocation.
- Rotate host invite or match credentials if needed.
- Return redacted logs/events.
- Return health report for UI display.

Suggested endpoint shape, if REST is selected:

```text
GET    /api/v1/status
GET    /api/v1/overlay/status
GET    /api/v1/sftp/status
GET    /api/v1/storage/status
GET    /api/v1/allocations
POST   /api/v1/allocations
GET    /api/v1/allocations/{allocationId}
PATCH  /api/v1/allocations/{allocationId}
POST   /api/v1/allocations/{allocationId}/invite
POST   /api/v1/allocations/{allocationId}/owner-response
POST   /api/v1/allocations/{allocationId}/suspend
POST   /api/v1/allocations/{allocationId}/resume
POST   /api/v1/allocations/{allocationId}/retire
GET    /api/v1/events
GET    /api/v1/health
```

The implementing agent may change this if another design is better. The final API contract must be reported at the end of implementation.

## Bundle Exchange Goal

The host/owner exchange should be streamlined.

Prefer this flow:

1. Host creates an allocation in the UI.
2. Host exports one Host Invite Bundle.
3. Owner imports Host Invite Bundle.
4. Owner app generates or selects a per-match SSH key.
5. Owner exports one Owner Access Response.
6. Host imports Owner Access Response.
7. Host agent authorizes the key.
8. Owner verifies SFTP and creates/connects Kopia repository.

The Host Invite Bundle must contain no secrets.

Suggested Host Invite Bundle fields:

```json
{
  "bundleVersion": 1,
  "kind": "nasbb.host_invite",
  "hostAgentVersion": "0.1.0",
  "matchId": "match-abc123",
  "allocationId": "alloc_...",
  "connectionName": "Alice hosted backup",
  "overlay": {
    "provider": "tailscale",
    "host": "host.tailnet.ts.net",
    "requiresDeviceShare": true
  },
  "sftp": {
    "host": "host.tailnet.ts.net",
    "port": 2222,
    "username": "nasbb-match-abc123",
    "path": "/repository"
  },
  "quota": {
    "quotaBytes": 536870912000,
    "quotaMode": "hard|soft|advisory|unknown"
  },
  "hostKey": {
    "fingerprintSha256": "SHA256:...",
    "verificationNote": "Verify out of band before trusting first connection."
  },
  "expiresAt": "2026-05-01T00:00:00Z"
}
```

Suggested Owner Access Response fields:

```json
{
  "bundleVersion": 1,
  "kind": "nasbb.owner_access_response",
  "matchId": "match-abc123",
  "allocationId": "alloc_...",
  "ownerDeviceLabel": "owner-laptop",
  "ownerPublicKey": "ssh-ed25519 AAAA...",
  "requestedSftpUsername": "nasbb-match-abc123",
  "createdAt": "2026-04-28T00:00:00Z"
}
```

The final implementation may adjust these fields. The final schema must be documented.

## Persistent Data

The Docker runtime must persist:

- Host agent config.
- Allocation metadata.
- Owner public keys.
- SFTP host keys.
- Hosted encrypted repository data.
- Health/event history needed for diagnostics.

The Docker runtime must not persist:

- Owner backup passwords.
- Owner private SSH keys.
- Plaintext source files.
- Plaintext source file names from owner repositories.

Recommended persistent volume categories:

```text
nasbb-host-config
nasbb-host-state
nasbb-host-logs
hosted-storage-root
tailscale-state, if container-managed Tailscale is selected
```

## Observability And Health

The host agent must report operational health without exposing sensitive data.

Required health checks:

- Host agent running.
- SFTP service running.
- Overlay status.
- Storage root available.
- Per-allocation used/free capacity.
- Per-allocation suspended/active/retiring state.
- Last owner write-test timestamp if available.
- Quota warning/critical state.
- Bandwidth/access policy status.
- Recent redacted operational events.

Health output must be safe for the desktop UI and later web health reporting.

## Docker Packaging Requirements

The implementation should produce a ready-for-test setup.

Expected deliverables:

- Dockerfile or Dockerfiles.
- `docker-compose.yml` or equivalent compose template.
- `.env.example` or generated config template if needed.
- Host agent source code.
- SFTP service configuration.
- Persistent volume layout.
- Local API documentation.
- Setup/readme instructions for Ubuntu/Linux Mint.
- Test script or runbook.
- Automated tests where practical.

The user should not need to manually install SFTP packages, Tailscale packages, quota tools, or edit daemon config inside the container unless the final design explicitly chooses host-managed Tailscale or host-managed quota.

## Suggested Repository Placement

The implementation agent may choose final paths, but a reasonable starting layout is:

```text
apps/host-agent/
  README.md
  docker/
  src/
  tests/
  compose/
docs/host-agent/
  docker-host-agent-implementation.md
  api-contract.md
  runbook.md
```

If the agent chooses a different layout, it must explain why in the implementation report.

## Implementation Phases

The agent should aim to complete these in one coherent pass:

1. Design the Docker host architecture.
2. Implement the host agent service.
3. Implement or configure the SFTP service.
4. Implement allocation creation and per-match isolation.
5. Implement owner public key authorization.
6. Implement invite/response bundle generation and import.
7. Implement local management API with auth.
8. Implement storage/quota reporting.
9. Implement overlay/Tailscale status reporting.
10. Implement suspend/resume/retire lifecycle.
11. Add health/events/log redaction.
12. Add Docker compose setup for Ubuntu/Linux Mint.
13. Add tests and a manual two-machine or local-loopback runbook.
14. Produce the final API/architecture report.

## Required Verification

At the end, the setup must be ready for test.

Minimum verification:

- Docker compose stack starts cleanly on Linux.
- Host API responds locally.
- SFTP service starts.
- Create at least two allocations.
- Confirm allocation A cannot access allocation B's repository path.
- Import an owner public key for allocation A.
- Confirm SFTP auth works for allocation A.
- Confirm allocation A key cannot authenticate to allocation B.
- Confirm write test succeeds inside allocation A repository.
- Confirm suspend blocks access for allocation A without affecting allocation B.
- Confirm resume restores access.
- Confirm retire disables allocation access without deleting unrelated allocations.
- Confirm logs do not expose tokens, private keys, or full sensitive paths.
- Confirm health endpoint reports status and capacity.
- Confirm invite and owner response files round-trip successfully.

If Tailscale is implemented in the first pass:

- Confirm Tailscale status is visible through API.
- Confirm overlay address or MagicDNS name is surfaced.
- Confirm SFTP listens on the intended interface/port.

If hard quota is implemented:

- Confirm writes fail or are blocked beyond quota.

If only soft/advisory quota is implemented:

- Confirm the API clearly reports `quotaMode`.
- Confirm warning/critical thresholds trigger from measured usage.

## Final Implementation Report Requirement

At the end of implementation, the agent must add or update a report that becomes the UI integration source of truth.

Create or update:

```text
docs/host-agent/api-contract.md
```

The report must include:

- Final container architecture.
- Final service list.
- Final port list.
- Which ports bind to localhost, host network, overlay network, or container network.
- Final persistent volume list.
- Final API protocol and auth model.
- Full API endpoint list or equivalent RPC method list.
- Request/response schema examples.
- Error schema.
- Allocation lifecycle state machine.
- Host Invite Bundle schema.
- Owner Access Response schema.
- Tailscale/overlay integration mode.
- SFTP isolation strategy.
- Quota strategy and limitations.
- Bandwidth/access-window strategy and limitations.
- Security decisions.
- Test commands run and results.
- Known gaps.
- UI integration notes.

This report should be precise enough that a separate desktop UI agent can implement the UI against it without reading the host-agent source code first.

## Quality Bar

The implementation should be practical, testable, and honest about limitations.

Prefer:

- Simple, explicit service boundaries.
- Strong isolation over clever convenience.
- Local-only management API by default.
- Structured config and schemas.
- Redacted logs.
- Small, auditable lifecycle operations.
- Clear failure states.

Avoid:

- Hidden public network exposure.
- Shared credentials across matches.
- Storing owner secrets.
- Docker-only claims that depend on host filesystem features without verification.
- API contracts that are only implicit in code.
- Requiring normal users to edit container internals.

## Success Definition

This work is successful when a Linux host can start the Docker runtime, configure hosting through the API/UI path, host multiple isolated encrypted repository allocations, exchange one invite and one owner response file, and pass an owner-side SFTP write test with no manual host OS account or `sshd_config` setup.
