# Spring Boot Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #31의 Java 21·Spring Boot 3.5.16·Gradle 멀티프로젝트를 구성하고, 공통 Event Envelope와 Readiness Endpoint를 TDD로 구현한다.

**Architecture:** 백엔드는 `domain`, `application`, `event-contract`, `adapters`, `runtime`으로 분리한다. Domain과 Event 검증은 Spring 없이 실행되는 Functional Core이고, Spring Boot Runtime은 HTTP·Profile·Actuator 조립만 담당하는 Imperative Shell이다.

**Tech Stack:** Java 21 LTS, Spring Boot 3.5.16, Gradle Wrapper 8.14.3 Kotlin DSL, JUnit 5, AssertJ, Spring Boot Actuator

## Global Constraints

- 작업 Issue: [#31](https://github.com/dev-baek/bidflow/issues/31)
- 작업 브랜치: `feature/issue-31-spring-boot-bootstrap`
- 선행 조건: 본 계획 PR이 승인되어 `main`에 병합되어 있어야 한다.
- `domain`은 Java 표준 라이브러리 외 의존성을 갖지 않는다.
- `application`은 `domain`만 참조한다.
- `event-contract`은 Java 표준 라이브러리만 사용한다.
- `adapters`는 `application`, `domain`, `event-contract`을 참조할 수 있다.
- `runtime`만 Spring Boot Plugin과 Spring Runtime 의존성을 사용한다.
- 시간·UUID는 생성 함수 내부에서 조회하지 않고 입력으로 전달한다.
- Event 검증은 고정된 기준 시각과 허용 Event Type 집합을 인자로 받는 순수 함수로 작성한다.
- Gradle Scaffold와 의존성 설정은 TDD 예외이며 `verifyModuleDependencies`, `test`, `bootJar`로 검증한다.
- 테스트 비활성화, `TODO`, 빈 Method, Field Injection은 완료 상태로 인정하지 않는다.

---

## Task 1: Gradle 멀티프로젝트와 Java 21 Toolchain 구성

**Files:**

- Create: `backend/settings.gradle.kts`
- Create: `backend/build.gradle.kts`
- Create: `backend/gradle/libs.versions.toml`
- Create: `backend/gradle/wrapper/gradle-wrapper.properties`
- Create: `backend/gradle/wrapper/gradle-wrapper.jar`
- Create: `backend/gradlew`
- Create: `backend/gradlew.bat`
- Create: `backend/domain/build.gradle.kts`
- Create: `backend/application/build.gradle.kts`
- Create: `backend/event-contract/build.gradle.kts`
- Create: `backend/adapters/build.gradle.kts`
- Create: `backend/runtime/build.gradle.kts`

**Interfaces:**

- Consumes: Java 21과 Gradle 8.14.3을 실행할 수 있는 `main` 작업 복사본
- Produces: `:domain`, `:application`, `:event-contract`, `:adapters`, `:runtime` Project와 `backend/gradlew`

- [ ] **Step 1: 브랜치와 Java 환경을 확인한다.**

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/issue-31-spring-boot-bootstrap
java -version
```

Expected: Java Major가 `21`이다. 다르면 `JAVA_HOME`을 JDK 21로 전환한 뒤 진행한다.

- [ ] **Step 2: 프로젝트 목록과 Version Catalog를 작성한다.**

`settings.gradle.kts`:

```kotlin
rootProject.name = "bidflow-backend"

include("domain")
include("application")
include("event-contract")
include("adapters")
include("runtime")
```

`libs.versions.toml`:

```toml
[versions]
spring-boot = "3.5.16"
junit = "5.12.2"
assertj = "3.27.3"

[libraries]
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
assertj-core = { module = "org.assertj:assertj-core", version.ref = "assertj" }

[plugins]
spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }
```

- [ ] **Step 3: 공통 Java·Test 설정을 작성한다.**

루트 `build.gradle.kts`:

```kotlin
plugins {
    base
    alias(libs.plugins.spring.boot) apply false
}

allprojects {
    group = "com.bidflow"
    version = "0.0.1-SNAPSHOT"
    repositories { mavenCentral() }
}

