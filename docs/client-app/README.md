# Client App

Tauri desktop app in `apps/client`.

## Active Tabs
- `Host`: Docker host-agent setup and storage-host operations.
- `Peer`: data-owner invite import, owner response, SFTP verify, Kopia SFTP backup.
- `Backup Plan`/`Recovery Key`: provide source folders and Kopia password used by Peer backup.

## Host Tab State
- Persists under `hostTabState` in app config.
- Stores token and last known env, not backup secrets.
- Uses localhost host-agent API through Rust proxy command `host_agent_http` in Tauri.

## Peer Tab State
- Persists under `peerTabState`.
- Stores invite JSON, public key, private key reference/path, response JSON, host override, last statuses.
- Does not store private key contents or Kopia password in React state.

## Build/Test
- Frontend: `cd apps/client && npm run build`
- Rust workspace: `cd apps/client && cargo test --workspace`

## Watchpoints
- Keep Host independent from owner setup wizard.
- Peer must not trust invite host key silently; user confirmation is required before SFTP verify.
- Cross-account Tailscale often needs raw `100.x` IP instead of MagicDNS.
