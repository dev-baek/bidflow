#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
target=${BIDFLOW_FAILURE_TARGET:-}
action=${BIDFLOW_FAILURE_ACTION:-}

case "$target" in redis|opensearch) ;; *) printf '%s\n' 'BIDFLOW_FAILURE_TARGET must be redis or opensearch' >&2; exit 2 ;; esac
case "$action" in stop|start) ;; *) printf '%s\n' 'BIDFLOW_FAILURE_ACTION must be stop or start' >&2; exit 2 ;; esac

compose() {
  "$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml --profile search "$@"
}

if [ "$action" = stop ]; then
  printf '%s\n' "BidFlow 로컬 $target 중단: 다른 Compose Project에는 영향을 주지 않습니다."
  compose stop "$target"
  exit 0
fi

printf '%s\n' "BidFlow 로컬 $target 재시작: 기존 volume과 데이터는 유지합니다."
compose start "$target"
