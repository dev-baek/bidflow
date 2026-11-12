#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/check-prerequisites.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fake() {
  name=$1
  body=$2
  printf '#!/bin/sh\n%s\n' "$body" >"$tmp/$name"
  chmod +x "$tmp/$name"
}

expect_failure() {
  expected=$1
  shift
  set +e
  output=$("$@" 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ]
  printf '%s' "$output" | grep -F "$expected" >/dev/null
}

expect_failure "Docker를 찾을 수 없습니다" \
  env BIDFLOW_DOCKER_BIN="$tmp/missing" sh "$script"

fake docker 'if [ "$1" = "info" ]; then exit 1; fi; exit 0'
expect_failure "Docker daemon이 실행 중이 아닙니다" \
  env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script"

fake docker 'if [ "$1" = "compose" ]; then exit 1; fi; exit 0'
expect_failure "Docker Compose v2를 찾을 수 없습니다" \
  env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script"

fake docker 'exit 0'
fake node 'printf "v20.19.4\n"'
fake java 'printf "openjdk version \"21.0.1\"\n" >&2'
expect_failure "Node.js 24가 필요합니다" \
  env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_NODE_BIN="$tmp/node" \
  BIDFLOW_JAVA_BIN="$tmp/java" sh "$script"

fake node 'printf "v24.1.0\n"'
fake java 'printf "openjdk version \"17.0.1\"\n" >&2'
expect_failure "Java 21이 필요합니다" \
  env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_NODE_BIN="$tmp/node" \
  BIDFLOW_JAVA_BIN="$tmp/java" sh "$script"

fake java 'printf "openjdk version \"21.0.1\"\n" >&2'
output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" BIDFLOW_NODE_BIN="$tmp/node" \
  BIDFLOW_JAVA_BIN="$tmp/java" sh "$script")
printf '%s' "$output" | grep -F "로컬 개발 사전 조건을 충족했습니다" >/dev/null
