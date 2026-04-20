# Client App Implementation Map

## Purpose

This map turns the client app into buildable phases with decision gates. The first implementation should prove safety and restore correctness before polishing marketplace-like flows.

## Phase 0: Docs And Architecture

Deliverables:

- Client app docs.
- Security and safety rules.
- Configuration defaults.
- Implementation prompt.
- Packaging and release requirements.

Exit criteria:

- Docs link from the main documentation index.
- Stack, license, tool handling, and safety posture are explicit.
- Prompt is ready for another agent or engineer to implement.

Decision gate:

| Question | Go | Hold |
| --- | --- | --- |
| Is the client direction decision-complete? | Start scaffold | Resolve stack/tool/license ambiguity |

## Phase 1: CLI And Service Prototype

Goal: prove the Rust service can validate config and model health without the UI.

Status: scaffold started. Rust modules exist for config, health, redaction, safety validation, and tool manifest modeling. Cargo checks still need to be run in an environment with Rust installed.

Deliverables:

- `apps/client` scaffold.
- Rust service crate or Tauri backend module.
- Config types.
- Health report types.
- Redaction module.
- Safe folder validator.
- Mock tool runner.
- Unit tests.

Required checks:

- Reject source folder used as Syncthing target.
- Reject repository path inside source path.
- Reject missing quota for host mode.
- Map restore failure to Critical.
- Map canary mismatch to Critical.
- Redact paths, secrets, and tokens from logs.

Exit criteria:

- Rust tests pass.
- Service can produce a sample health report without disallowed telemetry.
- Service can run in mock/offline mode.

Decision gate:

| Result | Decision |
| --- | --- |
| Validation and redaction pass | Build UI |
| Safety checks are hard to reason about | Keep service-only and simplify |

## Phase 2: Tauri Onboarding UI

Goal: make safe setup understandable.

Status: scaffold started with placeholder client UI views. Real onboarding behavior still needs implementation.

Deliverables:

- Setup wizard.
- Role selection: Data Owner, Storage Host, Reciprocal Match.
- Source folder selection.
- Repository path selection.
- Hosted storage path and quota setup.
- Retention policy screen.
- Recovery password/key backup confirmation.
- Pairing token screen.
- Setup summary with safety checks.

Required checks:

- UI cannot proceed past unsafe folder layout.
- UI cannot complete data owner setup without key backup confirmation.
- UI shows that Syncthing transports encrypted repository data only.
- UI supports mock/offline mode.

Exit criteria:

- User can complete a mock setup.
- Unsafe setup paths are blocked with clear messages.
- No paid marketplace or cloud storage features appear.

## Phase 3: Bundled Kopia And Syncthing Manager

Goal: make tool management predictable and safe.

Deliverables:

- Tool manifest.
- Kopia and Syncthing version detection.
- Checksum verification.
- Tool status screen.
- Fail-closed behavior for missing or mismatched binaries.
- README notes for updating pinned tool versions.

Required checks:

- Correct versions pass.
- Wrong checksum fails.
- Missing binary fails.
- Tool status is visible in the UI.

Exit criteria:

- Client can detect and validate bundled tools on the local platform.
- Unsupported or tampered tool state blocks setup.

## Phase 4: Health Checks And Restore Drill Automation

Goal: prove backup safety controls work end to end.

Deliverables:

- Backup runner.
- Repository check runner.
- Sync status checker.
- Restore drill runner.
- Canary checksum verification.
- Local incident/status mapping.
- Health checks view.

Required checks:

- Backup stale more than 24 hours maps to Warning.
- Backup stale more than 72 hours maps to Critical.
- Sync stale more than 24 hours maps to Warning.
- Sync stale more than 72 hours maps to Critical.
- Free quota below 15 percent maps to Warning.
- Free quota below 5 percent maps to Critical.
- Restore failure maps to Critical.
- Canary mismatch maps to Critical.

Exit criteria:

- Protected status is blocked until restore drill succeeds.
- Failed restore creates a Critical local status and incident payload.
- Health report remains allowlisted and redacted.

## Phase 5: Pairing With Web App

Goal: connect local client health to the coordination platform without leaking sensitive data.

Deliverables:

- Pairing token flow.
- Mock API client first.
- Health report submission interface.
- Incident payload submission interface.
- Offline queue for safe retry.
- Pairing status in UI.

Required checks:

- Pairing token is treated as secret.
- Health report does not contain disallowed telemetry.
- Offline mode remains available.
- Failed submissions do not block local backups.

Exit criteria:

- Client can pair in mock mode.
- Client can emit a sample health report.
- Client can queue and retry non-sensitive status updates.

## Phase 6: Packaging, Signing, Release, Update Channel

Goal: prepare safe distribution across supported platforms.

Deliverables:

- Windows package.
- macOS package.
- Linux package.
- Release checklist.
- AGPL-3.0 license placement.
- Third-party license inventory.
- Bundled tool manifest.
- Release notes template.
- Rollback notes.

Required checks:

- Build succeeds on local development platform.
- Package includes license files.
- Package includes tool manifest.
- Package documents bundled Kopia and Syncthing versions.
- Signing is used where practical or explicitly marked as pending.

Exit criteria:

- A tester can install, launch, complete mock onboarding, and view health status.
- Release artifact checksums are recorded.
- Update and rollback path is documented.

## Cross-Phase Test Requirements

Every phase must preserve these tests or equivalent checks:

- Config validation rejects unsafe folder layouts.
- Health threshold mapping is deterministic.
- Restore failure blocks Protected.
- Canary mismatch blocks Protected.
- Redaction removes secrets, tokens, full source paths, and raw logs.
- Tool manifest validation fails closed.
- Mock/offline mode works without the web app.
