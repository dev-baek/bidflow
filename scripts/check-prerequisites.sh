#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
node_bin=${BIDFLOW_NODE_BIN:-node}
java_bin=${BIDFLOW_JAVA_BIN:-java}

major() {
  printf '%s' "$1" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

if ! command -v "$docker_bin" >/dev/null 2>&1; then
  printf '%s\n' "Docker를 찾을 수 없습니다. Docker Desktop을 설치하세요." >&2
  exit 1
fi
if ! "$docker_bin" info >/dev/null 2>&1; then
  printf '%s\n' "Docker daemon이 실행 중이 아닙니다. Docker Desktop을 시작하세요." >&2
  exit 1
fi
if ! "$docker_bin" compose version >/dev/null 2>&1; then
  printf '%s\n' "Docker Compose v2를 찾을 수 없습니다." >&2
  exit 1
fi
if ! command -v "$node_bin" >/dev/null 2>&1; then
  printf '%s\n' "Node.js 24가 필요합니다." >&2
  exit 1
fi
node_version=$("$node_bin" --version 2>/dev/null)
if [ "$(major "$node_version")" != "24" ]; then
  printf '%s\n' "Node.js 24가 필요합니다. 현재: $node_version" >&2
  exit 1
fi
if ! command -v "$java_bin" >/dev/null 2>&1; then
  printf '%s\n' "Java 21이 필요합니다." >&2
  exit 1
fi
java_version=$("$java_bin" -version 2>&1 | sed -n '1p')
if [ "$(major "$java_version")" != "21" ]; then
  printf '%s\n' "Java 21이 필요합니다. 현재: $java_version" >&2
  exit 1
fi
printf '%s\n' "로컬 개발 사전 조건을 충족했습니다."
