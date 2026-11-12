# [Issue #31] Spring Boot·공통 이벤트 모듈 검증 보고서

- 작업 완료일: 2026-11-12
- Issue: [#31 Spring Boot 프로젝트와 공통 이벤트 모듈 초기화](https://github.com/dev-baek/bidflow/issues/31)
- 구현계획: [`2026-07-29-spring-boot-bootstrap.md`](../superpowers/plans/2026-07-29-spring-boot-bootstrap.md)
- 브랜치: `feature/issue-31-spring-boot-bootstrap`

## 1. 구현 결과

- Java 21·Gradle 8.14.3 기반 멀티프로젝트를 구성했다.
- `domain`, `application`, `event-contract`, `adapters`, `runtime` 모듈의 의존 방향을 빌드에서 검증한다.
- Kafka 메시지에 공통으로 사용할 `EventEnvelope<T>` 계약을 정의했다.
- 이벤트 값 검증을 현재 시각이나 외부 상태를 직접 조회하지 않는 순수 함수로 구현했다.
- Spring Boot Runtime과 표준 Actuator Readiness Probe를 구성했다.
- `/actuator/health/readiness`를 ALB Health Check 경로로 사용할 수 있다.
- 실행 가능한 Spring Boot Jar를 생성한다.

## 2. RED 증적

| 대상 | 실행 명령 | 확인한 실패 |
|---|---|---|
| 모듈 의존 방향 | `./gradlew verifyModuleDependencies` | 임시 `:application -> :adapters` 의존성을 금지된 방향으로 검출 |
| Event Envelope | `./gradlew :event-contract:test --tests com.bidflow.event.EventEnvelopeTest` | `EventEnvelope` 부재로 Test Compile 실패 |
| Event 검증 | `./gradlew :event-contract:test --tests com.bidflow.event.EventEnvelopeValidatorTest` | Validator와 Violation Type 부재로 Test Compile 실패 |
| Readiness | `./gradlew :runtime:test --tests com.bidflow.ReadinessEndpointTest` | Spring Boot Application 설정 부재로 초기화 실패 |

임시 금지 의존성은 실패 확인 후 즉시 제거했다. Gradle Scaffold와 의존성 설정은 동작 테스트의 실익이 낮아 TDD 예외로 처리하고, 전용 검증 Task와 실제 Build로 확인했다.

## 3. GREEN 증적

Java 21 환경에서 다음 명령을 실행했다.

```bash
./gradlew --no-daemon clean verifyModuleDependencies test check :runtime:bootJar --warning-mode all
```

결과:

- Gradle: `8.14.3`
- JVM: Microsoft OpenJDK `21.0.7`
- 다섯 개 모듈 의존 방향 검증 통과
- Event Envelope와 Validator 테스트 통과
- Readiness Endpoint 테스트 통과
- 전체 Gradle Build 성공
- Boot Jar: `backend/runtime/build/libs/runtime-0.0.1-SNAPSHOT.jar`

프론트엔드 회귀 검증도 프로젝트 요구사항인 Node.js 24에서 실행했다.

- Node.js: `v24.22.1`
- Test Files: `5 passed`
- Tests: `18 passed`
- Production Build 성공

## 4. 수동 검증

| 검사 | 결과 |
|---|---|
| `event-contract` Runtime Classpath | Spring과 Jackson 의존성 없음 |
| 순수 함수 규칙 | 시스템 시각 조회와 내부 UUID 생성 없음 |
| Spring 의존 범위 | `runtime` 모듈에만 Spring Boot 적용 |
| Readiness 응답 | HTTP 200, JSON `status` 값 `UP` |
| 실행 Artifact | Boot Jar 생성 확인 |

## 5. 설계 이유

- Event Envelope는 Kafka Producer와 Consumer가 이벤트 식별자, 종류, 버전, 발생 시각과 추적 ID를 같은 형식으로 교환하기 위해 사용한다.
- `schemaVersion`은 이벤트 형식 변경 시 Consumer 호환성을 판단하기 위해 둔다.
- `correlationId`는 HTTP 요청부터 Kafka Consumer까지 하나의 처리 흐름을 추적하기 위해 둔다.
- 이벤트 검증기는 시간과 허용 이벤트 목록을 인자로 받아 테스트가 실행 환경에 의존하지 않게 했다.
- Actuator Readiness Probe는 별도 Health API를 중복 구현하지 않고 ALB가 애플리케이션의 요청 수신 가능 상태를 판단하게 한다.
- 모듈 의존 방향 검증은 Domain이 Spring이나 Adapter에 결합되는 것을 Build 단계에서 차단한다.

## 6. 완료 조건

- [x] Java 21·Gradle Wrapper 기반 멀티프로젝트 구성
- [x] 모듈 의존 방향 선언 및 자동 검증
- [x] 공통 Event Envelope 정의
- [x] Event Envelope 순수 검증 함수 구현
- [x] Spring Boot Runtime 구성
- [x] Actuator Readiness Endpoint 검증
- [x] 실행 가능한 Boot Jar 생성
- [x] RED·GREEN·수동 검증 증적 기록
