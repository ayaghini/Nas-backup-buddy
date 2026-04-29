# Implement Docker Host Tab Prompt

Use this prompt when asking an implementation agent to build the Docker-backed **Host** tab in the NAS Backup Buddy desktop client.

```markdown
You are working in the NAS Backup Buddy repository.

Goal: implement a mostly standalone **Host** tab in the Tauri desktop client that can set up, start, configure, monitor, and test the Docker host-agent stack with minimal user interaction.

At the end of this work, a Linux user should be able to open the desktop app, go to the Host tab, bring up the Docker host stack, connect the UI to the host-agent API, configure Tailscale/SFTP hosting details, create a hosted allocation, import an owner response, and run an end-to-end test against the Docker stack.

The Host tab must be useful for a user who only wants to be a storage host. Do not require them to complete data-owner setup, recovery-key setup, backup-plan setup, or other tabs before using Host.

This work is about the **new Docker host-agent path**. Do not build on the legacy/manual Host Spaces command-plan flow except for visual style reference or temporary redirects.

## Minimal Context

NAS Backup Buddy lets homelab users host encrypted offsite backup repositories for one another.

The data owner runs Kopia locally. Kopia encrypts before upload. The host provides SFTP storage over a private overlay network, normally Tailscale. The host never receives backup passwords, owner private keys, plaintext file names, or plaintext file contents.

The Docker host-agent stack already exists under:

```text
apps/host-agent/
```

It exposes a local management API on:

```text
http://127.0.0.1:7420/api/v1
```

All API routes require:

```text
Authorization: Bearer <token>
```

except:

```text
GET /api/v1/info
```

The SFTP service defaults to loopback-only:

```text
NASBB_SFTP_BIND=127.0.0.1
NASBB_SFTP_PORT=2222
```

For real owner access over Tailscale, the host must set:

```text
NASBB_SFTP_BIND=<host-tailscale-ip>
TAILSCALE_ADDRESS=<host-tailscale-ip-or-magicdns-name>
```

`NASBB_SFTP_BIND` must be a local bindable IP address. It must not be a MagicDNS hostname.

`TAILSCALE_ADDRESS` is the advertised owner-facing address. It may be either a Tailscale IP or MagicDNS hostname.

## Read These Files Only

Read these files before coding:

- `apps/client/src/App.tsx`
- `apps/client/src/views/PeerConnection.tsx`
- `apps/client/src/lib/tauri-bridge.ts`
- `apps/client/src/lib/types.ts`
- `apps/client/src/context/AppContext.tsx`
- `apps/client/src-tauri/src/lib.rs`
- `apps/client/package.json`
- `apps/client/src-tauri/Cargo.toml`
- `docs/host-agent/api-contract.md`
- `docs/host-agent/runbook.md`
- `apps/host-agent/compose/docker-compose.yml`
- `apps/host-agent/compose/.env.example`
- `apps/host-agent/Makefile`
- `apps/host-agent/tests/scripts/verify.sh`

Do not read the whole repository unless you are blocked. Keep context small and work from the files above.

## Product Requirements

Implement a new primary navigation item:

```text
Host
```

Recommended route:

```text
/host
```

The existing `/host-setup` route may redirect to `/host` after this work. The older Host Spaces subsection inside `PeerConnection` can remain temporarily for compatibility, but the new Host tab is the source of truth for Docker host setup.

Do not use these legacy host setup APIs for the new Docker Host tab:

```text
planHostSetup
generateAuthorizeOwnerKeyPlan
HostSetupPlan
HostSetupStep
legacy Host Spaces command-plan UI
```

The Docker Host tab must use the host-agent REST API plus Docker compose lifecycle commands. No manual `useradd`, `authorized_keys`, or `sshd_config` command plan should appear in the normal Host tab flow.

The Host tab must support these user journeys:

1. Host-only setup
2. Docker stack detection
3. Docker stack start/stop/restart
4. First-run API token connection
5. Tailscale-aware SFTP configuration
6. Host-agent API status and health monitoring
7. Hosted allocation creation
8. Host Invite Bundle export
9. Owner Access Response import
10. Allocation suspend/resume/retire
11. Host-agent event display
12. End-to-end verification against the Docker stack

The user should not need to manually open other tabs to complete host setup.

## UX Requirements

Build the Host tab as an operational tool, not a marketing page.

Use the existing app style: dark operational UI, dense but readable panels, small status badges, restrained colors, lucide icons, and practical controls.

The Host tab should feel like a host appliance dashboard:

- Stack status at the top.
- Setup actions in a clear sequence.
- Tailscale/SFTP reachability shown prominently.
- Allocations table/list with lifecycle actions.
- Invite/response exchange built into the allocation flow.
- Events and diagnostics available without leaving the tab.

Avoid requiring users to understand Docker internals. Show plain actions like:

- Start host stack
- Restart with updated settings
- Connect to agent
- Use Tailscale IP
- Create hosted space
- Export invite
- Import owner response
- Suspend access
- Resume access
- Retire allocation
- Run host verification

## Best Tailscale Path

Use host-managed Tailscale for this stage.

The desktop app already has Tailscale detection helpers. The Host tab should:

1. Detect local Tailscale status with existing client/Tauri functionality where possible.
2. Show whether Tailscale is installed, authenticated, and connected.
3. Offer explicit user-triggered `tailscale up` only if existing app commands already support it and only after user confirmation.
4. Prefer the host's Tailscale IPv4 address for `NASBB_SFTP_BIND`.
5. Prefer MagicDNS for `TAILSCALE_ADDRESS` if available; otherwise use the Tailscale IPv4 address.
6. Warn if `TAILSCALE_ADDRESS` is set but `NASBB_SFTP_BIND` is still `127.0.0.1`.
7. Warn if `NASBB_SFTP_BIND` is `0.0.0.0`.
8. Never require public router port forwarding.

The tab should make the recommended path obvious:

```text
Tailscale connected -> use this Tailscale IP for SFTP bind -> use MagicDNS/IP for invite address -> restart Docker stack
```

If Tailscale is not available, the tab may still allow local-only testing with:

```text
NASBB_SFTP_BIND=127.0.0.1
TAILSCALE_ADDRESS=
```

But local-only invites must be labeled as test-only and not ready for remote owners.

Before generating an invite, compute and display a reachability classification:

```text
overlay_ready       TAILSCALE_ADDRESS is set and NASBB_SFTP_BIND is a non-loopback IP.
local_test_only     NASBB_SFTP_BIND is 127.0.0.1 and TAILSCALE_ADDRESS is empty.
advertised_blocked  TAILSCALE_ADDRESS is set but NASBB_SFTP_BIND is 127.0.0.1.
unsafe_public       NASBB_SFTP_BIND is 0.0.0.0.
unknown             Any other unclear combination.
```

The UI should allow local-test invite generation only after an explicit test-only confirmation. The UI should strongly warn or block `advertised_blocked` and `unsafe_public` before invite generation.

## Docker Automation Requirements

The app should automate Docker as much as technically feasible.

Implement Tauri backend commands, not raw frontend shell calls, for host-stack operations.

Required Tauri commands:

```text
host_agent_check_prereqs
host_agent_read_env
host_agent_write_env
host_agent_compose_up
host_agent_compose_down
host_agent_compose_restart
host_agent_compose_logs
host_agent_compose_status
host_agent_get_token_hint
host_agent_run_verify
```

The exact command names may vary, but the final names must be documented in the final report.

The commands should operate from:

```text
apps/host-agent
```

Use non-interactive process execution. Never run destructive Docker commands such as volume deletion.

`host_agent_write_env` should update:

```text
apps/host-agent/compose/.env
```

If `.env` does not exist, create it from:

```text
apps/host-agent/compose/.env.example
```

Do not overwrite unknown user values unnecessarily. Preserve comments if practical, but correctness matters more than comment preservation.

Required env fields:

```text
NASBB_API_PORT
NASBB_API_TOKEN
NASBB_SFTP_PORT
NASBB_SFTP_BIND
TAILSCALE_ADDRESS
```

If `NASBB_API_TOKEN` is empty, the UI should generate a strong token and write it to `.env` before first start. Falling back to the stack-generated log banner is allowed only as a recovery path.

Token requirements:

- At least 32 bytes of cryptographic randomness.
- Stored only in `.env` and local app persistence.
- Never displayed after first setup unless the user explicitly reveals it.
- Never written to app logs.

Token handling must be reported in the final response: where the token is generated, where it is stored, whether keychain storage was used, and whether any fallback log-token path remains.

## Host-Agent API Client Requirements

Create a typed API client in the desktop frontend or Tauri bridge layer.

Recommended file:

```text
apps/client/src/lib/host-agent-api.ts
```

Recommended types:

```text
HostAgentConnection
HostAgentInfo
HostAgentStatus
HostAgentConfig
HostAgentHealth
HostAgentAllocation
HostAgentInviteBundle
OwnerAccessResponse
HostAgentEvent
HostAgentError
```

Required API methods:

```text
getInfo()
getStatus(token)
getConfig(token)
patchConfig(token, patch)
getHealth(token)
getOverlayStatus(token)
getSftpStatus(token)
getStorageStatus(token)
listAllocations(token)
createAllocation(token, request)
patchAllocation(token, allocId, patch)
generateInvite(token, allocId)
importOwnerResponse(token, allocId, response)
suspendAllocation(token, allocId)
resumeAllocation(token, allocId)
retireAllocation(token, allocId, graceDays)
getEvents(token, options)
```

All API errors must preserve `code` and `error` from the host-agent response.

The UI must handle at least:

```text
UNAUTHORIZED
NOT_FOUND
INVALID_STATE
INVALID_KEY
INVITE_EXPIRED
QUOTA_STILL_CRITICAL
ALLOC_ID_MISMATCH
MATCH_ID_MISMATCH
INTERNAL
```

If the host-agent API adds more error codes, display them without crashing.

The host-agent API is the source of truth for allocations and lifecycle state. Do not mirror allocation state in a separate client-only model except as cached display data.

## Host Tab Views

The Host tab should be a single route with internal sections.

Each section should have an explicit status: `not_configured`, `blocked`, `ready_for_local_test`, `ready_for_remote_hosting`, `warning`, or `error`. Use these statuses to drive clear calls to action.

Required sections:

### 1. Host Stack

Show:

- Docker availability.
- Docker Compose availability.
- Whether `nasbb-agent` and `nasbb-sftp` containers are running.
- API reachability via `GET /api/v1/info`.
- Authenticated status via `GET /api/v1/status`.
- Current `.env` summary.

Actions:

- Create or update `.env`.
- Generate API token.
- Start stack.
- Stop stack.
- Restart stack.
- Refresh status.
- Show recent container logs with redaction.

Report in this section whether the UI is operating in:

```text
browser/mock mode
tauri-dev mode
packaged-app mode
```

If host stack automation is unavailable in browser/mock mode, show simulated controls and clear labels instead of failing silently.

### 2. Tailscale And Reachability

Show:

- Tailscale installed/connected status.
- Tailscale IPs.
- MagicDNS name if available.
- Recommended `NASBB_SFTP_BIND`.
- Recommended `TAILSCALE_ADDRESS`.
- Current SFTP bind from host-agent API.
- Current overlay status from host-agent API.
- Current SFTP status from host-agent API.

Actions:

- Use detected Tailscale IP.
- Use detected MagicDNS.
- Save env changes.
- Restart stack.
- Refresh host-agent status.

The "Use detected Tailscale IP" action must write the IP only to `NASBB_SFTP_BIND`. The "Use detected MagicDNS" action may write only to `TAILSCALE_ADDRESS`.

Warnings:

- `NASBB_SFTP_BIND=127.0.0.1` means remote owners cannot connect.
- `TAILSCALE_ADDRESS` without non-loopback SFTP bind is not remote-ready.
- `NASBB_SFTP_BIND=0.0.0.0` may expose SFTP publicly.
- MagicDNS is valid for `TAILSCALE_ADDRESS`, not for `NASBB_SFTP_BIND`.

### 3. Host Settings

Show and edit host-agent config:

- Host label.
- Advertised capacity.
- Default quota.
- Warning threshold.
- Critical threshold.
- Advisory bandwidth cap.

These use:

```text
GET /api/v1/config
PATCH /api/v1/config
```

Network bind fields are env-driven. The UI may edit `.env` for these and restart the stack, but must explain that restart is required.

### 4. Allocations

Show allocation list from:

```text
GET /api/v1/allocations
```

Each allocation should show:

- Connection name.
- Match ID.
- State.
- Username.
- Quota mode.
- Used/free quota.
- Quota state.
- Whether quota-enforced suspension is active.
- SFTP access active.
- Invite expiry.

Actions:

- Create allocation.
- Edit quota and labels.
- Generate invite.
- Copy/download invite JSON.
- Import owner response JSON.
- Suspend.
- Resume.
- Retire.

Allocation creation form:

```text
connectionName
quotaBytes or quotaGB
bandwidthCapBytesPerSecond
accessWindowEnabled
accessWindowStart
accessWindowEnd
```

Access windows are future-only in v1. Display them as planned/advisory. Do not imply enforcement.

### 5. Exchange

The Host tab must streamline host/owner interaction.

Preferred flow:

1. Host creates allocation.
2. Host generates invite.
3. UI lets host save/copy invite JSON.
4. Owner imports invite in owner UI.
5. Owner returns Owner Access Response JSON.
6. Host imports response in Host tab.
7. Host tab shows allocation as READY.

Do not require manual editing of `authorized_keys`.

The Host tab should validate imported JSON shape before POSTing it.

The UI must not expose, request, or store owner private keys. Owner Access Response contains only owner public key metadata.

### 6. Events And Diagnostics

Show:

- Recent host-agent events.
- Redacted compose logs.
- Health summary.
- Storage status.
- Verification results.

Use:

```text
GET /api/v1/events
GET /api/v1/health
GET /api/v1/storage/status
host_agent_compose_logs
host_agent_run_verify
```

## Persistence Requirements

Persist Host tab state separately from owner/backup setup state.

Recommended persisted fields:

```text
hostAgentApiUrl
hostAgentTokenRef or encrypted/local token value
lastKnownEnv
lastKnownStatus
lastSelectedTailscaleAddress
lastSelectedSftpBind
lastHostSetupCompletedAt
```

Do not store owner backup passwords. Do not store owner private SSH keys.

If a secure keychain helper exists in the client, prefer it for `hostAgentToken`. If not, persist only after warning or use existing app persistence with clear TODO-free documentation.

Persistence should never merge Host tab state into owner backup setup state. Host-only users should be able to clear owner setup data without affecting Host tab settings, and vice versa.

## Integration With Existing UI

Update:

```text
apps/client/src/App.tsx
```

Add:

```text
Host
```

with a server-style icon from `lucide-react`.

Recommended new files:

```text
apps/client/src/views/Host.tsx
apps/client/src/lib/host-agent-api.ts
apps/client/src/lib/host-agent-types.ts
```

Optional if complexity grows:

```text
apps/client/src/views/host/HostStackPanel.tsx
apps/client/src/views/host/TailscalePanel.tsx
apps/client/src/views/host/AllocationsPanel.tsx
apps/client/src/views/host/DiagnosticsPanel.tsx
```

Do not make the Host tab depend on `wizardConfigs`, owner backup targets, master backup password state, or recovery-key confirmation.

The old `PeerConnection` host subsection may remain, but add a clear route path for the new Docker Host tab.

Update `/host-setup` to redirect to `/host`. Leave `/peer-connection?section=host` untouched unless needed for compatibility.

## Tauri Backend Requirements

Implement host-agent commands in:

```text
apps/client/src-tauri/src/lib.rs
```

Follow existing command patterns.

Use safe process execution:

- `std::process::Command`
- explicit args
- no shell interpolation
- bounded output capture
- redaction before returning logs to the UI

Useful commands:

```text
docker --version
docker compose version
docker compose -f apps/host-agent/compose/docker-compose.yml ps --format json
docker compose -f apps/host-agent/compose/docker-compose.yml up -d
docker compose -f apps/host-agent/compose/docker-compose.yml down
docker compose -f apps/host-agent/compose/docker-compose.yml restart
docker compose -f apps/host-agent/compose/docker-compose.yml logs --tail 120 nasbb-agent
docker compose -f apps/host-agent/compose/docker-compose.yml logs --tail 120 nasbb-sftp
bash apps/host-agent/tests/scripts/verify.sh
```

Use the repository root or resolved app resource path consistently. Document the chosen path resolution in the final report.

In development, the commands may resolve `apps/host-agent` relative to the repository root. In packaged builds, if the stack is not available as a resource yet, show a clear "host stack files not bundled" message and document this as a packaging gap. Do not silently run commands in the wrong directory.

If Docker is not installed or not running, the UI must show a clear blocked state and next action.

## Implementation Stages

Work in order. At the end of every stage, emit a stage report.

Stage report format:

```text
=== STAGE REPORT: Stage N — Name ===
Status: COMPLETE | BLOCKED
Files changed:
  - path
