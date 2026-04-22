# Client App Current Audit

Last updated: 2026-04-21

## Summary

The client app is now a pre-alpha Tauri + React + Rust desktop client with meaningful local execution. It is no longer only a mock/offline scaffold. The strongest current evidence is the generated-data Kopia test lab: the app can create isolated test data, create or connect a Kopia filesystem repository, run a real snapshot, run `kopia snapshot verify`, restore a canary file, compare SHA-256 checksums, and derive health from the recorded outcomes.

The app is still not production backup software. The remaining risk is mostly around live Syncthing integration, production secret storage, cross-platform release packaging, and two-machine restore evidence.

## What Is Working

| Area | Current state | Evidence |
| --- | --- | --- |
| Desktop shell | Tauri + React + TypeScript app launches locally. | `apps/client` scaffold and Tauri commands. |
| Setup wizard | Role-aware setup, folder safety validation, native folder picker for source and repository paths, retention and consent settings. | Setup view plus Rust config validation. |
| Local persistence | App state persists locally for setup and UI state. | React context persistence layer. |
| Recovery key flow | UI supports recovery-key confirmation and local safety messaging. | Recovery key view and setup wizard. |
| Tool manifest | macOS arm64 Kopia/Syncthing entries have pinned versions and checksums. | `apps/client/src-tauri/resources/tool-manifest.json`. |
| Kopia generated-data lab | Real Kopia snapshot, `snapshot verify`, restore, and canary verification. | Tauri commands and `nasbb-core::kopia`. |
| Syncthing safety | Transport-folder definition rejects source-folder sharing and redacts config snippets. | `nasbb-core::syncthing`. |
| Health mapping | Backup, verification, restore drill, quota, sync, and peer thresholds map to OK/Warning/Critical. | `nasbb-core::health`. |
| Log redaction | Redaction exists for secrets, tokens, and local paths before display/reporting. | `nasbb-core::redaction`. |

## Main Gaps

| Priority | Gap | Why it matters | Next action |
| --- | --- | --- | --- |
| P1 | No live Syncthing daemon/API management yet. | The project cannot prove peer replication from inside the client. | Add guarded Syncthing process/API management and status polling. |
| P1 | No two-machine encrypted repository restore evidence yet. | The core product promise is peer-held offsite recovery, not only local generated-data restore. | Run and document a two-machine Kopia + Syncthing trial. |
| P1 | Production backup scheduling is not implemented. | Users cannot yet rely on recurring backups from selected source folders. | Add local scheduler/service lifecycle with explicit pause/resume and failure handling. |
| P1 | Production secret storage is not keychain-backed yet. | Test-lab secrets are non-secret; production backup passwords must not live in app state or plaintext config. | Integrate OS keychain and store only references in TOML. |
| P2 | Health report uses stale sync/peer values in the test lab. | The UI can look Critical after successful local backup/verify/restore because no peer is configured. | Add a test-lab mode field or health-state reason so "not configured" is distinct from production failure. |
| P2 | Mock/browser fallback commands remain available. | They are useful for UI work but can confuse audit evidence if mixed with real tests. | Label fallback mode clearly and keep release gates based on real Tauri commands only. |
| P2 | Cross-platform tool packaging is incomplete. | Windows, Linux, and non-arm64 macOS are target platforms but currently fail closed until binaries/checksums are added. | Fill platform manifests and add release checks for each platform. |
| P2 | Web pairing/API is not implemented. | Health reports and incidents are still local. | Build mock API contract, then real pairing token flow and allowlisted health submission. |
| P2 | Release signing and dependency license inventory are incomplete. | Public release needs a trustworthy supply chain and license audit. | Complete third-party notices, signing plan, and checksum/release notes workflow. |
| P3 | Client lint currently passes with warnings. | The warnings do not block the build, but they point at stale hook suppression and dependency cleanup work. | Remove unused `eslint-disable` comments and resolve the `useCallback` dependency warning. |

## Audit Notes

- Kopia command execution should continue to use `--config-file` isolation and must not reintroduce the unsupported Kopia 0.17.0 `--cache-directory` global flag.
- Repository verification wording should say `kopia snapshot verify` or "repository verification." Avoid the invalid older phrase `kopia repository check` in user-facing docs.
- The generated-data lab must remain clearly marked as generated test data only. It should not invite users to run production personal data until keychain-backed secrets, scheduling, and restore evidence are complete.
- Syncthing should remain transport-only. Source folders must never be configured as Syncthing folders.
- PATH-discovered tools are acceptable only as development fallback. Release builds should rely on pinned, checksum-verified bundled tools.

## Recommended Next Gate

Before calling the client "real backup ready," require all of the following:

- Kopia generated-data lab passes locally.
- Syncthing live daemon/API management can create and monitor a transport folder without exposing source folders.
- Two machines replicate an encrypted Kopia repository over Syncthing.
- A restore from the peer-held repository copy succeeds and the canary checksum matches.
- Health report contains no passwords, private keys, source file names, file contents, full local source paths, or raw tool logs.
- Production secrets are stored through OS keychain or an equivalent platform secret store.
- Release artifacts include license files, third-party notices, pinned tool versions, checksums, and rollback notes.
