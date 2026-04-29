# Client App Current Audit

Last updated: 2026-04-29

## Summary

The client app is a pre-alpha Tauri + React + Rust desktop client with meaningful local execution, Kopia SFTP support, and a Docker-backed Host tab. The strongest current evidence is the generated-data Kopia test lab (real snapshot, verify, restore, canary checksum) plus the new host-agent management surface. SFTP remote repository support and verification commands exist, but the old Peer Connection/Peer Storage owner flow should now be replaced by a focused `Peer` tab.

The app is still not production backup software. Remaining risk is around two-machine restore evidence, production secret storage, cross-platform packaging, and web API pairing.

## What Is Working

| Area | Current state | Evidence |
| --- | --- | --- |
| Desktop shell | Tauri + React + TypeScript app launches locally. | `apps/client` scaffold and Tauri commands. |
| Setup wizard | Role-aware setup with SFTP target step (overlay host, SFTP user/path/port, SSH key ref), source folder safety validation, native folder picker, retention and consent settings. Some owner setup should move into the new Peer tab. | Setup view plus Rust config validation. |
| Docker Host tab | Storage-provider UI can check Docker prerequisites, read/write host-agent `.env`, start/stop/restart the Compose stack, connect to the host-agent API, configure Tailscale/SFTP settings, create allocations, export Host Invite Bundles, import Owner Access Responses, display events/logs, and run verification. | `src/views/Host.tsx`, `src/views/host/*`, `src/lib/host-agent-api.ts`, Tauri `host_agent_*` commands. |
| Local persistence | App state persists locally for setup and UI state. | React context persistence layer. |
| Recovery key flow | UI supports recovery-key confirmation and local safety messaging. | Recovery key view and setup wizard. |
| Tool manifest | macOS arm64 Kopia/Syncthing entries have pinned versions and checksums. | `apps/client/src-tauri/resources/tool-manifest.json`. |
| Kopia generated-data lab | Real Kopia snapshot, `snapshot verify`, restore, and canary verification. | Tauri commands and `nasbb-core::kopia`. |
| Kopia SFTP repository | `SftpRepoTarget::config_id()` provides stable per-target config isolation. `initialize_kopia_sftp_repository` creates or connects a remote encrypted repository; each target gets its own `kopia/sftp-{id}.json`. | `nasbb-core::kopia`, Tauri commands. |
| Overlay TCP probe | `probe_tcp_reachability` tests port reachability with no secrets. Probe method is labeled `tcp_connect`; `Reachable` means TCP port open only — SSH auth is explicitly NOT verified. | `nasbb-core::remote_target`. |
| Peer Storage / Peer Connection views | Legacy/development owner flow for SFTP/overlay setup. Valid pieces should be migrated into the new Peer tab; stale host-space/manual command-plan pieces should not remain primary UI. | `src/views/PeerConnection.tsx`, `src/views/PeerStorage.tsx`. |
| Remote target health | `HealthReport.remote_target_status` and `remote_target_last_ok_hours` carry SFTP target state. `remote_target_level()` maps `not_configured` → OK, `unreachable ≤24h` → OK, `>24h` → Warning, `>72h` → Critical. | `nasbb-core::health`. |
| Integration readiness | `ClientSetupState.remote_repository` carries live remote target state. `check_readiness()` blocks on auth failure, host-key mismatch, and >72h unreachable; warns on <72h unreachable and quota. | `nasbb-core::integration`. |
| Legacy Syncthing safety | Transport-folder definition rejects source-folder sharing. Labeled optional/legacy mirror mode in UI. | `nasbb-core::syncthing`, sidebar label. |
| Health mapping | Backup, verification, restore drill, quota, remote target, sync (legacy), and peer thresholds map to OK/Warning/Critical. | `nasbb-core::health`. |
| Log redaction | Redaction exists for secrets, tokens, and local paths before display/reporting. | `nasbb-core::redaction`. |

## Main Gaps

| Priority | Gap | Why it matters | Next action |
| --- | --- | --- | --- |
| P1 | No focused owner-side Peer tab yet. | The host can generate invites, but the data owner needs one autonomous flow to import the invite, generate a response, verify SFTP, and create/connect Kopia. | Implement `docs/prompts/implement-peer-tab.md`. |
| P1 | No two-machine encrypted repository restore evidence yet. | The core product promise is peer-held offsite recovery. | Run and document a two-machine Kopia-over-SFTP/private-overlay trial after Host and Peer tabs work together. |
| P1 | Production backup scheduling not implemented. | Users cannot rely on recurring backups. | Add local scheduler/service lifecycle with pause/resume and failure handling. |
| P1 | Production secret storage is not keychain-backed for SFTP key paths. | macOS keychain works for backup password; SFTP SSH key path is passed as a filesystem path string with no keychain backing. | Extend OS keychain integration to cover SSH key references. |
| P2 | Older Peer Connection/manual host setup UI remains in navigation. | It can confuse users now that Docker Host is the storage-provider source of truth and Peer should be the owner flow. | Remove Peer Connection from primary navigation when the Peer tab lands; keep redirects only if needed. |
| P2 | SFTP target config is not persisted in `PersistedConfig`. | On app restart, the remote repository state reverts to `not_configured` even when a successful connection was made. | Add `remoteSftpConfig` (non-secret fields) to `PersistedConfig` and restore on load. |
| P2 | Cross-platform tool packaging is incomplete. | Windows, Linux, and non-arm64 macOS fail closed until binaries/checksums are added. | Fill platform manifests and add release checks for each platform. |
| P2 | Web pairing/API is not implemented. | Health reports and incidents are still local. | Build mock API contract, then real pairing token flow and allowlisted health submission. |
| P2 | Release signing and dependency license inventory are incomplete. | Public release needs a trustworthy supply chain and license audit. | Complete third-party notices, signing plan, and checksum/release notes workflow. |

## Audit Notes

- SFTP config identity: each distinct remote target (host/port/user/path) gets its own Kopia config file (`sftp-{sha256_id}.json`). The 24-char SHA-256-derived ID prevents one peer's config from being silently reused for another.
- TCP probe is labeled `tcp_connect` and `Reachable` means only "TCP port open." The probe never claims SSH authentication succeeded.
- `ToolStatus::Present` remains development/unverified. Production readiness requires checksum-verified `Ready`.
- Syncthing remains legacy/developer support. Source folders must never be configured as Syncthing folders or SFTP roots.
- Repository verification wording uses `kopia snapshot verify`. The older phrase `kopia repository check` is not valid in Kopia 0.17.0.
- The generated-data lab emits `remote_target_status = "not_configured"` which maps to OK, not Critical. Production unreachable targets still escalate normally.

## Recommended Next Gate

Before calling the client "real backup ready," require all of the following:

- Kopia generated-data lab passes locally.
- Kopia can create/connect a remote SFTP repository over the chosen private overlay.
- Host tab can export a Host Invite Bundle and import an Owner Access Response through the Docker host-agent.
- Peer tab can import the Host Invite Bundle and complete owner setup without the old Peer Connection flow.
- Two machines complete a direct Kopia-over-SFTP backup and restore drill.
- A restore from the peer-held repository copy succeeds and the canary checksum matches.
- Health report contains no passwords, private keys, source file names, file contents, full local source paths, or raw tool logs.
- Production secrets are stored through OS keychain or an equivalent platform secret store.
- Release artifacts include license files, third-party notices, pinned tool versions, checksums, and rollback notes.
