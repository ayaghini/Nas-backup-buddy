#!/usr/bin/env bash
# verify.sh — end-to-end verification of the NAS Backup Buddy host agent.
# Run from apps/host-agent/ after "make docker-up".
# Requires: docker, curl, jq, ssh-keygen, sftp.
set -euo pipefail

PASS=0; FAIL=0
BASE="http://127.0.0.1:7420/api/v1"
TOKEN="${NASBB_API_TOKEN:-compose-test-token}"
H="Authorization: Bearer $TOKEN"
SFTP_PORT="${NASBB_SFTP_PORT:-2222}"
TMPKEYS=$(mktemp -d)
trap 'rm -rf "$TMPKEYS"' EXIT

pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
check() { [ "$1" = "$2" ] && pass "$3" || fail "$3 (got '$1', want '$2')"; }

# ── Stack health ──────────────────────────────────────────────────────────────
docker ps --format "{{.Names}}" | grep -q "nasbb-agent" \
  && pass "Docker compose stack starts cleanly" || fail "nasbb-agent not running"
docker ps --format "{{.Names}}" | grep -q "nasbb-sftp" \
  && pass "SFTP container running" || fail "nasbb-sftp not running"

# ── Auth ──────────────────────────────────────────────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/info)
check "$CODE" "200" "GET /api/v1/info returns 200 without auth"

CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/status)
check "$CODE" "401" "GET /api/v1/status returns 401 without token"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$H" $BASE/status)
check "$CODE" "200" "GET /api/v1/status returns 200 with correct token"

# ── Config ────────────────────────────────────────────────────────────────────
LABEL=$(curl -sf -H "$H" $BASE/config | jq -r .hostLabel)
[ -n "$LABEL" ] && pass "GET /api/v1/config returns host configuration" \
  || fail "GET /api/v1/config"

LABEL2=$(curl -sf -X PATCH -H "$H" -H "Content-Type: application/json" \
  -d '{"hostLabel":"verify-test-host"}' $BASE/config | jq -r .hostLabel)
check "$LABEL2" "verify-test-host" "PATCH /api/v1/config updates host label"

# ── Allocations ───────────────────────────────────────────────────────────────
AID_A=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"VerifyA","quotaBytes":1073741824}' \
  $BASE/allocations | jq -r .allocId)
AID_B=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"VerifyB","quotaBytes":1073741824}' \
  $BASE/allocations | jq -r .allocId)
COUNT=$(curl -sf -H "$H" $BASE/allocations | jq '.allocations | length')
[ "$COUNT" -ge 2 ] && pass "Create two allocations" || fail "Create two allocations"

QM=$(curl -sf -H "$H" $BASE/allocations | \
  jq '[.allocations[].quotaMode] | unique | .[]' -r)
check "$QM" "soft" 'Quota mode is "soft" for all allocations'

# ── Invite ────────────────────────────────────────────────────────────────────
INVITE_A=$(curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/invite)
STATE_A=$(curl -sf -H "$H" $BASE/allocations/$AID_A | jq -r .state)
check "$STATE_A" "PENDING_KEY" "Generate invite for allocation A (DRAFT → PENDING_KEY)"

MATCH_A=$(echo "$INVITE_A" | jq -r .matchId)
USR_A=$(curl -sf -H "$H" $BASE/allocations/$AID_A | jq -r .username)

# ── Owner response ────────────────────────────────────────────────────────────
ssh-keygen -t ed25519 -f "$TMPKEYS/key-a" -N "" -q
ssh-keygen -t ed25519 -f "$TMPKEYS/key-b" -N "" -q
PUB_A=$(cat "$TMPKEYS/key-a.pub")

RESP_A=$(jq -n --arg m "$MATCH_A" --arg a "$AID_A" --arg k "$PUB_A" --arg u "$USR_A" \
  '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$m,allocId:$a,
    ownerDeviceLabel:"verify",ownerPublicKey:$k,requestedSftpUsername:$u,
    createdAt:"2026-04-28T00:00:00Z"}')
STATE_A=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d "$RESP_A" $BASE/allocations/$AID_A/owner-response | jq -r .state)
check "$STATE_A" "READY" "Import owner key for allocation A (PENDING_KEY → READY)"

# Give SFTP reload time to apply
sleep 7

# ── SFTP auth tests ───────────────────────────────────────────────────────────
sftp_auth() {
  local keyfile="$1" user="$2"
  echo "ls" | sftp -i "$keyfile" -P "$SFTP_PORT" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o BatchMode=yes -b /dev/stdin \
    "${user}@127.0.0.1" &>/dev/null
}

sftp_auth "$TMPKEYS/key-a" "$USR_A" \
  && pass "SFTP auth works for allocation A" || fail "SFTP auth works for allocation A"

USR_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .username)
! sftp_auth "$TMPKEYS/key-a" "$USR_B" \
  && pass "Allocation A key cannot authenticate as allocation B username" \
  || fail "Allocation A key cannot authenticate as allocation B username"

