# Peer Tab Audit 2026-05-02

Scope: `Peer.tsx`, Tauri peer commands, SFTP verify/Kopia SFTP path, host peer API.

## Status
- Peer can import host invite, generate owner RSA key/response, auto-submit response, verify SFTP, connect/create Kopia SFTP repository, and run backup.
- Host key confirmation gates SFTP verify.
- Manual host override supports cross-account Tailscale `100.x` IP when MagicDNS fails.
- Frontend build passed. Rust workspace tests passed: 329 passed, 1 ignored.

## Issues
1. Peer API auto-submit bypasses strict owner-response validation.
   - File: `apps/host-agent/src/api/peer_server.go`
   - Manual import uses `bundle.Parse()` to validate kind, alloc ID, match ID, SSH key, and expiry. Peer API validates token, state, and key, but does not validate `matchId`, `requestedSftpUsername`, `kind`, or `inviteExpiresAt`.
   - Impact: an old invite token can authorize after expiry; malformed/wrong-match responses can be accepted if token is valid.
   - Fix: build an `OwnerAccessResponse` and call shared parser before invalidating token on success.

2. Auto-submit success does not change derived Peer phase.
   - File: `apps/client/src/views/Peer.tsx`
   - `handleAutoSubmit()` saves `lastPhase: waiting_for_host`, but `phase` ignores persisted `lastPhase`/`submitResult`. UI can still show `response_ready` after successful auto-submit.
   - Fix: include successful `submitResult` in phase derivation or set a local submitted flag.

3. Rust `submit_peer_response` trusts invite `submitUrl`.
   - File: `apps/client/src-tauri/src/lib.rs`
   - The URL comes from imported JSON. This is acceptable for a trusted host invite, but it is a broad HTTP POST primitive from the desktop process.
   - Fix: require `http://`, reject localhost/private non-Tailscale surprises unless the user confirms, and display host/port before submit.

## Gaps
- No automated test for expired invite token on peer API.
- No UI integration test for host override clearing/re-verification.
- Backup button depends on existing Backup Plan source folders; Peer tab does not offer inline source folder add.

## Recommended Next Patch
- Share manual import parser with peer API.
- Add peer API tests: expired invite, match mismatch, username mismatch, token replay, malformed key.
- Tighten `submitUrl` validation in Rust bridge.
