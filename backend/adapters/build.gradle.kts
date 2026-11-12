dependencies {
    implementation(project(":application"))
    implementation(project(":domain"))
    implementation(project(":event-contract"))
    implementation(libs.flyway.core)
    implementation(libs.flyway.database.postgresql)
    implementation(libs.aws.sdk.s3)
    implementation(libs.aws.sdk.url.connection.client)
    runtimeOnly(libs.postgresql)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.testcontainers.junit.jupiter)
}
