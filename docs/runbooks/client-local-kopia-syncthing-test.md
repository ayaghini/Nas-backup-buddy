# Client Local Kopia + Syncthing Test Runbook

## Purpose

Step-by-step procedure for testing the NAS Backup Buddy desktop client setup locally in mock/offline mode. Use this runbook to validate:

- Config validation logic for all three roles.
- Kopia command planning and secret redaction.
- Syncthing folder safety (source folder rejection).
- Mock backup and restore drill flows.
- Health threshold evaluation.
- Log redaction behavior.

This runbook does NOT describe a real Kopia or Syncthing execution. See `docs/runbooks/proof-of-concept.md` for the two-machine manual proof of concept with real tools.

---

## Prerequisites

- Node.js 18+ and npm.
- (Optional) Rust and Cargo for Rust-side checks.
- A browser or the Vite dev server.

---

## Step 1: Start the client in mock/offline mode

```bash
cd apps/client
npm install
npm run dev
```

Open `http://localhost:1420` (or the URL shown by Vite).

The app starts in mock/offline mode by default. The sidebar shows "Offline mode" at the bottom.

**Expected:** Dashboard loads with mock state. No Tauri binary is required.

---

## Step 2: Validate the setup wizard

Navigate to **Setup Wizard**.

### Test: Data Owner

1. Select **Data Owner** role. Click Continue.
2. Add source folder `/home/user/documents`. Click Continue.
3. Enter repository path `/home/user/.nasbb-repo`. Click Continue.
4. Hosted storage step — skip (not required). Click Continue.
5. Confirm recovery key saved. Click Continue.
6. Set retention keep_last to 5. Click Continue.
7. Leave health consent off. Click Continue.
8. Review summary. Click **Save configuration**.

**Expected pass:** "Setup configuration saved." No validation errors.

### Test: Source folder used as repository (should fail)

1. Data Owner.
2. Source folder: `/home/user/documents`.
3. Repository path: `/home/user/documents` (same as source).

**Expected fail:** Error "Repository path must not be the same as a source folder."

### Test: Repository inside source (should fail)

1. Source: `/home/user/documents`.
2. Repository: `/home/user/documents/repo`.

**Expected fail:** Error "Repository path must not be inside a source folder."

### Test: Storage Host (no source or repository required)

1. Select **Storage Host** role.
2. Skip source folders and repository steps.
3. Enter hosted storage path `/mnt/peer-storage`, quota 500 GB.

**Expected pass:** No errors for missing source or repository.

### Test: Reciprocal Match (both sides required)

1. Select **Reciprocal Match** role.
2. Source folders: `/home/user/documents`.
3. Repository: `/home/user/.nasbb-repo`.
4. Hosted storage: `/mnt/peer-storage`, quota 500 GB.

**Expected pass:** All fields accepted.

### Test: Reciprocal Match missing hosted storage (should fail)

1. Same as above but leave hosted storage path empty.

**Expected fail:** "Enter the hosted peer-storage path."

---

## Step 3: Validate Kopia command planning

Navigate to **Backup Plan**.

**Expected:** Command plan table shows five planned commands:
- `kopia --version`
- `kopia repository create filesystem --path [REDACTED]`
- `kopia snapshot verify`
- `kopia snapshot create [REDACTED]`
- `kopia snapshot list`

**Verify:**
- No real paths appear in the display_command column.
- `KOPIA_PASSWORD` is not shown anywhere in the UI.
- Source folder paths are replaced with `[REDACTED]`.

### Test: Run mock backup

Click **Run mock backup**.

**Expected:**
- "Mock backup completed" success panel appears.
- Snapshot ID is shown (not a secret).
- File count and size are shown.
- Log line is safe to display (no raw paths).

### Test: Run mock repository verification (pass)

Click **Mock check (pass)**.

**Expected:** "Repository verification passed" message.

### Test: Run mock repository verification (fail)

Click **Mock check (fail)**.

**Expected:** "Repository verification FAILED" message. Red failure indicator. Health level: Critical (if wired to health view).

---

## Step 4: Validate Syncthing folder planning

Navigate to **Syncthing Connection**.

### Test: Repository path accepted

Default folder path `/home/user/.nasbb-repo` should already show as accepted:

**Expected:** Green "Path accepted" panel.

### Test: Source folder rejected

In the "Validate a proposed folder path" input, enter `/home/user/documents` (a configured source folder).

Click **Validate**.

**Expected:** Red error: "Source folder path must not be used as a Syncthing folder."

### Test: Subfolder of source also rejected

Enter `/home/user/documents/subdir`.

**Expected:** Red error about source folder rejection.

### Test: Unrelated path accepted

Enter `/mnt/peer-storage`.

**Expected:** Green "Path accepted" panel.

### Verify API plan redaction

The Syncthing API plan shown should contain:
- `[X-API-Key: REDACTED]` — never the actual API key.
- `path=[REDACTED]` — never the actual folder path.

---

## Step 5: Run mock restore drill

Navigate to **Restore Drill**.

