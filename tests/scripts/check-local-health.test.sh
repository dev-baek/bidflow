#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/check-local-health.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf '%s\n' '#!/bin/sh' \
  'service=${9}' \
  'case "${FAKE_UNHEALTHY:-}:$service" in' \
  '  redis:redis) printf "redis|exited|unhealthy\n" ;;' \
  '  opensearch:opensearch) exit 0 ;;' \
  '  *) printf "%s|running|healthy\n" "$service" ;;' \
  'esac' >"$tmp/docker"
chmod +x "$tmp/docker"

env BIDFLOW_DOCKER_BIN="$tmp/docker" \
  BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis \
  BIDFLOW_HEALTH_ATTEMPTS=1 BIDFLOW_HEALTH_INTERVAL_SECONDS=0 sh "$script"

set +e
output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" FAKE_UNHEALTHY=redis \
  BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis \
  BIDFLOW_HEALTH_ATTEMPTS=1 BIDFLOW_HEALTH_INTERVAL_SECONDS=0 sh "$script" 2>&1)
status=$?
set -e
[ "$status" -eq 1 ]
printf '%s' "$output" | grep -F "로컬 서비스 준비 실패: redis" >/dev/null
printf '%s' "$output" | grep -F "logs redis" >/dev/null

env BIDFLOW_DOCKER_BIN="$tmp/docker" \
  BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,opensearch \
  BIDFLOW_HEALTH_ATTEMPTS=1 BIDFLOW_HEALTH_INTERVAL_SECONDS=0 sh "$script"

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" FAKE_UNHEALTHY=opensearch \
  BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,opensearch \
  BIDFLOW_HEALTH_ATTEMPTS=1 BIDFLOW_HEALTH_INTERVAL_SECONDS=0 sh "$script"
status=$?
set -e
[ "$status" -eq 1 ]
