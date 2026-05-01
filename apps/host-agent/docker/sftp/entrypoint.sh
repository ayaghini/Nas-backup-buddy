#!/bin/bash
set -euo pipefail

STATE_DIR="${STATE_DIR:-/state}"
REPOS_DIR="${REPOS_DIR:-/repos}"

mkdir -p "$STATE_DIR/sftp-host-keys"
if [ ! -f "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key" ]; then
  ssh-keygen -t ed25519 -f "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key" -N "" -q
  echo "[nasbb-sftp] Ed25519 host key generated."
fi
chmod 600 "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key"
chmod 644 "$STATE_DIR/sftp-host-keys/ssh_host_ed25519_key.pub"

# RSA fallback key — needed for libssh2 < 1.9.0 which lacks Ed25519 support.
if [ ! -f "$STATE_DIR/sftp-host-keys/ssh_host_rsa_key" ]; then
  ssh-keygen -t rsa -b 4096 -f "$STATE_DIR/sftp-host-keys/ssh_host_rsa_key" -N "" -q
  echo "[nasbb-sftp] RSA host key generated."
fi
chmod 600 "$STATE_DIR/sftp-host-keys/ssh_host_rsa_key"
chmod 644 "$STATE_DIR/sftp-host-keys/ssh_host_rsa_key.pub"

setup_users() {
  for user_dir in "$STATE_DIR/users"/*/; do
    [ -d "$user_dir" ] || continue
    USER_JSON="$user_dir/user.json"
    [ -f "$USER_JSON" ] || continue

    USERNAME=$(jq -r '.username // empty' "$USER_JSON")
    [ -n "$USERNAME" ] || continue

    if ! id "$USERNAME" &>/dev/null; then
      adduser -D -H -G nasbb -s /sbin/nologin "$USERNAME"
    fi
    # Alpine's adduser -D sets shadow password to '!' (locked).
    # OpenSSH refuses pubkey auth for locked accounts even without PAM.
    # Set to '*' (disabled login, not locked) so pubkey auth works.
    usermod -p '*' "$USERNAME"

    mkdir -p "$REPOS_DIR/$USERNAME"
    chown root:root "$REPOS_DIR/$USERNAME"
    chmod 755 "$REPOS_DIR/$USERNAME"

    mkdir -p "$REPOS_DIR/$USERNAME/repository"
    chown "$USERNAME:nasbb" "$REPOS_DIR/$USERNAME/repository"
    chmod 700 "$REPOS_DIR/$USERNAME/repository"

    AUTH_KEYS="$user_dir/authorized_keys"
    [ -f "$AUTH_KEYS" ] || touch "$AUTH_KEYS"
    chown "$USERNAME" "$AUTH_KEYS"
    chmod 600 "$AUTH_KEYS"
  done
}

setup_users

if [ "${1:-}" = "--reload-only" ]; then
  exit 0
fi

/reload-watcher.sh "$STATE_DIR" &
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
