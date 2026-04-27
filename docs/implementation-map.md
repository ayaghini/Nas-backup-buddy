# Implementation Map

## Purpose

This document is the working roadmap for NAS Backup Buddy. It includes phases, required checks, audit controls, decision points, and matrices for choosing when to advance.

## North Star

Create a trustworthy homelab backup exchange where users can safely store encrypted offsite backups on each other's spare storage.

## Non-Negotiable Rules

- Never expose a user's live source folder directly to an untrusted peer.
- Never collect backup encryption passwords.
- Never mark a setup healthy until a restore drill succeeds.
- Never require the data owner to keep a full second encrypted repository copy unless they explicitly choose a mirror mode.
- Never launch paid storage before legal, abuse, payout, and dispute controls exist.
- Never imply this replaces a complete 3-2-1 backup strategy during early phases.

## Phase 0: Repository And Planning

Status: started.

Deliverables:

- Feasibility study.
- Architecture notes.
- Risk register.
- Implementation map.
- POC runbook.
- Restore drill runbook.
- Backup pact template.

Exit checks:

- Docs exist and are internally consistent.
- Main technical decision is recorded.
- MVP scope is clear.

Decision point:

| Question | Go | No-Go |
| --- | --- | --- |
| Is the project scope narrow enough for a POC? | Manual two-user encrypted backup exchange | Paid marketplace, custom protocol, or consumer app first |

## Phase 1: Manual Proof Of Concept

Goal: prove that two users can exchange encrypted offsite backups using existing tools.

Scope:

- Two machines on separate networks.
- Kopia encrypted repository on peer-hosted SFTP storage.
- Private overlay connectivity using Tailscale, Headscale, or WireGuard.
- Isolated host account/path with quota.
- One backup source folder with sample data.
- One canary restore file.
- One full restore drill.

Required setup details:

- Document operating systems.
- Document SFTP server and SSH version.
- Document overlay network option and version.
- Document backup engine version.
- Document NAT conditions.
- Document available upload/download speeds.
- Document remote repository URL shape and peer storage path.
- Document retention policy.
- Document restore password/key storage confirmation.

Checks:

- Backup creates a snapshot.
- Repository files are encrypted at rest on the peer.
- Peer cannot read filenames or contents.
- Owner can reach the peer SFTP target over the private overlay.
- Delete from source does not destroy restorable snapshot.
- Restore from peer-hosted repository succeeds.
- Disk-full behavior is understood.
- Lost-peer behavior is understood.

Audit evidence:

- Screenshot or log of successful backup.
- Screenshot or log of overlay and SFTP target reachability.
- Restore command and output.
- Checksum of restored canary file.
- Notes on time to backup and time to restore.

Exit criteria:

- At least three successful direct-to-peer backup cycles.
- At least one successful restore from peer-held data.
- At least one simulated deletion recovery.
- Known failure modes documented.

Decision matrix:

| Result | Decision |
| --- | --- |
| Restore succeeds, setup takes less than 2 hours, errors are understandable | Continue to Phase 2 |
| Restore succeeds but setup is confusing | Improve docs before Phase 2 |
| Restore fails or encryption setup is ambiguous | Stop and redesign |
| Remote backup works but restore from peer repository is not proven | Stay in Phase 1 |

## Phase 2: Private Alpha Matching

Goal: test the human workflow with a small trusted group.

Scope:

- 5 to 10 invited homelab users.
- Manual or spreadsheet-backed matching.
- Backup pact template.
- Health check questionnaire.
- Restore drill required for every match.
- No money changes hands.

User profile fields:

- Region or country.
- Time zone.
- Offered storage.
- Requested storage.
- Upload speed.
- Download speed.
- Monthly bandwidth cap.
- Expected uptime.
- NAS/server type.
- Filesystem if known.
- Power backup yes/no.
- Willingness to host multiple peers.

Controls:

- Invite-only users.
- Plain-language acceptable use terms.
- Each match accepts a backup pact.
- Restore drill must complete within 7 days.
- Users must confirm independent password/key backup.

Health statuses:

