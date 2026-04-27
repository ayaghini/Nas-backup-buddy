# Client App Architecture

## Overview

The client app is a desktop UI plus a local Rust service. The UI guides the user. The service performs sensitive and operational work.

The default v1 backup path is now **Kopia direct-to-peer over SFTP on a private overlay network**. This avoids requiring the data owner to keep a complete local encrypted repository copy before replication.

```mermaid
flowchart LR
  UI["Tauri desktop UI<br/>React + TypeScript"] --> SVC["Local Rust service"]
  SVC --> CFG["Local config store<br/>TOML + OS keychain"]
  SVC --> TOOLS["Bundled tool manager"]
  TOOLS --> KOPIA["Pinned Kopia"]
  SVC --> OVERLAY["Peer Connection manager<br/>Tailscale + SFTP setup"]
  SVC --> SFTP["SFTP target manager"]
  KOPIA --> REMOTE["Peer-hosted encrypted Kopia repository"]
  SVC --> HEALTH["Health reporter<br/>allowlisted metadata"]
  HEALTH --> WEB["NAS Backup Buddy web app"]
```

Syncthing support remains useful for the existing prototype and possible future mirror mode, but it is not the default v1 transport.

## Components

### Tauri Desktop UI

Responsibilities:

- Onboarding wizard.
- Dashboard.
- Backup plan view.
- Peer Connection view for Tailscale, host spaces, and backup targets.
- Restore drill view.
- Health checks.
- Redacted logs.
- Settings.
- About/license view.

The UI should never keep raw secrets longer than needed to pass them to the local service. Password and key entry screens must be explicit about local-only handling.

### Local Rust Service

Responsibilities:

- Own config parsing and validation.
- Own secret access through OS keychain where practical.
- Execute Kopia.
- Validate source, remote repository, and hosted storage separation.
- Prepare or inspect host-side SFTP target settings.
- Probe overlay and SFTP reachability.
- Run backup, repository verification, remote target check, and restore drill tasks.
- Produce redacted logs.
- Produce allowlisted health reports.

The service is the only component allowed to launch bundled tools or use backup secrets.

### Bundled Tool Manager

Responsibilities:

- Store a pinned manifest for supported Kopia versions.
- Verify bundled binary checksums.
- Fail closed when a bundled binary is missing, has a version mismatch, or has a checksum mismatch.
- Expose tool status to the UI.

Restic can be documented as future optional support, but v1 should not make users choose between engines during onboarding unless Kopia cannot run.

### Overlay Manager

Responsibilities:

- Detect whether the device is reachable through Tailscale.
- Record the matched peer's overlay address or hostname.
- Feed Host Spaces and Backup Targets from one guided Peer Connection flow.
- Avoid public inbound port assumptions.

The first implementation can be manual/instructional, but health checks must eventually distinguish "overlay not configured" from "peer unreachable."

### SFTP Target Manager

Responsibilities:

- Data owner mode: validate remote SFTP settings and create/connect the Kopia repository on the peer target.
- Storage host mode: guide or automate isolated account/path creation.
- Validate host quota and storage path.
- Redact usernames, hosts, paths, and command output where needed.

The host target should use an isolated account, chroot/jail, container, dataset, or equivalent boundary.

### Local Config Store

Responsibilities:

- Store human-readable non-secret configuration as TOML.
- Store secrets in the OS keychain where practical.
- Store only references to secrets in TOML.
- Keep config in the OS-appropriate app data directory.

Examples:

- Windows: application data directory.
- macOS: application support directory plus keychain.
- Linux: XDG config/data directories plus secret service where available.

### Health Reporter

Responsibilities:

- Emit only allowlisted operational metadata.
- Redact error messages.
- Never include source file names, contents, raw paths, passwords, SSH keys, or backup keys.
- Support mock/offline mode until the web API is real.

### Restore Drill Runner

Responsibilities:

- Select or create canary data.
- Restore from the remote encrypted repository to a clean local destination.
- Verify expected checksum against observed checksum.
- Record tool versions, snapshot ID, result, duration, warnings, and follow-up.
- Mark failure as Critical.

## Data Flows

### Onboarding

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Tauri UI
  participant S as Rust service
  participant K as Kopia
  participant O as Overlay
  participant H as Host SFTP target

  U->>UI: Choose role, source folders, and peer target
  UI->>S: Submit draft setup
  S->>S: Validate role, quota, paths, and target fields
  S->>O: Verify peer overlay address can be reached
  S->>H: Verify isolated SFTP target and quota
  S->>K: Create or connect encrypted remote repository
  S->>S: Save local config and secret references
  S-->>UI: Setup status and safety checks
```

### Backup Creation

```mermaid
flowchart LR
  SRC["Source folders"] --> K["Kopia snapshot"]
  K --> ENC["Encrypted repository writes"]
  ENC --> OVERLAY["Private overlay network"]
  OVERLAY --> SFTP["Peer SFTP target"]
  SFTP --> REPO["Encrypted Kopia repository on host"]
```

The data owner does not need a full local encrypted repository copy in the default v1 path.

### Remote Target Check

```mermaid
flowchart LR
  SVC["Rust service"] --> O["Overlay probe"]
  O --> SFTP["SFTP auth/path/quota probe"]
  SFTP --> K["Kopia repository verification"]
```

If overlay or SFTP reachability fails, backup should not be marked Protected.

### Restore Drill

```mermaid
sequenceDiagram
  participant S as Rust service
  participant K as Kopia
  participant R as Remote repository
  participant D as Restore destination

  S->>K: Select snapshot from remote repository
  K->>R: Read encrypted repository data
  K->>D: Restore to clean folder
  S->>S: Verify canary checksum
  alt checksum matches
    S-->>S: Mark drill Pass
  else mismatch or restore failure
    S-->>S: Mark match Critical and block Protected
  end
```

### Health Reporting

```mermaid
flowchart LR
  SVC["Rust service"] --> FILTER["Telemetry allowlist + redaction"]
  FILTER --> REPORT["Health report"]
  REPORT --> WEB["Web app or mock sink"]
```

## Trust Boundaries

| Boundary | Rule |
| --- | --- |
| UI to service | UI sends user choices; service validates before saving or executing |
| Service to tools | Service controls tool paths, arguments, environment, and log redaction |
| Service to web app | Only allowlisted operational metadata leaves the machine |
| User source data to repository | Kopia encrypts before network upload |
| Owner to host SFTP target | Host is untrusted; repository data must already be encrypted |
| Overlay network | Overlay improves reachability and transport privacy; it is not the backup encryption boundary |

## Protected Status Dependency

The client can display `Protected` only when all gates pass:

- Backup snapshot exists.
- Remote encrypted repository is reachable.
- Host quota has buffer.
- Restore drill completed.
- Canary checksum matches.
- User has confirmed recovery key/password backup.
- Retention policy configured.
- No critical health alerts.

## Legacy And Optional Syncthing Mode

The current prototype includes Syncthing safety logic. Keep it as a legacy/optional mode until it is intentionally removed or reworked.

Rules for any Syncthing mode:

- It must never sync live source folders.
- It must be clearly labeled as mirror/advanced mode.
- The UI must explain that it can require a local encrypted repository copy.
- It must not be the default v1 path.
