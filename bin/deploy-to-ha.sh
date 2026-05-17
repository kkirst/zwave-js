#!/bin/bash
# Build the zwave-js fork and re-deploy to HA's zwave-js-ui container.
#
# Mirrors deploy-to-pi.sh in shape, but the deployment mechanism is
# different: HA runs zwave-js-ui as a Docker container with bundled
# zwave-js node_modules. The docker-compose.override.yaml in
# /opt/home-assistant bind-mounts our fork's build/ over the container's
# vendored copy, so we just need to (a) build, (b) make sure the override
# is in place, (c) restart the container to pick up updated files.
#
# Why "force-recreate" instead of "restart" the first time:
# - On first run, the container may not have the bind-mounts yet.
# - Subsequent runs use plain "restart" since the mounts are already there.
#
# Safety notes:
# - HA's Z-Wave goes down for the restart window (~30-60s). Plan accordingly.
# - The override file is what enables our fork on HA. To roll back: rename
#   /opt/home-assistant/docker-compose.override.yaml + recreate the container.

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="/opt/home-assistant/docker-compose.yaml"
OVERRIDE="/opt/home-assistant/docker-compose.override.yaml"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

step "build"
yarn build

step "verify all package build/ dirs exist (the bind-mounts depend on them)"
PACKAGES=(zwave-js core cc serial host shared nvmedit)
for pkg in "${PACKAGES[@]}"; do
  if [ ! -d "packages/$pkg/build" ]; then
    echo "  !!! missing packages/$pkg/build — aborting"
    exit 1
  fi
done
echo "  all $((${#PACKAGES[@]})) build dirs present"

step "verify docker-compose.override.yaml is in place"
if [ ! -f "$OVERRIDE" ]; then
  echo "  !!! $OVERRIDE missing — refusing to deploy without the bind-mounts"
  echo "  (see deploy-to-ha.sh header for what should be there)"
  exit 1
fi
echo "  override file present"

step "current container config — do the bind-mounts already exist?"
EXISTING_MOUNTS=$(docker inspect zwave-js-ui --format '{{range .Mounts}}{{.Source}}->{{.Destination}}{{println}}{{end}}' 2>/dev/null | grep zwave-js-dev || true)
if [ -z "$EXISTING_MOUNTS" ]; then
  echo "  no fork bind-mounts detected — will force-recreate container"
  RECREATE=1
else
  echo "  fork bind-mounts already present:"
  echo "$EXISTING_MOUNTS" | sed 's/^/    /'
  RECREATE=0
fi

step "apply (restart vs force-recreate)"
if [ "$RECREATE" = 1 ]; then
  docker compose -f "$COMPOSE" up -d --force-recreate zwave-js-ui
else
  docker compose -f "$COMPOSE" restart zwave-js-ui
fi
sleep 4

step "verify container is up + mounts in place"
docker compose -f "$COMPOSE" ps zwave-js-ui
docker inspect zwave-js-ui --format '{{range .Mounts}}{{.Source}} → {{.Destination}}{{println}}{{end}}' | grep zwave-js-dev | sed 's/^/  /'

step "tail the first few lines of HA's zwave-js-ui log"
docker logs zwave-js-ui --tail 10

step "done"
