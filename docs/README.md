# Documentation Index

Start here when working on the project.

## Current Status

- Feasibility and architecture docs are in place.
- `apps/web` contains the current coordination web prototype.
- `apps/client` contains the current Tauri + Rust desktop client scaffold with mock/offline setup, Kopia/Syncthing planning, restore drill, health checks, and fail-closed bundled-tool verification scaffolding.
- Release foundations have started with AGPL-3.0-only and a third-party notices placeholder.
- The project is not production-ready.

## Strategy And Research

- [Feasibility Study](feasibility-study.md)
- [Source Links](research/source-links.md)

## Product And Architecture

- [Reference Architecture](architecture.md)
- [Implementation Map](implementation-map.md)
- [Risk Register](risk-register.md)
- [Control And Audit Plan](control-and-audit-plan.md)

## Client App

- [Client App Overview](client-app/README.md)
- [Client App Architecture](client-app/architecture.md)
- [Client App Configuration](client-app/configuration.md)
- [Client App Security And Safety](client-app/security-and-safety.md)
- [Client App Implementation Map](client-app/implementation-map.md)
- [Client App Packaging And Release](client-app/packaging-and-release.md)

## Release Foundations

- [Repository License](../LICENSE)
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md)

## Runbooks

- [Proof Of Concept Runbook](runbooks/proof-of-concept.md)
- [Restore Drill Runbook](runbooks/restore-drill.md)
- [Client Local Kopia + Syncthing Test Runbook](runbooks/client-local-kopia-syncthing-test.md)

## Templates

- [Backup Pact Template](templates/backup-pact.md)

## Prompts

- [Implement Client App Prompt](prompts/implement-client-app.md)
- [Project Next Steps Agent Prompt](prompts/project-next-steps.md)

## Decision Records

- [ADR 0001: Use Backup Engine Plus Syncthing](adr/0001-use-backup-engine-plus-syncthing.md)
- [ADR 0002: Start With Barter Before Paid Marketplace](adr/0002-start-with-barter-before-paid-marketplace.md)

## How To Use These Docs

1. Read the feasibility study to understand the project shape.
2. Follow the implementation map phase by phase.
3. Use runbooks as the source of truth during experiments.
4. Record major changes as new ADRs.
5. Update the risk register and control plan after every phase gate.
6. Use prompts only after reading the docs they reference.
