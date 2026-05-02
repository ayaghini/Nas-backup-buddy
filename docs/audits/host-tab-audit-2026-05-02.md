# Host Tab Audit 2026-05-02

Scope: `Host.tsx`, host subpanels, host-agent API/bundle/compose changes.

## Status
- Host tab is usable for stack setup, Tailscale/SFTP env, allocation management, invite generation, diagnostics.
- Cross-account flow is documented in UI: share Tailscale machine, use `100.x` IP for bind and advertised invite host, restart stack.
- Frontend build passed. Rust workspace tests passed: 329 passed, 1 ignored. Go tests not run: `go` missing.

## Issues
1. `inviteToken` leaks in allocation summaries.
   - Files: `apps/host-agent/src/allocation/model.go`, `apps/host-agent/src/api/handlers.go`
   - `Allocation.Summary()` clears `OwnerPublicKey` but not `InviteToken`. Authenticated Host API responses can include the one-time peer API token while allocation is `PENDING_KEY`.
   - Fix: clear `InviteToken` in `Summary()` and add API test.

2. Peer API port is live whenever SFTP bind is remote.
   - Files: `apps/host-agent/compose/docker-compose.yml`, `apps/host-agent/src/main.go`
   - This is intended for auto-submit, but docs/UI should keep calling out that `:7422` is token-authenticated only, not bearer-authenticated.
   - Fix: consider rate limits and request logging redaction before wider alpha.

## Gaps
- No Go test coverage in this environment.
- No two-machine verification evidence committed after peer auto-submit landed.
- Host UI does not surface peer API reachability separately from SFTP reachability.

## Recommended Next Patch
- Redact `InviteToken` from summaries.
- Add tests for invite generation redaction and peer API bind/port assumptions.
