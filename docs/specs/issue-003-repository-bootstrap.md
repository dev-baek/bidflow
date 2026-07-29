# [Issue #3] 모노레포 구조와 로컬 개발 환경 사양

- 상태: Review
- 작성일: 2026-07-28
- 개정일: 2026-07-29 — EC2 장기 실행 Spring Boot 구조로 전환
- 상위 Issue: [#3 모노레포 구조와 로컬 개발 환경 구성](https://github.com/dev-baek/bidflow/issues/3)
- 사양 작업: [#28 모노레포와 로컬 실행 규칙 사양 작성](https://github.com/dev-baek/bidflow/issues/28)
- 선행 사양: [Issue #1 프로젝트 범위와 성공 기준](./issue-001-project-scope.md)
- 아키텍처 사양: [Issue #2 EC2 이벤트 기반 아키텍처와 ADR](./issue-002-architecture-adr.md)

## 1. 목적

BidFlow의 React 프론트엔드, Spring Boot 백엔드, 로컬 의존 서비스와 Terraform을 하나의 저장소에서 일관되게 개발·테스트할 수 있는 기반을 정의한다.

이 사양은 다음 질문에 답해야 한다.

1. 각 코드가 어디에 위치하고 어떤 코드에 의존할 수 있는가?
2. 로컬 환경과 AWS 환경의 차이를 어떻게 Adapter로 격리하는가?
3. 새 개발자가 어떤 명령으로 설치, 테스트, 실행과 종료를 수행하는가?
4. TDD의 실패 테스트와 최종 통과 결과를 어떻게 재현하는가?
5. 비밀정보와 고비용 AWS 리소스가 실수로 생성되거나 저장되지 않게 어떻게 방지하는가?

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| 저장소 | 프론트엔드·백엔드·인프라·문서를 포함하는 단일 Git 저장소 |
| 프론트엔드 | React.js·TypeScript·Vite 기반 SPA |
| 프론트엔드 실행 환경 | Node.js 24 LTS, npm |
| 백엔드 | Java 21 LTS·Spring Boot 3.5.x·Gradle Kotlin DSL 멀티프로젝트 |
| 백엔드 구조 | Functional Core / Imperative Shell을 적용한 Domain·Application·Adapter·Runtime 분리 |
| 로컬 의존 서비스 | Docker Compose 기반 PostgreSQL·Kafka·Redis·OpenSearch |
| AWS 인프라 | Terraform |
| 공통 명령 | 루트 Makefile |
| 개발 방식 | 문서 승인 후 Red–Green–Refactor TDD |

Spring Boot는 `3.5.16`을 초기 기준 버전으로 사용한다. 의존성 버전은 Gradle Version Catalog와 lock file, npm `package-lock.json`으로 고정한다.

## 3. 선택 근거와 대안

### 3.1 Vite를 선택한 이유

Node.js는 프론트엔드 개발 도구를 실행하는 런타임이며, Next.js와 Vite는 애플리케이션 구성·빌드 방식이다. 따라서 “Node.js 또는 Vite”가 아니라 “Node.js 위에서 Next.js 또는 Vite 중 무엇을 사용할 것인가”가 정확한 비교다.

BidFlow 프론트엔드는 다음 특성을 가진다.

- 인증은 Cognito, 데이터 API는 ALB 뒤의 Spring Boot가 담당한다.
- 검색·입찰·WebSocket 연결은 브라우저에서 AWS API에 요청한다.
- 프론트엔드 자체 서버에서 실행할 SSR, Server Action과 API Route가 필요하지 않다.
- 배포 결과는 S3에 저장하고 CloudFront로 제공한다.

Vite는 `vite build` 결과를 정적 배포 가능한 `dist` 디렉터리로 만든다. 이는 S3·CloudFront 배포 모델과 직접 일치한다.

Next.js도 `output: 'export'`로 정적 파일을 만들 수 있지만 서버가 필요한 기능은 사용할 수 없다. 이 프로젝트에서 Next.js를 선택하면 정적 Export 제약을 관리하면서도 핵심 장점인 서버 기능은 사용하지 않는 구조가 된다.

따라서 MVP는 React.js·TypeScript·Vite를 사용한다. 향후 SEO가 중요한 공개 상품 페이지나 SSR 요구사항이 생기면 Next.js 또는 별도 렌더링 계층을 재검토한다.

### 3.2 백엔드 구조 대안

검토한 대안은 다음과 같다.

1. API와 Worker마다 독립 Spring Boot 프로젝트와 저장소를 만든다.
   - 장점: 배포 단위와 장애 경계가 완전히 독립적이다.
   - 단점: 한 달 MVP에서 빌드·버전·공통 계약과 배포 관리 비용이 크다.
2. 모든 코드를 단일 Spring Boot 모듈에 둔다.
   - 장점: 초기 구성이 가장 단순하다.
   - 단점: 도메인이 Spring과 AWS SDK에 결합되기 쉽고 API·Worker 역할 경계가 불분명하다.
3. 한 저장소 안에서 Gradle 멀티프로젝트와 Port·Adapter 경계를 사용한다.
   - 장점: 도메인 테스트는 빠르게 유지하면서 런타임과 배포 Adapter를 분리할 수 있다.
   - 단점: 모듈 의존 규칙과 빌드 구성을 관리해야 한다.

3번을 선택한다. API·Kafka Worker·Scheduler를 처음부터 별도 Codebase로 과도하게 분할하지 않고, 동일한 OCI Image를 Profile별 Process로 실행한다. 독립적으로 테스트할 가치가 있는 코드 경계만 Gradle 프로젝트로 만든다.

## 4. 저장소 구조

```text
BidFlow/
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── pages/
│       │   ├── features/
│       │   └── shared/
│       ├── public/
│       ├── package.json
│       ├── package-lock.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── backend/
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradle/
│   │   └── libs.versions.toml
│   ├── gradlew
│   ├── gradlew.bat
│   ├── domain/
│   ├── application/
│   ├── event-contract/
│   ├── adapters/
│   └── runtime/
├── infra/
│   ├── local/
│   │   └── compose.yaml
│   └── terraform/
│       ├── modules/
│       └── environments/
├── docs/
│   ├── adr/
│   ├── reports/
│   └── specs/
├── scripts/
│   ├── check-prerequisites.sh
│   └── check-local-health.sh
├── .env.example
├── .gitignore
├── Makefile
└── README.md
```

디렉터리는 해당 코드를 실제로 추가하는 Sub-issue에서 생성한다. 내용이 없는 디렉터리를 유지하기 위한 `.gitkeep`은 만들지 않는다.

## S. 화면 사양

### S.1 범위 판정

Issue #3은 사용자 기능 화면을 구현하지 않으므로 화면 사양은 제외한다.

다만 #30에서 다음 개발 기반을 검증한다.

- Vite 개발 서버가 기본 애플리케이션을 렌더링한다.
- Production Build 결과를 정적 서버에서 직접 열 수 있다.
- 잘못된 API 환경변수가 있으면 빈 화면 대신 명시적인 구성 오류를 표시한다.
- 브라우저 콘솔에 처리하지 않은 오류와 React 경고가 없어야 한다.

### S.2 프론트엔드 내부 구조

| 디렉터리 | 책임 |
|---|---|
| `src/app` | Router, Provider, 전역 Error Boundary와 애플리케이션 조립 |
| `src/pages` | URL 단위 화면 조립 |
| `src/features` | 인증, 검색, 상품 등록, 입찰처럼 사용자 행동 단위 |
| `src/shared` | API Client, 타입, 공통 UI와 테스트 유틸리티 |

의존 방향은 `app → pages → features → shared`로 제한한다. `shared`는 상위 디렉터리를 참조하지 않는다. 하나의 기능이 다른 기능의 내부 파일을 직접 가져오지 않고 공개 진입점만 사용한다.

MVP에서는 Redux 같은 전역 상태 라이브러리를 미리 도입하지 않는다. 서버 상태와 화면 로컬 상태가 실제로 분리되는 기능 사양에서 필요성을 다시 판단한다.

## D. 데이터 사양

### D.1 범위 판정

Issue #3은 경매 데이터를 저장하거나 데이터 모델을 확정하지 않으므로 업무 데이터 사양은 제외한다.

### D.2 개발 환경 데이터

로컬 Kafka, Redis와 OpenSearch 데이터는 언제든 삭제 가능한 개발 데이터다.

- `make local-down`은 컨테이너만 종료하고 데이터 볼륨은 보존한다.
- `make local-reset`은 사용자가 명시적으로 실행할 때만 개발 볼륨을 제거한다.
- `local-reset` 실행 전 제거 대상 Compose Project와 Volume 이름을 출력한다.
- AWS 데이터와 자격증명은 로컬 Compose 볼륨에 저장하지 않는다.
- 테스트는 각 실행이 생성한 Topic, Key Prefix와 Index 이름을 사용해 서로 간섭하지 않아야 한다.

## B. 백엔드 사양

### B.1 Gradle 프로젝트

`backend`는 하나의 Gradle Build이며 다음 프로젝트를 포함한다.

| 프로젝트 | 책임 | 허용 의존성 |
|---|---|---|
| `domain` | 입찰·경매 규칙, 값 객체, 순수 상태 전이 | Java 표준 라이브러리 |
| `application` | Use Case, 입력·출력 Port, 트랜잭션 경계 | `domain` |
| `event-contract` | 외부로 전달되는 Event Envelope와 버전 계약 | Java 표준 라이브러리와 JSON Annotation 최소 범위 |
| `adapters` | PostgreSQL, Kafka, Redis와 OpenSearch 구현 | `application`, `domain`, `event-contract`, 외부 SDK |
| `runtime` | Spring MVC·WebSocket·Worker·Scheduler와 의존성 조립 | 모든 백엔드 프로젝트 |

다음 의존은 금지한다.

- `domain`에서 Spring, AWS SDK, Kafka, Redis와 JSON 직렬화 라이브러리 참조
- `application`에서 `adapters` 또는 `runtime` 참조
- `event-contract`에서 `runtime` 참조
- `adapters`에서 다른 Adapter의 구체 클래스를 직접 호출
- 정적 전역 객체에서 시스템 시각, UUID 생성기와 외부 Client를 조회

### B.2 Functional Core / Imperative Shell

핵심 계산은 입력을 받아 결과를 반환하는 순수 함수로 작성한다.

```text
HTTP/WebSocket/Kafka/Scheduler Input
        ↓
Imperative Adapter
        ↓
Application Use Case
        ↓
Pure Domain Function
        ↓
Result + Domain Event
        ↓
Imperative Adapter
```

시간은 `Instant` 또는 주입한 `Clock`, ID는 주입한 생성 함수로 전달한다. 로그, 파일, 네트워크와 저장소 호출은 Adapter 경계에서만 수행한다.

### B.3 Spring Boot 사용 범위

Spring Boot는 `runtime`의 의존성 조립, REST·WebSocket과 장기 실행 Worker에 사용한다. 도메인 객체를 Spring Bean으로 만들지 않는다.

- 생성자 주입만 사용한다.
- Field Injection을 사용하지 않는다.
- Spring Context가 없어도 `domain`과 `application` 단위 테스트가 실행돼야 한다.
- Controller, WebSocket Handler, Kafka Listener와 Scheduler는 입력 변환, Use Case 호출과 결과 전달만 담당한다.
- Controller, Listener와 Scheduler 안에 입찰 규칙과 저장소 재시도 규칙을 작성하지 않는다.

### B.4 공통 Event Envelope

초기 Event Contract는 다음 필드를 가진다.

```text
eventId: UUID
eventType: String
schemaVersion: Integer
occurredAt: Instant
correlationId: String
payload: Object
```

Envelope 검증은 누락된 ID, 알 수 없는 Event Type, 1 미만의 Schema Version과 미래 허용 범위를 벗어난 `occurredAt`을 거부한다. 구체적인 이벤트 Payload는 각 기능 사양에서 정의한다.

## I. 인프라와 실행 사양

### I.1 지원 환경

| 도구 | 기준 |
|---|---|
| macOS | Apple Silicon M4 이상 개발 환경 |
| Java | Temurin/OpenJDK 21 LTS |
| Spring Boot | 3.5.16 |
| Gradle | Wrapper로 고정한 8.x |
| Node.js | 24 LTS |
| npm | Node.js 24에 포함된 버전, `package-lock.json` 사용 |
| Docker | Apple Silicon을 지원하는 Docker Desktop 또는 호환 Runtime |
| Terraform | 1.10 이상 |
| AWS CLI | v2 |
| GNU Make | macOS 기본 Make에서 실행 가능한 문법 |

Node.js Current 버전인 26 대신 LTS인 24를 사용한다. 프론트엔드 의존성은 `npm ci`로 재현한다.

### I.2 로컬 서비스

`infra/local/compose.yaml`은 다음 서비스를 제공한다.

| 서비스 | 목적 | 기본 실행 |
|---|---|---|
| PostgreSQL | 최종 원장과 Outbox 개발 | 포함 |
| Kafka | 입찰 명령과 이벤트 개발 | 포함 |
| Redis | 활성 경매 계산 개발 | 포함 |
| OpenSearch | 검색 색인 개발 | 별도 Profile |

OpenSearch는 메모리 사용량이 크므로 기본 `make local-up`에서 제외한다. 검색 기능 개발 시 `make local-up-search`로 명시적으로 시작한다.

모든 서비스는 다음 조건을 충족해야 한다.

- Apple Silicon용 ARM64 Image를 제공한다.
- Image Tag를 `latest`로 두지 않는다.
- Health Check를 정의한다.
- 외부 공개가 필요하지 않은 Port는 Localhost에만 Bind한다.
- 기본 자격증명은 로컬 개발에서만 사용하며 `.env.example`에 용도를 명시한다.
- Container 이름을 고정하지 않고 Compose Project 이름으로 격리한다.

### I.3 AWS와 로컬 경계

- 로컬 실행은 실제 AWS 자격증명 없이 시작할 수 있어야 한다.
- AWS 통합 검증은 별도 Terraform 환경과 명시적인 AWS Profile을 요구한다.
- `make local-up`과 `make test`는 AWS 리소스를 만들지 않는다.
- `terraform apply`는 Make의 일반 설치·테스트 명령에 포함하지 않는다.
- 고비용 리소스 생성 명령은 예상 대상 환경과 Workspace를 출력한 뒤 실행한다.

### I.4 공통 명령 계약

| 명령 | 동작 |
|---|---|
| `make help` | 지원 명령과 사전 조건 표시 |
| `make setup` | 프론트엔드 의존성 설치와 Gradle Wrapper 확인 |
| `make test` | 백엔드와 프론트엔드 단위 테스트 실행 |
| `make test-backend` | `backend`의 전체 단위 테스트 실행 |
| `make test-web` | Vitest를 CI Mode로 실행 |
| `make build` | 백엔드 Artifact와 프론트엔드 `dist` 생성 |
| `make verify` | Format, 정적 검사, 테스트와 Build 순서 실행 |
| `make local-up` | PostgreSQL, Kafka와 Redis 시작 후 Health 확인 |
| `make local-up-search` | PostgreSQL, Kafka, Redis와 OpenSearch 시작 후 Health 확인 |
| `make local-down` | 로컬 서비스 종료, Volume 보존 |
| `make local-reset` | 확인 가능한 대상의 개발 Volume 제거 |

명령 실패 시 첫 실패의 종료 코드를 유지한다. 성공하지 않은 단계를 성공으로 출력하지 않는다.

### I.5 환경변수와 비밀정보

루트 `.env.example`에는 변수명, 로컬 예시와 설명만 둔다.

실제 값이 포함된 다음 파일은 Git에 추가하지 않는다.

- `.env`
- `.env.*.local`
- Terraform `*.tfvars`
- Terraform State와 Plan
- Java Key Store와 Private Key
- AWS 자격증명 파일
- Cognito Client Secret
- Database Password

프론트엔드에 주입되는 `VITE_` 변수는 사용자에게 공개되는 값으로 간주한다. AWS Secret, Client Secret과 서명 Key를 `VITE_` 변수에 넣지 않는다.

### I.6 CI

GitHub Actions는 Pull Request와 `main` Push에서 다음 순서를 실행한다.

1. Repository Checkout
2. Java 21과 Node.js 24 설정
3. `npm ci`
4. Gradle Dependency Cache 복원
5. `make verify`

CI는 AWS 자격증명 없이 실행한다. LocalStack과 실제 AWS 통합 테스트는 Issue #3 범위에 포함하지 않는다.

## T. 테스트 사양

### T.1 공통 TDD 규칙

모든 동작 변경은 다음 순서를 따른다.

1. 한 가지 사용자 또는 도메인 동작을 표현하는 실패 테스트를 작성한다.
2. 구현 부재로 예상한 이유에서 실패하는지 실행 결과를 확인한다.
3. 테스트를 통과시키는 최소 구현을 작성한다.
4. 관련 테스트와 전체 테스트가 통과하는지 확인한다.
5. 테스트가 통과하는 상태에서만 구조를 정리한다.

PR에는 첫 RED 결과와 최종 GREEN 결과를 명령과 함께 기록한다. 설정 파일과 생성 코드처럼 실패 테스트가 실익이 없는 예외는 PR에 이유와 대체 검증 명령을 기록한다.

### T.2 백엔드 테스트

| 범위 | 도구 | 원칙 |
|---|---|---|
| Domain | JUnit 5·AssertJ | Spring과 Mock 없이 실제 순수 함수 검증 |
| Application | JUnit 5·AssertJ | In-memory Fake Port 우선 |
| Adapter | Testcontainers | 실제 Protocol과 직렬화 계약 검증 |
| Runtime | Spring Boot Test | Bean 조립과 진입점 계약만 검증 |

Mock 호출 여부 자체를 성공 기준으로 삼지 않는다. 외부 Port를 대체하더라도 Use Case의 반환 결과, 저장된 상태 또는 발행된 실제 계약을 검증한다.

첫 기반 테스트는 다음 행위를 증명한다.

- 고정된 입력으로 Event Envelope가 생성된다.
- 필수 필드가 없는 Envelope는 명시적인 오류로 거부된다.
- Domain 프로젝트 테스트가 Spring Context 없이 실행된다.
- 금지된 모듈 의존 방향이 Build에서 실패한다.

### T.3 프론트엔드 테스트

| 범위 | 도구 | 원칙 |
|---|---|---|
| 순수 상태 | Vitest | 이전 상태와 이벤트에 따른 다음 상태 검증 |
| Component | React Testing Library | 사용자가 보는 역할·이름과 행동 검증 |
| API 경계 | MSW | 완전한 실제 응답 구조로 성공·실패 대체 |
| Browser | Playwright | 핵심 사용자 흐름과 Console 상태 검증 |

첫 기반 테스트는 다음 행위를 증명한다.

- 초기 애플리케이션 상태가 준비 상태로 전이된다.
- 구성 오류 이벤트가 오류 상태와 사용자 메시지를 만든다.
- Reducer는 입력 State를 변경하지 않는다.
- 기본 화면이 접근 가능한 Landmark를 렌더링한다.

테스트는 Mock Component 존재 여부가 아니라 실제 화면 결과를 검증한다. 서버 응답에서 계산할 수 있는 값은 별도 State로 복제하지 않는다.

### T.4 실행 시간 목표

- 순수 백엔드 단위 테스트: 10초 이내
- 프론트엔드 단위·컴포넌트 테스트: 10초 이내
- `make test`: 로컬 Warm Cache 기준 30초 이내
- Testcontainers와 Browser E2E는 별도 명령으로 실행하며 기본 단위 테스트 시간에 포함하지 않는다.

## 10. 오류 처리

### 10.1 사전 조건 오류

`scripts/check-prerequisites.sh`는 설치되지 않은 도구, 지원하지 않는 Major Version과 Docker Daemon 중지 상태를 각각 구분해 출력한다. 검사 실패 시 설치 명령을 임의로 실행하지 않고 해결 방법만 안내한다.

### 10.2 로컬 서비스 오류

- Health Check 제한 시간 내 준비되지 않으면 실패한 서비스와 최근 로그 확인 명령을 출력한다.
- 일부 서비스만 준비된 상태를 전체 성공으로 처리하지 않는다.
- 종료 명령은 이미 종료된 서비스에 대해서도 성공할 수 있어야 한다.
- Reset은 BidFlow Compose Project가 아닌 Volume을 제거하지 않는다.

### 10.3 빌드와 테스트 오류

- Backend 또는 Web 한쪽이 실패하면 `make test`도 실패한다.
- 정적 검사 실패를 자동 수정으로 숨기지 않는다.
- CI와 로컬은 동일한 Make Target을 사용한다.
- Test Report와 Build Artifact는 Git에 Commit하지 않는다.

## 11. 작업 분리와 순서

| 순서 | Issue | 결과 |
|---|---|---|
| 1 | #28 DOC | 본 사양 승인 |
| 2 | #30 S | React.js·TypeScript·Vite와 프론트 테스트 기반 |
| 3 | #31 B | Gradle 멀티프로젝트, Spring Boot Runtime, Event Contract와 백엔드 테스트 기반 |
| 4 | #32 I | PostgreSQL·Kafka·Redis·OpenSearch Compose와 Health Check |
| 5 | #3 Epic | 공통 Make Target과 전체 검증 완료 |

#30, #31과 #32는 본 사양이 승인·병합된 뒤 각각 `feature/issue-<번호>-<slug>` 브랜치에서 작업한다. 독립 변경은 별도 PR로 검토한다.

## 12. 완료 조건

Issue #3은 다음 조건을 모두 충족해야 완료된다.

- 저장소 구조가 본 사양과 일치한다.
- Node.js 24, Java 21과 Docker가 설치된 Apple Silicon 환경에서 `make setup`이 성공한다.
- `make test`가 AWS 자격증명과 실행 중인 Docker Container 없이 성공한다.
- `make local-up` 후 PostgreSQL, Kafka와 Redis Health Check가 성공한다.
- `make local-up-search` 후 OpenSearch를 포함한 Health Check가 성공한다.
- `make local-down`이 데이터 Volume을 보존한다.
- `make local-reset`이 BidFlow 개발 Volume만 제거한다.
- `make build`가 백엔드 Artifact와 `apps/web/dist`를 생성한다.
- `make verify`가 로컬과 GitHub Actions에서 동일하게 성공한다.
- 실제 비밀정보, Terraform State와 Build Artifact가 Git에 포함되지 않는다.
- 백엔드와 프론트엔드 예제가 실패 테스트부터 구현된 증적이 PR에 기록된다.
- 실행 명령과 문제 해결 방법이 README에 기록된다.

## 13. 구현하지 않는 것

- 실제 AWS 리소스 생성
- 실제 Cognito 로그인
- ALB·EC2 Auto Scaling과 ECR 배포
- 경매 업무 모델과 API 구현
- Kafka Topic과 Event Payload 전체 정의
- OpenSearch 상품 Mapping
- 배포 Pipeline
- 개발 Container 전체를 구성하는 Dev Container
- Nx, Turborepo와 별도 JavaScript Monorepo 도구
- Redux 등 전역 상태 라이브러리
- LocalStack

## 14. 검증 증적

각 구현 PR은 다음 내용을 포함한다.

```text
RED
- 실행 명령
- 예상한 실패 이유
- 실제 실패 결과 요약

GREEN
- 실행 명령
- 통과한 테스트 수
- 경고와 처리하지 않은 오류 유무

MANUAL
- 로컬 서비스 Health 결과
- Production Build 결과
- 필요한 경우 화면 또는 로그 증적
```

Issue #3 완료 시 전체 결과를 `docs/reports/issue-003-repository-bootstrap.md`에 정리한다.

## 15. 참고 자료

- [Next.js Static Exports](https://nextjs.org/docs/app/guides/static-exports)
- [Vite Building for Production](https://vite.dev/guide/build)
- [Vite Deploying a Static Site](https://vite.dev/guide/static-deploy.html)
- [AWS S3 Static Website Hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
- [AWS CloudFront Secure Static Website](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/getting-started-secure-static-website-cloudformation-template.html)
- [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases)
- [Spring Boot 3.5 System Requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html)

## 16. 승인 후 다음 작업

본 사양이 승인되면 #30, #31과 #32를 위한 상세 구현 계획을 작성한다. 구현 계획은 각 Issue별 Red–Green–Refactor 단계, 정확한 파일 경로, 명령과 예상 결과를 포함한다.
