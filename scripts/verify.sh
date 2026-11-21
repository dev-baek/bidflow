#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

fail() { printf '%s\n' "$*" >&2; exit 1; }
run() {
  step=$1; shift
  printf '\n[%s]\n' "$step"
  if "$@"; then :; else
    code=$?
    printf '%s failed (exit %s)\n' "$step" "$code" >&2
    exit "$code"
  fi
}
tools() {
  for tool in node npm git make; do command -v "$tool" >/dev/null 2>&1 || fail "Required tool not found: $tool"; done
  java_bin=java
  if [ -n "${JAVA_HOME:-}" ]; then java_bin="$JAVA_HOME/bin/java"; fi
  java_version=$("$java_bin" -version 2>&1) || fail 'Java 21 is required. Set JAVA_HOME to a Java 21 installation.'
  java_major=$(printf '%s\n' "$java_version" | sed -n 's/.*version[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
  [ "$java_major" = 21 ] || fail 'Java 21 is required. Set JAVA_HOME to a Java 21 installation.'
  node_version=$(node --version) || fail 'Node.js 24 is required.'
  node_major=$(printf '%s\n' "$node_version" | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')
  [ "$node_major" = 24 ] || fail 'Node.js 24 is required. Select Node 24 in PATH, then run make setup.'
  npm --version >/dev/null
}
static_checks() {
  base=${BIDFLOW_VERIFY_BASE:-}
  if [ -n "$base" ]; then
    case "$base" in *[!0-9a-fA-F]*) fail 'BIDFLOW_VERIFY_BASE must be a full commit SHA.';; esac
    [ "${#base}" -eq 40 ] || fail 'BIDFLOW_VERIFY_BASE must be a full commit SHA.'
    if [ "$base" = 0000000000000000000000000000000000000000 ]; then
      run whitespace git show --format= --check HEAD --
    else
      run whitespace git diff --check "$base" HEAD --
    fi
  fi
  run whitespace git diff --check
  run staged-whitespace git diff --cached --check
  run module-dependencies ./backend/gradlew -p backend verifyModuleDependencies
}
backend() { run backend-unit ./backend/gradlew -p backend unitTest verifyModuleDependencies; }
web() { run web-unit npm --prefix apps/web run test:run; }
scripts() { run script-unit node --test tests/scripts/*.test.mjs; }
tests() { backend; web; scripts; }
build() {
  run backend-build ./backend/gradlew -p backend :runtime:bootJar
  run web-build npm --prefix apps/web run build
}

case "${1:-help}" in
  help)
    printf '%s\n' \
      'Java 21, Node 24, npm, Git and Make are required; run make setup once.' \
      'make setup                  npm ci + Gradle Wrapper check; no tool installer' \
      'make test                   backend unit -> Vitest -> Node script tests' \
      'make test-backend|test-web|test-scripts  individual unit suites' \
      'make build                  bootJar + TypeScript/Vite build; no deployment' \
      'make verify                 tools -> static -> test -> build (no Docker/AWS)' \
      'make verify-integration     full backend check; Docker + local services required' \
      'make local-up[-search]      start local services (Docker required)' \
      'make local-down             stop local services; retain volumes' \
      'make local-reset            explicit local volume reset' \
      'load-*/failure-*/consumer-lag  existing local load and recovery commands' ;;
  setup) tools; run web-setup npm --prefix apps/web ci; run gradle-wrapper ./backend/gradlew -p backend --version;;
  test-backend) tools; backend;;
  test-web) tools; web;;
  test-scripts) tools; scripts;;
  test) tools; tests;;
  build) tools; build;;
  verify) tools; static_checks; tests; build;;
  verify-integration)
    tools
    run docker docker info
    BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,object-storage sh scripts/check-local-health.sh
    run backend-full ./backend/gradlew -p backend check;;
  *) fail 'Unknown verification target. Run make help.';;
esac
