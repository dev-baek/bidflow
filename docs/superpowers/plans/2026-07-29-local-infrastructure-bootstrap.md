# Local Infrastructure Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #32의 PostgreSQL·Kafka·Redis·OpenSearch 로컬 환경을 Apple Silicon에서 재현 가능하게 실행하고, Health 확인·종료·안전한 Reset 명령을 제공한다.

**Architecture:** Docker Compose Project `bidflow-local`을 로컬 효과 경계로 사용한다. PostgreSQL·Kafka·Redis는 기본 Profile, OpenSearch는 메모리 비용 때문에 `search` Profile로 분리한다. Shell Script는 판단 로직을 작은 함수로 두고 Docker 명령은 교체 가능한 실행 경계로 유지한다.

**Tech Stack:** Docker Compose v2, PostgreSQL 17.5 Alpine, Apache Kafka 3.9.1 KRaft, Redis 7.4.5 Alpine, OpenSearch 2.19.2, POSIX shell, GNU Make

## Global Constraints

- 작업 Issue: [#32](https://github.com/dev-baek/bidflow/issues/32)
- 작업 브랜치: `feature/issue-32-local-services`
- 선행 조건: 본 계획 PR이 승인되어 `main`에 병합되어 있어야 한다.
- 선택한 네 Image Tag는 2026-07-29에 Docker Manifest의 `linux/arm64` 제공 여부를 확인했다.
- `latest` Tag와 고정 `container_name`을 사용하지 않는다.
- Host Port는 `127.0.0.1`에만 Bind한다.
- 기본 실행에 OpenSearch를 포함하지 않는다.
- `make local-up`, `make local-down`, `make local-reset`은 AWS CLI나 AWS 자격증명을 요구하거나 AWS 리소스를 변경하지 않는다.
- `local-down`은 Volume을 보존하고 `local-reset`만 BidFlow Compose Project Volume을 제거한다.
- Reset은 정확한 확인 문자열 없이는 삭제 명령을 실행하지 않는다.
- Compose YAML과 Makefile처럼 테스트 선행의 실익이 낮은 선언 파일은 TDD 예외로 두고 `docker compose config --quiet` 및 실제 Health Check로 검증한다.

---

## Task 1: 사전 조건 검사 Script를 실패 테스트부터 구현

**Files:**

- Create: `scripts/check-prerequisites.sh`
- Create: `tests/scripts/check-prerequisites.test.sh`

**Interfaces:**

- Consumes: `PATH`에서 조회 가능한 `docker`, `node`, `java`
- Produces: `scripts/check-prerequisites.sh` 종료 코드 0/1과 원인별 한국어 진단

- [ ] **Step 1: 명령 부재와 Docker Daemon 중지 실패 테스트를 작성한다.**

Test는 `mktemp -d` 아래의 가짜 실행 파일을 사용하고 실제 시스템 설정은 변경하지 않는다. 각 Case는 별도 Subshell에서 실행하고 예상 종료 코드와 문구를 검사한다.

```sh
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
```

검증 Case:

```text
docker 명령 없음       -> 종료 1, "Docker를 찾을 수 없습니다"
docker info 실패       -> 종료 1, "Docker daemon이 실행 중이 아닙니다"
node Major 20          -> 종료 1, "Node.js 24가 필요합니다"
java Major 17          -> 종료 1, "Java 21이 필요합니다"
모든 조건 충족         -> 종료 0, "로컬 개발 사전 조건을 충족했습니다"
```

- [ ] **Step 2: RED를 확인한다.**

```bash
sh tests/scripts/check-prerequisites.test.sh
```

Expected: `scripts/check-prerequisites.sh`가 없어 첫 Case에서 실패한다.

- [ ] **Step 3: 명시적인 종료 코드와 해결 문구를 가진 최소 Script를 구현한다.**

```sh
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
```

설치·업데이트·Docker 시작을 자동 실행하지 않는다. `major` 함수는 Version 문자열만 입력받는다.

- [ ] **Step 4: GREEN과 macOS 기본 Shell 호환성을 확인한다.**

```bash
sh tests/scripts/check-prerequisites.test.sh
sh -n scripts/check-prerequisites.sh
```

- [ ] **Step 5: Script와 Test를 커밋한다.**

```bash
git add scripts/check-prerequisites.sh tests/scripts/check-prerequisites.test.sh
git commit -m "test(infra): validate local prerequisites"
```

---

## Task 2: PostgreSQL·Kafka·Redis 기본 Compose 구성

**Files:**

- Create: `infra/local/compose.yaml`
- Create: `.env.example`

**Interfaces:**

- Consumes: Task 1이 확인한 Docker Compose v2와 `.env.example`
- Produces: `bidflow-local` Project의 `postgres`, `kafka`, `redis` Service와 Named Volume

- [ ] **Step 1: Compose Project와 Network·Volume 이름을 선언한다.**

```yaml
name: bidflow-local

networks:
  backend:

volumes:
  postgres-data:
  kafka-data:
  redis-data:
  opensearch-data:
```

- [ ] **Step 2: PostgreSQL을 고정 Tag와 Health Check로 추가한다.**

```yaml
postgres:
  image: postgres:17.5-alpine
  environment:
    POSTGRES_DB: ${POSTGRES_DB:-bidflow}
    POSTGRES_USER: ${POSTGRES_USER:-bidflow}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-bidflow-local-only}
  ports:
    - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    interval: 5s
    timeout: 3s
    retries: 20
  volumes:
    - postgres-data:/var/lib/postgresql/data
  networks: [backend]
```

- [ ] **Step 3: Kafka KRaft 단일 Node를 고정 Tag로 추가한다.**

```yaml
kafka:
  image: apache/kafka:3.9.1
  environment:
    CLUSTER_ID: ${KAFKA_CLUSTER_ID:-MkU3OEVBNTcwNTJENDM2Qk}
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller
    KAFKA_LISTENERS: CONTROLLER://:29093,PLAINTEXT://:29092,PLAINTEXT_HOST://:9092
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:${KAFKA_PORT:-9092}
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
    KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
    KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:29093
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
  ports:
    - "127.0.0.1:${KAFKA_PORT:-9092}:9092"
  healthcheck:
    test: ["CMD-SHELL", "/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:29092 --list >/dev/null"]
    interval: 10s
    timeout: 5s
    retries: 30
  volumes:
    - kafka-data:/var/lib/kafka/data
  networks: [backend]
```

- [ ] **Step 4: Redis를 고정 Tag와 Ping Health Check로 추가한다.**

```yaml
redis:
  image: redis:7.4.5-alpine
  command: ["redis-server", "--appendonly", "yes"]
  ports:
    - "127.0.0.1:${REDIS_PORT:-6379}:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 20
  volumes:
    - redis-data:/data
  networks: [backend]
```

- [ ] **Step 5: `.env.example`에 로컬 전용 값과 공개 범위를 기록한다.**

포함할 변수:

```dotenv
POSTGRES_DB=bidflow
POSTGRES_USER=bidflow
POSTGRES_PASSWORD=bidflow-local-only
POSTGRES_PORT=5432
KAFKA_PORT=9092
KAFKA_CLUSTER_ID=MkU3OEVBNTcwNTJENDM2Qk
REDIS_PORT=6379
OPENSEARCH_PORT=9200
```

파일 머리말에 “로컬 Docker 전용이며 AWS Secret으로 재사용하지 않는다”를 명시한다.

- [ ] **Step 6: 선언 파일을 검증한다.**

```bash
docker compose --env-file .env.example -f infra/local/compose.yaml config --quiet
docker compose --env-file .env.example -f infra/local/compose.yaml config --services
```

Expected: 기본 Service 목록이 `postgres`, `kafka`, `redis`이고 OpenSearch는 Profile 없이는 활성화되지 않는다.

- [ ] **Step 7: Compose 기본 구성을 커밋한다.**

```bash
git add infra/local/compose.yaml .env.example
git commit -m "feat(infra): define core local services"
```

---

## Task 3: OpenSearch를 선택적 Search Profile로 추가

**Files:**

- Modify: `infra/local/compose.yaml`

**Interfaces:**

- Consumes: Task 2의 Compose Project·Network·Volume
- Produces: `search` Profile에서만 활성화되는 `opensearch` Service

- [ ] **Step 1: OpenSearch Service를 `search` Profile로 선언한다.**

```yaml
opensearch:
  image: opensearchproject/opensearch:2.19.2
  profiles: ["search"]
  environment:
    discovery.type: single-node
    plugins.security.disabled: "true"
    bootstrap.memory_lock: "true"
    OPENSEARCH_JAVA_OPTS: "-Xms512m -Xmx512m"
  ulimits:
    memlock:
      soft: -1
      hard: -1
  ports:
    - "127.0.0.1:${OPENSEARCH_PORT:-9200}:9200"
  healthcheck:
    test: ["CMD-SHELL", "curl -fsS http://localhost:9200/_cluster/health >/dev/null"]
    interval: 10s
    timeout: 5s
    retries: 30
  volumes:
    - opensearch-data:/usr/share/opensearch/data
  networks: [backend]
```

- [ ] **Step 2: 기본 실행과 Search Profile 차이를 검증한다.**

```bash
docker compose --env-file .env.example -f infra/local/compose.yaml config --services
docker compose --env-file .env.example -f infra/local/compose.yaml --profile search config --services
```

Expected: 첫 출력에는 OpenSearch가 없고 두 번째 출력에만 `opensearch`가 추가된다.

- [ ] **Step 3: ARM64 Manifest를 다시 확인한다.**

```bash
docker manifest inspect postgres:17.5-alpine | rg '"architecture": "arm64"'
docker manifest inspect apache/kafka:3.9.1 | rg '"architecture": "arm64"'
docker manifest inspect redis:7.4.5-alpine | rg '"architecture": "arm64"'
docker manifest inspect opensearchproject/opensearch:2.19.2 | rg '"architecture": "arm64"'
```

- [ ] **Step 4: Search Profile 변경을 커밋한다.**

```bash
git add infra/local/compose.yaml
git commit -m "feat(infra): add optional OpenSearch profile"
```

---

## Task 4: Service Health 확인 Script를 TDD로 구현

**Files:**

- Create: `scripts/check-local-health.sh`
- Create: `tests/scripts/check-local-health.test.sh`

**Interfaces:**

- Consumes: `BIDFLOW_EXPECTED_SERVICES`, `BIDFLOW_DOCKER_BIN`, Compose `ps --format`
- Produces: 전체 Service 준비 시 종료 0, 실패 Service와 Logs 명령을 포함한 종료 1

- [ ] **Step 1: 전체 성공·부분 실패·Search 포함 Case를 가짜 Docker로 작성한다.**

Test는 `BIDFLOW_EXPECTED_SERVICES`와 가짜 `BIDFLOW_DOCKER_BIN`을 Script 입력으로 준다.

```sh
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
```

검증 Case:

```text
postgres,kafka,redis 모두 healthy       -> 종료 0
redis exited                            -> 종료 1, 실패 Service와 logs 명령 출력
search 모드에서 opensearch healthy      -> 종료 0
search 모드에서 opensearch 누락         -> 종료 1
```

- [ ] **Step 2: RED를 확인한다.**

```bash
sh tests/scripts/check-local-health.test.sh
```

Expected: `scripts/check-local-health.sh` 부재로 실패한다.

- [ ] **Step 3: Service 집합 비교와 오류 출력을 최소 구현한다.**

```sh
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
```

재시도 횟수와 간격은 Test에서 각각 `1`, `0`을 사용한다.

- [ ] **Step 4: GREEN과 Shell 문법을 확인한다.**

```bash
sh tests/scripts/check-local-health.test.sh
sh -n scripts/check-local-health.sh
```

- [ ] **Step 5: Health Script를 커밋한다.**

```bash
git add scripts/check-local-health.sh tests/scripts/check-local-health.test.sh
git commit -m "test(infra): verify local service health"
```

---

## Task 5: 안전한 Reset과 공통 Make Target 구현

**Files:**

- Create: `scripts/reset-local-services.sh`
- Create: `tests/scripts/reset-local-services.test.sh`
- Create: `Makefile`

**Interfaces:**

- Consumes: Task 2~4의 Compose File·Health Script와 `CONFIRM_BIDFLOW_RESET`
- Produces: `make local-up`, `make local-up-search`, `make local-down`, `make local-reset`

- [ ] **Step 1: 확인 문자열 없이는 삭제하지 않는 실패 테스트를 작성한다.**

가짜 Docker 실행기가 전달받은 Argument를 기록하도록 한다.

```sh
#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/reset-local-services.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s"\n' "$log" >"$tmp/docker"
chmod +x "$tmp/docker"

set +e
output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script" 2>&1)
status=$?
set -e
[ "$status" -eq 2 ]
printf '%s' "$output" | grep -F "bidflow-local_postgres-data" >/dev/null
[ ! -s "$log" ]

set +e
env BIDFLOW_DOCKER_BIN="$tmp/docker" CONFIRM_BIDFLOW_RESET=wrong sh "$script"
status=$?
set -e
[ "$status" -eq 2 ]
[ ! -s "$log" ]

env BIDFLOW_DOCKER_BIN="$tmp/docker" CONFIRM_BIDFLOW_RESET=bidflow-local sh "$script"
grep -F "down --volumes --remove-orphans" "$log" >/dev/null
[ "$(wc -l <"$log" | tr -d ' ')" -eq 1 ]
```

- [ ] **Step 2: RED를 확인한다.**

```bash
sh tests/scripts/reset-local-services.test.sh
```

Expected: Reset Script가 없어 실패한다.

- [ ] **Step 3: Compose Project 범위를 고정한 최소 Reset Script를 구현한다.**

```sh
#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
project=bidflow-local

printf '%s\n' "제거 대상 Compose Project: $project"
printf '%s\n' \
  "${project}_postgres-data" \
  "${project}_kafka-data" \
  "${project}_redis-data" \
  "${project}_opensearch-data"

if [ "${CONFIRM_BIDFLOW_RESET:-}" != "$project" ]; then
  printf '%s\n' \
    "삭제하려면 CONFIRM_BIDFLOW_RESET=bidflow-local make local-reset을 실행하세요." >&2
  exit 2
fi

"$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml \
  --profile search down --volumes --remove-orphans
```

정확한 확인 문자열을 받은 경우에만 동일 Compose File에 `down --volumes --remove-orphans`를 실행한다. 다른 Project, 경로, Docker Volume 전체를 열거하거나 삭제하지 않는다.

- [ ] **Step 4: GREEN을 확인한다.**

```bash
sh tests/scripts/reset-local-services.test.sh
```

- [ ] **Step 5: Make Target을 선언한다.**

```make
COMPOSE = docker compose --env-file .env.example -f infra/local/compose.yaml

.PHONY: local-up local-up-search local-down local-reset
local-up:
	$(COMPOSE) up -d --wait postgres kafka redis
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis sh scripts/check-local-health.sh

local-up-search:
	$(COMPOSE) --profile search up -d --wait
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,opensearch sh scripts/check-local-health.sh

local-down:
	$(COMPOSE) --profile search down

local-reset:
	sh scripts/reset-local-services.sh
```

Make Recipe의 들여쓰기는 실제 Tab을 사용한다.

- [ ] **Step 6: Make Target이 올바른 Compose 명령을 만드는지 검증한다.**

```bash
make -n local-up
make -n local-up-search
make -n local-down
make -n local-reset
```

Expected: `local-down`에는 `--volumes`가 없고 `local-reset`만 Reset Script를 호출한다.

- [ ] **Step 7: Reset과 Makefile을 커밋한다.**

```bash
git add Makefile scripts/reset-local-services.sh tests/scripts/reset-local-services.test.sh
git commit -m "test(infra): protect local volume reset"
```

---

## Task 6: 실제 Container 통합 검증과 Volume 보존 확인

**Files:**

- Create: `docs/reports/issue-032-local-infrastructure-bootstrap.md`

**Interfaces:**

- Consumes: Task 2~5의 실제 Docker Service와 Make Target
- Produces: Protocol Health, Volume 보존·삭제 결과가 기록된 Issue #32 보고서

- [ ] **Step 1: 기본 Service를 시작한다.**

```bash
make local-up
docker compose --env-file .env.example -f infra/local/compose.yaml ps
```

Expected: PostgreSQL, Kafka, Redis가 `running (healthy)`다.

- [ ] **Step 2: 각 Protocol을 실제로 확인한다.**

```bash
docker compose --env-file .env.example -f infra/local/compose.yaml exec -T postgres \
  pg_isready -U bidflow -d bidflow
docker compose --env-file .env.example -f infra/local/compose.yaml exec -T kafka \
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
docker compose --env-file .env.example -f infra/local/compose.yaml exec -T redis \
  redis-cli ping
```

Expected: PostgreSQL은 `accepting connections`, Kafka 명령은 종료 0, Redis는 `PONG`.

- [ ] **Step 3: `local-down`이 Volume을 보존하는지 확인한다.**

```bash
make local-down
docker volume ls --format '{{.Name}}' | rg '^bidflow-local_(postgres|kafka|redis)-data$'
```

Expected: 세 Volume이 남아 있다.

- [ ] **Step 4: Search Profile을 시작하고 실제 Cluster Health를 확인한다.**

```bash
make local-up-search
curl -fsS http://127.0.0.1:9200/_cluster/health
```

Expected: JSON의 `status`가 `yellow` 또는 `green`이다. 단일 Node의 Replica 때문에 `yellow`는 정상이다.

- [ ] **Step 5: 종료 후 명시적으로 개발 Volume만 제거한다.**

```bash
make local-down
CONFIRM_BIDFLOW_RESET=bidflow-local make local-reset
docker volume ls --format '{{.Name}}' | rg '^bidflow-local_' || true
```

Expected: 마지막 명령에 BidFlow Local Volume이 출력되지 않는다.

- [ ] **Step 6: 실제 증적을 보고서에 기록한다.**

```text
RED
- prerequisites Script 부재 실패
- health Script 부재 실패
- reset Script 부재 실패

GREEN
- 세 Shell Test 통과 수
- docker compose config 결과
- 기본 Service Health
- Search Profile Health

MANUAL
- Docker/Docker Compose 버전
- Apple Silicon ARM64 Manifest 확인
- local-down 후 Volume 보존
- 확인 문자열 없는 Reset 차단
- 명시적 Reset 후 BidFlow Volume 제거
```

- [ ] **Step 7: 보고서를 커밋한다.**

```bash
git add docs/reports/issue-032-local-infrastructure-bootstrap.md
git commit -m "docs(infra): record issue 32 verification"
```

---

## Task 7: 최종 검증과 PR 작성

**Interfaces:**

- Consumes: Task 1~6의 Shell Test·Compose 검증·보고서와 Git 변경
- Produces: `Closes #32` PR과 종료·Volume 제거가 끝난 로컬 상태

- [ ] **Step 1: Placeholder와 위험한 명령을 검사한다.**

```bash
rg -n 'TODO|TBD|FIXME|latest|0\\.0\\.0\\.0|docker volume prune|system prune|down -v' \
  infra/local scripts tests Makefile .env.example docs/reports/issue-032-local-infrastructure-bootstrap.md
git diff --check
```

Expected: Placeholder, `latest`, 전체 Volume 정리, 외부 Bind가 없다.

- [ ] **Step 2: 선언과 Shell Test를 새로 검증한다.**

```bash
docker compose --env-file .env.example -f infra/local/compose.yaml config --quiet
docker compose --env-file .env.example -f infra/local/compose.yaml --profile search config --quiet
sh tests/scripts/check-prerequisites.test.sh
sh tests/scripts/check-local-health.test.sh
sh tests/scripts/reset-local-services.test.sh
```

- [ ] **Step 3: 원격 브랜치를 올린다.**

```bash
git push -u origin feature/issue-32-local-services
```

- [ ] **Step 4: PR을 생성한다.**

PR 제목: `[I] Kafka·Redis·OpenSearch 로컬 Docker 환경 구성`

PR 본문에는 `Closes #32`, 실제 RED/GREEN/MANUAL 증적, Compose 선언 파일의 TDD 예외, ARM64 검증, Volume 보존과 Reset 보호 결과를 포함한다. 실제 Container와 Volume을 종료·제거한 상태에서 검토를 요청한다.
