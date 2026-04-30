# Host And Peer Tab Audit — 2026-04-30

## Scope

Audited only the Host and Peer setup surfaces and their supporting mechanisms:

- `apps/client/src/views/Host.tsx`
- `apps/client/src/views/host/*`
- `apps/client/src/views/Peer.tsx`
- Host/Peer helpers in `apps/client/src/lib/host-agent-api.ts` and `apps/client/src/lib/tauri-bridge.ts`
- Tauri commands in `apps/client/src-tauri/src/lib.rs`
- Host-agent invite/response and overlay changes in `apps/host-agent/src/api/*` and `apps/host-agent/src/bundle/invite.go`

Other tabs were considered only where Host or Peer calls into shared state.

## Verification Run

Passed:

- `npm run typecheck` from `apps/client`
- `npm run build` from `apps/client`
- `cargo check` from `apps/client`
- `cargo test` from `apps/client` (`326 passed`, `1 ignored`)

Not run:

- `go test ./...` from `apps/host-agent` because `go` is not installed in this environment.
- Docker smoke test because the audit focused on source and local toolchain verification; run it before closing the Host/Peer flow.

## Overall Assessment

The direction is good. The new Peer tab implements the intended owner-side flow, and the Host tab changes improve the Docker host-agent path by avoiding direct browser fetches from Tauri and by making stale overlay settings more visible.

The main risk is that the Peer tab currently trusts UI/persisted state more than live verification in a few places. That can make the tab show `repo_ready` or continue after a host-key confirmation without proving the actual host fingerprint matches the invite. The Host tab also still allows invite generation in an `unknown` reachability class, which is too loose for the product's "autonomous and safe" goal.

## Findings

### P1 — Peer does not compare the live SFTP host fingerprint to the invite fingerprint

File: `apps/client/src/views/Peer.tsx`
Lines: 422-469, 752-787, 828-848

The UI asks the user to confirm the invite's `hostKey.fingerprintSha256`, then calls `verifySftpTarget`. The Rust verifier returns the live `host_fingerprint` and TOFU status, but the Peer tab never compares `sftpResult.host_fingerprint` against `invite.hostKey.fingerprintSha256`.

This means first-use verification is mostly a manual checkbox plus local TOFU. A first connection to the wrong SFTP endpoint can be accepted if auth/write succeeds, and the wrong fingerprint may be saved as the trusted local TOFU value. The invite fingerprint is the host-provided expected identity; it should be enforced.

Recommended fix:

- After `verifySftpTarget`, if `invite.hostKey.fingerprintSha256` exists and `result.host_fingerprint !== invite.hostKey.fingerprintSha256`, set a hard `host_key_mismatch`/blocked state.
- Do not call `updateRemoteRepositoryState('reachable', 0)` for this case.
- Do not allow Kopia create/connect.
- Consider clearing any just-saved TOFU entry when the invite fingerprint mismatch is detected, or move invite-fingerprint checking into the Rust verifier before TOFU save.

### P1 — Peer restores `repo_ready` from a persisted message without live repository verification

File: `apps/client/src/views/Peer.tsx`
Lines: 276-299, 262-274, 471-493, 891-925

On startup, any persisted `lastRepoMessage` is restored as:

```ts
setRepoResult({ initialized: true, already_existed: true, message: s.lastRepoMessage });
```

The derived phase then becomes `repo_ready` if the restored SFTP status is also `ok`. This can make the tab show repository-ready and enable backup based on stale state from a previous session, even if the host revoked access, the allocation was suspended, the invite changed, the SFTP target changed, or the repository config was removed.

Recommended fix:

- Persist status as historical display only, not as proof of current readiness.
- On reload, show a `needs_reverify` or `previously_ready` state and require fresh SFTP verify plus Kopia connect before `repo_ready`.
- Alternatively add a lightweight Tauri command that checks whether the per-target Kopia config exists and can connect, then only promote to `repo_ready` after that live check.

### P2 — Host allows invite generation for `unknown` reachability without confirmation

File: `apps/client/src/views/host/AllocationsPanel.tsx`
Lines: 94-119, 355-373

Invite generation blocks `advertised_blocked` and `unsafe_public`, and asks confirmation for `local_test_only`. It does not block or confirm `unknown`.

`unknown` includes cases such as `NASBB_SFTP_BIND` set to a non-loopback address with no `TAILSCALE_ADDRESS`. That may produce an invite with a LAN/local bind address or unclear reachability, which can fail for remote owners while looking like a normal generated invite.

Recommended fix:

- Treat `unknown` like a warning state requiring explicit confirmation, or block until the host config is either `overlay_ready` or `local_test_only`.
- Surface the actual bind/address combination in the warning so the host knows what to fix.

