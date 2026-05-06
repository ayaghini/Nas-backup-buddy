# NAS Backup Buddy

## Executive Summary

NAS Backup Buddy is an open-source homelab project for encrypted reciprocal offsite backup. The v1 architecture is now centered on two local-first desktop flows: **Host** for storage providers running the Docker host-agent stack, and **Peer** for data owners importing a host invite and creating an encrypted Kopia SFTP target. Kopia creates encrypted, versioned backups directly on peer-hosted SFTP storage over a private overlay network. The host never needs access to plaintext, and the data owner keeps backup secrets and private SSH keys local.

Current repository status:

- `apps/client` contains the active Tauri + React + Rust desktop client.
- The primary host UI is now `Host`: it manages the Docker host-agent stack, `.env`, Tailscale/SFTP bind settings, allocations, host invite export, owner response import, events, diagnostics, and verification.
- The data-owner UI is `Peer`: it supports multiple simultaneous peer connections. Each peer goes through an invite → response → connect → backup lifecycle. The peer list is a horizontal scrollable tab strip; selecting a peer auto-opens the correct accordion section based on its current phase. The user provides a Host Invite Bundle by paste or file import; the tab generates an owner SSH key/access response, can auto-submit it to the host, verifies SFTP, creates/connects the Kopia repository, and can run a backup. All peer state persists via `savedPeers` in the app config.
- Tailscale is the supported v1 overlay path. Hosts advertise a Tailscale IP or MagicDNS name in the invite, while SFTP binds to a local Tailscale IP through the Docker `.env`.
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

1. Storage host opens `Host`, starts or connects to the Docker host-agent stack, configures Tailscale/SFTP settings, creates an allocation, and exports the Host Invite Bundle JSON.
2. Data owner opens `Peer`, clicks "Add peer", imports the Host Invite Bundle JSON by paste or file, generates an owner SSH key, and auto-submits or exports the Owner Access Response JSON.
3. Storage host imports the Owner Access Response in `Host → Allocations`; the host-agent authorizes the public key and activates SFTP access.
4. Data owner opens `Setup Wizard`, selects the connected peer from the peer-selection card list (all SFTP fields auto-fill), adds source folders, and configures retention.
5. Data owner verifies Tailscale/TCP/SFTP reachability in `Peer → Connect`, creates or connects the Kopia SFTP repository, then runs the first backup.

### Project Progress

Progress is estimated by usable project capability, not by lines of code. The project is still pre-alpha.

| Component | Progress | Status | What Exists | Main Remaining Work |
| --- | ---: | --- | --- | --- |
| Feasibility and product docs | `████████░░` 80% | Compact current docs | Feasibility study, architecture, implementation map, risk register, runbooks, ADRs, host/peer audits | Keep docs updated as real POC results arrive |
| Web coordination prototype | `██████░░░░` 60% | Usable local prototype | Dashboard, matching, pacts, health, restore drills, incidents, admin, shared mock state | Real backend, auth, persistence, API contracts, production UX pass |
| Desktop client | `█████████░` 90% | Main local app path implemented | Tauri + React UI, Docker Host tab, multi-peer Peer tab, host-agent API client, host stack lifecycle commands, generated-data Kopia lab, SFTP verify, Kopia connect, local persistence, recovery-key flow, restore drill, health checks, allocation delete, setup wizard peer-select cards | Production service lifecycle, OS keychain hardening, packaging polish |
| Backup safety controls | `████████░░` 85% | Real generated-data lab plus peer-target checks | Protected gate, restore failure mapping, canary mismatch handling, repository verification failure mapping, hosted path isolation validation, telemetry consent wiring, real Kopia generated-data backup/verify/restore path | Two-machine peer restore evidence, incident submission to web app, longer soak testing |
| Release and open-source foundation | `█████░░░░░` 50% | Started | AGPL-3.0-only license, third-party notices foundation, package scaffolds, macOS arm64 tool sources/checksums recorded | Complete dependency license inventory, signing, all-platform checksums, release process |
| Kopia/SFTP/Tailscale integration | `████████░░` 80% | Main v1 path wired in app | Redacted Kopia command planner, guarded local Kopia execution, generated-data test lab, TCP probe, SFTP auth/write verification, Kopia SFTP create/connect, Docker host-agent allocation/invite/peer auto-submit flow | Real two-machine trial, hard quota evidence, keychain-backed production secrets |
| Infrastructure and backend | `█░░░░░░░░░` 10% | Future work | Web app mock state and coordination screens | API, database, auth, pairing tokens, health ingestion, invite/bundle exchange, reputation |
| Real backup POC evidence | `████░░░░░░` 40% | Single-machine lab proven; two-machine runbook ready | Client can create a local test lab, run Kopia snapshot, verify repository content, restore canary data, and report health from actual outcomes | Run two-machine Kopia over SFTP/Tailscale trial, record results, prove restore from peer-hosted repository |
| Production readiness | `░░░░░░░░░░` 0% | Not production-ready | Clear safety posture and launch constraints | Security review, legal review, reliability metrics, support process, paid-marketplace controls |

Next engineering priorities:

- Run and document the two-machine Tailscale + SFTP + Kopia restore trial.
- Harden peer API: share manual import parser with peer API; add tests for expired invite, match mismatch, username mismatch, token replay.
- Redact `inviteToken` from allocation summaries in host-agent API responses.
- Harden secret storage with OS keychain support for production backup passwords and SSH key refs.
- Connect client health reports to the web app once the API exists.
- Keep the first launch invite-only and barter-based.

## Repository Map

```text
apps/
  web/                 Marketplace and matching prototype
  client/              Tauri + React + Rust desktop client
  host-agent/          Docker host-agent stack for storage hosts
  agent/               Legacy/future headless/NAS notes
docs/
  client-app/          Compact desktop client handoff
  adr/                 Architecture decision records
  audits/              Current host/peer audit files
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
- [Client Tab Audit 2026-05-05](docs/audits/client-tab-audit-2026-05-05.md)
- [Host Tab Audit 2026-05-02](docs/audits/host-tab-audit-2026-05-02.md)
- [Peer Tab Audit 2026-05-02](docs/audits/peer-tab-audit-2026-05-02.md)
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
- Local management: Tauri + Rust desktop client with bundled Kopia plus a Docker host-agent stack for storage hosts.

## Status

Pre-alpha prototype phase. The repository contains planning docs, a web app prototype, and an active desktop client implementation. It is not production-ready.
