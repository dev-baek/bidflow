#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/check-kafka-consumer-lag.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

printf '#!/bin/sh\nprintf "%%s\\n" "$*" >"%s"\n' "$log" >"$tmp/docker"
chmod +x "$tmp/docker"

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 2 ]

env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_CONSUMER_GROUP=bid-settlement sh "$script"
grep -F -- "exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group bid-settlement" "$log" >/dev/null
