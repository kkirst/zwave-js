#!/bin/bash
# Wrapper that handles stop-HA / run-script / restart-HA around the
# handover-suc.mjs driver-level script. Pass --execute to actually do
# the handover; default is dry-run.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:---dry-run}"
COMPOSE="/opt/home-assistant/docker-compose.yaml"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

step "1) stop HA's zwave-js-ui (releases USB)"
docker compose -f "$COMPOSE" stop zwave-js-ui
sleep 2

step "2) confirm USB stick is free"
fuser /dev/ttyUSB* 2>/dev/null && {
  echo "!!! USB still held by another process — aborting"
  docker compose -f "$COMPOSE" start zwave-js-ui
  exit 1
}
echo "  USB stick is free"

step "3) run handover-suc.mjs $MODE"
set +e
node handover-suc.mjs "$MODE"
SCRIPT_RC=$?
set -e
echo "  script exit code: $SCRIPT_RC"

step "4) restart HA's zwave-js-ui"
docker compose -f "$COMPOSE" start zwave-js-ui
sleep 4
docker compose -f "$COMPOSE" ps zwave-js-ui

step "done — exit $SCRIPT_RC"
exit "$SCRIPT_RC"
