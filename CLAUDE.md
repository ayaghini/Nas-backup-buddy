# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This is a **docs-first project in the planning and feasibility phase**. There is no production code yet. All current work lives in `docs/`, with placeholder `README.md` files in `apps/` and `infra/`.

Before writing any code, read the implementation map (`docs/implementation-map.md`) to understand the current phase and what is in scope.

## Architecture

NAS Backup Buddy is an encrypted reciprocal offsite backup exchange for homelab users. The system has three main components:

1. **Backup engine** (Kopia preferred, restic as alternative) — creates client-side encrypted, versioned snapshots of user data. This is the only thing that touches plaintext.
2. **Syncthing** — replicates the *encrypted repository directory* (not source files) to a matched peer over peer-to-peer transport. Syncthing is treated as a transport layer, not a backup engine.
3. **Coordination layer** — two future apps:
   - `apps/web/`: web app for matching, pacts, health dashboards, reputation, and (eventually) billing. It must never receive passwords, plaintext filenames, or private keys.
   - `apps/agent/`: local Docker-based agent that drives the backup engine and Syncthing, enforces quotas, runs restore drills, and emits redacted health metadata to the web app.

Data flow: source folders → backup engine → encrypted repo on disk → Syncthing → peer's storage.

## Non-Negotiable Rules (from `docs/implementation-map.md`)

- Never sync a user's live source folder directly to an untrusted peer.
- Never collect backup encryption passwords.
- Never mark a setup healthy until a restore drill succeeds.
- Never launch paid storage before legal, abuse, payout, and dispute controls exist.
- The web app must not receive plaintext filenames, file contents, encryption passwords, or private keys — only redacted operational metadata.

## Design Bias

- Docs before automation. Manual proof of concept before custom agent code.
- Backup correctness before marketplace features. Barter community before payment flows.
- Restore testing before growth.

## Documentation Structure

```
docs/
  adr/              Architecture decision records (read before making technology decisions)
  runbooks/         Proof-of-concept and restore-drill procedures
  templates/        Backup pact template
  research/         Source links
  architecture.md   Component diagram and trust boundaries
  implementation-map.md  Phase-by-phase roadmap with decision matrices
  feasibility-study.md
  risk-register.md
  control-and-audit-plan.md
```

New major technical or product decisions should be recorded as ADRs in `docs/adr/`.

## Current Phase

Phase 0 (Repository and Planning) is in progress. Phase 1 (Manual Proof of Concept with Kopia + Syncthing on two separate-network machines) is next. No agent or web app code should be written until Phase 1 exit criteria are met.
