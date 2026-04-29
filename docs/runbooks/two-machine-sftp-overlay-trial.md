# Two-Machine SFTP/Overlay Trial Runbook

**Purpose:** Prove that Machine A (Data Owner) can back up data to Machine B (Storage Host) using Kopia over SFTP on a private overlay network, restore it, and verify the canary checksum.

This is the Phase 1 POC the project requires before advancing to Phase 2 alpha matching.

---

## Machines and roles

| Machine | Role | Notes |
| --- | --- | --- |
| Machine A | Data Owner | Runs Kopia, connects to peer SFTP target |
| Machine B | Storage Host | Accepts SFTP connections, stores encrypted repo |

**Both machines must be on separate networks** (not just separate LAN segments) to prove overlay routing works.

---

## Prerequisites

- [ ] Kopia CLI installed on Machine A (same version as the client app manifest).
- [ ] OpenSSH server (`sshd`) running on Machine B.
- [ ] Tailscale (or equivalent) installed and authenticated on both machines (each user signs in to their own account).
- [ ] Machine B has shared their device with Machine A, or both are on a mutually reachable tailnet path.
- [ ] Machine B's Tailscale MagicDNS hostname or overlay IP is known to Machine A.
- [ ] Backup encryption password decided (not written down yet — store in OS keychain).

---

## Overlay compatibility matrix

| Machine A | Machine B | Works? | Notes |
| --- | --- | --- | --- |
| Tailscale | Tailscale (reachable via sharing/invite) | ✅ Yes | Each user uses their own account. Device/tailnet sharing or an invite is enough — no shared account required. |
| Tailscale client | Headscale (joined to same server) | ✅ Yes | Only works when the Tailscale client is explicitly joined to that Headscale control server (`tailscale up --login-server <url>`), not when it is on a separate Tailscale tailnet. |
| Tailscale tailnet | Separate Headscale network | ❌ No | A standard Tailscale tailnet cannot reach a separate Headscale network automatically. Routing between them requires explicit bridging. |
| Headscale | Headscale (same server) | ✅ Yes | Both users join the same self-hosted Headscale network. |
| Tailscale | Plain WireGuard | ❌ No | Not interoperable without manual routing/bridging. |
| WireGuard | WireGuard (matching config) | ✅ Yes | Both users configure matching WireGuard tunnels. |
| Custom address | Any | ✅ If reachable | Only if the address is actually reachable and on a secured private path. |

> **Key point:** Machine A and Machine B are typically owned by **different people**. A shared Tailscale account is not required or recommended. Each user signs in to their own account; the Storage Host shares their device or sends an invite so the Data Owner can reach them.

---

## Overlay setup paths

### Path A: Both already have Tailscale (check reachability)

If both machines already have Tailscale installed and can reach each other (via sharing, invite, or shared tailnet):

```bash
# On each machine: confirm Tailscale is running
tailscale status

# Get this machine's Tailscale IP
tailscale ip -4
# MagicDNS hostname (preferred — more stable than IP):
# Run: tailscale status --json
# Look for "DNSName" in the "Self" block, e.g. "my-mac.tailnet-name.ts.net"
# (The NAS Backup Buddy Overlay tab shows this automatically)
```

Skip to Step 1.

### Path B: Tailscale first-time setup (two separate users)

Each user sets up Tailscale independently on their own machine, then Machine B shares its device with Machine A.

**On each machine separately:**

1. **Install Tailscale** (do not use `brew install tailscale` for the GUI app on macOS):
   - macOS: download the GUI app from https://tailscale.com/download/mac
   - Linux: `curl -fsSL https://tailscale.com/install.sh | sh`
   - Windows: download from https://tailscale.com/download
   - Raspberry Pi: use the Linux installer — ARM packages are included

2. **Sign in** (interactive browser auth — each user uses their own account):
   - macOS: click the menu bar icon → Log in
   - Linux/Windows: run `tailscale up` yourself in a terminal — the app never runs this

