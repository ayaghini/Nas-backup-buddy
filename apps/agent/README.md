# Headless Agent Notes

The first real client-app target is now documented in [Client App Overview](../../docs/client-app/README.md): a cross-platform Tauri + Rust desktop client with a local background service.

This directory remains for future headless/NAS packaging work, such as Docker, Unraid, TrueNAS, Synology, or server-only deployments. Do not treat this directory as the primary client app unless the architecture is intentionally changed.

Future headless agent responsibilities are still expected to mirror the desktop local service:

- Configure Kopia or restic backup repositories.
- Configure Syncthing folders for encrypted repository replication.
- Enforce local storage quotas.
- Report health metadata to the web app.
- Run restore drills against canary data.
- Warn users about missing passwords, keys, and recovery material.
- Detect disk-full, stale peer, failed backup, failed sync, and failed restore states.

Privacy rule: the agent should report operational metadata only. It should not upload file names, file contents, backup passwords, or private keys to the web app.

Current client-app source of truth:

- [Client App Architecture](../../docs/client-app/architecture.md)
- [Client App Configuration](../../docs/client-app/configuration.md)
- [Client App Security And Safety](../../docs/client-app/security-and-safety.md)
- [Client App Implementation Map](../../docs/client-app/implementation-map.md)