subprojects {
    apply(plugin = "java-library")

    extensions.configure<JavaPluginExtension> {
        toolchain { languageVersion = JavaLanguageVersion.of(21) }
    }

    dependencies {
        "testImplementation"(rootProject.libs.junit.jupiter)
        "testImplementation"(rootProject.libs.assertj.core)
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }
}
```

각 Module Build는 실제로 필요한 Project Dependency만 선언한다. `domain`과 `event-contract`의 Main Compile Classpath에는 외부 의존성이 없다.

- [ ] **Step 4: 허용된 Project 의존성만 선언한다.**

`application/build.gradle.kts`:

```kotlin
dependencies {
    api(project(":domain"))
}
```

`adapters/build.gradle.kts`:

```kotlin
dependencies {
    implementation(project(":application"))
    implementation(project(":domain"))
    implementation(project(":event-contract"))
}
```

`runtime/build.gradle.kts`의 Project 의존성:

```kotlin
dependencies {
    implementation(project(":application"))
    implementation(project(":domain"))
    implementation(project(":event-contract"))
    implementation(project(":adapters"))
}
```

`domain/build.gradle.kts`와 `event-contract/build.gradle.kts`에는 Dependency를 추가하지 않는다.

- [ ] **Step 5: 임시 Gradle 8.14.3 배포본으로 Wrapper를 생성한다.**

```bash
bidflow_gradle_tmp=$(mktemp -d)
curl -fsSLo "$bidflow_gradle_tmp/gradle.zip" \
  https://services.gradle.org/distributions/gradle-8.14.3-bin.zip
unzip -q "$bidflow_gradle_tmp/gradle.zip" -d "$bidflow_gradle_tmp"
"$bidflow_gradle_tmp/gradle-8.14.3/bin/gradle" -p backend \
  wrapper --gradle-version 8.14.3 --distribution-type bin
```

Wrapper 파일은 생성 명령으로 만들며 직접 편집하지 않는다. 임시 디렉터리는 운영 코드나 Git에 포함하지 않는다.

- [ ] **Step 6: Build 설정을 검증한다.**

```bash
cd backend
./gradlew projects
./gradlew javaToolchains
./gradlew test
```

Expected: 다섯 Subproject가 표시되고 Java 21 Toolchain을 사용하며, 테스트가 없어도 Build 설정 오류 없이 성공한다.

- [ ] **Step 7: Scaffold를 커밋한다.**

```bash
git add backend
git commit -m "build(backend): initialize Gradle modules"
```

---

## Task 2: 금지된 모듈 의존 방향 검증

**Files:**

- Modify: `backend/build.gradle.kts`

**Interfaces:**

- Consumes: Task 1의 다섯 Gradle Project와 각 `ProjectDependency`
- Produces: `./gradlew verifyModuleDependencies` Task와 `check` 연결

- [ ] **Step 1: 허용 Project Graph를 Build Logic에 선언한다.**

루트 Build에 다음 계약을 선언한다.

```kotlin
val allowedProjectDependencies = mapOf(
    ":domain" to emptySet(),
    ":application" to setOf(":domain"),
    ":event-contract" to emptySet(),
    ":adapters" to setOf(":application", ":domain", ":event-contract"),
    ":runtime" to setOf(":application", ":domain", ":event-contract", ":adapters"),
)
```

- [ ] **Step 2: 실제 Project Dependency가 계약 밖이면 실패하는 Task를 추가한다.**

```kotlin
val dependencyConfigurations = setOf("api", "implementation", "compileOnly", "runtimeOnly")

val verifyModuleDependencies by tasks.registering {
    doLast {
        allowedProjectDependencies.forEach { (projectPath, allowed) ->
            val actual = project(projectPath).configurations
                .filter { it.name in dependencyConfigurations }
                .flatMap { configuration ->
                    configuration.dependencies
                        .withType<ProjectDependency>()
                        .map { it.dependencyProject.path }
                }
                .toSet()
            val unexpected = actual - allowed
            check(unexpected.isEmpty()) {
                unexpected.joinToString { "$projectPath -> $it is not allowed" }
            }
        }
    }
}

tasks.named("check") {
    dependsOn(verifyModuleDependencies)
}
```

외부 라이브러리는 이 Task의 비교 대상이 아니다.

- [ ] **Step 3: 검증 Task가 정상 Graph에서 통과하는지 확인한다.**

```bash
cd backend
./gradlew verifyModuleDependencies
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: 임시 금지 의존성으로 검증 실패를 확인하고 즉시 되돌린다.**

`application/build.gradle.kts`에 `implementation(project(":adapters"))`를 잠시 추가하고 실행한다.

```bash
cd backend
./gradlew verifyModuleDependencies
```

