# NAS Backup Buddy

## Executive Summary

NAS Backup Buddy is an open-source homelab project for encrypted reciprocal offsite backup. The product direction is now clear: use Kopia for encrypted, versioned backups; use Syncthing only as the peer-to-peer transport for encrypted repository data; and use the platform for matching, backup pacts, health checks, restore drills, incidents, and reputation.

Current repository status:

- A docs-first feasibility and implementation package exists.
- A Vite + React web prototype exists in `apps/web`.
- A Tauri + React + Rust desktop client scaffold exists in `apps/client`.
- The client safety model is local-first: secrets stay local, telemetry is allowlisted, and source folders must never be synced directly to peers.
- Release foundations have started under AGPL-3.0-only, but production release readiness still requires license inventory, signing, bundled tool checksums, and Rust verification on a machine with Cargo.

### Project Progress

Progress is estimated by usable project capability, not by lines of code. The project is still pre-alpha.

| Component | Progress | Status | What Exists | Main Remaining Work |
| --- | ---: | --- | --- | --- |
| Feasibility and product docs | `████████░░` 80% | Strong foundation | Feasibility study, architecture, implementation map, risk register, control plan, runbooks, ADRs | Keep docs updated as real POC results arrive |
| Web coordination prototype | `██████░░░░` 60% | Usable local prototype | Dashboard, matching, pacts, health, restore drills, incidents, admin, shared mock state | Real backend, auth, persistence, API contracts, production UX pass |
| Desktop client scaffold | `████░░░░░░` 40% | Scaffold started | Tauri + React UI shell, Rust core modules, config/health/redaction/safety/tool-manifest models | Real service orchestration, keychain, Kopia/Syncthing manager, Tauri command coverage |
| Backup safety controls | `█████░░░░░` 50% | Core rules modeled | Protected gate, restore failure mapping, canary mismatch handling, folder safety validation, telemetry allowlist docs | End-to-end backup/sync/restore automation and real-world failure tests |
| Release and open-source foundation | `███░░░░░░░` 30% | Started | AGPL-3.0-only notice, third-party notices placeholder, package scaffolds | Full AGPL text/audit, dependency license inventory, signing, checksums, release process |
| Syncthing/Kopia integration | `██░░░░░░░░` 20% | Designed, not implemented | Tool choice and architecture documented; manifest model exists | Bundle pinned binaries, verify checksums, run Kopia/Syncthing safely from client |
| Infrastructure and backend | `█░░░░░░░░░` 10% | Future work | Syncthing discovery/relay notes, web app mock state | API, database, auth, pairing tokens, health ingestion, relay/discovery operations |
| Real backup POC evidence | `█░░░░░░░░░` 10% | Not yet proven in repo | POC and restore drill runbooks | Run two-machine Kopia + Syncthing trial, record results, prove restore from peer copy |
| Production readiness | `░░░░░░░░░░` 0% | Not production-ready | Clear safety posture and launch constraints | Security review, legal review, reliability metrics, support process, paid-marketplace controls |

Next engineering priorities:

- Run Rust checks for the client on a machine with Cargo.
- Build the real Kopia/Syncthing tool manager and keychain-backed secret storage.
- Connect client health reports to the web app once the API exists.
- Keep the first launch invite-only and barter-based.

NAS Backup Buddy is an early-stage project concept for an encrypted reciprocal offsite backup exchange aimed at homelab users.

The core idea is simple: users with spare NAS or server capacity can match with other users who need offsite backup space. Data should be encrypted before it leaves the owner device. The platform coordinates matching, health checks, reputation, and recovery workflows, while open source tools do the actual backup and transfer work.

## Current Position

This repository starts as a docs-first project. The feasibility conclusion is:

- The idea is technically feasible.
- The safest MVP should use a real backup engine, such as Kopia or restic, to create encrypted versioned snapshots.
- Syncthing should be treated as a transport and replication layer, not as the backup engine.
- The first launch should be invite-only and barter-based before any paid storage marketplace is attempted.

## Repository Map

```text
apps/
  web/                 Future marketplace and matching application
  client/              Future Tauri + Rust desktop client app
  agent/               Headless/NAS agent notes for future packaging
docs/
  client-app/          Client app architecture, safety, config, and release docs
  adr/                 Architecture decision records
  prompts/             Copy-paste prompts for future implementation agents
  research/            Source links and research notes
  runbooks/            Operator and prototype procedures
  templates/           User agreement and operational templates
infra/
  syncthing/           Discovery and relay infrastructure notes
scripts/               Future helper scripts
```

## Key Docs

- [Docs Index](docs/README.md)
- [Feasibility Study](docs/feasibility-study.md)
- [Reference Architecture](docs/architecture.md)
- [Implementation Map](docs/implementation-map.md)
- [Client App Plan](docs/client-app/README.md)
- [Control And Audit Plan](docs/control-and-audit-plan.md)
- [Risk Register](docs/risk-register.md)
- [Proof of Concept Runbook](docs/runbooks/proof-of-concept.md)
- [Restore Drill Runbook](docs/runbooks/restore-drill.md)

## Product Principle

Do not promise cloud-backup reliability until the project can measure and enforce it. The first version should be honest:

> Encrypted reciprocal offsite backup for homelab users, with matching, monitoring, and restore testing.

## Proposed Technical Direction

Recommended first stack:

- Backup snapshots: Kopia first, restic as a strong alternative.
- Encrypted peer transport: Syncthing.
- Coordination: self-hosted web app.
- Discovery/relay: start with Syncthing defaults, later add private discovery and relay.
- Local management: Tauri + Rust desktop client with bundled Kopia and Syncthing; headless Docker/NAS agent packaging can follow later.

## Status

Prototype phase. The repository contains planning docs, a web app prototype, and a desktop client scaffold. It is not production-ready.
