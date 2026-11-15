FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY backend backend
RUN ./backend/gradlew --no-daemon -p backend :runtime:bootJar

FROM eclipse-temurin:21-jre
WORKDIR /opt/bidflow

RUN groupadd --system bidflow && useradd --system --gid bidflow --home-dir /opt/bidflow bidflow
COPY --from=build /workspace/backend/runtime/build/libs/runtime-*.jar app.jar

USER bidflow
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/opt/bidflow/app.jar"]
