package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SimpleCommandLinePropertySource;
import org.springframework.scheduling.annotation.Scheduled;

class OutboxDelayConfigurationTest {
    @Test void localProfilesUseOneHundredMilliseconds() throws Exception {
        for (String profiles : new String[] {"local", "local,e2e"}) verifyDelay(profiles, false, "100");
    }

    @Test void nonLocalProfilesKeepCommonFallback() throws Exception {
        for (String profiles : new String[] {"", "e2e", "prod"}) verifyDelay(profiles, false, "1000");
    }

    @Test void explicitCommandLineOverrideWinsOverLocalProfile() throws Exception {
        for (String profiles : new String[] {"local", "local,e2e"}) verifyDelay(profiles, true, "1000");
    }

    private void verifyDelay(String profiles, boolean override, String expected) throws Exception {
        String expression = OutboxScheduler.class.getDeclaredMethod("publishPending")
                .getAnnotation(Scheduled.class).fixedDelayString();
        new ApplicationContextRunner()
                .withPropertyValues("spring.profiles.active=" + profiles, "spring.config.location=classpath:/")
                .withInitializer(context -> {
                    if (override) context.getEnvironment().getPropertySources().addFirst(
                            new SimpleCommandLinePropertySource("--bidflow.outbox.fixed-delay-ms=1000"));
                    new ConfigDataApplicationContextInitializer().initialize(context);
                })
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getEnvironment().resolveRequiredPlaceholders(expression)).isEqualTo(expected);
                    assertThat(context.getEnvironment().getProperty("logging.level.com.bidflow.runtime.OutboxScheduler"))
                            .isNull();
                });
    }
}