3. **Machine B (Storage Host): share your device with Machine A**:
   - Open https://login.tailscale.com → Machines → your machine → Share
   - Enter Machine A user's email — they accept the invite
   - Alternatively, if operating a shared tailnet together, invite Machine A's user
   - See: https://tailscale.com/kb/1084/sharing

4. **Confirm reachability**:
   ```bash
   # On Machine A — ping Machine B's Tailscale address
   ping machine-b.tailnet-name.ts.net
   # or: ping 100.x.x.x
   ```

### Path C: Headscale (self-hosted control server)

Both users must join the same Headscale instance. The Headscale operator must pre-register both machines or use pre-auth keys.

```bash
# On each machine (run yourself — the app never runs auth commands):
tailscale up --login-server https://your-headscale-server
```

### Path D: WireGuard (advanced / manual)

1. Install `wireguard-tools` on both machines.
2. Generate keypairs on each machine:
   ```bash
   wg genkey | tee /tmp/wg-pk | wg pubkey > /tmp/wg-pub
   # Share the contents of /tmp/wg-pub with your peer out-of-band
   # Delete /tmp/wg-pk immediately after moving it to your config
   ```
3. Create `/etc/wireguard/wg0.conf` on each machine with matching peer entries.
4. Bring up the tunnel: `sudo wg-quick up wg0`
5. Verify: `sudo wg show` and `ping <peer-tunnel-ip>`

---

## Step 1: Overlay network setup

### On Machine B (host)

```bash
# Confirm Tailscale is up
tailscale status

# Note the Machine B overlay IP or hostname — you will give this to Machine A
tailscale ip -4
# or use MagicDNS hostname: hostname.tailnet-name.ts.net
```

### On Machine A (owner)

```bash
# Confirm overlay connectivity to Machine B
ping <machine-b-overlay-ip-or-hostname>
```

---

## Step 2: Host setup on Machine B

Use the NAS Backup Buddy client app **Host** tab. The current v1 host path is the Docker host-agent stack, not manual OS user creation.

1. Open **Host**.
2. Confirm Docker and Docker Compose prerequisites pass.
3. Generate or enter an API token and save it to `.env`.
4. Start the host stack.
5. In **Tailscale & Network**, set:
   - `NASBB_SFTP_BIND` to Machine B's Tailscale IPv4 address.
   - `TAILSCALE_ADDRESS` to Machine B's MagicDNS hostname or Tailscale address.
6. Restart the stack after changing host settings.
7. Create an allocation with the trial quota.
8. Export the Host Invite Bundle JSON.
9. Send the invite JSON to Machine A out-of-band.

The invite JSON looks like:

```
{
  "bundleVersion": 1,
  "kind": "nasbb.host_invite",
  "matchId": "match-abc123",
  "allocId": "alloc_a1b2c3d4e5f6",
  "sftp": {
    "host": "machine-b.tailnet.ts.net",
    "port": 2222,
    "username": "nabb_1234abcd",
    "path": "/repository"
  },
  "hostKey": {
    "fingerprintSha256": "SHA256:..."
  },
  "expiresAt": "2026-07-27T00:00:00Z"
}
```

No passwords or private keys are in the invite.

---

## Step 2b: Owner response on Machine A

Use the planned **Peer** tab when implemented. Until then, use the implementation prompt in `docs/prompts/implement-peer-tab.md` as the source of truth for the owner flow.

Expected Peer tab flow:

1. Open **Peer**.
2. Paste or import the Host Invite Bundle JSON.
3. Confirm the host key fingerprint out-of-band.
4. Generate the owner SSH key and Owner Access Response JSON.
5. Send the response JSON to Machine B.
6. Wait for Machine B to import the response in **Host -> Allocations**.

Machine B then imports the Owner Access Response in **Host**. The Docker host-agent writes the owner's public key to the allocation and activates SFTP access.

---

## Step 3: Verify SFTP access from Machine A

### Option A: Use the app (recommended)

1. In the **Peer** tab, confirm the invite is imported and the host has imported the Owner Access Response.
2. Click **Verify SFTP** — verifies SSH authentication, path access, and write test.
   - **Expected result:** `SFTP verified` with write test passed.

