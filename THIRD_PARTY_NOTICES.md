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

The client app now includes pinned macOS arm64 binaries for local development and packaging experiments. Other platform binaries are not bundled yet.

| Component | Version | Platform | Source URL | SHA-256 | License Notes |
| --- | --- | --- | --- | --- | --- |
| Kopia CLI | 0.17.0 | macOS arm64 | https://github.com/kopia/kopia/releases/download/v0.17.0/kopia-0.17.0-macOS-arm64.tar.gz | `d5f7d864b2fd35eecf35cf73374aeed84f9b30fc580b5931b68b30bb80e88acd` | Upstream release includes `LICENSE`; review before production release |
| Syncthing | 1.27.7 | macOS arm64 | https://github.com/syncthing/syncthing/releases/download/v1.27.7/syncthing-macos-arm64-v1.27.7.zip | `a914d368a621d3a9972ae6b995174169b2bc8ab0041d870da49502e618209e39` | Upstream release includes `LICENSE.txt`; review before production release |

Before any packaged release:

- Record the exact Kopia version, source URL, checksum, and license for every bundled platform.
- Record the exact Syncthing version, source URL, checksum, and license for every bundled platform.
- Include any required upstream notices.
- Include release artifact checksums.
- Document signing status for every platform artifact.

## Release Status

No production release artifact should claim full third-party notice completeness until this file is audited and expanded.
