import org.gradle.api.plugins.JavaPluginExtension
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
