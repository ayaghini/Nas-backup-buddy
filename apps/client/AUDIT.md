# Client Tab Audit — 2026-05-05

Files audited: Peer.tsx, AllocationsPanel.tsx (Host), SetupWizard.tsx, HealthChecks.tsx

---

## BUGS

_(all fixed)_

---

## UX / CORRECTNESS GAPS

_(all fixed)_

---

## FIXED

- [x] **P1 · Peer**: `previousSessionNote` seeded from `peer.lastSftpStatus` / `peer.lastRepoMessage` when initializing a session for an existing peer with persistence data.
- [x] **P2 · Peer**: Backup section now finds the wizard config whose `overlay_host` matches the current peer's effective SFTP host; falls back to last config.
- [x] **P3 · Host**: `onRefresh()` called after successful invite generation so allocation state flips from `DRAFT` → `PENDING_KEY` immediately.
- [x] **P4 · Peer**: Added `defaultSection(peer)` — switching peers now auto-opens the accordion section matching the current phase.
- [x] **P5 · Peer**: Red banner inside the invite details box when `expiresAt < now`.
- [x] **P6 · Wizard**: Summary step now shows actual field values (overlay host, SFTP user, path, SSH key, source folder paths) instead of `✓ configured`.
- [x] **P7 · Host**: Two-step confirm before `Suspend access` — inline confirm matching the retire pattern.
- [x] **P8 · Host**: `Show retired (N)` / `Hide retired (N)` toggle at the bottom of the allocations list; retired entries hidden by default.
- [x] **P9 · Wizard**: `applyWizardConfig` already deduplicates by `overlay_host:sftp_path`. Summary step now shows a sky info note when the save will update an existing job in-place.
- [x] **P10 · Health**: Refresh button added to HealthChecks header; calls `refreshRealHealth()` + `refreshReadiness()`.
- [x] **P11 · Health**: "Protected Status Gate" renamed to "Backup Readiness Checklist".
