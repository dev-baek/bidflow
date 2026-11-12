#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
expected=${BIDFLOW_EXPECTED_SERVICES:-postgres,kafka,redis}
attempts=${BIDFLOW_HEALTH_ATTEMPTS:-30}
interval=${BIDFLOW_HEALTH_INTERVAL_SECONDS:-2}

compose() {
  "$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml "$@"
}

remaining=$expected
attempt=1
while [ "$attempt" -le "$attempts" ]; do
  failed=""
  old_ifs=$IFS
  IFS=,
  for service in $expected; do
    line=$(compose ps --format '{{.Service}}|{{.State}}|{{.Health}}' "$service")
    if [ "$line" != "$service|running|healthy" ]; then
      failed="${failed}${failed:+,}$service"
    fi
  done
  IFS=$old_ifs
  if [ -z "$failed" ]; then
    printf '%s\n' "로컬 서비스 준비 완료: $expected"
    exit 0
  fi
  remaining=$failed
  attempt=$((attempt + 1))
  [ "$attempt" -gt "$attempts" ] || sleep "$interval"
done

printf '%s\n' "로컬 서비스 준비 실패: $remaining" >&2
printf '%s\n' \
  "로그 확인: docker compose --env-file .env.example -f infra/local/compose.yaml logs $remaining" >&2
exit 1
