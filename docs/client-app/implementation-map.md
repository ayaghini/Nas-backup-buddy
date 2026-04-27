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

Status: mostly complete for the pre-alpha service foundation, but the architecture has pivoted. Rust modules exist for config, health, redaction, safety validation, tool manifest modeling, Kopia execution, Syncthing transport-folder preparation, and generated-data test labs. The next service phase should add SFTP remote repository targets and overlay reachability checks.

Deliverables:

- `apps/client` scaffold.
- Rust service crate or Tauri backend module.
- Config types.
- Health report types.
- Redaction module.
- Safe folder validator.
- Mock/browser fallback runner.
- Generated-data Kopia test-lab runner.
- Unit tests.

Required checks:

- Reject source folder exposed as any peer target or share.
- Reject local cache/repository paths inside source path.
- Validate remote SFTP target shape without logging secrets.
- Reject missing quota for host mode.
- Map restore failure to Critical.
- Map canary mismatch to Critical.
- Redact paths, secrets, and tokens from logs.

Exit criteria:

- Rust tests pass.
- Service can produce a sample health report without disallowed telemetry.
- Service can run in mock/browser fallback mode.
- Service can run generated-data Kopia backup, verification, and restore-drill flows.

Decision gate:

| Result | Decision |
| --- | --- |
| Validation and redaction pass | Build UI |
| Safety checks are hard to reason about | Keep service-only and simplify |

## Phase 2: Tauri Onboarding UI

Goal: make safe setup understandable.

Status: implemented for local pre-alpha use, but the wizard still reflects parts of the old local-repository/Syncthing model. The next iteration should ask data owners for source folders, backup secret confirmation, remote SFTP target details, overlay peer address, retention, and restore-drill settings. Storage hosts should configure hosted storage path, quota, overlay address, and isolated SFTP target details.

Deliverables:

- Setup wizard.
- Role selection: Data Owner, Storage Host, Reciprocal Match.
- Source folder selection.
- Remote repository target selection or entry.
- Hosted storage path and quota setup.
- Overlay connection setup.
- SFTP target setup.
- Retention policy screen.
- Recovery password/key backup confirmation.
- Pairing token screen.
- Setup summary with safety checks.

Required checks:

- UI cannot proceed past unsafe folder layout.
- UI cannot complete data owner setup without key backup confirmation.
- UI shows that Kopia writes encrypted repository data directly to the peer SFTP target.
- UI labels Syncthing, if present, as optional mirror/legacy mode.
- UI supports mock/offline mode.

Exit criteria:

- User can complete a local setup.
- Unsafe setup paths are blocked with clear messages.
- No paid marketplace or cloud storage features appear.
- Health-report consent defaults off and persists into local app state.

## Phase 3: Kopia, SFTP, And Overlay Manager

Goal: make remote backup target management predictable and safe.

Status: SFTP integration implemented. Tool manifest, SHA-256 verification, and generated-data Kopia execution exist. SFTP `create_repository`/`connect_repository` Kopia runner methods are complete. Per-target Kopia config isolation via `SftpRepoTarget::config_id()` prevents one peer's config from being reused for another. Overlay TCP probe is live; it confirms port reachability only (SSH/SFTP auth is left to Kopia). The Peer Storage view wires probe and connect results to shared AppContext state so Health Checks update automatically. Two-machine restore evidence and production SSH key credential management remain future work.

Deliverables:

- Tool manifest.
- Kopia version/status detection.
- SHA-256 checksum verification.
- Tool status screen.
- Fail-closed behavior for missing or mismatched binaries.
- SFTP target validator.
- Overlay reachability probe.
- Kopia SFTP repository create/connect flow.
- README notes for updating pinned tool versions.

Required checks:

- Correct versions pass.
- Wrong checksum fails.
- Missing binary fails.
- Tool status is visible in the UI.

Exit criteria:

- Client can detect and validate bundled tools on the local platform.
- Unsupported or tampered tool state blocks setup.
- Client can validate remote SFTP target reachability without leaking credentials or paths.

## Phase 4: Health Checks And Restore Drill Automation

Goal: prove backup safety controls work end to end.

Status: partially implemented with real generated-data evidence. Health and restore drill flows are wired into shared app state. Repository verification failure, canary mismatch, and restore failure map to Critical and block Protected status in the UI. The client can create a generated-data Kopia test lab, run a real snapshot, run `kopia snapshot verify`, restore a canary file, and build health from those outcomes. Remote SFTP repository backup, overlay/SFTP health, scheduled production backups, and peer-held restore evidence remain future work.

Deliverables:

- Backup runner.
- Repository verification runner using `kopia snapshot verify`.
- Remote target reachability checker.
- Restore drill runner.
- Canary checksum verification.
- Local incident/status mapping.
- Health checks view.

Required checks:

- Backup stale more than 24 hours maps to Warning.
- Backup stale more than 72 hours maps to Critical.
- Remote target unreachable more than 24 hours maps to Warning.
- Remote target unreachable more than 72 hours maps to Critical.
- Free quota below 15 percent maps to Warning.
- Free quota below 5 percent maps to Critical.
- Restore failure maps to Critical.
- Canary mismatch maps to Critical.

Exit criteria:

- Protected status is blocked until restore drill succeeds.
- Failed restore creates a Critical local status and incident payload.
- Health report remains allowlisted and redacted.

Current gap:

- Test-lab health must distinguish "remote target not configured in test lab" from production remote-target failure.

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

- Client can pair in mock/browser fallback mode.
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
- Package documents bundled Kopia version and any optional transport/helper tools.
- Signing is used where practical or explicitly marked as pending.

Exit criteria:

- A tester can install, launch, complete local onboarding, run the generated-data Kopia lab on supported platforms, and view health status.
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