| Status | Meaning |
| --- | --- |
| Pending | Match exists but setup not complete |
| Transferring | Initial backup upload in progress |
| Protected | Backup, remote repository access, quota, and restore drill succeeded |
| Warning | Backup stale, remote target warning, quota low, or peer offline |
| Critical | Restore failed, peer missing, or repository unavailable |
| Retired | Match ended and retention/deletion flow completed |

Exit criteria:

- 80 percent of invited matches complete setup.
- 100 percent of protected matches pass restore drill.
- No unrecoverable data loss.
- Support questions are categorized.
- Top 10 setup problems are documented.

Decision matrix:

| Signal | Continue | Pause |
| --- | --- | --- |
| Users can complete setup from docs | Build agent prototype | Rewrite onboarding |
| Restore drills pass | Increase alpha size | Fix backup flow |
| Peer reliability acceptable | Add health automation | Add stricter matching |
| Users understand risk | Continue | Improve product language |

## Phase 3: Local Agent MVP

Goal: reduce setup errors and collect health metadata safely.

Scope:

- Docker-first agent.
- Linux/NAS first.
- Kopia first, restic optional.
- SFTP target setup for host mode.
- Private overlay setup for peer reachability.
- Local configuration file.
- Health report endpoint to web app or mock server.

Agent responsibilities:

- Validate backup source path.
- Validate remote repository target.
- Validate host storage path is isolated and quota-bound.
- Validate retention policy exists.
- Validate free space and quota.
- Run direct-to-peer backup command.
- Run repository verification command with `kopia snapshot verify`.
- Run canary restore.
- Redact logs.
- Emit health status.

Security controls:

- No backup passwords sent to server.
- No source file names sent to server.
- Report schema allowlist.
- Local-only secret storage.
- Explicit consent before telemetry.
- Diagnostic bundle redaction.

Agent health checks:

| Check | Warning | Critical |
| --- | --- | --- |
| Last backup age | More than 24 hours stale | More than 72 hours stale |
| Remote repository access | Warning from probe | Unreachable more than 72 hours |
| Free quota | Less than 15 percent | Less than 5 percent |
| Restore drill | Older than 30 days | Failed or never run |
| Peer online | Offline more than 24 hours | Offline more than 7 days |
| Repository verification | Warning from tool | Failed verification |

Exit criteria:

- Agent can set up a test repository from clean instructions.
- Agent detects at least five known bad configurations.
- Agent completes direct remote backup, repository verification, and restore drill.
- Telemetry review confirms no plaintext metadata leakage.

Decision matrix:

| Agent Result | Decision |
| --- | --- |
| Reduces setup time by 50 percent or more | Continue |
| Fails silently | Stop and harden |
| Collects sensitive metadata | Redesign telemetry |
| Works only for one environment | Keep alpha narrow |

## Phase 4: Web App MVP

Goal: replace manual matching with a small real coordination app.

MVP features:

- Account creation.
- Profile page.
- Offered/requested storage listings.
- Match suggestions.
- Backup pact acceptance.
- Health status dashboard.
- Incident notes.
- Admin moderation panel.

Match scoring inputs:

- Storage fit.
- Region.
- Upload speed.
- Bandwidth cap.
- Uptime expectation.
- Existing reputation.
- Reciprocal balance.
- User preference for barter or donate-only.

Match score matrix:

| Factor | Weight | Notes |
| --- | --- | --- |
| Storage fit | 25 | Offered capacity must exceed requested plus buffer |
| Upload speed | 20 | Slow upload affects backup and restore |
| Uptime | 20 | Backup target must be reachable |
| Region distance | 10 | Far enough for disaster separation, near enough for speed |
| Reputation | 15 | Starts manual in alpha |
| Reciprocal fairness | 10 | Prevents one-sided free riding |

Exit criteria:

- Users can create and accept a match without admin intervention.
- Admin can pause or retire a match.
- Health reports appear correctly.
- Restore drill state is visible.
- Privacy review completed.

Decision point:

