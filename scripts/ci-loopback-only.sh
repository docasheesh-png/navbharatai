#!/usr/bin/env bash
# Run a hosted CI check in a fresh network namespace. Do not fall back to the
# runner's network if setup fails. Only namespace setup runs with privileges.
set -euo pipefail
(( $# > 0 )) || { echo 'Missing CI command' >&2; exit 2; }

sudo -- unshare --net -- /bin/bash -euc '
  uid=$1 gid=$2 runner_path=$3 runner_home=$4 workspace=$5 runner_temp=$6
  shift 6
  /usr/sbin/ip link set lo up
  exec /usr/bin/setpriv --reuid="$uid" --regid="$gid" --init-groups \
    --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    -- /usr/bin/env PATH="$runner_path" HOME="$runner_home" CI=true GITHUB_ACTIONS=true \
      GITHUB_WORKSPACE="$workspace" RUNNER_TEMP="$runner_temp" "$@"
' ci-loopback "$(id -u)" "$(id -g)" "$PATH" "$HOME" "${GITHUB_WORKSPACE:-$PWD}" "${RUNNER_TEMP:-/tmp}" "$@"
