#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/reset-local-services.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s"\n' "$log" >"$tmp/docker"
chmod +x "$tmp/docker"

set +e
output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script" 2>&1)
status=$?
set -e
[ "$status" -eq 2 ]
printf '%s' "$output" | grep -F "bidflow-local_postgres-data" >/dev/null
[ ! -s "$log" ]

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" CONFIRM_BIDFLOW_RESET=wrong sh "$script"
status=$?
set -e
[ "$status" -eq 2 ]
[ ! -s "$log" ]

env BIDFLOW_DOCKER_BIN="$tmp/docker" CONFIRM_BIDFLOW_RESET=bidflow-local sh "$script"
grep -F "down --volumes --remove-orphans" "$log" >/dev/null
[ "$(wc -l <"$log" | tr -d ' ')" -eq 1 ]
