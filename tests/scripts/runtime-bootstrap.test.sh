#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -r -- "$scratch"' EXIT
template="$root/infra/terraform/modules/private_runtime/user-data.sh.tftpl"
image="123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
registry="123456789012.dkr.ecr.ap-northeast-1.amazonaws.com"

# Render the production template in an empty directory, without providers or state.
printf '%s\n' "base64encode(templatefile(\"$template\", {region=\"ap-northeast-1\", runtime_secret_arn=\"runtime-fixture\", database_secret_arn=\"rds-fixture\", database_host=\"db.example.test\", database_port=5432, image_registry=\"$registry\", application_image=\"$image\", verification_guard=\"\", managed_runtime_env_base64=\"\", enable_managed_redis=false, enable_managed_kafka=false, enable_managed_search=false, redis_secret_arn=null, redis_endpoint=null, opensearch_endpoint=null}))" |
  "${TERRAFORM_BIN:-terraform}" -chdir="$scratch" console -no-color |
  jq -er '@base64d' | sed "s|/etc/bidflow|$scratch/runtime|g" > "$scratch/user-data.sh"

aws() {
  case "$1:$2" in
    secretsmanager:get-secret-value)
      case "$6" in
        runtime-fixture) printf '%s' 'BIDFLOW_FIXTURE=yes' ;;
        rds-fixture) printf '%s' "$RDS_FIXTURE" ;;
        *) return 1 ;;
      esac
      ;;
    ecr:get-login-password) printf '%s\n' 'fake-ecr-token' ;;
    *) return 1 ;;
  esac
}

docker() {
  if [[ $1 == login ]]; then
    read -r token
    [[ $token == fake-ecr-token ]] || return 1
  fi
  printf '%s\n' "$*" >> "$DOCKER_TRACE"
}

export -f aws docker
export DOCKER_TRACE="$scratch/docker-trace"
RDS_FIXTURE='{"username":"fixture-user","password":"fixture-password"}' \
  bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1

grep -Fxq 'BIDFLOW_DATABASE_URL=jdbc:postgresql://db.example.test:5432/bidflow' "$scratch/runtime/runtime-complete.env" ||
  { printf '%s\n' 'JDBC URL must come from the RDS endpoint/port, not Secret fields.' >&2; exit 1; }
grep -Fxq 'BIDFLOW_FIXTURE=yes' "$scratch/runtime/runtime-complete.env"
grep -Fxq 'BIDFLOW_DATABASE_USER=fixture-user' "$scratch/runtime/runtime-complete.env"
grep -Fxq 'BIDFLOW_DATABASE_PASSWORD=fixture-password' "$scratch/runtime/runtime-complete.env"
grep -Fx "login --username AWS --password-stdin $registry" "$DOCKER_TRACE"
grep -Fx "pull $image" "$DOCKER_TRACE"
grep -q '^run ' "$DOCKER_TRACE"
if grep -Eq 'fake-ecr-token|fixture-password' "$scratch/boot-log"; then exit 1; fi

for invalid_secret in '{}' '{"username":null,"password":"never-log-me"}' '{"username":"fixture-user","password":""}' '{"username":"fixture-user","password":"never-log-me\nBAD=value"}' '{"password": "never-log-me",' '{"username":"u","password":"p"} {"username":"u","password":"p"}'; do
  export DOCKER_TRACE="$scratch/unexpected-docker-trace"
  if RDS_FIXTURE="$invalid_secret" bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1; then
    printf '%s\n' 'Invalid RDS Secret must stop boot.' >&2
    exit 1
  fi
  test ! -e "$DOCKER_TRACE"
  grep -Fxq 'Invalid RDS credentials in managed Secret.' "$scratch/boot-log"
  if grep -Eq 'never-log-me|fake-ecr-token' "$scratch/boot-log"; then exit 1; fi
done
