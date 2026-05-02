# Host-Agent Runbook

## Start Local Host
```bash
cd apps/host-agent
cp compose/.env.example compose/.env
docker compose -f compose/docker-compose.yml up -d --build
docker compose -f compose/docker-compose.yml logs --tail=200 nasbb-agent
```

Paste the generated token into Host tab if `NASBB_API_TOKEN` was not preset.

## Enable Remote Peer Access
1. Install/login Tailscale on host.
2. Share the host machine with peer if they are in another Tailscale account.
3. In Host tab `Tailscale & Network`, choose the host `100.x` IP for both SFTP bind and advertised address.
4. Save and restart stack.
5. Generate a new invite from `Host -> Allocations`.

Expected `.env`:
```env
NASBB_SFTP_PORT=2222
NASBB_SFTP_BIND=100.x.y.z
NASBB_PEER_API_PORT=7422
TAILSCALE_ADDRESS=100.x.y.z
```

## Owner Onboarding
1. Host creates allocation.
2. Host generates invite JSON and sends to peer.
3. Peer imports invite, generates response, auto-submits or sends JSON back.
4. Host allocation becomes `READY`; otherwise import response manually in Allocations.
5. Peer verifies SFTP, creates/connects Kopia repo, runs backup.

## Diagnostics
```bash
docker compose -f compose/docker-compose.yml ps
docker compose -f compose/docker-compose.yml logs --tail=200 nasbb-agent
docker compose -f compose/docker-compose.yml logs --tail=200 nasbb-sftp
```

Common fixes:
- `local-only`: set `NASBB_SFTP_BIND` to Tailscale `100.x`.
- MagicDNS fails across accounts: use raw `100.x` IP.
- SFTP auth failed: host has not imported owner response, wrong key, or allocation not `READY`.
- Host key mismatch: stop; verify with host before proceeding.
