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
- `apps/client`: Tauri desktop app. Active tabs: `Host` (storage-host ops), `Peer` (multi-peer data-owner), `Setup Wizard` (4-step with peer-select), `Health Checks` (metrics + readiness checklist).
- `apps/host-agent`: Docker host-agent plus SFTP service. Management API at `127.0.0.1:7420`; peer submit API at `:7422`.
- `apps/web`: older coordination prototype; not the active backup path.
- Syncthing docs/flows are legacy unless a task explicitly reopens mirror mode.

## Audits
- `docs/audits/client-tab-audit-2026-05-05.md` — multi-peer Peer tab, wizard peer-select, host delete/suspend, health refresh (11 items, all fixed)
- `docs/audits/host-tab-audit-2026-05-02.md` — inviteToken leak, peer API port exposure (open)
- `docs/audits/peer-tab-audit-2026-05-02.md` — peer API validation, auto-submit phase, submitUrl trust (open)

Delete or update stale docs quickly. Prefer short facts, file anchors, and unresolved risks over narrative.