### Option B: Command line

```bash
# From Machine A — confirm SFTP login works
sftp -i <owner-private-key-path> -P 2222 nabb_1234abcd@<machine-b-overlay-host>
# Expect: sftp> prompt
# Type: ls
# Expect: chrooted repository contents
# Type: exit
```

If this fails, check:
- Overlay connectivity (`ping <host>`)
- Docker host stack running on Machine B.
- Host tab SFTP bind uses Machine B's Tailscale IP, not `127.0.0.1`.
- Machine B imported the Owner Access Response in Host.
- Host-agent health shows SFTP running and no public exposure warning.

---

## Step 4: Create sample data on Machine A

```bash
mkdir -p /tmp/nasbb-trial/source
echo "canary-$(date +%s)" > /tmp/nasbb-trial/source/canary.txt
# Copy of this checksum will be verified after restore
sha256sum /tmp/nasbb-trial/source/canary.txt > /tmp/nasbb-trial/canary.sha256
cat /tmp/nasbb-trial/canary.sha256
```

---

## Step 5: Create Kopia SFTP repository on Machine A

### Option A: Use the app (recommended after SFTP verify succeeds)

1. In the **Peer** tab, confirm SFTP Verification shows `SFTP verified`.
2. Set your backup password in the **Recovery Key** tab if not already done.
3. Click **Create / Connect SFTP Repository**.
4. Expected result: `Repository connected`.

### Option B: Command line

```bash
# Set password via env var — never pass as CLI arg
export KOPIA_PASSWORD="<your-backup-password>"

kopia repository create sftp \
  --host <machine-b-overlay-host> \
  --port 2222 \
  --username nabb_1234abcd \
  --path /repository \
  --keyfile <owner-private-key-path> \
  --config-file /tmp/nasbb-trial/kopia.config.json

# Expect: "Initialized encrypted repository..."
```

> **Note:** `--path /repository` is the path *inside the chroot* (`/home/nasbb-match-1/repository` on Machine B becomes `/repository` from the chroot perspective).

Confirm the repository was created on Machine B:

```bash
# On Machine B
ls /home/nasbb-match-1/repository/
# Expect: kopia.repository, p/, q/ etc.
```

---

## Step 6: Run backup

```bash
# On Machine A
kopia snapshot create /tmp/nasbb-trial/source \
  --config-file /tmp/nasbb-trial/kopia.config.json

# Note the snapshot ID from the output, e.g.:
# Created snapshot with root k... and ID k...
```

Run two more backup cycles (vary source content between runs):

```bash
echo "update-$(date +%s)" >> /tmp/nasbb-trial/source/canary.txt
kopia snapshot create /tmp/nasbb-trial/source --config-file /tmp/nasbb-trial/kopia.config.json

echo "update-$(date +%s)" >> /tmp/nasbb-trial/source/canary.txt
kopia snapshot create /tmp/nasbb-trial/source --config-file /tmp/nasbb-trial/kopia.config.json
```

**Exit criterion:** At least 3 successful backup cycles.

---

## Step 7: Repository verification

```bash
# On Machine A
kopia snapshot verify --config-file /tmp/nasbb-trial/kopia.config.json

# Expect: no errors in output
```

---

## Step 8: Simulated deletion — confirm snapshot survives

```bash
# On Machine A — delete a file from source
rm /tmp/nasbb-trial/source/canary.txt

# Confirm snapshot still shows it
kopia snapshot list --config-file /tmp/nasbb-trial/kopia.config.json
```

---

## Step 9: Restore drill from peer-held repository

```bash
# On Machine A
# Clear restore destination
rm -rf /tmp/nasbb-trial/restore
mkdir -p /tmp/nasbb-trial/restore

# List snapshots to get the first snapshot ID
kopia snapshot list --config-file /tmp/nasbb-trial/kopia.config.json

# Restore the first snapshot (replace <SNAPSHOT-ID> with the actual ID)
kopia restore <SNAPSHOT-ID> /tmp/nasbb-trial/restore \
  --config-file /tmp/nasbb-trial/kopia.config.json
```

