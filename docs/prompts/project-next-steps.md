# Project Next Steps Agent Prompt

Use this prompt when asking another agent to work through the next concrete project steps: fix the web prototype audit findings, start the client app scaffold, and add open-source release foundations.

```markdown
You are working in the NAS Backup Buddy repository.

Goal: complete the next project steps in one coherent pass:

1. Fix the current web-app audit findings.
2. Start the real cross-platform client app scaffold.
3. Add open-source licensing and third-party license tracking foundations.

Before coding, read:
- README.md
- PROJECT_STRUCTURE.md
- docs/README.md
- docs/architecture.md
- docs/control-and-audit-plan.md
- docs/risk-register.md
- docs/client-app/README.md
- docs/client-app/architecture.md
- docs/client-app/configuration.md
- docs/client-app/security-and-safety.md
- docs/client-app/implementation-map.md
- docs/client-app/packaging-and-release.md
- docs/prompts/implement-client-app.md
- apps/web/README.md

Work in this order.

## Part 1: Fix Web App Audit Findings

Audit findings to fix:

1. Failed restore drills do not change match health.
2. Request Match button is inert.
3. Backup pact signing flow is not reachable from seeded data.
4. `npm run lint` exists but ESLint is not installed/configured.
5. TypeScript build info files are not ignored.

Implementation requirements:

- Keep the existing Vite + React + TypeScript app in `apps/web`.
- Introduce shared local mock state for matches, pacts, restore drills, incidents, and admin audit log.
- Use React context or a small local store. Do not add a backend yet.
- Preserve the existing mock/offline prototype behavior.
- Do not add payment features.
- Do not collect or display backup passwords, private keys, plaintext file names, or file contents.

Specific web behavior:

- Recording a failed restore drill must:
  - add the restore drill record
  - mark the affected match `Critical`
  - set protected gate checks so `restoreDrillCompleted` and/or `canaryChecksumMatches` block Protected status as appropriate
  - create or update a Critical incident with required action from `docs/control-and-audit-plan.md`
  - update Dashboard, Match Detail, Health Checks, Restore Drill, Incidents, and Admin views from the same shared state

- Recording a passing restore drill must:
  - add the restore drill record
  - update last restore drill state for the affected match
  - clear restore-drill-related warning/critical state only when all gate checks pass
  - never mark Protected unless every Protected gate passes

- Requesting a match from a candidate detail page must:
  - create a new `Pending` match
  - create an unsigned backup pact for that match
  - remove or visually mark the candidate as requested
  - navigate to the new pact or match detail page
  - make the pact signing flow reachable

- Pact signing must:
  - update shared pact state
  - update the match timeline once both parties accept
  - leave the match `Pending` or `Syncing` until backup/sync/restore checks pass

- Seed data must include at least one unsigned or newly creatable pact path.

- Linting:
  - Add ESLint dependencies and config for React + TypeScript, or replace the lint script with a working equivalent.
  - `npm run lint` must pass.

- Git ignore:
  - Add `*.tsbuildinfo` to `.gitignore`.
  - Do not commit generated `dist`, `node_modules`, or TypeScript build info files.

Web verification:

- From `apps/web`, run:
  - `npm run typecheck`
  - `npm run build`
  - `npm run lint`
- Manually verify the UI path:
  - request a candidate match
  - sign the new pact
  - record a failed restore drill and confirm Dashboard/Health/Incidents show Critical
  - record a passing restore drill and confirm Protected only appears when all gates pass

## Part 2: Start Client App Scaffold

Use `docs/prompts/implement-client-app.md` as the source prompt for this section.

Build target:

- Create `apps/client` as a Tauri + Rust desktop app.
- Use React + TypeScript for the Tauri UI.
- Use Rust for local service logic.
- Keep the client mock/offline-capable until the web API is real.
- The app must be cross-platform in design: Windows, macOS, Linux.
- The app must be open source under AGPL-3.0.

Minimum scaffold requirements:

- `apps/client/README.md` with dev, build, test, and packaging notes.
- Tauri app structure that can launch locally.
- Rust types/modules for:
  - config model
  - health report model
  - safe folder validation
  - health threshold mapping
  - restore result to status mapping
  - telemetry/log redaction
  - bundled tool manifest model
- UI views or placeholders for:
  - Dashboard
  - Setup wizard
  - Backup plan
  - Syncthing connection
  - Restore drill
  - Health checks
  - Logs with redaction
  - Settings
  - About/license

Safety behavior to implement in tests first where possible:

- Reject direct sharing of source folders.
- Reject repository path inside a source folder.
- Reject source path inside the repository path.
- Map restore failure to Critical.
- Map canary checksum mismatch to Critical.
- Warn when backup/sync is stale over 24 hours.
- Mark Critical when backup/sync is stale over 72 hours.
- Warn when free quota is below 15 percent.
- Mark Critical when free quota is below 5 percent.
- Redact passwords, keys, pairing tokens, full source paths, and raw tool logs from reports.
- Fail closed when bundled Kopia/Syncthing manifest checks fail.

Do not actually bundle real Kopia/Syncthing binaries in this pass unless the repo already has a release tooling pattern. Add the manifest shape, mock validation, and clear TODO-free documentation for where pinned binaries and checksums will be supplied.

Client verification:

- Run the available Rust and frontend checks for `apps/client`.
- At minimum, run the scaffold's equivalent of:
  - Rust format/check/test
  - frontend typecheck/build
- Confirm sample health reports do not contain disallowed telemetry.

## Part 3: Licensing And Release Foundations

Add open-source release foundations:

- Add a root `LICENSE` file using AGPL-3.0.
- Add a third-party notices placeholder such as `THIRD_PARTY_NOTICES.md`.
- Add or update docs so release work knows:
  - app license is AGPL-3.0
  - bundled tools need license inventory
  - release artifacts need checksums
  - public releases need signing status documented

Do not claim production release readiness. This is a foundation only.

## Quality Bar

- Keep edits scoped to this work.
- Do not revert unrelated user changes.
- Keep docs and code consistent.
- Prefer simple, explicit state/data flow over clever abstractions.
- Keep secrets local.
- Keep telemetry allowlisted.
- Keep Syncthing as transport only.
- Keep Kopia as the default backup engine.

## Final Response

When done, summarize:

- Web audit fixes completed.
- Client scaffold created and what it contains.
- License/release files added.
- Commands run and results.
- Any remaining gaps or blocked items.
```

