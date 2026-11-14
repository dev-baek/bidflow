#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/inject-local-failure.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s"\n' "$log" >"$tmp/docker"
chmod +x "$tmp/docker"

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_FAILURE_TARGET=redis sh "$script" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 2 ]
[ ! -s "$log" ]

env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_FAILURE_TARGET=redis BIDFLOW_FAILURE_ACTION=stop sh "$script"
grep -F -- "compose --env-file .env.example -f infra/local/compose.yaml --profile search stop redis" "$log" >/dev/null

env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_FAILURE_TARGET=opensearch BIDFLOW_FAILURE_ACTION=start sh "$script"
grep -F -- "compose --env-file .env.example -f infra/local/compose.yaml --profile search start opensearch" "$log" >/dev/null
