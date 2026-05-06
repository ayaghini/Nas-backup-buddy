# Client App

Tauri desktop app in `apps/client`.

## Active Tabs
- `Host`: Docker host-agent setup and storage-host operations (allocations, invites, SFTP bind, Tailscale, diagnostics).
- `Peer`: multi-peer data-owner tab — each peer has its own invite/response/connect/backup lifecycle; all peers persist as `savedPeers[]` in app config.
- `Setup Wizard`: 4-step flow (source folders → backup destination → retention → review); step 2 shows all connected peers as selectable cards that auto-fill SFTP fields.
- `Backup Plan`/`Recovery Key`: provide source folders and Kopia password used by Peer backup.
- `Health Checks`: live metrics table, Backup Readiness Checklist (5 gates), alert thresholds reference, manual refresh.

## Host Tab State
- Persists under `hostTabState` in app config.
- Stores token and last known env, not backup secrets.
- Uses localhost host-agent API through Rust proxy command `host_agent_http` in Tauri.
- Allocation actions: create, generate invite, import owner response, suspend (with confirm), resume, retire (with confirm), delete (with confirm + warning for active peers).
- RETIRED allocations are hidden by default; a "Show retired (N)" toggle reveals them.

## Peer Tab State (`savedPeers[]`)
- Each peer is a `SavedPeer` record keyed by a stable local UUID.
- Persisted fields: invite JSON, SFTP host/port/username/path, manual host override, owner public key, private key path reference, response JSON, host key confirmation, phase, last SFTP/repo status, timestamps.
- Does not store private key contents or Kopia password in React state or on disk.
- Session-only (not persisted): live probe/SFTP/repo/backup results, loading flags, previous-session note.
- Phase is derived from persisted + session data: `needs_invite → invite_invalid → needs_key → response_ready → waiting_for_host → sftp_verified → repo_ready → blocked`.

## Build/Test
- Frontend: `cd apps/client && npm run build`
- TypeScript: `cd apps/client && npx tsc --noEmit`
- Rust workspace: `cd apps/client && cargo test --workspace`

## Watchpoints
- Keep Host independent from owner setup wizard.
- Peer must not trust invite host key silently; user confirmation required before SFTP verify.
- Expired invites show a red banner in the invite section — user must request a fresh one from the host.
- Cross-account Tailscale often needs raw `100.x` IP in the host override field instead of MagicDNS.
- Wizard step 2 only shows peers with SFTP credentials (`sftpHost !== ''`); peers still in `needs_invite`/`needs_key` are excluded.
