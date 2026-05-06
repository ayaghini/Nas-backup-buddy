# NAS Backup Buddy Client

This is the scaffold for the NAS Backup Buddy cross-platform desktop client.
It is currently a pre-alpha safety prototype with real generated-data Kopia execution and a Docker-backed Host tab. The UI is interactive, Rust core logic models the safety rules, and the Tauri backend can create an isolated test lab, run Kopia snapshots, run `kopia snapshot verify`, restore a canary file, manage the host-agent Docker stack, and report health from those real outcomes. Syncthing is legacy/developer support only.

The client target is:

- Tauri desktop shell.
- React + TypeScript UI.
- Rust local service logic.
- AGPL-3.0-only.
- Browser/mock fallback for UI development until the web API is real.

## Safety Rules

- Keep backup passwords and private keys local.
- Store non-secret config as TOML.
- Store only keychain references in config.
- Never sync live source folders directly with Syncthing.
- Treat Syncthing as legacy/optional mirror-mode code only.
- Use Kopia as the default backup engine.
- Block Protected status until restore drill checks pass.
- Redact logs before display or reporting.

## Frontend Commands

```bash
npm install
npm run typecheck
npm run build
npm run lint
npm run dev
```

## Tauri Commands

```bash
npm run tauri dev
npm run tauri build
```

These commands require the Tauri/Rust toolchain to be installed locally.
The macOS arm64 build currently produces both a `.app` bundle and a `.dmg` smoke-test artifact.

## Rust Commands

From `apps/client`:

```bash
cargo fmt --check
cargo check
cargo test
```

Rust checks are expected to pass on a machine with Rust installed.

## Current Scaffold

The client currently includes:

- Interactive UI views for dashboard, setup wizard, backup plan, Docker Host, multi-peer Peer tab, restore drill, health checks, logs, settings, recovery key, about/license, and Syncthing legacy/developer support.
- Docker Host tab for storage providers: Docker prerequisite checks, `.env` read/write, stack start/stop/restart, token connection, Tailscale/SFTP settings, allocations (create / generate invite / import response / suspend+confirm / resume / retire+confirm / delete+confirm / show-retired toggle), events, logs, and verification.
- Multi-peer Peer tab: each peer is a `SavedPeer` record in `savedPeers[]`; phase is derived from persisted + session data; accordion auto-opens to the right section; expired-invite banner; supports invite import, key generation, auto-submit, SFTP verify, Kopia repo connect, and backup per peer.
- Setup Wizard: 4-step flow (source folders → backup destination → retention → review); step 2 shows connected peers as selectable cards that auto-fill all SFTP fields from the selected `SavedPeer`; summary shows actual field values; update-in-place notice when re-saving an existing peer config.
- Health Checks: live metrics table, "Backup Readiness Checklist" (5 gates), alert thresholds reference, manual Refresh button.
- Shared React context and persistence: `savedPeers[]`, `upsertSavedPeer`, `removeSavedPeer`, wizard configs, health report, setup state, tool status, logs, and operation results.
- `updateRemoteRepositoryState` action in AppContext — Peer probe and connect results propagate to Health Checks and Backup Readiness Checklist automatically.
- Rust core modules for role-aware config validation (SFTP mode does not require local `repository_path`), health threshold mapping, redaction, source-folder safety, Kopia command planning (SFTP create/connect), overlay TCP probe, integration readiness with remote target checks, and bundled tool manifest modeling.
- `SftpRepoTarget::config_id()` — stable 24-char SHA-256-derived per-target config discriminator. Different SFTP targets get different Kopia config files; same target always maps to the same file.
- Real SHA-256 verification logic for bundled tool checks.
- A bundled-tool manifest in `src-tauri/resources/tool-manifest.json`; macOS arm64 Kopia and Syncthing entries point at packaged `resources/binaries/*` paths and are filled with real checksums, while other platforms intentionally fail closed until release tooling supplies real binaries.
- Pinned macOS arm64 Kopia and Syncthing binaries under `src-tauri/resources/binaries/`.
- A generated-data test lab that runs real Kopia repository creation/connection, snapshot creation, `snapshot verify`, restore, and canary SHA-256 comparison.
- Legacy Syncthing transport-folder preparation that rejects source folders and emits redacted configuration snippets without requiring a running Syncthing daemon. Syncthing is not the default v1 transport.
- Browser/mock fallback backup, verification, and restore-drill flows for UI development without Tauri.

## Current Progress

| Area | Progress | Notes |
| --- | ---: | --- |
| React/Tauri UI scaffold | `█████████░` 90% | Multi-peer Peer tab, wizard peer-select cards, host allocation delete, health refresh — all tabs are functional with full persistence. |
| Rust safety core | `████████░░` 80% | Config, health, redaction, tool status, command planning, and readiness models have passing Cargo checks. |
| Kopia/SFTP/overlay integration | `████████░░` 80% | Multi-peer Kopia SFTP verify/connect/backup wired per-peer; matching wizard config selected by overlay_host. |
| Restore drill flow | `███████░░░` 70% | Real generated-data restore drill compares canary checksums and updates health state. Peer-held restores remain future work. |
| Release readiness | `████░░░░░░` 40% | Manifest/resources and macOS arm64 tool inventory exist; signing, all-platform binaries, and complete license inventory remain. |

## Known Gaps

- Kopia execution is limited to user-initiated flows; background/scheduled backups are not implemented.
- Syncthing is not the default v1 transport; legacy mirror-mode code remains for developer support only.
- Only macOS arm64 Kopia and Syncthing binaries are bundled; other platform manifest entries intentionally fail closed until release tooling fills them.
- Real web API pairing is not implemented yet.
- OS keychain integration is not implemented yet (private key path references stored; key content never written to disk or React state).
- Release signing is not configured yet.
- Third-party license inventory needs audit before public release.
- Peer API validation is weaker than manual import (does not re-validate matchId, requestedSftpUsername, or invite expiry on auto-submit). See `docs/audits/peer-tab-audit-2026-05-02.md`.
