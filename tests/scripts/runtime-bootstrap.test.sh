#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -r -- "$scratch"' EXIT
template="$root/infra/terraform/modules/private_runtime/user-data.sh.tftpl"
image="123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
registry="123456789012.dkr.ecr.ap-northeast-1.amazonaws.com"

# Render the production template in an empty directory, without providers or state.
render() {
  printf '%s\n' "base64encode(templatefile(\"$template\", {region=\"ap-northeast-1\", runtime_secret_arn=\"runtime-fixture\", database_secret_arn=\"rds-fixture\", database_host=\"db.example.test\", database_port=5432, image_registry=\"$registry\", application_image=\"$image\", verification_guard=file(\"$root/infra/terraform/modules/private_runtime/verification-runtime-guard.sh\"), managed_runtime_env_base64=\"\", enable_managed_redis=$1, enable_managed_kafka=false, enable_managed_search=false, redis_secret_arn=\"redis-fixture\", redis_endpoint=\"redis.example.cache.amazonaws.com\", cloudwatch_log_group=${2:-null}}))" |
    "${TERRAFORM_BIN:-terraform}" -chdir="$scratch" console -no-color |
    jq -er '@base64d' | sed "s|/etc/bidflow|$scratch/runtime|g" > "$scratch/user-data.sh"
}
render false

aws() {
  case "$1:$2" in
    secretsmanager:get-secret-value)
      case "$6" in
        runtime-fixture) printf '%s' "${RUNTIME_FIXTURE:-BIDFLOW_FIXTURE=yes}" ;;
        rds-fixture) printf '%s' "$RDS_FIXTURE" ;;
        redis-fixture)
          [[ $7 == --version-stage && $8 == AWSCURRENT ]] || return 1
          if [[ $REDIS_FIXTURE == unavailable ]]; then
            printf '%s\n' 'never-log-me' >&2
            return 1
          fi
          printf '%s' "$REDIS_FIXTURE"
          ;;
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
if grep -q '^SPRING_DATA_REDIS_' "$scratch/runtime/runtime-complete.env"; then exit 1; fi
grep -Fx "login --username AWS --password-stdin $registry" "$DOCKER_TRACE"
grep -Fx "pull $image" "$DOCKER_TRACE"
grep -q '^run ' "$DOCKER_TRACE"
if grep -Eq 'awslogs|logging\.structured' "$DOCKER_TRACE"; then exit 1; fi
if grep -Eq 'fake-ecr-token|fixture-password' "$scratch/boot-log"; then exit 1; fi

render false '"/aws/bidflow-verification"'
bash -n "$scratch/user-data.sh"
export DOCKER_TRACE="$scratch/cloudwatch-docker-trace"
RDS_FIXTURE='{"username":"fixture-user","password":"fixture-password"}' \
  bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1
grep -Fq -- '--log-driver awslogs --log-opt awslogs-region=ap-northeast-1' "$DOCKER_TRACE"
grep -Fq -- '--log-opt awslogs-group=/aws/bidflow-verification --log-opt awslogs-create-group=false' "$DOCKER_TRACE"
grep -Fq -- "--log-opt mode=non-blocking --log-opt max-buffer-size=1m $image --spring.main.banner-mode=off --logging.structured.format.console=logstash --logging.structured.json.include=@timestamp,level,logger_name,event,outcome,correlationId,bidRequestId,eventId,auctionId" "$DOCKER_TRACE"
if grep -Eq 'fake-ecr-token|fixture-password' "$scratch/boot-log"; then exit 1; fi
export DOCKER_TRACE="$scratch/unexpected-cloudwatch-docker-trace"
if RUNTIME_FIXTURE='LOGGING_CONFIG=never-log-me' RDS_FIXTURE='{}' bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1; then exit 1; fi
test ! -e "$DOCKER_TRACE"
grep -Fxq 'Runtime Secret must not override managed verification settings.' "$scratch/boot-log"
if grep -Fq 'never-log-me' "$scratch/boot-log"; then exit 1; fi
render false

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

render true
export RDS_FIXTURE='{"username":"fixture-user","password":"fixture-password"}'
redis_fixture_token='FakeRedisTokenAbc1234567890abcde'
export REDIS_FIXTURE="{\"redis_auth_token\":\"$redis_fixture_token\"}"
export DOCKER_TRACE="$scratch/redis-docker-trace"
bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1
grep -Fxq 'SPRING_DATA_REDIS_HOST=redis.example.cache.amazonaws.com' "$scratch/runtime/runtime-complete.env"
grep -Fxq 'SPRING_DATA_REDIS_PORT=6379' "$scratch/runtime/runtime-complete.env"
grep -Fxq 'SPRING_DATA_REDIS_SSL_ENABLED=true' "$scratch/runtime/runtime-complete.env"
grep -Fxq "SPRING_DATA_REDIS_PASSWORD=$redis_fixture_token" "$scratch/runtime/runtime-complete.env"
grep -q '^run ' "$DOCKER_TRACE"
if grep -Fq "$redis_fixture_token" "$scratch/boot-log"; then exit 1; fi

export DOCKER_TRACE="$scratch/unexpected-redis-docker-trace"
for invalid in '{}' '{"redis_auth_token":null}' '{"redis_auth_token":""}' '{"redis_auth_token":"never-log-me"}' '{"redis_auth_token":"never-log-me",' "{\"redis_auth_token\":\"${redis_fixture_token:0:31}\\n\"}" unavailable; do
  if REDIS_FIXTURE="$invalid" bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1; then
    printf '%s\n' 'Invalid Redis Secret must stop boot.' >&2
    exit 1
  fi
  test ! -e "$DOCKER_TRACE"
  grep -Fxq 'Invalid or unavailable Redis AUTH in managed Secret.' "$scratch/boot-log"
  if grep -Eq 'never-log-me|fake-ecr-token' "$scratch/boot-log"; then exit 1; fi
done

for collision in SPRING_DATA_REDIS_URL SPRING_DATA_REDIS_CLUSTER_NODES SPRING_DATA_REDIS_SENTINEL_MASTER; do
  if RUNTIME_FIXTURE="$collision=never-log-me" bash "$scratch/user-data.sh" > "$scratch/boot-log" 2>&1; then
    printf '%s\n' 'Redis configuration collision must stop boot.' >&2
    exit 1
  fi
  test ! -e "$DOCKER_TRACE"
  grep -Fxq 'Runtime Secret must not override managed verification settings.' "$scratch/boot-log"
  if grep -Fq 'never-log-me' "$scratch/boot-log"; then exit 1; fi
done
