# Proof Of Concept Runbook

## Objective

Prove that two separate machines can exchange encrypted offsite backups using Kopia direct-to-peer over SFTP on a private overlay network.

The key claim to prove is that the data owner can restore from a peer-hosted encrypted repository without keeping a full local encrypted repository copy.

## Recommended Tools

- Kopia for first test.
- Tailscale, Headscale, or WireGuard for private peer reachability.
- OpenSSH/SFTP on the storage host.
- A small sample dataset.
- A canary file with known content and checksum.

## Participants

- Owner: the user whose data is backed up.
- Host: the peer storing encrypted backup repository data.

For reciprocal testing, run the procedure twice with roles reversed.

## Preflight

Record:

- Owner OS and version.
- Host OS and version.
- Backup engine and version.
- Overlay network option and version.
- SFTP server and SSH version.
- Owner upload speed.
- Host upload speed.
- Host available free space.
- NAT/router notes.
- Whether relay/DERP or other overlay relay was used.

Confirm:

- The sample data is non-sensitive.
- The backup password is stored outside the test machine.
- The host SFTP account/path is isolated from the host's own data and from other matches.
- Host quota is configured or manually monitored for the test.
- The host understands they should not inspect, modify, or delete the encrypted repository.
- The source folder is not shared directly with the host.

## Procedure

1. Configure private overlay connectivity between owner and host.
2. Install Kopia on the owner machine.
3. Configure an isolated SFTP account/path on the host.
4. Create a sample source directory on the owner.
5. Add a canary file and record its checksum.
6. Create a Kopia SFTP repository on the host target.
7. Create the first snapshot.
8. Inspect the host target and confirm it does not expose plaintext file names or contents.
9. Delete or modify a sample source file.
10. Create another snapshot.
11. Run repository verification with `kopia snapshot verify`.
12. Restore from the peer-hosted repository to a clean local destination.
13. Verify the canary checksum.
14. Record local owner-side storage used by Kopia cache/temp files versus source data size.

## Required Evidence

- Overlay reachability check.
- SFTP target path/quota evidence.
- Backup command and result.
- Repository size on host.
- Repository verification command and result.
- Restore command and result.
- Canary checksum before and after restore.
- Time to initial backup.
- Time to restore.
- Owner-side extra local storage used during the run.

## Failure Tests

Run at least these:

- Source file deleted, previous version restored.
- Host goes offline during backup.
- Overlay disconnects during backup.
- Host disk approaches quota.
- Wrong password restore attempt fails.
- SFTP credentials revoked or rotated.

## Pass Criteria

- Host cannot read backup contents or plaintext file names.
- Owner can restore from the host-held repository.
- Deletion recovery works.
- Owner does not need a complete local encrypted repository copy.
- Failure behavior is documented.
- No live source folder was shared with the host.
