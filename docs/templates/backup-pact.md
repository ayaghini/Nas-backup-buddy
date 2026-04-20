# Backup Pact Template

This template is for private alpha testing. It is not a legal contract.

## Participants

- Data owner:
- Storage host:
- Start date:
- Review date:

## Storage Terms

- Storage offered:
- Storage requested:
- Quota buffer:
- Expected minimum uptime:
- Expected monthly bandwidth:
- Region:
- Retention period if match ends:

## Security Agreement

- The data owner will encrypt backups before they leave their machine.
- The storage host will receive only encrypted repository data.
- The data owner will not share backup passwords with the storage host or platform.
- The data owner is responsible for saving recovery keys/passwords.
- The storage host agrees not to inspect, modify, or delete repository data except through the agreed retirement process.

## Operational Agreement

- Initial backup target date:
- First restore drill target date:
- Restore drill frequency:
- Alert contact method:
- Grace period before deleting data after match retirement:

## Exit Process

1. Either participant may request match retirement.
2. Data owner confirms whether they need time to migrate data.
3. Storage host keeps encrypted data for the agreed grace period.
4. Data owner confirms migration or expiration.
5. Storage host deletes encrypted repository data.
6. Both participants mark the pact retired.

## Acknowledgements

- This is an experimental homelab backup exchange.
- This should not be the user's only backup.
- Restore testing is required.
- Lost passwords cannot be recovered by the platform.

