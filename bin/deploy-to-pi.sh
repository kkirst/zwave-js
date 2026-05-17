#!/bin/bash
# Build the zwave-js fork and deploy the relevant package build outputs to the
# Pi (matter-hub), then restart zwave-js-server.service. Designed for fast
# iteration: turbo's incremental build only rebuilds what changed.
set -euo pipefail
cd "$(dirname "$0")/.."

PI=matter-hub
REMOTE_NM=/opt/zwave-js-server/node_modules

# Subset of workspace packages that the Pi actually installs (i.e. ones
# zwave-js-server depends on transitively). Confirmed via:
#   cat /opt/zwave-js-server/package.json + walking the actual node_modules tree.
PACKAGES=(
  zwave-js
  @zwave-js/core
  @zwave-js/cc
  @zwave-js/serial
  @zwave-js/host
  @zwave-js/shared
  @zwave-js/nvmedit
)

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

step "build"
yarn build

step "rsync each package's build/ to the Pi"
for pkg in "${PACKAGES[@]}"; do
  # Map @scope/name → packages/name; for unscoped → packages/<name>
  local_dir="packages/${pkg##*/}/build/"
  remote_dir="$REMOTE_NM/$pkg/build/"
  if [ ! -d "$local_dir" ]; then
    echo "  ⚠ no local build dir for $pkg (looking at $local_dir) — skipping"
    continue
  fi
  printf '  %-22s → %s\n' "$pkg" "$remote_dir"
  rsync -a --delete "$local_dir" "$PI:$remote_dir"
done

step "restart zwave-js-server on the Pi"
ssh "$PI" 'systemctl restart zwave-js-server && sleep 4 && systemctl is-active zwave-js-server'

step "tail the first few lines of the service log"
ssh "$PI" 'journalctl -u zwave-js-server -n 8 --no-pager'

step "done"
