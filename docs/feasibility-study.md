# Feasibility Study

## Executive Summary

NAS Backup Buddy is viable as a homelab-focused encrypted offsite backup exchange, but it should not begin as a paid cloud-backup replacement.

The recommended first product is:

> Encrypted reciprocal offsite backup matching for homelab users, with health monitoring and restore testing.

The most important technical finding is that Syncthing should not be the backup engine or the default v1 transport. Syncthing is a strong peer-to-peer transfer and synchronization layer, but its own documentation warns that it is not a great backup application because modifications and deletions propagate to peers. It also requires the data owner to keep a local encrypted repository copy before replication. Use Kopia first to create encrypted, versioned snapshots directly on peer-hosted SFTP storage over a private overlay network.

## Feasibility Rating

| Area | Rating | Notes |
| --- | --- | --- |
| Technical feasibility | High | Existing open source tools cover backup, encryption, sync, discovery, and relay. |
| MVP complexity | Medium | Manual setup is straightforward for homelab users; automation needs care. |
| Reliability challenge | High | Residential peers disappear, disks fail, bandwidth varies, and restores can be slow. |
| Legal/compliance challenge | Medium to High | Increases sharply if paid storage, public marketplace, or international users are added. |
| Commercial viability | Medium | Must compete with cheap cloud storage through control, privacy, community, and convenience. |
| Best first audience | High fit | Homelab, NAS, Unraid, TrueNAS, Proxmox, self-hosted users. |
| General consumer fit | Low | Support burden and expectations are too high for v1. |

## Core Assumptions

- Users own or operate always-on storage.
- Users understand that this is one layer in a 3-2-1 backup strategy.
- User data is encrypted before leaving the owner's machine.
- The platform does not hold backup encryption passwords.
- The platform coordinates matches and monitors health, but does not store backup payloads.
- Early users can tolerate setup friction if the documentation is clear.

## Recommended Architecture

Use a layered model:

1. Backup engine encrypts snapshots on the data-owner device.
2. Kopia writes the encrypted repository directly to peer-hosted SFTP storage.
3. A private overlay network, such as Tailscale, Headscale, or WireGuard, handles peer reachability.
4. Website coordinates profiles, matching, pacts, reputation, and alerts.
5. Agent automates setup and health reporting after the manual process is proven.

## Why Not Raw Syncthing As Backup

Syncthing synchronizes state. If a file is modified or deleted, that change can be propagated. Versioning can reduce risk, but it is not the same as a backup system with retention policy, snapshots, verification, and restore workflows.

Raw Syncthing can be useful for:

- Transport.
- Peer discovery.
- Encrypted replication to an untrusted device.
- Moving encrypted repository files created by a backup tool.
- Optional mirror mode for users who can afford the extra local repository storage.

Raw Syncthing should not be used as the only protection against:

- Accidental deletion.
- Ransomware.
- Silent corruption.
- Bad retention.
- Operator mistakes.
- Need for point-in-time restore.

## Backup Engine Options

| Tool | Strengths | Weaknesses | Fit |
| --- | --- | --- | --- |
| Kopia | Encrypted by default, snapshots, policies, dedupe, GUI and CLI, mount/restore options | More moving parts than restic | Best first candidate |
| restic | Simple, mature, encrypted, dedupe, broad backend support | CLI-first; retention needs careful setup | Strong MVP candidate |
| BorgBackup | Excellent compression/dedupe, authenticated encryption, strong Unix ecosystem | Less Windows-friendly, often SSH-centric | Great for advanced Linux users |
| Syncthing only | Easy sync and peer connectivity | Not a real backup engine; can require extra local repository storage | Optional transport/mirror only |

## Existing Adjacent Models

| Project | Lesson |
| --- | --- |
| Sia | Real decentralized storage markets need incentives, host scoring, contracts, proofs, and redundancy. |
| Storj | Central coordination still matters for metadata, reputation, repair, billing, and abuse handling. |
| Tahoe-LAFS | Capability-based encrypted distributed storage is relevant, but productizing it for homelab users is non-trivial. |

## Cost Benchmark

Cloud storage is cheap enough that price alone is a weak differentiator.

Examples observed during research:

- Backblaze B2: about USD 6/TB/month, with egress allowance.
- Wasabi: starts around USD 6.99/TB/month.
- Storj Archive: about USD 6/TB/month with egress details depending on tier.
- rsync.net: about USD 12/TB/month for smaller accounts, lower at larger volume.

NAS Backup Buddy must win on:

- Use of spare existing storage.
- Community reciprocity.
- Self-hosted control.
- Privacy posture.
- Ease of setting up encrypted offsite backup.
- Better transparency for homelab users than generic object storage.

## Main Risks

- A peer goes offline or leaves.
- A peer deletes the encrypted repository.
- A peer's disk fails.
- A peer silently runs out of space.
- Residential bandwidth makes backup or restore too slow.
- User loses encryption password.
- Bad configuration syncs live data instead of encrypted backups.
- One peer is not enough redundancy.
- Abuse reports arrive even though payloads are encrypted.
- Paid marketplace introduces disputes, fraud, payouts, taxes, and policy obligations.

## Recommended Go-To-Market

Start with an invite-only barter network:

- Users list offered storage and requested storage.
- Users are matched manually or semi-automatically.
- Each pair signs a plain-language backup pact.
- No cash changes hands in the first version.
- A restore drill is mandatory before the pair is marked healthy.

Avoid public paid marketplace features until the project proves:

- Restore works.
- Health checks are reliable.
- Peers can be replaced safely.
- Quotas are enforceable.
- Abuse and legal processes exist.

## Conclusion

Proceed with the project, but keep the first version narrow. The valuable product is not "Syncthing for strangers." The valuable product is the coordination and safety layer that makes encrypted reciprocal backup understandable, testable, and trustworthy for homelab users.