### P2 — Invalid invite expiry can pass Peer validation

File: `apps/client/src/views/Peer.tsx`
Lines: 115-143

`expiresAt` only checks that the field is a non-empty string, then uses:

```ts
new Date(expiresAt).getTime() < Date.now()
```

For an invalid date string, `getTime()` is `NaN`, and `NaN < Date.now()` is false. So a malformed expiry is accepted.

Recommended fix:

- Parse once into `expiryMs`.
- Reject when `Number.isNaN(expiryMs)`.
- Optionally require an ISO/RFC3339 shape before comparing.

### P2 — Peer blocks `quota_warning` even though SFTP auth/write succeeded

File: `apps/client/src/views/Peer.tsx`
Lines: 262-274, 447-469, 866-884

The Rust verifier defines `quota_warning` as auth/path/write success with low free space. Existing health logic maps it to a warning, not a hard failure. The Peer tab only treats `status === 'ok'` as SFTP verified and disables Kopia create/connect for all other statuses.

Recommended fix:

- Treat `ok` and `quota_warning` as SFTP-verified for progression.
- Show a warning badge/message for `quota_warning`.
- Update shared health state to `quota_warning` instead of generic `unreachable`.

### P2 — Peer backup success is not propagated to shared health/readiness state

File: `apps/client/src/views/Peer.tsx`
Lines: 495-518, 891-932

The Peer tab can run `runRealSftpBackupFromConfig`, but it stores the result only in local component state. Other app health/readiness state is not updated, so the Peer tab can show a successful snapshot while Health Checks/Protected gate remain unaware.

Recommended fix:

- Reuse the existing AppContext backup operation path if possible.
- If the direct SFTP backup action stays in Peer, add a shared action that records backup success/failure, snapshot ID, timestamp, and health implications.
- On failure, map to the same warning/critical behavior as existing backup flows.

### P3 — `/syncthing` route now redirects through a removed compatibility route

File: `apps/client/src/App.tsx`
Line: 100

`/syncthing` redirects to `/peer-connection?section=advanced`, which immediately redirects to `/peer`. This works but loses the intended advanced/legacy context and is confusing now that Peer Connection is removed from primary navigation.

Recommended fix:

- Either redirect `/syncthing` directly to `/peer` if legacy Syncthing UI is intentionally gone from normal UX, or keep a dedicated legacy/developer route outside the Host/Peer flow.

## Mechanism Validation

### Host tab

Validated:

- Host API calls use `host_agent_http` in Tauri, avoiding browser/WebKit mixed-content/CORS problems.
- The Rust proxy hard-codes `http://127.0.0.1:7420/api/v1`, keeping the host-agent API local-only from the UI path.
- Host network settings write `.env` through Tauri commands, not frontend shell execution.
- `host_agent_compose_restart` uses `docker compose up -d --remove-orphans`, which is more appropriate than `docker compose restart` for applying `.env` changes.
- Invite generation now refreshes overlay status before producing the bundle.
- Host UI detects a stale running container whose overlay address is empty while `.env` has `TAILSCALE_ADDRESS`.

Remaining concerns:

- The Go host-agent tests were not run in this environment.
- `unknown` reachability is under-controlled before invite generation.
- The committed `apps/host-agent/bin/nasbb-agent` binary should be reviewed as a release/repo hygiene question. It is outside the tab UI, but it affects host-agent trust and provenance.

### Peer tab

Validated:

- New `/peer` route exists and primary navigation uses it.
- `/peer-connection`, `/peer-storage`, and `/overlay` redirect to `/peer`.
- Paste import and Tauri JSON file import are implemented.
- Owner Access Response generation uses the existing owner SSH key helper and exports only the public key.
- SFTP verification uses the native Rust/libssh2 verifier, not a frontend shell command.
- Kopia create/connect uses the existing per-target SFTP config isolation path.

Remaining concerns:

- The invite host-key fingerprint is displayed but not technically enforced against the live server fingerprint.
- Restored persisted state can overstate current repository readiness.
- Backup action updates local Peer UI only, not shared health/readiness.
- Parser validation needs a few hardening checks.

## Suggested Fix Order

1. Enforce invite fingerprint against live SFTP fingerprint before any `reachable` state or Kopia action.
2. Stop restoring `repo_ready` from persisted messages; require live reverify/reconnect after restart.
3. Tighten Host invite generation for `unknown` reachability.
4. Fix invalid `expiresAt` parsing and `quota_warning` progression.
5. Decide whether Peer owns real backup execution or only setup; if it owns it, wire results into shared health.
6. Clean up the `/syncthing` redirect.