Expected: `:application -> :adapters is not allowed`를 포함해 실패한다. 확인 직후 해당 한 줄만 제거하고 다시 실행해 통과시킨다.

- [ ] **Step 5: `check`에 검증을 연결하고 커밋한다.**

```bash
cd backend
./gradlew check
cd ..
git add backend/build.gradle.kts
git commit -m "build(backend): enforce module dependency direction"
```

---

## Task 3: 공통 Event Envelope 생성 계약 구현

**Files:**

- Create: `backend/event-contract/src/test/java/com/bidflow/event/EventEnvelopeTest.java`
- Create: `backend/event-contract/src/main/java/com/bidflow/event/EventEnvelope.java`

**Interfaces:**

- Consumes: Task 1의 `event-contract` Java Project
- Produces: `EventEnvelope<T>(UUID eventId, String eventType, int schemaVersion, Instant occurredAt, String correlationId, T payload)`

- [ ] **Step 1: 고정 입력으로 Envelope가 생성되는 실패 테스트를 작성한다.**

```java
package com.bidflow.event;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventEnvelopeTest {
    @Test
    void keepsEveryProvidedFieldWithoutGeneratingHiddenValues() {
        UUID eventId = UUID.fromString("b9347c5f-b02f-4a67-89c9-2d2272ed1a32");
        Instant occurredAt = Instant.parse("2026-07-29T00:00:00Z");
        Map<String, String> payload = Map.of("auctionId", "auction-1");

        EventEnvelope<Map<String, String>> envelope = new EventEnvelope<>(
                eventId, "AuctionCreated", 1, occurredAt, "request-1", payload);

        assertThat(envelope.eventId()).isEqualTo(eventId);
        assertThat(envelope.eventType()).isEqualTo("AuctionCreated");
        assertThat(envelope.schemaVersion()).isEqualTo(1);
        assertThat(envelope.occurredAt()).isEqualTo(occurredAt);
        assertThat(envelope.correlationId()).isEqualTo("request-1");
        assertThat(envelope.payload()).isEqualTo(payload);
    }
}
```

- [ ] **Step 2: RED를 확인한다.**

```bash
cd backend
./gradlew :event-contract:test --tests com.bidflow.event.EventEnvelopeTest
```

Expected: `EventEnvelope` Symbol을 찾을 수 없어 Test Compile이 실패한다.

- [ ] **Step 3: 외부 프레임워크가 없는 Generic Record를 구현한다.**

```java
package com.bidflow.event;

import java.time.Instant;
import java.util.UUID;

public record EventEnvelope<T>(
        UUID eventId,
        String eventType,
        int schemaVersion,
        Instant occurredAt,
        String correlationId,
        T payload
) {}
```

- [ ] **Step 4: GREEN을 확인한다.**

```bash
cd backend
./gradlew :event-contract:test --tests com.bidflow.event.EventEnvelopeTest
```

- [ ] **Step 5: Event Contract를 커밋한다.**

```bash
git add backend/event-contract
git commit -m "test(backend): define common event envelope"
```

---

## Task 4: Event Envelope 검증을 순수 함수로 구현

**Files:**

- Create: `backend/event-contract/src/test/java/com/bidflow/event/EventEnvelopeValidatorTest.java`
- Create: `backend/event-contract/src/main/java/com/bidflow/event/EventEnvelopeViolation.java`
- Create: `backend/event-contract/src/main/java/com/bidflow/event/EventEnvelopeValidator.java`

**Interfaces:**

- Consumes: Task 3의 `EventEnvelope<T>`
- Produces: `EventEnvelopeValidator.validate(EventEnvelope<?> envelope, Instant validationTime, Duration allowedFutureSkew, Set<String> knownTypes): List<EventEnvelopeViolation>`

- [ ] **Step 1: 정상·누락·미지원 Type·Version·미래 시각 실패 테스트를 작성한다.**

테스트 기준은 다음 고정값을 사용한다.

```java
private static final Instant VALIDATION_TIME = Instant.parse("2026-07-29T00:00:00Z");
private static final Duration ALLOWED_FUTURE_SKEW = Duration.ofMinutes(1);
private static final Set<String> KNOWN_TYPES = Set.of("AuctionCreated");
```

각 Case는 `validate(envelope, VALIDATION_TIME, ALLOWED_FUTURE_SKEW, KNOWN_TYPES)` 반환값을 검증한다.

