# Client App

The NAS Backup Buddy client app is the safety-first desktop application that runs on a user's own machine or homelab server. It should make encrypted reciprocal backup setup understandable without hiding the controls that keep the user safe.

## Goal

Build a cross-platform desktop client with a local background service.

Locked v1 decisions:

- Desktop UI plus local Rust service.
- Tauri + React + TypeScript for the desktop shell.
- Rust owns local service logic, tool execution, config validation, health state, and secret boundaries.
- Open source under AGPL-3.0.
- Bundled and managed Kopia with pinned versions.
- Kopia is the default backup engine.
- Default v1 transport/storage target is Kopia over SFTP on a private overlay network.
- Syncthing is optional/future mirror mode, not the default v1 path.
- The app pairs with the web app, but it must work in mock/offline mode until the web API is real.

## Current Prototype State

The client has moved beyond the original mock-only scaffold. The current app can run a local generated-data Kopia test lab on the supported development platform:

- Create an isolated test source, repository, and restore area under the OS temp directory.
- Verify pinned bundled tool readiness before guarded Kopia execution.
- Create or connect a Kopia filesystem repository.
- Run a real Kopia snapshot against generated test data.
- Run repository verification through `kopia snapshot verify`.
- Restore the canary file and compare SHA-256 checksums.
- Build a health report from actual backup, verification, and restore-drill outcomes.

The current Host tab is the active storage-provider path. It manages the Docker host-agent stack, host-agent API token connection, Tailscale/SFTP environment, allocations, Host Invite Bundle export, Owner Access Response import, host health, events, logs, and verification.

The next implementation target is the owner-side `Peer` tab. It should replace the old `Peer Connection`/`Peer Storage` owner flow with invite import, owner SSH key/access response generation, SFTP verification, Kopia SFTP repository creation/connection, backup execution, and next-step guidance.

The current Syncthing work is legacy safety/configuration work from the earlier transport direction.

Mock/browser fallback remains useful for UI development without Tauri, but it is no longer the main client-readiness signal.

## Audience

Primary users:

- Homelab operators.
- NAS owners.
- Self-hosters.
- Users comfortable with backups, but not necessarily with manually wiring Kopia, SSH/SFTP, and overlay networking together.

The first version is not for general consumers who expect fully managed cloud backup.

## Supported Platforms

Target platforms:

- Windows.
- macOS.
- Linux desktop.

Docker/NAS deployment is now represented by `apps/host-agent` for storage hosts. The old `apps/agent` notes remain legacy/future headless packaging context.

## User Modes

### Data Owner

The user backs up their own data directly to an encrypted Kopia repository on a matched peer's SFTP storage target.

The client must help them:

- Select source folders.
- Import a Host Invite Bundle from the storage host by paste or file.
- Generate or reference a per-match owner SSH key.
- Export an Owner Access Response for the host.
- Verify SFTP auth/write access after the host imports that response.
- Create or connect an encrypted Kopia SFTP repository.
- Confirm their recovery password/key is saved outside the platform.
- Use private overlay and SFTP target details from the invite unless explicitly overridden.
- Run restore drills.
- Report health metadata.

### Storage Host

The user offers spare storage for another user's encrypted repository.

The client must help them:

- Run and configure the Docker host-agent stack.
- Create hosted allocations with quota.
- Export Host Invite Bundle JSON.
- Import Owner Access Response JSON.
- Confirm they understand the data is encrypted and must not be modified.
- Monitor disk space.
- Report availability and quota health.

### Reciprocal Match

The user both backs up to another peer and hosts encrypted backup data for that peer.

The client must keep owner and host responsibilities visibly separate so a user cannot confuse source folders, local repositories, and hosted peer-storage paths.

## Non-Negotiable Safety Rules

- Never expose a live source folder directly to an untrusted peer.
- Never upload backup passwords, private keys, plaintext file names, file contents, or full local source paths.
- Never mark a match Protected before a restore drill succeeds.
- Never allow a failed restore drill or canary mismatch to remain only local UI state.
- Never treat Syncthing as the backup engine or default transport.
- Never continue silently after a backup, remote target, repository verification, or restore failure.

## V1 Responsibilities

The client app should:

- Manage bundled Kopia.
- Validate safe folder layout.
- Create and check encrypted Kopia SFTP repositories.
- Validate private overlay and SFTP target reachability.
- Run backups and repository verification.
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
