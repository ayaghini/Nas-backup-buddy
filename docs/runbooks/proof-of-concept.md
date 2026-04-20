# Proof Of Concept Runbook

## Objective

Prove that two separate machines can exchange encrypted offsite backups using a real backup engine and Syncthing.

## Recommended Tools

- Kopia for first test.
- Syncthing for peer replication.
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
- Syncthing version.
- Owner upload speed.
- Host upload speed.
- Host available free space.
- NAT/router notes.
- Whether public relay was used.

Confirm:

- The sample data is non-sensitive.
- The backup password is stored outside the test machine.
- The host understands they should not modify the encrypted repository.
- The source folder is not shared directly with Syncthing.

## Procedure

1. Install Syncthing on both machines.
2. Install Kopia on the owner machine.
3. Create a sample source directory.
4. Add a canary file.
5. Create an encrypted Kopia repository in a local repository directory.
6. Create the first snapshot.
7. Configure Syncthing to share only the encrypted repository directory to the host.
8. Let Syncthing complete initial sync.
9. Inspect the host copy and confirm it does not expose plaintext file names or contents.
10. Delete or modify a sample source file.
11. Create another snapshot.
12. Sync again.
13. Restore from the repository copy.
14. Verify the canary checksum.

## Required Evidence

- Backup command and result.
- Sync completion state.
- Repository size.
- Restore command and result.
- Canary checksum before and after restore.
- Time to initial backup.
- Time to initial sync.
- Time to restore.

## Failure Tests

Run at least these:

- Source file deleted, previous version restored.
- Host goes offline during sync.
- Host disk approaches quota.
- Owner loses local repository but has host copy.
- Wrong password restore attempt fails.

## Pass Criteria

- Host cannot read backup contents.
- Owner can restore from host-held repository copy.
- Deletion recovery works.
- Failure behavior is documented.
- No live source folder was shared with the host.

