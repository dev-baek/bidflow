#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/run-k6-bid-load.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

cat >"$tmp/docker" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >"$log"
EOF
chmod +x "$tmp/docker"

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_LOAD_SCENARIO=focused sh "$script" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 2 ]

env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_LOAD_SCENARIO=focused BIDFLOW_AUCTION_ID=auction-1 BIDFLOW_RUN_ID=proof sh "$script"
grep -F -- "-e BIDFLOW_LOAD_SCENARIO=focused" "$log" >/dev/null
grep -F -- "-e BIDFLOW_AUCTION_ID=auction-1" "$log" >/dev/null
grep -F -- "grafana/k6:0.54.0 run tests/load/bid-request.js" "$log" >/dev/null

env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_LOAD_SCENARIO=distributed BIDFLOW_AUCTION_IDS=auction-1,auction-2 sh "$script"
grep -F -- "-e BIDFLOW_LOAD_SCENARIO=distributed" "$log" >/dev/null
grep -F -- "-e BIDFLOW_AUCTION_IDS=auction-1,auction-2" "$log" >/dev/null
