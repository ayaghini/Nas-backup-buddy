# ADR 0001: Use Backup Engine Plus Syncthing

## Status

Accepted.

## Context

The project idea started with fully encrypted backup using Syncthing between two users. Syncthing provides peer-to-peer sync, discovery, relay fallback, and untrusted encrypted device support. However, Syncthing is synchronization software, not a full backup system. Changes and deletions can propagate, which is dangerous for backup use cases.

## Decision

Use a real backup engine to create encrypted, versioned repositories, then use Syncthing to replicate those repositories to matched peers.

Initial preferred backup engine: Kopia.

Accepted alternatives: restic, BorgBackup for advanced users.

## Consequences

Positive:

- Better point-in-time restore.
- Better retention policy.
- Better ransomware/deletion recovery.
- Easier restore drills.
- Stronger product honesty.

Negative:

- More setup complexity.
- Agent will need to manage at least two tools.
- Documentation must explain the difference between sync and backup.

## Follow-Up

- Run POC with Kopia.
- Compare restic if Kopia causes friction.
- Document exact safe folder layout.

