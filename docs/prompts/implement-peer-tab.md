# Implement Peer Tab Prompt

Use this prompt when asking an implementation agent to build the data-owner **Peer** tab in the NAS Backup Buddy desktop client.

```markdown
You are working in the NAS Backup Buddy repository.

## Goal

Implement a focused, mostly autonomous **Peer** tab for the data owner.

The user should only need to provide the Host Invite Bundle JSON from the storage host, either by paste or file import. After that, the tab should guide the owner through:

1. Validate invite.
2. Generate or reuse owner SSH key.
3. Produce Owner Access Response JSON for the host.
4. Wait for host authorization.
5. Verify SFTP.
6. Create/connect the Kopia SFTP repository.
7. Show the next concrete step.

This is an owner-side implementation. The storage-provider side is already the Docker-backed **Host** tab.

## Non-Goals

- Do not rebuild manual host setup.
- Do not use the legacy Host Spaces command-plan flow.
- Do not redesign Dashboard, Backup Plan, Recovery Key, Restore Drill, or Host.
- Do not implement the web API.
- Do not implement production backup scheduling.
- Do not make Syncthing part of this flow.
- Do not claim production readiness.

## Architecture Context

NAS Backup Buddy lets homelab users store encrypted offsite backups on each other's infrastructure.

The storage host uses the `Host` tab. It manages `apps/host-agent/`, starts the Docker host-agent stack, creates an allocation, and exports a Host Invite Bundle.

The data owner uses the new `Peer` tab. Kopia runs locally on the owner machine and encrypts before upload. The host receives encrypted repository data, an SSH public key, and operational metadata needed to authorize SFTP. The host never receives backup passwords, owner private keys, plaintext file names, or plaintext file contents.

Current v1 exchange:

```text
Host tab -> Docker host-agent -> Host Invite Bundle JSON
Peer tab -> Owner Access Response JSON -> host imports response
Peer tab -> SFTP verify -> Kopia SFTP create/connect -> backup/restore checks
```

## Read These Files First

Keep context small. Read only these files before coding:

- `apps/client/src/App.tsx`
- `apps/client/src/views/Host.tsx`
- `apps/client/src/views/PeerConnection.tsx`
- `apps/client/src/views/PeerStorage.tsx`
- `apps/client/src/lib/host-agent-types.ts`
- `apps/client/src/lib/host-agent-api.ts`
- `apps/client/src/lib/tauri-bridge.ts`
- `apps/client/src/lib/types.ts`
- `apps/client/src/lib/persistence.ts`
- `apps/client/src/context/AppContext.tsx`
- `apps/client/src-tauri/src/lib.rs`
- `docs/host-agent/api-contract.md`
- `docs/client-app/architecture.md`

Only read more if blocked by a specific missing type, helper, or test failure. Prefer reusing existing helpers and local patterns over adding new abstractions.

## Existing Helpers To Reuse

Types:

- `HostAgentInviteBundle`
- `OwnerAccessResponse`
- `OwnerSshKey`
- `SftpVerifyResult`
- `SftpRepositoryInitResult`

Likely useful functions:

- `pickFile()`
- `generateOwnerSshKey(matchId)`
- `probeRemoteTarget(host, port)`
- `verifySftpTarget(host, port, username, path, sshKeyPath)`
- `initializeKopiaSftpRepository(host, username, path, port, sshKeyPath)`
- `runRealSftpBackupFromConfig(...)`
- `setKopiaPassword(...)`
- `hasKopiaPassword()`
- `updateRemoteRepositoryState(...)` from `useApp()`
- `refreshReadiness()` from `useApp()`

Important: older helpers named around `OwnerConnectionBundle`, `PeerBundle`, or `parseOwnerBundle` may use the old text bundle/schema. Update or replace those paths. The new Peer tab must use `HostAgentInviteBundle` from `host-agent-types.ts` and the schema in `docs/host-agent/api-contract.md`.

## File Import And Export

Paste import is required.

File import is required. Use existing Tauri dialog helpers where possible. If a helper only returns a path, add the smallest safe Tauri command or frontend helper needed to read a UTF-8 JSON file. Browser/mock mode may fall back to paste-only if native file read is unavailable, but the UI must remain usable.

Copy response JSON is required.

Export response JSON to a file is required in Tauri mode. Prefer a save-file dialog plus a small Tauri write command if no existing helper exists. Browser/mock mode may fall back to copy-only.

Do not write private keys, backup passwords, raw source paths, or raw logs to exported files. The only required export is Owner Access Response JSON, which contains the public key only.

## Host Invite Bundle

Accept JSON with this shape:

```json
{
  "bundleVersion": 1,
  "kind": "nasbb.host_invite",
  "hostAgentVersion": "0.1.0",
  "matchId": "match-abc123",
  "allocId": "alloc_a1b2c3d4e5f6",
  "connectionName": "Alice offsite backup",
  "overlay": {
    "provider": "tailscale",
    "host": "host.tailnet.ts.net",
    "note": "..."
  },
  "sftp": {
    "host": "host.tailnet.ts.net",
    "port": 2222,
    "username": "nabb_1234abcd",
    "path": "/repository"
  },
  "quota": {
    "quotaBytes": 53687091200,
    "quotaMode": "soft"
  },
  "hostKey": {
    "fingerprintSha256": "SHA256:...",
    "verificationNote": "Verify out-of-band"
  },
  "expiresAt": "2026-07-27T00:00:00Z"
}
```

Validation rules:

- `bundleVersion` must be `1`.
- `kind` must be `"nasbb.host_invite"`.
- `matchId`, `allocId`, `sftp.username`, `sftp.path`, and `expiresAt` are required non-empty strings.
- `sftp.port` must be an integer from 1 to 65535.
- `quota.quotaBytes`, if present, must be a positive number.
- `hostKey.fingerprintSha256`, if present, must be displayed before verification.
- `sftp.host` is the connection host. If it is missing, use `overlay.host` as a fallback. If both are missing, block remote verification and tell the user to ask the host for a remote-ready invite.
- Expired invites are blocked. Tell the user to ask the host for a fresh invite.
- Unknown fields are ignored but preserved if storing the original invite JSON.

Display after successful import:

- Connection name.
- Match ID and allocation ID.
- Host, port, username, path.
- Overlay provider/host.
- Quota.
- Invite expiry.
- Host key fingerprint and verification note.

## Owner Access Response

Generate JSON with this exact shape:

```json
{
  "bundleVersion": 1,
  "kind": "nasbb.owner_access_response",
  "matchId": "match-abc123",
  "allocId": "alloc_a1b2c3d4e5f6",
  "ownerDeviceLabel": "Mira Mac mini",
  "ownerPublicKey": "ssh-ed25519 AAAA...",
  "requestedSftpUsername": "nabb_1234abcd",
  "createdAt": "2026-04-29T00:00:00Z"
}
```

Rules:

- `matchId` and `allocId` come from the invite.
- `requestedSftpUsername` equals `invite.sftp.username`.
- `ownerDeviceLabel` is user-editable. Provide a sensible default if the app already has one; otherwise use a short fallback such as `"Owner device"`.
- `ownerPublicKey` comes from `generateOwnerSshKey(matchId)`.
- `createdAt` is the current UTC timestamp in RFC3339/ISO format.
- Never display, export, or log the owner private key.

## Route Changes

Add primary navigation:

```text
Peer -> /peer
```

Route handling:

- `/peer` renders the new Peer tab.
- `/peer-connection` redirects to `/peer`.
- `/peer-storage` redirects to `/peer`.
- `/overlay` redirects to `/peer`.
- `/host-setup` continues redirecting to `/host`.
- `/syncthing` may keep its current legacy/developer redirect unless changing it is necessary for type/build correctness.

Remove `Peer Connection` from primary navigation.

## UX Requirements

Build an operational tool, not an explanation page.

Use existing app visual patterns: dark operational UI, compact panels, small status badges, restrained colors, lucide icons, and practical controls.

Recommended sections:

1. **Invite**: paste/import JSON, validation status, invite summary.
2. **Response**: owner device label, SSH key status, response copy/export.
3. **Connect**: host-key confirmation, TCP probe, SFTP verify, Kopia create/connect.
4. **Backup**: source readiness and backup action only if existing safe commands support it.
5. **Next Step**: one clear current action.

Use concise labels such as:

- Import invite
- Generate response
- Copy response
- Export response
- Probe TCP
- Verify SFTP
- Create/connect repository
- Run backup

Avoid long in-app architecture prose. Put detailed behavior in code structure and docs, not visible tutorial blocks.

## State Model

Use this state machine for UI gating:

| State | Meaning | Next step |
| --- | --- | --- |
| `needs_invite` | No valid invite imported | Paste or import Host Invite Bundle |
| `invite_invalid` | JSON/schema/expiry failed | Fix JSON or ask host for fresh invite |
| `needs_key` | Valid invite, no owner key | Generate response |
| `response_ready` | Response JSON generated | Send response to host |
| `waiting_for_host` | Response generated, SFTP auth not ready | Ask host to import response in Host tab |
| `sftp_verified` | SFTP auth/write test passed | Create/connect repository |
| `repo_ready` | Kopia repository created or connected | Run backup/restore checks |
| `backup_ready` | Source folders and repo are ready | Run backup |
| `blocked` | Expiry, missing host, host-key unconfirmed, unsafe input, or hard failure | Show exact blocker |

Persist this non-secret owner state under a dedicated key such as `peerTabState`:

- Original imported invite JSON.
- Parsed invite summary.
- Owner device label.
- Owner public key.
- Owner private key path or secure reference, not private key contents.
- Response JSON.
- Host-key fingerprint confirmation for this `allocId`.
- Last TCP probe result.
- Last SFTP verify result.
- Last Kopia create/connect result.
- Last completed state.

Use existing app config persistence patterns. Do not mix this state into the Host tab state.

## Security Requirements

- Keep owner private key local.
- Keep Kopia password local and use existing password/keychain helper where available.
- Do not store backup password or private key contents in plaintext config.
- Do not send backup password, owner private key, source file names, file contents, or full local source paths to host or web app.
- Require explicit host-key fingerprint confirmation before SFTP verification or Kopia create/connect.
- Treat invite fields as untrusted input. Validate and escape display.
- Do not run shell commands from frontend code. Use Tauri commands.
- Redact sensitive values in logs and error displays where existing helpers support it.

## Implementation Stages

### Stage 1: Navigation And Skeleton

Implement:

- Add `apps/client/src/views/Peer.tsx`.
- Add `/peer` route.
- Add `Peer` nav item.
- Remove `Peer Connection` nav item.
- Redirect `/peer-connection`, `/peer-storage`, and `/overlay` to `/peer`.
- Keep `/host` and `/host-setup` behavior intact.

Verify:

- `npm run typecheck`
- Peer tab renders in browser/mock mode.

Report:

- Files changed.
- Final route map.

### Stage 2: Parser, Import, And Persistence

Implement:

- Typed `parseHostInviteBundle(raw: unknown)` or equivalent.
- Paste import.
- Tauri file import for UTF-8 JSON, with paste fallback in browser/mock mode.
- Invite validation and compact summary display.
- Persist imported invite and parsed non-secret state.

Keep parser near the Peer tab or in `host-agent-types.ts`/a small companion helper. Avoid broad app-wide refactors.

Verify:

- Valid sample invite passes.
- Bad JSON fails.
- Wrong `kind` fails.
- Missing `allocId` fails.
- Bad port fails.
- Expired invite fails.
- Reopening the app restores imported invite state.

Report:

- Parser location.
- Validation decisions.
- Persistence key.

### Stage 3: Owner Key And Response

Implement:

- Owner device label input.
- Generate/reuse owner SSH key via existing helper.
- Build `OwnerAccessResponse`.
- Copy response JSON.
- Export response JSON in Tauri mode.
- Next step says: send the response to the host and ask them to import it in `Host -> Allocations`.

Verify:

- Generated response matches `docs/host-agent/api-contract.md`.
- Regenerating for the same match reuses existing key if helper supports it.
- Exported JSON contains public key only.

Report:

- Whether key generation reuses existing key material.
- Where private key path/reference is stored.
- Export behavior in Tauri and browser/mock modes.

### Stage 4: Reachability And SFTP Verification

Implement:

- Host-key fingerprint confirmation gate.
- TCP probe using `probeRemoteTarget(host, port)` if available.
- SFTP verification using `verifySftpTarget(host, port, username, path, sshKeyPath)`.
- Health/readiness update through `updateRemoteRepositoryState(...)` and `refreshReadiness()` where appropriate.

Failure mapping:

- TCP timeout/refused: host SFTP not reachable; point to Tailscale/SFTP bind settings.
- Permission denied/auth failed: host has not imported response or key mismatch; state is `waiting_for_host`.
- Host key mismatch: hard block; require out-of-band verification and user action.
- Path/write failure: host allocation/path problem; tell user to ask host to inspect allocation.

Verify:

- SFTP verify is blocked until host-key confirmation.
- Before host imports response, auth failure is shown as waiting for host authorization.
- After host imports response, local/test host-agent SFTP verification passes when Docker is available.

Report:

- Failure mapping.
- State transitions.
- Any command/helper added.

### Stage 5: Kopia Repository Create/Connect

Implement:

- Require local Kopia password to exist before create/connect. Use `hasKopiaPassword()` and existing password flow/link.
- Use `initializeKopiaSftpRepository(host, username, path, port, sshKeyPath)`.
- Preserve existing per-target config isolation via `SftpRepoTarget::config_id()`.
- Update shared remote repository health/readiness after success or failure.

Verify:

- Missing Kopia password blocks with clear action.
- Successful create/connect moves to `repo_ready`.
- Re-running create/connect is idempotent for the same target.
- Health Checks/Protected gate reflect remote target state.

Report:

- Command used.
- Success/failure state mapping.
- Config location only at a non-sensitive level.

### Stage 6: Backup Action

Scope this tightly.

Implement `Run backup` only if existing source-folder state and `runRealSftpBackupFromConfig(...)` can be reused safely without inventing new scheduling or source management. If not, show a next step that points to the existing Backup Plan/source selection flow and leave backup execution out of this pass.

Verify if implemented:

- Successful backup shows snapshot ID/time.
- Failure updates operation/health state consistently with existing logic.

Report:

- Whether real SFTP backup execution was implemented.
- If deferred, the exact prerequisite still needed.

### Stage 7: Remove Stale Primary UI

Implement:

- Remove `Peer Connection` from primary navigation.
- Remove or stop importing stale owner/host command-plan UI if no longer reachable.
- Keep old files only if redirects, tests, or incremental migration require them.
- Do not delete Rust/core helpers unless they are definitely unused and tests pass.

Verify:

- `npm run typecheck`
- `npm run build`
- `rg -n "Peer Connection|Host Spaces|Backup Targets|manual Host Setup|Owner Connection Bundle" apps/client/src README.md docs | grep -v "Deprecated" | grep -v "Historical" | grep -v "implement-peer-tab.md"` returns no stale primary-path references. If it returns intentional compatibility notes, explain them.

Report:

- What was removed.
- What remains for compatibility and why.

## Final Verification

Run from `apps/client`:

```bash
npm run typecheck
npm run build
```

Run Rust checks if Rust or Tauri commands changed:

```bash
cargo fmt --check
cargo check
cargo test
```

If Docker is available, run this smoke test:

```bash
cd apps/host-agent
NASBB_API_TOKEN=peer-tab-test-token make docker-up
```

Manual smoke path:

1. Host tab creates allocation and exports invite.
2. Peer tab imports invite and exports response.
3. Host tab imports response.
4. Peer tab verifies SFTP.
5. Peer tab creates/connects Kopia repository.

Stop the stack:

```bash
make docker-down
```

If Docker is not available, state that clearly and complete the non-Docker verification.

## Final Report Format

Return:

- Completed stages.
- Files changed.
- Route changes.
- Persistence key/state shape.
- Security decisions.
- Verification commands and results.
- Remaining gaps or blockers.

Do not claim production readiness. This remains pre-alpha until two-machine backup and restore evidence exists.
```
