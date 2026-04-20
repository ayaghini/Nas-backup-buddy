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
- A bundled-tool manifest scaffold in `src-tauri/resources/tool-manifest.json`; checksums are intentionally empty until release tooling supplies real binaries.
- Mock/offline backup, repository check, and restore drill flows that update health and Protected-gate state.

## Current Progress

| Area | Progress | Notes |
| --- | ---: | --- |
| React/Tauri UI scaffold | `██████░░░░` 60% | Main views are interactive in mock/offline mode. |
| Rust safety core | `███████░░░` 70% | Config, health, redaction, tool status, command planning, and readiness models exist. Cargo verification is still needed here. |
| Kopia/Syncthing planning | `████░░░░░░` 40% | Plans and redaction exist; real tool execution is not enabled. |
| Restore drill flow | `██████░░░░` 60% | Mock pass, canary mismatch, and failure paths update health state. Real Kopia restore is future work. |
| Release readiness | `██░░░░░░░░` 20% | Manifest/resource scaffold exists; signing, binaries, checksums, and license inventory remain. |

## Known Gaps

- Real Kopia and Syncthing binaries are not bundled yet.
- Manifest checksums are placeholders, so bundled tool readiness will fail closed until release tooling fills them.
- Real web API pairing is not implemented yet.
- OS keychain integration is not implemented yet.
- Rust checks were not run in the current desktop environment because Cargo is unavailable.
- Release signing is not configured yet.
- Third-party license inventory needs audit before public release.
