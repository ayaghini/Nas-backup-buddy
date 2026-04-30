# NAS Backup Buddy — Host Agent Runbook

## Prerequisites

- Docker Engine 24+
- Docker Compose v2 plugin (`docker compose`, not `docker-compose`)
- Ubuntu 22.04+ or Linux Mint 21+
- Tailscale installed and running on the host (for remote owner access)

## First Run

1. Copy the environment template:
   ```bash
   cd apps/host-agent
   cp compose/.env.example compose/.env
   ```

2. Optionally pre-set a token (otherwise one is generated and printed once):
   ```bash
   echo "NASBB_API_TOKEN=your-secret-token" >> compose/.env
   ```

3. Start the stack:
   ```bash
   docker compose -f compose/docker-compose.yml up -d
   ```

4. Retrieve the generated token (if you did not pre-set one):
   ```bash
   docker compose -f compose/docker-compose.yml logs nasbb-agent
   ```
   Look for the `NASBB AGENT TOKEN` banner.

## Configure Tailscale

Set `TAILSCALE_ADDRESS` in `compose/.env` to your host's shared Tailscale IPv4. This is the address written into owner invites and is the reliable choice for cross-account device sharing:
```
TAILSCALE_ADDRESS=100.64.0.1
```
Also set `NASBB_SFTP_BIND` to the same address so the SFTP port is reachable from owner machines:
```
NASBB_SFTP_BIND=100.64.0.1
```
Only use a MagicDNS hostname for `TAILSCALE_ADDRESS` after confirming that the owner device can resolve that exact name from their Tailscale account.
Restart the stack to apply:
```bash
docker compose -f compose/docker-compose.yml up -d
```

## Create an Allocation

1. POST to the API to create an allocation:
   ```bash
   curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"connectionName":"Alice","quotaBytes":53687091200}' \
     http://127.0.0.1:7420/api/v1/allocations
   ```

2. Generate an invite bundle and save it to a file:
   ```bash
   curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7420/api/v1/allocations/$ALLOC_ID/invite > invite.json
   ```

3. Send `invite.json` to the owner (email, secure message, etc.).

4. The owner imports the invite in their desktop client, which generates an owner-response file.

5. Import the owner response:
   ```bash
   curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d @owner-response.json \
     http://127.0.0.1:7420/api/v1/allocations/$ALLOC_ID/owner-response
   ```

6. Verify SFTP access is active:
   ```bash
   curl -sf -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7420/api/v1/health | jq '.allocations[] | {state, sftpAccessActive}'
   ```

## SFTP Bind Warning

If owners cannot connect, verify `NASBB_SFTP_BIND` is set to the Tailscale address and not `127.0.0.1`. The API health endpoint will show `sftpPublicExposureWarning: true` if the bind address is public and Tailscale is unconfigured.

## Quota Exceeded

1. Increase `quotaBytes` on the allocation:
   ```bash
   curl -sf -X PATCH -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"quotaBytes":107374182400}' \
     http://127.0.0.1:7420/api/v1/allocations/$ALLOC_ID
   ```

2. Resume the suspended allocation:
   ```bash
   curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7420/api/v1/allocations/$ALLOC_ID/resume
   ```

## SFTP Interruption Note

Avoid adding or modifying allocations during scheduled backup windows. Each allocation change triggers an SFTP config reload which takes up to 10 seconds and interrupts active transfers. Kopia's content-addressable format makes partial uploads safe; run `kopia snapshot gc` on the owner side if orphaned packs accumulate.

## Volume Safety

**Never run `docker volume rm nasbb-state`.** This deletes the SFTP host key. All existing owner machines will see an SSH host key mismatch on their next connection and will need to update their `~/.ssh/known_hosts`.

Named volumes and what they contain:

| Volume | Contents | Never delete if… |
|--------|----------|-----------------|
| `nasbb-config` | Config JSON, allocations, API token | You have active allocations |
| `nasbb-state` | SFTP host key, user authorized_keys | Owners have connected |
| `nasbb-repos` | Backup repository data | Any allocation is READY |
| `nasbb-logs` | Event log (JSONL) | Audit trail needed |

## Troubleshooting

**Lost token**: Check container logs — `docker compose -f compose/docker-compose.yml logs nasbb-agent`. The token is printed only on first start. If lost, set `NASBB_API_TOKEN` in `.env` and restart.

**SFTP not reachable**: Check `NASBB_SFTP_BIND` is the Tailscale address. Check `GET /api/v1/sftp/status` to see `running` and `bindAddress`.

**Health shows no allocations**: Verify the stack is running (`docker ps`) and volumes are mounted (`docker inspect nasbb-agent`).

**Container won't start after upgrade**: Check that named volumes still exist (`docker volume ls | grep nasbb`). If `nasbb-config` is missing, the token and allocations are gone — recreate from scratch.
