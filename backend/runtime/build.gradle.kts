plugins {
    alias(libs.plugins.spring.boot)
}

tasks.register<JavaExec>("replayListingEvent") {
    description = "Dry-run or explicitly replay one local listing-event DLT record without starting Spring"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.bidflow.runtime.ListingEventReplayCli")
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(21))
    })
    workingDir = rootProject.projectDir.parentFile
}

dependencies {
    implementation(platform(libs.spring.boot.dependencies))
    implementation(project(":application"))
    implementation(project(":domain"))
    implementation(project(":event-contract"))
    implementation(project(":adapters"))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.kafka:spring-kafka")
    runtimeOnly(libs.aws.msk.iam.auth)
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:testcontainers:1.21.3")
    testImplementation(libs.testcontainers.junit.jupiter)
}
