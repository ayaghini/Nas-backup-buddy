# Implementation Map

## Current Phase
Phase 3: local agent MVP.

## Done Enough To Use
- Host tab can manage Docker stack, env, Tailscale/SFTP reachability, allocations, diagnostics.
- Host-agent can create, delete, suspend, resume, and retire allocations; generate invites; import owner responses; expose peer auto-submit API.
- Peer tab supports multiple peer connections — each peer has its own invite/response/connect/backup lifecycle; all peer state persists in `savedPeers[]`; the tab auto-opens to the right section based on current phase.
- Peer tab can import invite, generate owner SSH key/response, auto-submit to host, verify SFTP (with expired-invite banner and host-key confirmation), create/connect Kopia SFTP repo, and run SFTP backup.
- Setup Wizard has a 4-step flow (source folders → backup destination → retention → review); step 2 shows all connected peers as selectable cards that auto-fill every SFTP field; summary step shows actual credential values.
- Health Checks has a manual Refresh button and the readiness section is now titled “Backup Readiness Checklist”.
- Frontend build passed on 2026-05-05.

## Next Hardening
- Reuse strict owner-response validation in peer API.
- Strip `inviteToken` from allocation summaries/responses.
- Add Go tests for peer API expiry/mismatch/token replay and summary redaction.
- Add UI state after successful auto-submit so Peer tab shows “waiting for host” without needing an auth-failed verify first.
- Add end-to-end two-machine runbook evidence after Go toolchain is available.

## Exit Criteria For Phase 3
- Host and peer complete a fresh two-machine backup and restore drill.
- Host key mismatch, expired invite, wrong alloc/match, low quota, unreachable SFTP, and wrong private key produce clear UI states.
- No API response leaks one-time tokens, private keys, passwords, source filenames, or backup metadata beyond allowlisted health.
- Automated tests cover host-agent API, bundle parsing, SFTP verify mapping, Kopia SFTP command generation, and Tauri command validation.

## Deferred
- Paid marketplace, abuse/moderation/payouts.
- Web app MVP.
- Syncthing mirror mode.
