# Control And Audit Plan

## Purpose

This document defines the controls NAS Backup Buddy should use before it claims user backups are protected. It complements the implementation map by focusing on evidence, audit cadence, and operational accountability.

## Control Categories

| Category | Control Goal | Evidence |
| --- | --- | --- |
| Backup correctness | Backups are restorable point-in-time snapshots | Restore drill record, canary checksum, backup logs |
| Encryption | Peer stores encrypted data only | Setup review, peer-side inspection, tool configuration |
| Key safety | User can restore without platform-held secrets | User confirmation, restore drill, key backup checklist |
| Remote repository health | Encrypted repository is reachable on peer storage | SFTP/overlay probe, last successful backup, repository size |
| Peer reliability | Host is available enough to be useful | Uptime reports, stale peer alerts, incident notes |
| Quota safety | Host capacity is not overrun | Free space report, quota setting, disk-full test |
| Privacy | Platform collects only required metadata | Telemetry schema review, sample report audit |
| Abuse readiness | Complaints and unsafe users can be handled | AUP, contact path, admin action log |
| Marketplace readiness | Paid flows are controlled before launch | Legal review, payout policy, dispute runbook |

## Minimum Controls By Phase

| Phase | Required Controls |
| --- | --- |
| Manual POC | Restore drill, canary checksum, peer-side encryption inspection, source-folder safety check |
| Private alpha | Backup pact, restore drill before protected status, key backup confirmation, incident notes |
| Agent MVP | Telemetry allowlist, redacted logs, quota check, stale backup check, remote target reachability check |
| Web MVP | Admin pause/retire controls, health status model, privacy review, match audit trail |
| Reliability beta | Peer replacement test, multi-peer restore test, monthly restore audit |
| Paid marketplace | Legal review, AUP, DMCA/contact process where applicable, payout holds, dispute workflow |

## Audit Cadence

| Cadence | Audit |
| --- | --- |
| Every POC run | Restore result, canary checksum, failure notes |
| Weekly during private alpha | Match status, unresolved warnings, support issues |
| Monthly during alpha | Restore sample, telemetry sample, risk register update |
| Quarterly during beta | Disaster recovery exercise, peer replacement exercise, security review |
| Before public launch | Legal, privacy, security, backup correctness, and support readiness reviews |

## Protected Status Gate

A user or match can be marked `Protected` only when all checks pass:

| Check | Required Result |
| --- | --- |
| Backup snapshot exists | Pass |
| Remote encrypted repository reachable | Pass |
| Restore drill completed | Pass |
| Canary checksum matches | Pass |
| User has recovery password/key | Confirmed |
| Retention policy configured | Pass |
| Peer quota has buffer | Pass |
| No critical health alerts | Pass |

## Audit Evidence Template

Use this structure in issue notes, experiment logs, or later app records:

```text
Audit date:
Operator:
Match/user:
Tool versions:
Backup snapshot:
Repository size:
Restore destination:
Canary checksum expected:
Canary checksum observed:
Result:
Warnings:
Follow-up:
```

## Control Failure Matrix

| Failure | Severity | Required Action |
| --- | --- | --- |
| Restore fails | Critical | Mark unprotected, stop pruning, investigate repository and keys |
| Canary mismatch | Critical | Mark unprotected, preserve logs, test alternate snapshot |
| Password/key missing | Critical | Mark unprotected, require new protected setup |
| Peer offline more than 7 days | Critical | Start peer replacement process |
| Backup stale more than 72 hours | Critical | Alert user, investigate agent and source host |
| Remote repository unreachable more than 72 hours | Critical | Alert both users, inspect overlay, SFTP, quota, and host availability |
| Free quota below 5 percent | Critical | Pause growth, require capacity action |
| Telemetry contains sensitive data | Critical | Stop telemetry path, purge if possible, redesign schema |
| Abuse complaint received | High | Preserve account state, follow AUP/legal process |

## Open Control Questions

- What exact metadata can be reported without creating privacy risk?
- Should peers be required to use ZFS/Btrfs snapshots for hosted encrypted repositories?
- Should encrypted repository deletion require a two-step retirement flow?
- How often should a full restore be required versus canary-only restore?
- What evidence is enough to trust a host's offered capacity?