Commands run:
  - command
Verification:
  - result
User-visible behavior:
  - what changed in the UI
Host-agent behavior:
  - what was verified against Docker/API
Issues:
  - none | issue
Next:
  - Stage N+1
```

If a stage is blocked, stop and report the blocker.

### Stage 1: Host API Types And Client

Create typed host-agent API types and API client.

Deliverables:

- `host-agent-types` definitions matching `docs/host-agent/api-contract.md`.
- API client with auth header handling.
- Error parser that preserves host-agent machine codes.
- Browser/mock fallback that never pretends Docker is running.

Verification:

```bash
cd apps/client
npm run typecheck
```

### Stage 2: Tauri Host-Agent Commands

Add Tauri commands for Docker prereqs, env read/write, compose lifecycle, logs, and verification script.

Add frontend bridge functions in:

```text
apps/client/src/lib/tauri-bridge.ts
```

Verification:

```bash
cd apps/client
npm run typecheck
cd src-tauri
cargo check
```

Also verify command outputs are bounded and redacted. Logs returned to the UI must not include bearer tokens or SSH public keys.

### Stage 3: Host Route And Skeleton UI

Add `/host` route and nav item. Create the Host view with stack, Tailscale, settings, allocations, and diagnostics sections.

Use mock/fallback states in browser mode so `npm run dev` remains useful without Tauri.

Verification:

```bash
cd apps/client
npm run typecheck
npm run build
```

Manual check: `/host` renders when no owner setup exists. `/host-setup` redirects to `/host`.

### Stage 4: Stack Setup Automation

Wire UI actions to:

- check Docker
- create/update `.env`
- generate token
- start stack
- stop stack
- restart stack
- read logs
- connect to API

Verification:

```bash
cd apps/host-agent
NASBB_API_TOKEN=compose-test-token make docker-up
curl -sf http://127.0.0.1:7420/api/v1/info
NASBB_API_TOKEN=compose-test-token make docker-down
```

Then verify the Host tab can perform equivalent start/status actions.

The Host tab should generate `NASBB_API_TOKEN` before first start unless the user entered one. The final report must state whether the Docker log token fallback is still reachable.

### Stage 5: Tailscale And Reachability Flow

Wire Tailscale detection into the Host tab.

Implement recommended address selection:

- `NASBB_SFTP_BIND`: Tailscale IPv4 only.
- `TAILSCALE_ADDRESS`: MagicDNS if available, else Tailscale IPv4.

Add warnings for unsafe or non-ready states.

Verification:

- Tailscale unavailable state renders clearly.
- Tailscale connected state offers address choices.
- Loopback-only SFTP state is labeled local-test only.
- MagicDNS is never written to `NASBB_SFTP_BIND`.
- Invite generation is blocked or strongly confirmed for `local_test_only`.
- Invite generation is blocked for `advertised_blocked` unless the user fixes env settings.
- `unsafe_public` is shown as a security warning.

### Stage 6: Host-Agent Settings And Health

Wire:

```text
GET/PATCH config
GET health
GET overlay/status
GET sftp/status
GET storage/status
GET events
```

Verification:

```bash
cd apps/host-agent
NASBB_API_TOKEN=compose-test-token make docker-up
```

From the Host tab, connect with token `compose-test-token`, patch host label, refresh health, and confirm the UI updates.

Report the exact API calls used and at least one sample response shape in the stage report.

### Stage 7: Allocation Lifecycle

Implement create/list/patch/invite/owner-response/suspend/resume/retire flows.

The Host tab must support file import/export or copy/paste for:

- Host Invite Bundle
- Owner Access Response

Verification:

- Create allocation.
- Generate invite.
- Import a test owner response.
- Confirm state moves to READY.
- Suspend, resume, retire.
- Confirm events update.

For the test owner response, use a generated test SSH public key only. Do not use or ask for a real owner private key.

### Stage 8: End-To-End Docker Verification

Expose a "Run host verification" action that calls:

```text
host_agent_run_verify
```

It should run:

```bash
cd apps/host-agent
NASBB_API_TOKEN=compose-test-token make verify
```

or equivalent against the running stack.

Show pass/fail output in the Host tab.

Verification:

```bash
cd apps/host-agent
NASBB_API_TOKEN=compose-test-token make docker-up
NASBB_API_TOKEN=compose-test-token make verify
NASBB_API_TOKEN=compose-test-token make docker-down
```

The UI-triggered verification should also work.

The UI must show the raw pass/fail lines from verification in a scrollable diagnostic panel, with token/public-key redaction applied.

### Stage 9: Audit And Fix Pass

Run the full checks below. Fix issues before final response.

Required checks:

```bash
cd apps/client
npm run typecheck
npm run build
npm run lint

