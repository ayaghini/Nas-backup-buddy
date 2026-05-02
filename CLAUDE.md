# CLAUDE.md

Guidance for coding agents working in this repo.

## Status
Pre-alpha, but no longer docs-only. Active implementation lives in:
- `apps/client`: Tauri + React + Rust desktop app.
- `apps/host-agent`: Docker host-agent and SFTP service.
- `apps/web`: older coordination prototype.

Current focus: harden the Host and Peer tabs for Kopia-over-SFTP backup.

## Read First
- `docs/README.md`
- `docs/architecture.md`
- `docs/implementation-map.md`
- `docs/audits/host-tab-audit-2026-05-02.md`
- `docs/audits/peer-tab-audit-2026-05-02.md`

## Non-Negotiables
- Never expose live source folders directly to peers.
- Never collect/upload Kopia passwords, private SSH keys, plaintext filenames, file contents, or full local source paths.
- Never mark a setup healthy until restore evidence exists.
- Treat Syncthing as legacy/deferred unless explicitly requested.
- Keep Host and Peer responsibilities visibly separate.

## Active Flow
Host starts Docker stack, configures Tailscale/SFTP bind, creates allocation, generates invite. Peer imports invite, generates owner SSH key/response, auto-submits or exports response, verifies SFTP/host key, connects Kopia SFTP repository, and runs backup.

## Test Hints
- Frontend: `cd apps/client && npm run build`
- Rust: `cd apps/client && cargo test --workspace`
- Go: `cd apps/host-agent && go test ./...` when Go is installed.
