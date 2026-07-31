import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.tasks.testing.Test

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
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }
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
