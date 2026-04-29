# Deprecated: Implement Peer Connection Host-First Flow

This prompt is stale. Do not use it for new work.

Use [Implement Peer Tab Prompt](implement-peer-tab.md) instead. The current architecture uses a Docker-backed `Host` tab for storage providers and a planned `Peer` tab for data owners. The old `Peer Connection` flow should be removed from primary navigation when `Peer` lands.

---

# Historical Prompt: Implement Peer Connection Host-First Flow

Goal: make `/peer-connection` a guided Tailscale + SFTP setup page where a storage host can fully allocate space before knowing the data owner's SSH key.

Keep this prompt implementation-focused. Do not redesign unrelated backup/restore tabs.

## Product Model

- V1 path: Kopia -> SFTP -> peer storage over Tailscale.
- Tailscale is the only active overlay provider.
- Syncthing is hidden from normal setup; keep backend/dev code unless trivial to remove.
- Host setup remains command-plan based. The app must not run privileged user creation, sshd edits, chmod/chown, or quota commands.
- Private keys and backup passwords never leave the owner's device.

## Routes And Layout

- Primary route/sidebar item: `/peer-connection`.
- Legacy routes redirect:
  - `/overlay` -> `/peer-connection?section=network`
  - `/host-setup` -> `/peer-connection?section=host`
  - `/peer-storage` -> `/peer-connection?section=owner`
  - `/syncthing` -> `/peer-connection?section=advanced`
- Page sections:
  1. `Network Status`
  2. `Host Spaces`
  3. `Backup Targets`
  4. `Advanced / Legacy`

## Data Model

Persist non-secret state:

- `hostAllocations[]`: `id`, `connection_name`, `match_id`, `hosted_path`, `quota_gb`, `sftp_username`, `sftp_port`, `overlay_host`, `status`, `host_invite_bundle`, `owner_public_key?`, `authorized_at?`.
- `backupTargets[]`: `id`, `connection_name`, `match_id`, `overlay_host`, `sftp_user`, `sftp_port`, `sftp_path`, `quota_gb`, `ssh_key_ref`, `public_key`, `verify_status`, `repo_init_status`.
- `ownerSshKeys[]`: `match_id`, `public_key`, `fingerprint`, `private_key_path_or_ref`.

Statuses:

- Host allocation: `draft | space_planned | waiting_for_owner_key | owner_key_received | authorized | retired`.
- Backup target: `draft | invite_imported | access_request_sent | sftp_verified | repo_connected | error`.

Use `connection_name` as the user-facing label. Auto-generate `match_id`; show it only as advanced/copyable metadata.

## Host Spaces Flow

Host must be able to allocate space without owner input.

Inputs/buttons:

- `Connection name` required, user-friendly.
- Auto-generated `match_id`, read-only advanced field with regenerate/copy.
- `Browse` hosted storage path.
- `Quota GB`.
- `SFTP username` optional, auto-derived from match ID.
- `SFTP port`, default 22.
- `This device Tailscale address`, auto-filled from Network Status.
- `Generate Host Space Plan`.
- `Copy Host Invite Bundle`.
- `Import Owner Access Request`.
- `Generate Authorize Owner Key Plan`.
- Per saved space: `Copy invite`, `Import access request`, `Show commands`, `Edit`, `Retire/Delete`.
- `Add another host space` clears the form without deleting saved spaces.

Behavior:

- Validate hosted path does not overlap source folders or any existing hosted allocation.
- Generate display-only commands to create isolated user/path/quota-ready SFTP area without requiring an owner key.
- Generate `Host Invite Bundle` containing only non-secret connection fields: provider, overlay host, SFTP user, port, path, quota, match ID, connection name, host-key verification note.
- Space status becomes `waiting_for_owner_key`.
- Owner later sends `Owner Access Request` with match ID + public key + fingerprint.
- Host imports request, validates match ID, stores public key, then generates a small display-only authorization plan to append/install the key into `authorized_keys`.
- After authorization plan is generated/copied, host can mark the space `authorized`.

## Backup Targets Flow

Owner imports host invite, then sends access request back.

Inputs/buttons:

- `Import Host Invite Bundle`.
- `Generate SSH key for this match`.
- `Copy Owner Access Request`.
- Fallback: `Choose existing private key` + paste public key.
- `Tailscale ping host`.
- `Probe TCP`.
- `Verify SFTP`.
- `Create / connect Kopia repo`.
- Per saved target: `Copy access request`, `Ping`, `Verify SFTP`, `Connect repo`, `Edit`, `Delete`.
- `Add another backup target` clears the form without deleting saved targets.

Behavior:

- Importing invite fills connection name, match ID, host, SFTP user, port, path, quota.
- Generate per-match Ed25519 key with `ssh-keygen` under app data.
- Return only public key, fingerprint, and private key path/ref.
- `Owner Access Request` contains match ID, connection name, public key, fingerprint. No private key.
- Before SFTP verify, UI should explain host must authorize the access request.
- SFTP verify uses generated/imported private key path/ref.
- Kopia connect is enabled only after Recovery Key exists and SFTP fields are present.
- Save each target independently so multiple peers do not overwrite each other.

## Network Status

- On page open, run Tailscale detection automatically.
- Show CLI path, on-PATH state, running/login state, MagicDNS/IP, peer count, last checked.
- Offer refresh.
- Offer bounded Tailscale ping for a typed peer host.
- If not installed/not logged in, show concise cross-platform Tailscale guidance.

## Advanced / Legacy

- Explain Headscale/WireGuard/custom are future/advanced.
- Explain Syncthing is not default v1 transport and is hidden from normal setup.

## Tests

Run:

```bash
cd apps/client && npm run typecheck
cd apps/client && cargo test -p nasbb-core
cd apps/client/src-tauri && cargo test
```

Acceptance:

- Host can create a host space without owner public key.
- Host can create two host spaces and copy distinct invites.
- Host path overlap with source folders or another allocation is blocked.
- Owner can import host invite and generate/copy access request.
- Owner private key is never displayed or persisted as raw key material.
- Host can import access request and generate authorization plan.
- Owner can verify SFTP and connect Kopia after host authorization.
- Saved host spaces and backup targets have action buttons and do not overwrite each other.