```text
정상                  -> 빈 List
eventId null          -> EVENT_ID_REQUIRED
eventType blank       -> EVENT_TYPE_REQUIRED
eventType Unknown     -> EVENT_TYPE_UNKNOWN
schemaVersion 0       -> SCHEMA_VERSION_INVALID
occurredAt null       -> OCCURRED_AT_REQUIRED
occurredAt + 61초     -> OCCURRED_AT_TOO_FAR_IN_FUTURE
correlationId blank   -> CORRELATION_ID_REQUIRED
payload null          -> PAYLOAD_REQUIRED
```

- [ ] **Step 2: RED를 확인한다.**

```bash
cd backend
./gradlew :event-contract:test --tests com.bidflow.event.EventEnvelopeValidatorTest
```

Expected: Validator와 Violation Type이 없어 Test Compile이 실패한다.

- [ ] **Step 3: Violation Enum과 Validator를 최소 구현한다.**

```java
public enum EventEnvelopeViolation {
    EVENT_ID_REQUIRED,
    EVENT_TYPE_REQUIRED,
    EVENT_TYPE_UNKNOWN,
    SCHEMA_VERSION_INVALID,
    OCCURRED_AT_REQUIRED,
    OCCURRED_AT_TOO_FAR_IN_FUTURE,
    CORRELATION_ID_REQUIRED,
    PAYLOAD_REQUIRED
}
```

Validator는 모든 입력을 인자로 받고, 발견 순서가 고정된 수정 불가능한 `List<EventEnvelopeViolation>`을 반환한다. `Instant.now()`, `Clock.systemUTC()`와 UUID 생성을 호출하지 않는다.

```java
package com.bidflow.event;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class EventEnvelopeValidator {
    private EventEnvelopeValidator() {}

    public static List<EventEnvelopeViolation> validate(
            EventEnvelope<?> envelope,
            Instant validationTime,
            Duration allowedFutureSkew,
            Set<String> knownTypes
    ) {
        List<EventEnvelopeViolation> violations = new ArrayList<>();
        if (envelope.eventId() == null) violations.add(EventEnvelopeViolation.EVENT_ID_REQUIRED);
        if (envelope.eventType() == null || envelope.eventType().isBlank()) {
            violations.add(EventEnvelopeViolation.EVENT_TYPE_REQUIRED);
        } else if (!knownTypes.contains(envelope.eventType())) {
            violations.add(EventEnvelopeViolation.EVENT_TYPE_UNKNOWN);
        }
        if (envelope.schemaVersion() < 1) {
            violations.add(EventEnvelopeViolation.SCHEMA_VERSION_INVALID);
        }
        if (envelope.occurredAt() == null) {
            violations.add(EventEnvelopeViolation.OCCURRED_AT_REQUIRED);
        } else if (envelope.occurredAt().isAfter(validationTime.plus(allowedFutureSkew))) {
            violations.add(EventEnvelopeViolation.OCCURRED_AT_TOO_FAR_IN_FUTURE);
        }
        if (envelope.correlationId() == null || envelope.correlationId().isBlank()) {
            violations.add(EventEnvelopeViolation.CORRELATION_ID_REQUIRED);
        }
        if (envelope.payload() == null) violations.add(EventEnvelopeViolation.PAYLOAD_REQUIRED);
        return List.copyOf(violations);
    }
}
```

- [ ] **Step 4: GREEN과 Spring 부재를 확인한다.**

```bash
cd backend
./gradlew :event-contract:test
./gradlew :event-contract:dependencies --configuration runtimeClasspath | rg 'spring|jackson'
```

Expected: 테스트가 통과한다. 두 번째 명령은 Spring/Jackson 항목을 찾지 못해 `rg` 종료 코드 1이 될 수 있으며, 그 결과가 의존성 부재 증적이다.

- [ ] **Step 5: 검증 코드를 커밋한다.**

```bash
git add backend/event-contract
git commit -m "test(backend): validate event envelope values"
```

---

## Task 5: Spring Boot Runtime과 Readiness Endpoint 구성

**Files:**

- Create: `backend/runtime/src/main/java/com/bidflow/BidFlowApplication.java`
- Create: `backend/runtime/src/main/resources/application.yml`
- Create: `backend/runtime/src/test/java/com/bidflow/ReadinessEndpointTest.java`
- Modify: `backend/runtime/build.gradle.kts`

**Interfaces:**