### Test: Passing drill

Click **Simulate pass** (sets both checksums to match), then **Run mock restore drill**.

**Expected:** "Drill PASSED". Health level: OK. Audit evidence shows `result: pass`.

### Test: Canary mismatch (Critical)

Click **Simulate mismatch** (sets observed to all-zeros checksum), then run.

**Expected:** "Drill FAILED — CANARY MISMATCH". Health level: Critical. Audit evidence includes "Preserve all logs" action.

### Test: Restore failure (Critical)

Click **Simulate failure (empty observed)** — sets observed checksum to empty, then run.

**Expected:** "Drill FAILED". Health level: Critical. Audit evidence includes restore investigation action.

This path intentionally leaves the observed checksum empty. The mock restore drill backend treats an empty observed checksum as a restore failure, so the failure must still reach the backend and update Health Checks.

---

## Step 6: Verify health check thresholds

Navigate to **Health Checks**.

**Verify the following thresholds are displayed correctly:**

| Check | Warning threshold | Critical threshold |
|---|---|---|
| Last backup age | > 24h | > 72h |
| Last sync age | > 24h | > 72h |
| Free quota | < 15% | < 5% |
| Restore drill age | > 30 days | Never run / failed |
| Peer offline | > 24h | > 7 days |
| Repository verification | Tool warning | Verification failed |

**With default mock state:**
- Last backup: OK (2h ago).
- Last sync: OK (1h ago).
- Free quota: OK (65%).
- Restore drill: Critical (never run — blocks Protected).
- Peer offline: OK (online).
- Repository verification: OK (passed).

**Expected:** Overall health level = Critical (because drill never run).

**Expected Protected gate:** 3–4 of 8 checks passing (snapshot exists, repo synced, quota has buffer, retention configured — but drill never run, no key confirmation in default state).

---

## Step 7: Verify log redaction

Navigate to **Logs**.

**Verify the redaction demo panel shows:**
- Before/after pairs where source paths and passwords are replaced with `[REDACTED]`.

**Verify the log stream shows only redacted lines.** No raw paths, passwords, or API keys should appear.

Key examples to confirm:
- `password=hunter2` → `password=[REDACTED]`
- `/home/alice/documents` → `[REDACTED]`
- Health summary lines pass through unchanged.

---

## Step 8: Verify settings toggles

Navigate to **Settings**.

**Toggle mock/offline mode off and on.** Verify the banner on the Dashboard changes.

**Toggle health reporting consent.** Verify the state summary updates.

**Toggle recovery key confirmed.** Verify:
- Dashboard "Recovery key saved externally" check flips.
- Protected gate count changes.

---

## Safety checks to verify manually

Before calling a local test complete, confirm each of the following manually:

- [ ] Source folders configured in the wizard never appear in Syncthing folder plans.
- [ ] Repository path is always shown as `[REDACTED]` in Kopia command display.
- [ ] Kopia password is never shown anywhere in the UI.
- [ ] Syncthing API key is always shown as `[X-API-Key: REDACTED]`.
- [ ] Mock restore drill with mismatched checksums returns health level `critical`.
- [ ] Mock restore drill with empty observed checksum returns health level `critical`.
- [ ] Storage Host role validation passes with no source or repository paths.
- [ ] Data Owner role validation fails if source folders are empty.
- [ ] Reciprocal Match role validation fails if either owner-side or host-side settings are missing.
- [ ] Health report consent defaults to off.

---

## What is mock vs real

| Feature | Mock/offline | Real (not yet implemented) |
|---|---|---|
| Kopia command planning | ✅ Real Rust logic | Real execution: not yet |
| Kopia/Syncthing tool verification | ✅ Real SHA-256 verifier and macOS arm64 manifest checksums | Other platform binaries/checksums: not yet |
| Syncthing folder safety | ✅ Real Rust logic | Real execution: not yet |
| Config validation | ✅ Real Rust logic | Production keychain: not yet |
| Mock backup result | ✅ Mock JSON | Real kopia snapshot: not yet |
| Mock repo check | ✅ Mock pass/fail | Real kopia check: not yet |
| Mock restore drill | ✅ Real checksum compare logic | Real kopia restore: not yet |
| Log redaction | ✅ Real Rust regex logic | Streaming from real tool: not yet |
| Health thresholds | ✅ Real Rust threshold logic | Real health report from service: not yet |
| Syncthing REST API | Planned (mock plan) | Real API calls: not yet |
| OS keychain | Documented pattern | Real integration: not yet |
| Web API pairing | Not implemented | Future phase 5 |

---

## Do not claim real backup protection until:

1. A real Kopia binary is bundled and its checksum is verified against the manifest on every release platform.
2. `kopia repository create`, `snapshot create`, and `snapshot verify` have been executed against a real repository.
3. A real restore from a peer-held repository has succeeded with canary checksum match.
4. Syncthing has replicated the encrypted repository to a second machine.
5. Cargo checks pass on a Rust-enabled machine for the Tauri command layer and `nasbb-core` tests.
