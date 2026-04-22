# NAS Backup Buddy Client

This is the scaffold for the NAS Backup Buddy cross-platform desktop client.
It is currently a mock/offline-capable safety prototype: the UI is interactive, Rust core logic models the safety rules, and Kopia/Syncthing integration is planned and redacted, but real backup execution is not enabled yet.

The client target is:

- Tauri desktop shell.
- React + TypeScript UI.
- Rust local service logic.
- AGPL-3.0-only.
- Mock/offline capable until the web API is real.

## Safety Rules

- Keep backup passwords and private keys local.
- Store non-secret config as TOML.
- Store only keychain references in config.
- Never sync live source folders directly with Syncthing.
- Treat Syncthing as transport only.
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

The current desktop environment used during scaffolding did not have `cargo` available, so Rust checks must be run on a machine with Rust installed.

## Current Scaffold

The client currently includes:

- Interactive UI views for dashboard, setup, backup plan, Syncthing connection, restore drill, health checks, logs, settings, and about/license.
- Shared React context for setup state, health state, tool status, wizard configuration, logs, and mock operation results.
- Rust core modules for role-aware config validation, health threshold mapping, redaction, source-folder safety, Kopia command planning, Syncthing API planning, integration readiness, and bundled tool manifest modeling.
- Real SHA-256 verification logic for bundled tool checks.
- A bundled-tool manifest in `src-tauri/resources/tool-manifest.json`; macOS arm64 Kopia and Syncthing entries point at packaged `resources/binaries/*` paths and are filled with real checksums, while other platforms intentionally fail closed until release tooling supplies real binaries.
- Pinned macOS arm64 Kopia and Syncthing binaries under `src-tauri/resources/binaries/`.
- Mock/offline backup, repository verification, and restore drill flows that update health and Protected-gate state.

## Current Progress

| Area | Progress | Notes |
| --- | ---: | --- |
| React/Tauri UI scaffold | `███████░░░` 70% | Main views are interactive in mock/offline mode and Rust checks pass. |
| Rust safety core | `████████░░` 80% | Config, health, redaction, tool status, command planning, and readiness models have passing Cargo checks. |
| Kopia/Syncthing planning | `█████░░░░░` 50% | Plans, redaction, macOS arm64 bundled binaries, and checksum verification exist; real guarded execution is not enabled. |
| Restore drill flow | `██████░░░░` 60% | Mock pass, canary mismatch, and failure paths update health state. Real Kopia restore is future work. |
| Release readiness | `███░░░░░░░` 30% | Manifest/resources and macOS arm64 tool inventory exist; signing, all-platform binaries, and complete license inventory remain. |

## Known Gaps

- Real Kopia and Syncthing execution is not wired into user actions yet.
- Only macOS arm64 Kopia and Syncthing binaries are bundled; other platform manifest entries intentionally fail closed until release tooling fills them.
- Real web API pairing is not implemented yet.
- OS keychain integration is not implemented yet.
- Release signing is not configured yet.
- Third-party license inventory needs audit before public release.
