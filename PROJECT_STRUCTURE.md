# Project Structure

This project is intentionally split between product coordination, local agent work, and infrastructure operations.

## Top-Level Layout

```text
apps/web
```

Future website for user profiles, matching, backup pacts, health dashboards, reputation, and later billing.

```text
apps/client
```

Future cross-platform desktop client. This is the first real client-app target: Tauri + React + TypeScript UI with a local Rust service. It should manage Kopia, SFTP remote repository targets, private overlay reachability, safe folder layout, backups, restore drills, and only allowlisted operational metadata. Syncthing work is legacy/optional mirror-mode context unless it is deliberately reintroduced.

Current scaffold includes UI placeholder views and Rust core modules for config validation, health mapping, safe folder checks, redaction, and tool manifest modeling.

```text
apps/agent
```

Legacy/future headless agent notes for NAS and Docker-style deployments. Keep this path for later packaging work unless the desktop client and headless service are intentionally merged.

```text
infra/syncthing
```

Infrastructure notes. The current default direction is SFTP over Tailscale, Headscale, or WireGuard. Older Syncthing discovery and relay notes are retained as optional/future transport research.

```text
docs
```

Project decisions, feasibility research, runbooks, templates, implementation plans, and client-app planning docs.

```text
scripts
```

Future helper scripts. Avoid adding scripts until the manual process is understood and repeatable.

## Design Bias

- Docs before automation.
- Manual proof of concept before custom agent code.
- Backup correctness before marketplace features.
- Barter community before payment flows.
- Restore testing before growth.
- Desktop client safety before headless packaging expansion.
