# Final Overlay Polish Prompt

Fix the last `/overlay` issues, verify, then move on to the next tabs. Do not redesign the page again.

## Context

- Product path: Kopia -> SFTP -> peer storage over Tailscale.
- Tailscale is the only active overlay provider for now.
- Headscale/WireGuard/custom stay as future/advanced placeholders.
- Never auto-run auth or state-changing Tailscale commands on mount, refresh, backup, or detection.
- Allowed automatic checks: `tailscale version`, `tailscale status --json`, `tailscale ip -4`.
- Explicit user actions only: `tailscale ping ...`, `tailscale up`.

## Fixes

### 1. Bound Tailscale Ping

File: `apps/client/crates/nasbb-core/src/overlay.rs`

Current issue: `ping_tailscale_peer` runs bare `tailscale ping <peer>`, which can wait on default multi-ping / direct-path behavior.

Implement:

- Run bounded args: `tailscale ping --c=1 --timeout=5s --until-direct=false <peer>`.
- Pass every arg with `Command::arg` / `Command::args`, never through a shell.
- Keep existing peer validation.
- Add a small helper like `tailscale_ping_args(peer)` if needed.
- Add a unit test proving bounded args are used.

### 2. Remove Double Confirmation For `tailscale up`

File: `apps/client/src/views/OverlaySetup.tsx`

Current issue: the user clicks once to show confirmation, then clicks again to run `tailscale up`. This is too much friction.

Implement:

- Replace the two-step confirmation UI with one explicit button: `Run tailscale up (connect)`.
- Put safety copy next to the button:
  - Runs `tailscale up` with no flags.
  - No auth keys.
  - No routes, ACLs, SSH, serve/funnel, or advanced network changes.
  - If login is needed, an auth URL or manual login instructions will be shown.
- Keep `tailscale up` user-triggered only.
- Refresh Tailscale status after it returns.

### 3. Fix Empty Failed `tailscale up`

File: `apps/client/crates/nasbb-core/src/overlay.rs`

Current issue: `parse_tailscale_up_output("", false)` can report success.

Implement:

- Empty output is success only when `exit_ok == true`.
- Success requires `exit_ok == true` or a known success signal.
- Add regression test: `parse_tailscale_up_output("", false)` returns `success: false`, `needs_auth: false`.

## Preserve

- Do not break the existing split handoff saves for Host Setup vs Peer Storage.
- Do not reintroduce shared-account language.
- Do not reintroduce Unix-only generic setup guidance.
- Do not remove Windows Tailscale detection paths.
- Keep setup help auto-open when Tailscale is missing/not ready.

## Verify

Run:

```bash
cd apps/client && npm run typecheck
cd apps/client && cargo test -p nasbb-core overlay
cd apps/client/src-tauri && cargo test
```

Acceptance:

- `Tailscale ping peer` returns promptly because ping args are bounded.
- `Run tailscale up (connect)` is one click, clearly explained, and never automatic.
- Empty failed `tailscale up` output is not shown as success.
- Tests pass with zero warnings.
