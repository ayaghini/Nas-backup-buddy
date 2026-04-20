# Restore Drill Runbook

## Objective

Verify that a user can restore from their encrypted offsite backup before they need it in an emergency.

## Frequency

- Alpha: once per match before marking protected.
- Beta: monthly automated canary restore, quarterly manual restore.
- Paid marketplace: monthly restore required for protected status.

## Inputs

- Backup repository location.
- Backup password or key material.
- Restore destination.
- Canary file path.
- Expected canary checksum.
- Snapshot identifier or restore date.

## Procedure

1. Stop writing to the restore destination if it already exists.
2. Select the snapshot to restore.
3. Restore to a clean destination folder.
4. Verify the canary file exists.
5. Verify checksum.
6. Spot-check at least three restored files.
7. Record restore duration.
8. Delete restore output if it contains sensitive data.

## Pass Criteria

- Restore command succeeds.
- Canary checksum matches.
- Expected files are present.
- Restore time is recorded.
- User confirms password/key material was available without platform help.

## Failure Handling

| Failure | Action |
| --- | --- |
| Password missing | Mark critical; user is not protected |
| Repository missing | Mark critical; investigate peer and sync |
| Checksum mismatch | Mark critical; preserve logs; stop pruning |
| Restore too slow | Mark warning; review match bandwidth |
| Snapshot too old | Mark warning or critical depending on policy |

## Audit Record

Record:

- Date and time.
- Snapshot restored.
- Result.
- Duration.
- Checksum result.
- Tool version.
- Operator notes.

