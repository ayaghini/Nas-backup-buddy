# Implement Client App Prompt

Use this prompt when asking another agent or engineer to implement the first client app scaffold.

```markdown
You are working in the NAS Backup Buddy repository.

Goal: create the first cross-platform client app foundation and its supporting docs.

Before coding, read:
- README.md
- PROJECT_STRUCTURE.md
- docs/architecture.md
- docs/implementation-map.md
- docs/control-and-audit-plan.md
- docs/risk-register.md
- docs/client-app/README.md
- docs/client-app/architecture.md
- docs/client-app/configuration.md
- docs/client-app/security-and-safety.md
- docs/client-app/implementation-map.md
- docs/client-app/packaging-and-release.md

Build target:
- Create `apps/client` as a Tauri + Rust desktop app.
- The app must be cross-platform: Windows, macOS, Linux.
- The app must be open source under AGPL-3.0.
- The app must be user-friendly and extremely safety-oriented.

Product requirements:
- Local desktop UI plus Rust background service.
- Bundle/manage pinned Kopia and Syncthing versions.
- Default backup engine is Kopia.
- Syncthing is transport only; never sync live source folders to peers.
- Backups must be encrypted before leaving the user device.
- The web app must never receive backup passwords, private keys, plaintext file names, or file contents.
- Health reporting must use an explicit allowlist.

Minimum v1 features:
- Onboarding wizard:
  - choose role: Data Owner, Storage Host, or Reciprocal Match
  - select source folders
  - select encrypted repository location
  - select hosted peer-storage location and quota
  - confirm password/key backup
  - configure retention policy
  - pair with web app using a pairing token
- Local service:
  - detect bundled Kopia/Syncthing
  - validate safe folder layout
  - create encrypted Kopia repository
  - configure Syncthing repository folder
  - run backup
  - run repository verification with `kopia snapshot verify`
  - run canary restore drill
  - redact logs
  - emit health status
- Safety controls:
  - block direct sharing of source folders
  - block Protected status until restore drill succeeds
  - mark Critical on restore failure or canary mismatch
  - warn when backup/sync stale over 24h
  - mark Critical when backup/sync stale over 72h
  - warn when free quota below 15 percent
  - mark Critical when free quota below 5 percent
- UI views:
  - Dashboard
  - Setup wizard
  - Backup plan
  - Syncthing connection
  - Restore drill
  - Health checks
  - Logs with redaction
  - Settings
  - About/license

Implementation expectations:
- Keep secrets local.
- Use structured Rust types for config and health reports.
- Store config in an OS-appropriate app data directory.
- Do not implement paid marketplace features.
- Do not implement cloud backup storage.
- Do not upload plaintext paths or file names.
- Include mock/offline mode until the web API is real.
- Add README instructions for development, build, and packaging.
- Add tests for config validation, safe folder checks, health threshold mapping, telemetry redaction, and restore failure status mapping.

Verification:
- Run format/check/test commands available in the client app.
- Confirm the app scaffold builds.
- Confirm no secrets or plaintext paths are present in sample health reports.
- Summarize changed files, commands run, and remaining gaps.
```