# ── Write test ────────────────────────────────────────────────────────────────
echo "put /dev/null /repository/verify-probe" | sftp \
  -i "$TMPKEYS/key-a" -P "$SFTP_PORT" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o BatchMode=yes -b /dev/stdin \
  "${USR_A}@127.0.0.1" &>/dev/null \
  && pass "Write test succeeds inside allocation A repository" \
  || fail "Write test succeeds inside allocation A repository"

# ── Suspend / resume ──────────────────────────────────────────────────────────
curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/suspend > /dev/null
sleep 7
! sftp_auth "$TMPKEYS/key-a" "$USR_A" \
  && pass "Suspend blocks SFTP access for allocation A" \
  || fail "Suspend blocks SFTP access for allocation A"

STATE_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .state)
check "$STATE_B" "DRAFT" "Allocation B unaffected by suspend of A"

curl -sf -X POST -H "$H" $BASE/allocations/$AID_A/resume > /dev/null
sleep 7
sftp_auth "$TMPKEYS/key-a" "$USR_A" \
  && pass "Resume restores SFTP access for allocation A" \
  || fail "Resume restores SFTP access for allocation A"

# ── Retire ────────────────────────────────────────────────────────────────────
curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"graceDays":0}' $BASE/allocations/$AID_A/retire > /dev/null
sleep 7
! sftp_auth "$TMPKEYS/key-a" "$USR_A" \
  && pass "Retire disables SFTP access for allocation A" \
  || fail "Retire disables SFTP access for allocation A"

docker exec nasbb-sftp test -d "/repos/$USR_A/repository" \
  && pass "Repository data preserved after retire" \
  || fail "Repository data preserved after retire"

STATE_B=$(curl -sf -H "$H" $BASE/allocations/$AID_B | jq -r .state)
check "$STATE_B" "DRAFT" "Allocation B unaffected by retire of A"

# ── Invite expiry ─────────────────────────────────────────────────────────────
AID_EXP=$(curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"connectionName":"ExpTest","quotaBytes":1073741824}' \
  $BASE/allocations | jq -r .allocId)
curl -sf -X POST -H "$H" $BASE/allocations/$AID_EXP/invite > /dev/null
docker exec nasbb-agent sh -c \
  "f=/config/allocations/${AID_EXP}.json; \
   tmp=\$(mktemp); \
   jq '.inviteExpiresAt=\"2020-01-01T00:00:00Z\"' \$f > \$tmp && mv \$tmp \$f"
MATCH_EXP=$(curl -sf -H "$H" $BASE/allocations/$AID_EXP | jq -r .matchId)
USR_EXP=$(curl -sf -H "$H" $BASE/allocations/$AID_EXP | jq -r .username)
ssh-keygen -t ed25519 -f "$TMPKEYS/key-exp" -N "" -q
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$H" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg m "$MATCH_EXP" --arg a "$AID_EXP" \
    --arg k "$(cat $TMPKEYS/key-exp.pub)" --arg u "$USR_EXP" \
    '{bundleVersion:1,kind:"nasbb.owner_access_response",matchId:$m,allocId:$a,
      ownerDeviceLabel:"t",ownerPublicKey:$k,requestedSftpUsername:$u,
      createdAt:"2026-04-28T00:00:00Z"}')" \
  $BASE/allocations/$AID_EXP/owner-response)
check "$CODE" "409" "Expired invite rejected with 409 INVITE_EXPIRED"

# ── Host key stability ────────────────────────────────────────────────────────
FP1=$(docker exec nasbb-sftp \
  ssh-keygen -lf /state/sftp-host-keys/ssh_host_ed25519_key.pub | awk '{print $2}')
docker compose -f compose/docker-compose.yml build nasbb-sftp --quiet
docker compose -f compose/docker-compose.yml up -d nasbb-sftp
sleep 5
FP2=$(docker exec nasbb-sftp \
  ssh-keygen -lf /state/sftp-host-keys/ssh_host_ed25519_key.pub | awk '{print $2}')
check "$FP1" "$FP2" "SFTP host key unchanged after container rebuild"

# ── Log cleanliness ───────────────────────────────────────────────────────────
LOG=$(docker exec nasbb-agent cat /logs/events.jsonl 2>/dev/null || true)
echo "$LOG" | grep -oE "AAAA[A-Za-z0-9+/]{10,}" \
  && fail "No public key material in event log" \
  || pass "No public key material in event log"
echo "$LOG" | grep -oE "Bearer [A-Fa-f0-9]{8,}" \
  && fail "No Bearer token in event log" \
  || pass "No Bearer token in event log"

# ── Health ────────────────────────────────────────────────────────────────────
HEALTHY=$(curl -sf -H "$H" $BASE/health | jq '.agentRunning and .storageRootAvailable')
check "$HEALTHY" "true" "Health endpoint reports status and capacity"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
