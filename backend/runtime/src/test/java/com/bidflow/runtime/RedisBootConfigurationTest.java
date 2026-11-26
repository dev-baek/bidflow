package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import io.lettuce.core.SslVerifyMode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

class RedisBootConfigurationTest {
    private static final String ENDPOINT = "redis.example.cache.amazonaws.com";
    private static final String FIXTURE_TOKEN = "FakeRedisTokenAbc1234567890abcde";

    @Test void ec2EnvBindsToAuthenticatedTlsWithPeerVerification() {
        withEnvironment(Map.of("SPRING_DATA_REDIS_HOST", ENDPOINT, "SPRING_DATA_REDIS_PORT", "6379",
                "SPRING_DATA_REDIS_SSL_ENABLED", "true", "SPRING_DATA_REDIS_PASSWORD", FIXTURE_TOKEN))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    var connection = context.getBean(LettuceConnectionFactory.class);
                    assertThat(connection.getHostName()).isEqualTo(ENDPOINT);
                    assertThat(connection.getPort()).isEqualTo(6379);
                    assertThat(connection.isUseSsl()).isTrue();
                    assertThat(connection.getClientConfiguration().getVerifyMode()).isEqualTo(SslVerifyMode.FULL);
                    assertThat(connection.getStandaloneConfiguration().getPassword().get()).isEqualTo(FIXTURE_TOKEN.toCharArray());
                });
    }

    @Test void localEnvRetainsTheExistingHostPortAndNoAuthDefaults() {
        withEnvironment(Map.of("BIDFLOW_REDIS_HOST", "localhost", "BIDFLOW_REDIS_PORT", "16379"))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    var connection = context.getBean(LettuceConnectionFactory.class);
                    assertThat(connection.getHostName()).isEqualTo("localhost");
                    assertThat(connection.getPort()).isEqualTo(16379);
                    assertThat(connection.isUseSsl()).isFalse();
                    assertThat(connection.getStandaloneConfiguration().getPassword().isPresent()).isFalse();
                });
    }

    private static ApplicationContextRunner withEnvironment(Map<String, Object> variables) {
        return new ApplicationContextRunner().withConfiguration(AutoConfigurations.of(RedisAutoConfiguration.class))
                .withPropertyValues("spring.config.location=classpath:/")
                .withInitializer(context -> {
                    var name = StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME;
                    context.getEnvironment().getPropertySources().replace(name, new SystemEnvironmentPropertySource(name, variables));
                    new ConfigDataApplicationContextInitializer().initialize(context);
                });
    }
}