| Question | Go | Hold |
| --- | --- | --- |
| Can users understand their backup state from the dashboard? | Private beta | Improve status model |
| Can admins handle incidents? | Private beta | Build moderation tools |
| Does telemetry stay minimal? | Private beta | Redesign data model |

## Phase 5: Reliability Layer

Goal: improve durability beyond a single reciprocal peer.

Options:

- One-to-two replication: each user backs up to two peers.
- Credit pool: users earn credits by hosting and spend credits across multiple peers.
- Managed overlay/relay guidance: platform improves connectivity.
- Multi-target policy: owner backs up to more than one peer-hosted repository.

Reliability controls:

- Peer replacement runbook.
- Backup evacuation workflow.
- Multi-peer health dashboard.
- Stale peer automatic warning.
- Grace period before peer deletes data.
- Monthly restore drill.
- Quarterly disaster recovery exercise.

Decision matrix:

| Model | Pros | Cons | Recommendation |
| --- | --- | --- | --- |
| Single reciprocal peer | Simple | Weak durability | Alpha only |
| Two matched peers | Better durability | More storage coordination | Best beta target |
| Erasure coding across peers | Efficient, resilient | More custom engineering | Later research |
| Central platform storage | Easier guarantees | Higher cost and liability | Avoid for now |

Exit criteria:

- Peer replacement tested.
- Two-peer restore tested.
- Relay/discovery needs quantified.
- Reliability metrics stable for 60 days.

## Phase 6: Paid Marketplace Review

Goal: decide whether to allow users to buy and sell storage.

Do not enter this phase until:

- Private beta restore success rate is high.
- Peer replacement is proven.
- Abuse process exists.
- Legal review is complete.
- Payment and payout provider is selected.
- Tax and reporting duties are understood.
- Terms, privacy policy, AUP, and DMCA/contact process exist where applicable.

Marketplace controls:

- Provider verification.
- Payout holds.
- Refund policy.
- Minimum uptime requirement.
- Capacity proof.
- Dispute workflow.
- Prohibited content policy.
- Repeat offender policy.
- Account suspension procedure.

Paid launch decision matrix:

| Area | Green | Yellow | Red |
| --- | --- | --- | --- |
| Restore reliability | Repeated successful restores | Some manual help needed | Restore failures unexplained |
| Legal readiness | Counsel-reviewed policies | Draft policies only | No legal review |
| Abuse handling | Documented and tested | Email-only process | No process |
| Payments | Payout holds and KYC as needed | Basic payments only | Direct informal payments |
| Support | Runbooks and diagnostics | Founder-only support | No support process |
| Provider reliability | Measured uptime | Self-reported uptime | Unknown |

Only launch paid marketplace if every row is green or explicitly accepted by a written decision record.

## Ongoing Audits

Monthly during alpha:

- Sample restore drill review.
- Health status accuracy review.
- Incident review.
- Privacy/telemetry sample review.
- Risk register update.

Quarterly during beta:

- Disaster recovery exercise.
- Peer replacement exercise.
- Security review.
- Abuse workflow tabletop.
- Cost and support review.

Before public launch:

- Legal review.
- Security review.
- Privacy impact review.
- Backup correctness review.
- Billing and tax review if paid.
- Public communication review.

## Key Metrics

| Metric | Target For Alpha | Target For Beta |
| --- | --- | --- |
| Setup completion | 80 percent | 90 percent |
| Restore drill success | 100 percent protected users | 99 percent protected users |
| Mean setup time | Under 2 hours | Under 30 minutes with agent |
| Stale backup rate | Under 20 percent | Under 5 percent |
| Peer offline more than 7 days | Under 20 percent | Under 5 percent |
| Critical incidents unresolved after 72 hours | 0 | 0 |

## Initial Backlog

1. Run manual POC with Kopia.
2. Run manual POC with restic if Kopia has friction.
3. Write comparison notes.
4. Create sample backup pact.
5. Recruit 5 alpha users.
6. Build static profile/match form.
7. Define agent health schema.
8. Prototype local agent checks.
9. Build minimal health dashboard.
10. Test peer replacement.
