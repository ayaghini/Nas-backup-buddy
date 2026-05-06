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
4. Peer tab (multi-peer): user clicks "Add peer", pastes or imports invite. Each peer is a `SavedPeer` record persisted in `savedPeers[]`.
5. Peer generates owner SSH key, auto-submits or exports the Owner Access Response.
6. Host-agent authorizes public key and marks allocation `READY`.
7. Peer confirms host key out-of-band, verifies TCP/SFTP, creates/connects Kopia SFTP repo.
8. User opens Setup Wizard, selects the connected peer (auto-fills all SFTP fields), adds source folders, configures retention, saves.
9. Peer runs backup from wizard-configured source folders.

## Trust Boundaries
- Desktop app stores `savedPeers[]`, wizard configs, and other non-secret state in platform app-data JSON.
- Kopia password/private SSH key stay on peer machine/Rust side. `SavedPeer` stores only key path references, never key content.
- Host-agent management API is localhost-only (`127.0.0.1:7420`).
- Peer API is reachable over the SFTP/Tailscale bind address (`:7422`) and guarded by one-time invite token.
- SFTP should bind to a Tailscale `100.x` IP for remote peers; `127.0.0.1` is local test only; `0.0.0.0` is unsafe.

## Key Files
- Peer UI (multi-peer): `apps/client/src/views/Peer.tsx`
- Peer types (`SavedPeer`, `PeerPhase`): `apps/client/src/lib/types.ts`
- App-wide state incl. `savedPeers`: `apps/client/src/context/AppContext.tsx`
- Persistence (incl. `savedPeers`): `apps/client/src/lib/persistence.ts`
- Setup Wizard (peer-select step): `apps/client/src/views/SetupWizard.tsx`
- Host UI shell: `apps/client/src/views/Host.tsx`
- Host allocations + delete: `apps/client/src/views/host/AllocationsPanel.tsx`
- Host Tailscale panel: `apps/client/src/views/host/TailscalePanel.tsx`
- Health Checks: `apps/client/src/views/HealthChecks.tsx`
- Tauri bridge: `apps/client/src/lib/tauri-bridge.ts`, `apps/client/src-tauri/src/lib.rs`
- Host-agent API: `apps/host-agent/src/api/`
- Allocation manager (incl. delete): `apps/host-agent/src/allocation/manager.go`
- Invite/response bundles: `apps/host-agent/src/bundle/`
- SFTP/Kopia verification: `apps/client/crates/nasbb-core/src/sftp_verify.rs`, `apps/client/crates/nasbb-core/src/kopia.rs`

## Current Risks
- Peer API validation is weaker than manual owner-response import. See peer audit.
- Allocation summaries may expose `inviteToken` to the authenticated host UI/API response. See host audit.
- Go test toolchain was unavailable during the 2026-05-02 audit.
