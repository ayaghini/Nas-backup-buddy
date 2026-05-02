# Architecture

## Goal
Encrypted offsite backup exchange between two users:
- Host offers isolated storage over SFTP.
- Peer/data-owner backs up directly to that SFTP target with Kopia.
- Host cannot read backup contents; peer owns encryption password/private key.

## Active Path
1. Host tab starts Docker stack: `nasbb-agent` + `nasbb-sftp`.
2. Host creates allocation and invite.
3. Invite includes SFTP target, host-key fingerprints, optional `peerApi` one-time submit URL/token.
4. Peer tab imports invite, generates owner SSH key, auto-submits or exports response.
5. Host-agent authorizes public key and marks allocation `READY`.
6. Peer verifies TCP/SFTP, confirms host key, creates/connects Kopia SFTP repo.
7. Peer runs backup from configured source folders.

## Trust Boundaries
- Desktop app stores local non-secret tab state in app config.
- Kopia password/private SSH key stay on peer machine/Rust side.
- Host-agent management API is localhost-only (`127.0.0.1:7420`).
- Peer API is reachable over the SFTP/Tailscale bind address (`:7422`) and guarded by one-time invite token.
- SFTP should bind to a Tailscale `100.x` IP for remote peers; `127.0.0.1` is local test only; `0.0.0.0` is unsafe.

## Key Files
- Peer UI: `apps/client/src/views/Peer.tsx`
- Host UI shell: `apps/client/src/views/Host.tsx`
- Host Tailscale panel: `apps/client/src/views/host/TailscalePanel.tsx`
- Tauri bridge: `apps/client/src/lib/tauri-bridge.ts`, `apps/client/src-tauri/src/lib.rs`
- Host-agent API: `apps/host-agent/src/api/`
- Invite/response bundles: `apps/host-agent/src/bundle/`
- SFTP/Kopia verification: `apps/client/crates/nasbb-core/src/sftp_verify.rs`, `apps/client/crates/nasbb-core/src/kopia.rs`

## Current Risks
- Peer API validation is weaker than manual owner-response import. See peer audit.
- Allocation summaries may expose `inviteToken` to the authenticated host UI/API response. See host audit.
- Go test toolchain was unavailable during the 2026-05-02 audit.
