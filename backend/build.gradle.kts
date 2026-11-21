import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.SourceSetContainer

plugins {
    base
    alias(libs.plugins.spring.boot) apply false
}

allprojects {
    group = "com.bidflow"
    version = "0.0.1-SNAPSHOT"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java-library")

    extensions.configure<JavaPluginExtension> {
        toolchain {
            languageVersion = JavaLanguageVersion.of(21)
        }
    }

    dependencies {
        "testImplementation"(rootProject.libs.junit.jupiter)
        "testImplementation"(rootProject.libs.assertj.core)
        "testRuntimeOnly"(rootProject.libs.junit.platform.launcher)
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }

    val tests = extensions.getByType<SourceSetContainer>().named("test")
    tasks.register<Test>("unitTest") {
        group = "verification"
        description = "Runs tests without external services; integration tests remain in test/check"
        testClassesDirs = tests.get().output.classesDirs
        classpath = tests.get().runtimeClasspath
        useJUnitPlatform { excludeTags("integration") }
    }
}

tasks.register("unitTest") {
    group = "verification"
    dependsOn(subprojects.map { it.tasks.named("unitTest") })
}

val allowedProjectDependencies = mapOf(
    ":domain" to emptySet(),
    ":application" to setOf(":domain"),
    ":event-contract" to emptySet(),
    ":adapters" to setOf(":application", ":domain", ":event-contract"),
    ":runtime" to setOf(":application", ":domain", ":event-contract", ":adapters"),
)

val dependencyConfigurations = setOf("api", "implementation", "compileOnly", "runtimeOnly")

val verifyModuleDependencies by tasks.registering {
    doLast {
        allowedProjectDependencies.forEach { (projectPath, allowed) ->
            val actual = project(projectPath).configurations
                .filter { it.name in dependencyConfigurations }
                .flatMap { configuration ->
                    configuration.dependencies
                        .withType<ProjectDependency>()
                        .map { it.path }
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
