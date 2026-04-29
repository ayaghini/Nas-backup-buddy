# Headless Agent Notes

The first real client-app target is documented in [Client App Overview](../../docs/client-app/README.md): a cross-platform Tauri + Rust desktop client with a local background service.

The active Docker storage-host implementation lives in `apps/host-agent`. This directory remains for future headless/NAS owner-side packaging work, such as Unraid, TrueNAS, Synology, or server-only deployments. Do not treat this directory as the primary client app or Docker host-agent unless the architecture is intentionally changed.

Future headless agent responsibilities are still expected to mirror the desktop local service:

- Configure Kopia or restic backup repositories.
- Connect to host-agent SFTP targets from imported Host Invite Bundles.
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
