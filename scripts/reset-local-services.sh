#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
project=bidflow-local

printf '%s\n' "제거 대상 Compose Project: $project"
printf '%s\n' \
  "${project}_postgres-data" \
  "${project}_kafka-data" \
  "${project}_redis-data" \
  "${project}_object-storage-data" \
  "${project}_opensearch-data"

if [ "${CONFIRM_BIDFLOW_RESET:-}" != "$project" ]; then
  printf '%s\n' \
    "삭제하려면 CONFIRM_BIDFLOW_RESET=bidflow-local make local-reset을 실행하세요." >&2
  exit 2
fi

"$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml \
  --profile search down --volumes --remove-orphans
