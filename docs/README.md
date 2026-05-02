# NAS Backup Buddy Docs

Compact map for agents and maintainers.

## Read First
- `README.md` repo overview.
- `docs/architecture.md` current system shape.
- `docs/implementation-map.md` current roadmap and done/next status.
- `docs/host-agent/api-contract.md` API and bundle contract.
- `docs/host-agent/runbook.md` local host-agent operations.
- `docs/client-app/README.md` desktop tabs and command bridge.

## Current Product
- `apps/client`: Tauri desktop app. Current focus: `Host` and `Peer` tabs.
- `apps/host-agent`: Docker host-agent plus SFTP service.
- `apps/web`: older coordination prototype; not the active backup path.
- Syncthing docs/flows are legacy unless a task explicitly reopens mirror mode.

## Audits
- `docs/audits/host-tab-audit-2026-05-02.md`
- `docs/audits/peer-tab-audit-2026-05-02.md`

Delete or update stale docs quickly. Prefer short facts, file anchors, and unresolved risks over narrative.