- Consumes: Task 1의 `runtime` Project와 Task 2가 허용한 하위 Project 의존성
- Produces: `com.bidflow.BidFlowApplication`, HTTP `GET /actuator/health/readiness`, 실행 가능한 Boot Jar

- [ ] **Step 1: Readiness HTTP 계약의 실패 테스트를 작성한다.**

```java
package com.bidflow;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ReadinessEndpointTest {
    private final MockMvc mockMvc;

    @Autowired
    ReadinessEndpointTest(MockMvc mockMvc) {
        this.mockMvc = mockMvc;
    }

    @Test
    void exposesReadinessForAlbHealthChecks() throws Exception {
        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }
}
```

- [ ] **Step 2: RED를 확인한다.**

```bash
cd backend
./gradlew :runtime:test --tests com.bidflow.ReadinessEndpointTest
```

Expected: Spring Application과 Readiness 설정이 없어 실패한다.

- [ ] **Step 3: 최소 Spring Boot Application과 Actuator 설정을 구현한다.**

`runtime/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.spring.boot)
}

dependencies {
    implementation(project(":application"))
    implementation(project(":domain"))
    implementation(project(":event-contract"))
    implementation(project(":adapters"))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}
```

`BidFlowApplication.java`:

```java
package com.bidflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BidFlowApplication {
    public static void main(String[] args) {
        SpringApplication.run(BidFlowApplication.class, args);
    }
}
```

`application.yml`:

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health
server:
  shutdown: graceful
spring:
  application:
    name: bidflow
```

`BidFlowApplication`은 `@SpringBootApplication`과 `main`만 가진다. 별도 Custom Health Endpoint를 만들지 않는다.

- [ ] **Step 4: GREEN과 Boot Artifact를 확인한다.**

```bash
cd backend
./gradlew :runtime:test --tests com.bidflow.ReadinessEndpointTest
./gradlew :runtime:bootJar
test -n "$(find runtime/build/libs -maxdepth 1 -name '*.jar' -print -quit)"
```

- [ ] **Step 5: Runtime을 커밋한다.**

```bash
git add backend/runtime
git commit -m "feat(backend): expose Spring readiness probe"
```

---

## Task 6: 전체 검증과 PR 작성

**Files:**

- Create: `docs/reports/issue-031-spring-boot-bootstrap.md`

**Interfaces:**

- Consumes: Task 1~5의 실제 RED·GREEN 명령 출력과 Git 변경
- Produces: Issue #31 검증 보고서와 `Closes #31` PR

- [ ] **Step 1: 보고서에 실제 Red–Green 증적을 기록한다.**

```text
RED
- EventEnvelope Test Compile 실패
- EventEnvelopeValidator Test Compile 실패
- Readiness Endpoint Test 실패
- 임시 금지 Module Dependency 검증 실패

GREEN
- ./gradlew verifyModuleDependencies
- ./gradlew test
- ./gradlew check
- ./gradlew :runtime:bootJar

MANUAL
- Java와 Gradle Wrapper 버전
- event-contract Runtime Classpath의 Spring/Jackson 부재
- 생성된 Runtime Boot Jar
```

- [ ] **Step 2: 금지 패턴과 Placeholder를 검사한다.**

```bash
rg -n 'TODO|TBD|FIXME|@Autowired\\s+(private|protected|public)|Thread\\.sleep|Instant\\.now|UUID\\.randomUUID' backend docs/reports/issue-031-spring-boot-bootstrap.md
git diff --check
```

Expected: 테스트의 `MockMvc` 주입 외 Field Injection, 숨은 시간·ID 생성과 Placeholder가 없다.

- [ ] **Step 3: 최종 검증을 새로 실행한다.**

```bash
cd backend
./gradlew --version
./gradlew clean verifyModuleDependencies test check :runtime:bootJar
cd ..
```

- [ ] **Step 4: 보고서를 커밋하고 원격 브랜치를 올린다.**

```bash
git add docs/reports/issue-031-spring-boot-bootstrap.md
git commit -m "docs(backend): record issue 31 verification"
git push -u origin feature/issue-31-spring-boot-bootstrap
```

- [ ] **Step 5: PR을 생성한다.**

PR 제목: `[B] Spring Boot 프로젝트와 공통 이벤트 모듈 초기화`

PR 본문에는 `Closes #31`, 실제 RED/GREEN/MANUAL 증적, Gradle 설정 TDD 예외, 모듈 의존 검증 결과를 포함한다. #30이나 #32 파일을 이 PR에 섞지 않는다.
