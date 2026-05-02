# Host-Agent API Contract

Base: `http://127.0.0.1:7420/api/v1` for management API. Auth: `Authorization: Bearer <token>` except `/info`.

Peer API: `http://<tailscale-or-bind-host>:7422/peer/v1/submit-response`. Auth is one-time `inviteToken` inside JSON body.

## Compose Ports
- Management API: `127.0.0.1:${NASBB_API_PORT:-7420}:7420`
- SFTP: `${NASBB_SFTP_BIND:-127.0.0.1}:${NASBB_SFTP_PORT:-2222}:2222`
- Peer API: `${NASBB_SFTP_BIND:-127.0.0.1}:${NASBB_PEER_API_PORT:-7422}:7422`

Use `NASBB_SFTP_BIND=<host Tailscale 100.x IP>` and `TAILSCALE_ADDRESS=<same 100.x IP>` for cross-account owners.

## Allocation States
`DRAFT -> PENDING_KEY -> READY -> SUSPENDED/RETIRING -> RETIRED`; `EXPIRED -> PENDING_KEY`.

## Management Endpoints
- `GET /info`: `{version, ready}` no auth.
- `GET /status`: agent/storage/allocation counts.
- `GET|PATCH /config`: host label, capacities, quota defaults, bandwidth cap.
- `GET /health`: agent/SFTP/overlay/storage/allocation health.
- `GET /overlay/status`; `POST /overlay/refresh`.
- `GET /sftp/status`: bind, port, host key fingerprint, active users.
- `GET /storage/status`.
- `GET|POST /allocations`.
- `GET|PATCH /allocations/{allocId}`.
- `POST /allocations/{allocId}/invite`: allowed in `DRAFT` or `EXPIRED`; returns Host Invite Bundle; moves to `PENDING_KEY`.
- `POST /allocations/{allocId}/owner-response`: validates response; authorizes key; moves to `READY`.
- `POST /allocations/{allocId}/suspend|resume|retire`.

Error body: `{"error":"message","code":"MACHINE_CODE"}`.

## Host Invite Bundle
Required fields:
- `bundleVersion: 1`
- `kind: "nasbb.host_invite"`
- `matchId`, `allocId`, `connectionName`, `expiresAt`
- `sftp: {host, port, username, path}`
- `overlay: {provider, host, note}`
- `quota: {quotaBytes, quotaMode}`
- `hostKey: {fingerprintSha256, alternateFingerprints?, verificationNote}`
- `peerApi?: {submitUrl, token}`

## Owner Access Response
Required fields:
- `bundleVersion: 1`
- `kind: "nasbb.owner_access_response"`
- `matchId`, `allocId`
- `ownerDeviceLabel`
- `ownerPublicKey`
- `requestedSftpUsername`
- `createdAt`

Manual import validates kind, alloc ID, match ID, SSH key, and invite expiry.

Peer API currently validates token, allocation state, and SSH key only; see `docs/audits/peer-tab-audit-2026-05-02.md`.
