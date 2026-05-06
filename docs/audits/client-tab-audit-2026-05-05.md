# Client Tab Audit 2026-05-05

Scope: Peer.tsx, AllocationsPanel.tsx (Host), SetupWizard.tsx, HealthChecks.tsx.
All 11 items found were fixed in the same session. Build and `tsc --noEmit` pass clean.

---

## Peer Tab (multi-peer rewrite + bug fixes)

### Architecture change
Single-peer `peerTabState` replaced by `savedPeers: SavedPeer[]` persisted in app config via AppContext.
Each peer has a stable local UUID. Session-only state (live results, loading flags) lives in a
`Record<string, PeerSession>` map — not persisted.

### Phase derivation
`derivePhase(peer, session)` is a pure function. Fresh session results take precedence; falls back to
`peer.lastSftpStatus` / `peer.lastRepoMessage` for cross-session continuity.

### Phases
`needs_invite → invite_invalid → needs_key → response_ready → waiting_for_host → sftp_verified → repo_ready → blocked`

### Bugs fixed
1. **`previousSessionNote` never set from persistence.** Session initialized empty even when peer had
   persisted `lastSftpStatus`/`lastRepoMessage`. Fixed: `useEffect` seeds session's `previousSessionNote`
   from persisted fields on first load for each peer.
2. **Backup section used wrong wizard config.** `wizardConfig` (always last config) replaced by a lookup:
   find the config whose `overlay_host` matches the current peer's effective SFTP host; fall back to
   last config.
3. **Peer tabs reset accordion to 'invite' on every selection.** Fixed: `defaultSection(peer)` derives
   the right accordion section from the peer's current phase.

### UX gaps fixed
4. **Expired invite not flagged.** Red inline banner added when `invite.expiresAt < Date.now()`.

---

## Host Tab (AllocationsPanel)

### New: DELETE allocation
- Go: `Manager.Delete(allocId)` removes JSON file, returns `NOT_FOUND` sentinel on missing file.
- Go handler: `handleDeleteAllocation` deauthorizes SFTP key before deletion; returns 204.
- Route: `r.Delete("/api/v1/allocations/{allocId}", s.handleDeleteAllocation)`.
- Client: `deleteAllocation(token, allocId, baseUrl)` in `host-agent-api.ts` uses `method: 'DELETE'`.
- UI: "Delete" button with two-step confirm; extra warning when allocation is `READY`/`SUSPENDED`.

### Bugs / UX fixed
5. **Allocation state stale after invite generation.** `onRefresh()` was not called after a successful
   `generateInvite`. Now called — allocation flips `DRAFT → PENDING_KEY` immediately.
6. **No confirm before Suspend.** Suspend revokes SFTP instantly. Added two-step confirm matching
   the retire pattern.
7. **RETIRED allocations cluttered the list.** Hidden by default; `Show retired (N)` / `Hide retired (N)`
   toggle added at the bottom of the list.

---

## Setup Wizard

### Refactored flow (4 steps)
`source-folders → peer-target → retention → summary`  
Previous steps removed: role selection (hardcoded `data_owner`), hosted-storage, health-consent.

### Step 2 peer-select cards
`readyPeers` = `savedPeers.filter(p => p.sftpHost !== '' || p.manualSftpHost !== '')`.  
Each card shows: connection name, phase dot + label, `host:port`, SFTP username.  
Clicking a card auto-fills: `overlay_host`, `sftp_user`, `sftp_port`, `sftp_path`, `ssh_key_ref`, and
pre-populates `label` if blank.  
Selected card gets a sky border highlight.  
Empty state: amber nudge pointing to Peer tab.

### UX fixes
8. **Summary showed `✓ configured` instead of real values.** Now shows actual overlay host, SFTP user,
   path, SSH key, and full source folder list.
9. **No duplicate detection feedback.** `applyWizardConfig` already deduplicates by `overlay_host:sftp_path`
   (updates in-place). Summary step now shows a sky info note when the save will update an existing job.

---

## Health Checks

### Fixes
10. **No refresh button.** Added to header; calls `refreshRealHealth()` + `refreshReadiness()`.
11. **Jargon section title.** "Protected Status Gate" renamed to "Backup Readiness Checklist".

---

## Known Remaining Issues (carried from 2026-05-02 audit)

- Peer API auto-submit bypasses strict owner-response validation (no matchId / requestedSftpUsername /
  expiry check). Fix: share manual import parser with peer API.
- `inviteToken` may be exposed in allocation summary API responses. Fix: clear in `Summary()`.
- No Go test coverage (toolchain unavailable at audit time).
