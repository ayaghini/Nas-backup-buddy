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

Cross-platform desktop client: Tauri + React + TypeScript UI with a local Rust service. It manages Kopia, SFTP remote repository targets, private overlay reachability, safe folder layout, backups, restore drills, the Docker-backed Host tab, and only allowlisted operational metadata. Syncthing work is legacy/developer context unless it is deliberately reintroduced.

Current scaffold includes interactive UI views, Rust core modules for config validation, health mapping, safe folder checks, redaction, tool manifest modeling, Kopia execution, SFTP verification, and host-agent Docker controls.

```text
apps/host-agent
```

Docker host-agent stack for storage providers. It includes the Go `nasbb-agent` API, the OpenSSH `nasbb-sftp` container, Compose files, allocation lifecycle, Host Invite Bundle generation, Owner Access Response import, soft quota monitoring, and integration tests.

```text
apps/agent
```

Legacy/future headless agent notes. The active Docker host implementation is `apps/host-agent`.

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
