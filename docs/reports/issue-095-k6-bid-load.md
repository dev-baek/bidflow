# [Issue #95] k6 동시 입찰 부하 시나리오 보고서

- 작업 완료일: 2026-11-14
- Issue: [#95 k6 동시 입찰 부하 시나리오 구현](https://github.com/dev-baek/bidflow/issues/95)
- 사양: [issue-019-load-failure-test.md](../specs/issue-019-load-failure-test.md)
- 브랜치: `feature/issue-95-k6-bid-load`

## 1. 구현 결과

- `tests/load/bid-request.js`에 두 k6 시나리오를 분리했다.
  - `focused`: 같은 `BIDFLOW_AUCTION_ID`에 20 VU가 한 번씩 입찰해 경합·순서·원장 정합성을 재현한다.
  - `distributed`: `BIDFLOW_AUCTION_IDS`의 여러 경매에 5 VU warm-up 30초, 20 VU steady 2분을 적용한다.
- 모든 요청은 VU·iteration별 고유 `Idempotency-Key`, `X-Actor-Id`, `BIDFLOW_RUN_ID`를 사용한다. 재시도로 인한 중복 요청과 별개로 각 부하 요청을 추적할 수 있다.
- `202 RECEIVED`, 입찰 API P95 300ms, HTTP 실패율 1% 미만을 k6 threshold로 고정하고 JSON summary를 `reports/k6/`에 남긴다.
- `scripts/run-k6-bid-load.sh`은 로컬 k6 설치 없이 Docker image를 사용한다. 실제 Fixture ID가 없으면 실행 전 종료하며 기존 PostgreSQL/Redis 데이터를 삭제하지 않는다.

## 2. 실행 방법

~~~sh
# Spring Boot와 로컬 인프라를 먼저 준비한 뒤 실행한다.
make local-up

BIDFLOW_AUCTION_ID=<활성-경매-UUID> \
BIDFLOW_RUN_ID=focused-001 \
make load-focused

BIDFLOW_AUCTION_IDS=<활성-경매-UUID-1>,<활성-경매-UUID-2> \
BIDFLOW_RUN_ID=distributed-001 \
make load-distributed
~~~

Docker 안의 k6는 기본값으로 `http://host.docker.internal:8080`을 호출한다. 다른 서버를 검증할 때만 `BIDFLOW_BASE_URL`을 명시한다.

## 3. 검증 증적

~~~sh
sh tests/scripts/run-k6-bid-load.test.sh
~~~

- focused Fixture ID 누락 시 exit 2로 중단한다.
- focused/distributed 각각 필요한 환경변수와 k6 image·스크립트 경로가 Docker 실행 명령에 전달됨을 Fake Docker로 검증했다.
- 실제 성능 수치, 정합성 SQL, Consumer Lag 결과는 실행 환경과 Fixture를 준비한 뒤 #102 보고서에 기록한다. 이 PR은 재현 가능한 실행 도구를 제공하며 임의의 개발 데이터를 만들어 수치를 주장하지 않는다.
