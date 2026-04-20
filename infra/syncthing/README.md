# Syncthing Infrastructure

Syncthing can run without platform-operated infrastructure by using the public discovery and relay network. For NAS Backup Buddy, platform-operated services may become useful when we need better reliability, privacy posture, or observability.

## Components

- `stdiscosrv`: private Syncthing discovery server.
- `strelaysrv`: private Syncthing relay server.

## Initial Recommendation

Do not operate private Syncthing infrastructure during the first manual proof of concept unless connectivity blocks testing.

Start with:

- Syncthing public discovery.
- Syncthing public relay fallback.
- Direct TCP/QUIC when peers can connect.

Add private infrastructure when:

- We need platform-level health visibility.
- Public relay performance is a bottleneck.
- Privacy policy requires reducing dependence on public discovery.
- We need a controlled onboarding experience.

## Controls To Add Before Production

- Rate limits.
- Abuse monitoring.
- Prometheus metrics.
- Log retention policy.
- Clear IP/device ID privacy disclosure.
- Separate relay capacity from website capacity.
- Runbooks for degraded relay and discovery outages.