cd src-tauri
cargo fmt --check
cargo check

cd ../../host-agent
go test ./tests/...
go vet ./src/... ./tests/...
NASBB_API_TOKEN=compose-test-token make docker-build
NASBB_API_TOKEN=compose-test-token make docker-up
NASBB_API_TOKEN=compose-test-token make verify
NASBB_API_TOKEN=compose-test-token make docker-down
```

If a check cannot run because the machine lacks Docker, Tailscale, or another prerequisite, report that clearly and verify all possible non-Docker checks.

## Manual UI Test Script

After implementation, perform this flow and include results in the final report:

1. Open the app to `/host`.
2. Confirm Host tab loads without requiring other setup.
3. Generate or enter an API token.
4. Start the Docker stack.
5. Connect to `GET /api/v1/info` and authenticated status.
6. Detect Tailscale state.
7. If Tailscale is unavailable, keep local-only test mode and confirm warnings.
8. Create an allocation with a small quota.
9. Generate Host Invite Bundle.
10. Generate a test owner SSH key or owner response using host-agent verification flow.
11. Import Owner Access Response.
12. Confirm allocation becomes READY.
13. Suspend and resume allocation.
14. Retire allocation.
15. Run host verification.
16. Confirm no token or public key appears in displayed logs/events.

Also capture whether the test ran in:

```text
local-only mode
tailscale-ready mode
```

If Tailscale is unavailable, do not claim remote-owner readiness.

## Quality Bar

- Host tab is independent and useful for host-only users.
- Docker setup is automated where feasible.
- Tailscale path is clear and honest.
- Dangerous network states are warned before invite exchange.
- API errors are shown with actionable messages.
- No owner secrets are introduced into host UI state.
- The user never has to manually edit `authorized_keys`.
- The user does not need to understand Docker commands for the normal path.
- Verification proves the UI and Docker stack work together.

## Definition Of Done

The work is done only when:

- `/host` exists and is linked from primary navigation.
- `/host-setup` redirects to `/host`.
- A host-only user can use `/host` without visiting setup, backup, recovery, or owner tabs.
- The UI can create/update `.env` for the Docker stack.
- The UI can start, stop, restart, and inspect the Docker stack through Tauri commands.
- The UI can connect to the host-agent API with a bearer token.
- The UI can configure the recommended Tailscale/SFTP env values or clearly explain why it cannot.
- The UI can create an allocation, generate an invite, import an owner response, and perform suspend/resume/retire.
- The UI can run or trigger the host-agent verification flow.
- The final audit commands have been run or blocked prerequisites are clearly reported.
- No normal Host tab flow depends on the legacy manual Host Spaces command-plan path.

## Final Response Requirement

When finished, summarize:

- Host tab files added/changed.
- Tauri commands added.
- Host-agent API methods integrated.
- Docker automation behavior.
- Tailscale behavior.
- End-to-end verification results.
- Any blocked checks or remaining risks.
- Whether the result is remote-hosting ready or local-test only.

Do not mark the work complete until you have run the audit/fix pass or clearly documented why a prerequisite prevented part of it.
```
