# NAS Backup Buddy

## Executive Summary

NAS Backup Buddy is an open-source homelab project for encrypted reciprocal offsite backup. The v1 architecture is now centered on one guided desktop flow: **Peer Connection = Tailscale reachability + Host Spaces + Backup Targets**. Kopia creates encrypted, versioned backups directly on peer-hosted SFTP storage over a private overlay network. The host never needs access to plaintext, and the data owner keeps backup secrets and private SSH keys local.

Current repository status:

- `apps/client` contains the active Tauri + React + Rust desktop client.
- The primary setup UI is now `Peer Connection`, which replaces separate Overlay, Host Setup, and Peer Storage decisions.
- Tailscale is the supported v1 overlay path. The app detects the CLI, shows MagicDNS/IP status, can run bounded peer pings, can probe TCP/SFTP reachability, and can explicitly run `tailscale up` when the user asks.
- Host Spaces let a storage provider allocate one or more isolated SFTP spaces, choose hosted folders with a browse button, validate path isolation and quota, generate display-only host setup commands, and produce a Host Invite Bundle.
- Backup Targets let the data owner import a Host Invite Bundle, generate or reference a per-match SSH key, copy an Owner Access Request, verify SFTP auth/write access, and create/connect a Kopia SFTP repository.
- The client remains local-first: private keys, backup passwords, and raw backup data stay local; telemetry is allowlisted; source folders must never be shared directly with peers.
- Syncthing is no longer a normal setup path. Existing Syncthing code/tests remain as legacy/developer support while the product moves to Kopia-over-SFTP.
- Release foundations have started under AGPL-3.0-only, but production readiness still requires packaging/signing, full dependency review, multi-platform tool checksums, a real two-machine restore trial, and security review.

Latest architecture:

```text
Data owner source folders
  -> Kopia encryption/deduplication
  -> SFTP over Tailscale
  -> peer-hosted isolated storage path
  -> restore drill / repository verify / health report
```

Peer setup is intentionally two-sided:

1. Storage host opens `Peer Connection -> Host Spaces`, creates a hosted allocation, runs the display-only OS setup commands, and sends the Host Invite Bundle.
2. Data owner opens `Peer Connection -> Backup Targets`, imports the bundle, generates a per-match SSH key, and sends the Owner Access Request.
3. Storage host imports the access request and runs the generated authorization commands.
4. Data owner verifies Tailscale, TCP, SFTP, and Kopia repository connectivity, then runs backup/restore checks.

### Project Progress

Progress is estimated by usable project capability, not by lines of code. The project is still pre-alpha.

| Component | Progress | Status | What Exists | Main Remaining Work |
| --- | ---: | --- | --- | --- |
| Feasibility and product docs | `████████░░` 80% | Strong foundation | Feasibility study, architecture, implementation map, risk register, control plan, runbooks, ADRs | Keep docs updated as real POC results arrive |
| Web coordination prototype | `██████░░░░` 60% | Usable local prototype | Dashboard, matching, pacts, health, restore drills, incidents, admin, shared mock state | Real backend, auth, persistence, API contracts, production UX pass |
| Desktop client | `████████░░` 85% | Main local app path implemented | Tauri + React UI, Peer Connection flow, multi-host allocations, multi-backup targets, Tailscale CLI detection/connect/ping, SFTP verify, Kopia connect, local persistence, recovery-key flow, restore drill, health checks | Production service lifecycle, OS keychain hardening, packaging polish |
| Backup safety controls | `████████░░` 85% | Real generated-data lab plus peer-target checks | Protected gate, restore failure mapping, canary mismatch handling, repository verification failure mapping, hosted path isolation validation, telemetry consent wiring, real Kopia generated-data backup/verify/restore path | Two-machine peer restore evidence, incident submission to web app, longer soak testing |
| Release and open-source foundation | `█████░░░░░` 50% | Started | AGPL-3.0-only license, third-party notices foundation, package scaffolds, macOS arm64 tool sources/checksums recorded | Complete dependency license inventory, signing, all-platform checksums, release process |
| Kopia/SFTP/Tailscale integration | `███████░░░` 70% | Main v1 path wired in app | Redacted Kopia command planner, guarded local Kopia execution, generated-data test lab, bounded Tailscale ping, TCP probe, SFTP auth/write verification, Kopia SFTP create/connect, host setup command plans | Real two-machine trial, OS-level quota enforcement evidence, keychain-backed production secrets |
| Infrastructure and backend | `█░░░░░░░░░` 10% | Future work | Web app mock state and coordination screens | API, database, auth, pairing tokens, health ingestion, invite/bundle exchange, reputation |
| Real backup POC evidence | `████░░░░░░` 40% | Single-machine lab proven; two-machine runbook ready | Client can create a local test lab, run Kopia snapshot, verify repository content, restore canary data, and report health from actual outcomes | Run two-machine Kopia over SFTP/Tailscale trial, record results, prove restore from peer-hosted repository |
| Production readiness | `░░░░░░░░░░` 0% | Not production-ready | Clear safety posture and launch constraints | Security review, legal review, reliability metrics, support process, paid-marketplace controls |

Next engineering priorities:

- Run and document the two-machine Tailscale + SFTP + Kopia restore trial.
- Harden secret storage with OS keychain support for production backup passwords and SSH key refs.
- Polish the Peer Connection UX around multi-peer lifecycle, quota guidance, and recovery from failed setup steps.
- Connect client health reports to the web app once the API exists.
- Keep the first launch invite-only and barter-based.

## Repository Map

```text
apps/
  web/                 Marketplace and matching prototype
  client/              Tauri + React + Rust desktop client
  agent/               Headless/NAS agent notes for future packaging
docs/
  client-app/          Client app architecture, safety, config, and release docs
  adr/                 Architecture decision records
  prompts/             Copy-paste prompts for future implementation agents
  research/            Source links and research notes
  runbooks/            Operator and prototype procedures
  templates/           User agreement and operational templates
infra/
  syncthing/           Legacy discovery and relay infrastructure notes
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

- Backup snapshots: Kopia.
- Encrypted peer storage target: SFTP over Tailscale.
- Coordination: self-hosted web app.
- Connectivity: Tailscale first; Headscale/WireGuard are future advanced paths; Syncthing is legacy/developer-only.
- Local management: Tauri + Rust desktop client with bundled Kopia; headless Docker/NAS host packaging can follow later.

## Status

Pre-alpha prototype phase. The repository contains planning docs, a web app prototype, and an active desktop client implementation. It is not production-ready.
