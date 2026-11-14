#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
scenario=${BIDFLOW_LOAD_SCENARIO:-focused}
base_url=${BIDFLOW_BASE_URL:-http://host.docker.internal:8080}

case "$scenario" in focused|distributed) ;; *) printf '%s\n' 'BIDFLOW_LOAD_SCENARIO must be focused or distributed' >&2; exit 2 ;; esac
if [ "$scenario" = focused ] && [ -z "${BIDFLOW_AUCTION_ID:-}" ]; then printf '%s\n' 'BIDFLOW_AUCTION_ID is required for focused scenario' >&2; exit 2; fi
if [ "$scenario" = distributed ] && [ -z "${BIDFLOW_AUCTION_IDS:-}" ]; then printf '%s\n' 'BIDFLOW_AUCTION_IDS is required for distributed scenario' >&2; exit 2; fi

mkdir -p "$root/reports/k6"
exec "$docker_bin" run --rm -i \
  -e "BIDFLOW_BASE_URL=$base_url" \
  -e "BIDFLOW_LOAD_SCENARIO=$scenario" \
  -e "BIDFLOW_AUCTION_ID=${BIDFLOW_AUCTION_ID:-}" \
  -e "BIDFLOW_AUCTION_IDS=${BIDFLOW_AUCTION_IDS:-}" \
  -e "BIDFLOW_BID_AMOUNT=${BIDFLOW_BID_AMOUNT:-20000}" \
  -e "BIDFLOW_RUN_ID=${BIDFLOW_RUN_ID:-local}" \
  -v "$root:/work" -w /work grafana/k6:0.54.0 run tests/load/bid-request.js
