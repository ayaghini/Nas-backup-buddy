# NAS Backup Buddy

## Executive Summary

NAS Backup Buddy is an open-source homelab project for encrypted reciprocal offsite backup. The product direction is now clear: use Kopia for encrypted, versioned backups; use Syncthing only as the peer-to-peer transport for encrypted repository data; and use the platform for matching, backup pacts, health checks, restore drills, incidents, and reputation.

Current repository status:

- A docs-first feasibility and implementation package exists.
- A Vite + React web prototype exists in `apps/web`.
- A Tauri + React + Rust desktop client exists in `apps/client`, with native setup flows, local persistence, recovery-key handling, bundled-tool verification, and a generated-data Kopia test lab for real backup, `snapshot verify`, and restore-drill execution on the supported local platform.
- The client safety model is local-first: secrets stay local, telemetry is allowlisted, and source folders must never be synced directly to peers.
- Release foundations have started under AGPL-3.0-only, but production release readiness still requires a complete license inventory, signing, all-platform bundled tool checksums, two-machine Syncthing evidence, and security review.

### Project Progress

Progress is estimated by usable project capability, not by lines of code. The project is still pre-alpha.

| Component | Progress | Status | What Exists | Main Remaining Work |
| --- | ---: | --- | --- | --- |
| Feasibility and product docs | `████████░░` 80% | Strong foundation | Feasibility study, architecture, implementation map, risk register, control plan, runbooks, ADRs | Keep docs updated as real POC results arrive |
| Web coordination prototype | `██████░░░░` 60% | Usable local prototype | Dashboard, matching, pacts, health, restore drills, incidents, admin, shared mock state | Real backend, auth, persistence, API contracts, production UX pass |
| Desktop client scaffold | `████████░░` 80% | Interactive local app verified | Tauri + React UI, shared app state, setup wizard with folder pickers, persistent local settings, recovery-key flow, backup plan, Syncthing safety view, restore drill, health checks, logs, settings, Rust checks passing | Production service lifecycle, OS keychain, more platform testing, packaging polish |
| Backup safety controls | `████████░░` 80% | Real generated-data lab plus UI controls | Protected gate, restore failure mapping, canary mismatch handling, repository verification failure mapping, folder safety validation, telemetry consent wiring, real Kopia generated-data backup/verify/restore path | Two-machine peer restore evidence, live Syncthing health, incident submission to web app |
| Release and open-source foundation | `█████░░░░░` 50% | Started | AGPL-3.0-only license, third-party notices foundation, package scaffolds, macOS arm64 tool sources/checksums recorded | Complete dependency license inventory, signing, all-platform checksums, release process |
| Syncthing/Kopia integration | `██████░░░░` 60% | Kopia real-test path works locally | Redacted Kopia command planner, guarded Kopia execution, generated-data test lab, `snapshot verify`, restore drill, Syncthing transport-folder safety, real SHA-256 verifier, pinned macOS arm64 Kopia/Syncthing binaries | Live Syncthing daemon/API management, all-platform binaries, keychain-backed production secrets |
| Infrastructure and backend | `█░░░░░░░░░` 10% | Future work | Syncthing discovery/relay notes, web app mock state | API, database, auth, pairing tokens, health ingestion, relay/discovery operations |
| Real backup POC evidence | `███░░░░░░░` 30% | Single-machine generated-data Kopia lab proven | Client can create a local test lab, run Kopia snapshot, verify repository content, restore canary data, and report health from actual outcomes | Run two-machine Kopia + Syncthing trial, record results, prove restore from peer copy |
| Production readiness | `░░░░░░░░░░` 0% | Not production-ready | Clear safety posture and launch constraints | Security review, legal review, reliability metrics, support process, paid-marketplace controls |

Next engineering priorities:

- Promote the generated-data Kopia lab into a documented test gate for every client release.
- Add live Syncthing daemon/API management and two-machine encrypted repository replication tests.
- Build keychain-backed secret storage for production backup passwords.
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
  web/                 Marketplace and matching prototype
  client/              Tauri + Rust desktop client scaffold
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
