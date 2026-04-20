# Client App

The NAS Backup Buddy client app is the safety-first desktop application that runs on a user's own machine or homelab server. It should make encrypted reciprocal backup setup understandable without hiding the controls that keep the user safe.

## Goal

Build a cross-platform desktop client with a local background service.

Locked v1 decisions:

- Desktop UI plus local Rust service.
- Tauri + React + TypeScript for the desktop shell.
- Rust owns local service logic, tool execution, config validation, health state, and secret boundaries.
- Open source under AGPL-3.0.
- Bundled and managed Kopia and Syncthing with pinned versions.
- Kopia is the default backup engine.
- Syncthing is transport only.
- The app pairs with the web app, but it must work in mock/offline mode until the web API is real.

## Audience

Primary users:

- Homelab operators.
- NAS owners.
- Self-hosters.
- Users comfortable with backups, but not necessarily with manually wiring Kopia and Syncthing together.

The first version is not for general consumers who expect fully managed cloud backup.

## Supported Platforms

Target platforms:

- Windows.
- macOS.
- Linux desktop.

Headless Docker/NAS deployment remains important, but the first real client app is the desktop plus local service path. The old `apps/agent` notes remain useful for future headless packaging.

## User Modes

### Data Owner

The user backs up their own data to encrypted local repository data that is then replicated to a storage host.

The client must help them:

- Select source folders.
- Create an encrypted Kopia repository.
- Confirm their recovery password/key is saved outside the platform.
- Configure Syncthing to replicate only the encrypted repository.
- Run restore drills.
- Report health metadata.

### Storage Host

The user offers spare storage for another user's encrypted repository.

The client must help them:

- Select a hosted peer-storage folder.
- Set a quota.
- Confirm they understand the data is encrypted and must not be modified.
- Monitor disk space.
- Report availability and quota health.

### Reciprocal Match

The user both backs up to another peer and hosts encrypted backup data for that peer.

The client must keep owner and host responsibilities visibly separate so a user cannot confuse source folders, local repositories, and hosted peer-storage paths.

## Non-Negotiable Safety Rules

- Never sync a live source folder directly to an untrusted peer.
- Never upload backup passwords, private keys, plaintext file names, file contents, or full local source paths.
- Never mark a match Protected before a restore drill succeeds.
- Never allow a failed restore drill or canary mismatch to remain only local UI state.
- Never treat Syncthing as the backup engine.
- Never continue silently after a backup, sync, repository check, or restore failure.

## V1 Responsibilities

The client app should:

- Manage bundled Kopia and Syncthing binaries.
- Validate safe folder layout.
- Create and check encrypted Kopia repositories.
- Configure Syncthing folder replication for encrypted repositories only.
- Run backups and repository checks.
- Run checksum-based canary restore drills.
- Redact logs before display or reporting.
- Emit health reports using an explicit allowlist.
- Pair with the web app using a pairing token.

## V1 Non-Goals

- Paid marketplace features.
- Cloud backup storage.
- Recovery of lost backup passwords or keys.
- Inspecting user files.
- Uploading raw logs.
- Supporting restic as a first-class engine before Kopia is safe and smooth.

