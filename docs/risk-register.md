# Risk Register

Risk ratings are initial planning estimates. Re-score after each phase.

| ID | Risk | Likelihood | Impact | Controls | Decision Gate |
| --- | --- | --- | --- | --- | --- |
| R1 | Syncthing propagates deletion or bad state | Medium | High | Use Kopia/restic snapshots; never sync live source folders to strangers | POC must prove point-in-time restore |
| R2 | Peer disappears | High | High | Alerts, grace periods, reputation, multi-peer in later phase | Alpha requires peer replacement runbook |
| R3 | Peer deletes encrypted repository | Medium | High | Backup pact, agent warnings, storage proofs later, multi-peer later | No paid marketplace until deletion recovery is tested |
| R4 | User loses encryption password | Medium | High | Key export checklist, repeated warnings, restore drill | Cannot mark user protected until key backup confirmed |
| R5 | Disk fills up | High | Medium | Quota enforcement, preflight checks, alerts | Agent MVP must detect low space |
| R6 | Residential bandwidth too slow | High | Medium | Match by upload speed, seed option, expected restore time estimate | Match score must include bandwidth |
| R7 | Ransomware corrupts source data | Medium | High | Snapshot retention, immutable-ish retention guidance, delayed prune | Restore drill must include previous snapshot |
| R8 | Peer inspects data | Medium | High | Client-side encryption, no plaintext sync, no password sharing | Security review before alpha |
| R9 | Metadata leaks | Medium | Medium | Minimize agent reports; disclose device IDs/IP handling | Privacy review before public beta |
| R10 | Abuse complaints | Medium | High | AUP, contact process, account suspension, legal review | Public launch blocked until policies exist |
| R11 | Paid marketplace fraud | Medium | High | Delay paid launch, identity checks, payout holds | Paid launch requires fraud controls |
| R12 | Platform becomes support-heavy | High | Medium | Homelab-only positioning, docs, diagnostics bundle | Beta requires support runbook |
| R13 | False sense of safety | Medium | High | Honest copy, health states, "not your only backup" warnings | Marketing review before launch |
| R14 | Tool incompatibility or breaking changes | Medium | Medium | Version pinning, compatibility matrix, agent update plan | Agent beta requires version policy |

## Highest Priority Controls

1. Use a real backup engine.
2. Make restore drills mandatory.
3. Do not launch paid storage until peer replacement and dispute flows exist.
4. Minimize metadata collected by the web app.
5. Treat one-peer backup as experimental, not durable.

