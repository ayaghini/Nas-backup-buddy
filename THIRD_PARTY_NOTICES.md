# Third-Party Notices

NAS Backup Buddy is licensed under AGPL-3.0-only.

This file is the starting inventory for third-party software used by the repository. It is not yet a complete production release notice file.

## Application Dependencies

| Component | Area | License Notes |
| --- | --- | --- |
| React | Web app and client UI | Review package license before release |
| TypeScript | Web app and client UI | Review package license before release |
| Vite | Web app and client UI | Review package license before release |
| Tauri | Client desktop shell | Review package license before release |
| Rust crates | Client local service | Review crate licenses before release |
| lucide-react | UI icons | Review package license before release |

## Bundled Tool Dependencies

The client app is designed to manage pinned Kopia and Syncthing binaries, but real binaries are not bundled in this repository yet.

Before any packaged release:

- Record the exact Kopia version, source URL, checksum, and license.
- Record the exact Syncthing version, source URL, checksum, and license.
- Include any required upstream notices.
- Include release artifact checksums.
- Document signing status for every platform artifact.

## Release Status

No production release artifact should claim full third-party notice completeness until this file is audited and expanded.