---

## Step 10: Canary checksum verification

```bash
# On Machine A
sha256sum /tmp/nasbb-trial/restore/canary.txt

# Compare to the original
cat /tmp/nasbb-trial/canary.sha256

# The hashes must match exactly.
# If they differ, the restore is corrupt — do not mark as Protected.
```

**Exit criterion:** Restored canary SHA-256 matches the original. Record result.

---

## Step 11: Confirm Machine B cannot read the data

```bash
# On Machine B — attempt to read a content block
# (Kopia stores content as encrypted binary blobs)
ls /home/nasbb-match-1/repository/p/
# The files have opaque names and are ciphertext — not readable without the password.

# Try to cat any content file — it should be binary garbage
cat /home/nasbb-match-1/repository/p/$(ls /home/nasbb-match-1/repository/p/ | head -1)
# Expect: unreadable binary output
```

---

## Evidence to record

| Evidence | How to capture |
| --- | --- |
| Overlay connectivity confirmed | `ping` output |
| SFTP login successful | `sftp` session screenshot |
| Repository created on Machine B | `ls /home/nasbb-match-1/repository/` output |
| Backup runs completed (3×) | `kopia snapshot list` output |
| `kopia snapshot verify` passed | Command output |
| Restore from peer-held data succeeded | `kopia restore` output |
| Canary checksum matches | `sha256sum` comparison |
| Machine B cannot read content | `cat` of content block (binary output) |

---

## Failure notes

### Overlay unreachable

```
ssh: connect to host ... port 22: Connection timed out
```

- Check Tailscale is up on both machines: `tailscale status`
- Check firewall: `sudo ufw status` — ensure port 22 is open from overlay subnet
- Try `tailscale ping <peer>` to test overlay-level connectivity

### Authentication failure

```
Permission denied (publickey)
```

- Check key file path: `ls -la ~/.ssh/nasbb-match-1`
- Check `authorized_keys` on Machine B: `sudo cat /home/nasbb-match-1/.ssh/authorized_keys`
- Check permissions: `authorized_keys` must be 600, `.ssh` must be 700
- Check `sshd_config` Match block is correct: `sudo sshd -t`

### Permission denied on SFTP path

```
Couldn't stat remote file: No such file or directory
```

- Inside a ChrootDirectory, `/repository` maps to `/home/nasbb-match-1/repository`
- Confirm the directory exists: `sudo ls /home/nasbb-match-1/repository`
- Check ownership: `sudo chown -R nasbb-match-1 /home/nasbb-match-1`

### Quota or disk full

```
repository write failed: ... no space left on device
```

- Check available space on Machine B: `df -h /home/nasbb-match-1`
- Adjust quota or free space before retrying
- Do not prune existing snapshots while diagnosing — restore may still be possible

### Host key mismatch

```
REMOTE HOST IDENTIFICATION HAS CHANGED
```

- Machine B's SSH host key changed (OS reinstall, different machine behind same address)
- Verify out-of-band that Machine B is the expected host
- If correct, update `~/.ssh/known_hosts` on Machine A: `ssh-keygen -R <host>`
- Never skip host key verification in production

### Restore output differs from original

- Do not delete source data
- Run `kopia snapshot verify` again to check repository integrity
- Check whether the wrong snapshot ID was restored (use `kopia snapshot list`)
- File a Critical incident — do not mark the match Protected until restored data is verified

---

## Next steps after successful trial

- [ ] Record all evidence listed above.
- [ ] Store backup password in OS keychain (not an environment variable).
- [ ] Remove trial test data: `rm -rf /tmp/nasbb-trial`
- [ ] Repeat the trial with production source folders and a full backup + restore.
- [ ] Document timing: backup duration, restore duration, network throughput.
- [ ] Update `docs/client-app/current-audit.md` with two-machine restore evidence.
- [ ] Proceed to Phase 2 alpha matching per `docs/implementation-map.md`.
