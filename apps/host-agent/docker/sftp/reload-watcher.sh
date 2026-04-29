#!/bin/sh
STATE_DIR="${1:-/state}"
TRIGGER="$STATE_DIR/reload-trigger"
while true; do
  if [ -f "$TRIGGER" ]; then
    rm -f "$TRIGGER"
    /entrypoint.sh --reload-only 2>&1 | sed 's/^/[reload] /'
    kill -HUP "$(cat /var/run/sshd.pid 2>/dev/null || echo 0)" 2>/dev/null || true
  fi
  sleep 5
done
