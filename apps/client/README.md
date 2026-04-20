# NAS Backup Buddy Client

This is the scaffold for the NAS Backup Buddy cross-platform desktop client.

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

- UI placeholder views for dashboard, setup, backup plan, Syncthing, restore drill, health checks, logs, settings, and about/license.
- Rust core modules for config validation, health threshold mapping, redaction, safe folder validation, and bundled tool manifest modeling.
- Mock/offline behavior.

## Known Gaps

- Real Kopia and Syncthing binaries are not bundled yet.
- Real web API pairing is not implemented yet.
- OS keychain integration is not implemented yet.
- Release signing is not configured yet.
- Third-party license inventory needs audit before public release.

