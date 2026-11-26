package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration;
import org.springframework.boot.autoconfigure.kafka.KafkaProperties;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.ProducerFactory;

class MskKafkaConfigurationTest {
    private static final String BROKER_A = "boot-a.kafka-serverless.ap-northeast-1.amazonaws.com:9098";
    private static final String BROKER_B = "boot-b.kafka-serverless.ap-northeast-1.amazonaws.com:9098";
    private static final String LOGIN_MODULE = "software.amazon.msk.auth.iam.IAMLoginModule";
    private static final String CALLBACK = "software.amazon.msk.auth.iam.IAMClientCallbackHandler";

    @ParameterizedTest
    @ValueSource(strings = {"msk", "verification,msk", "msk,verification"})
    void allKafkaClientsUseTheIamContract(String profiles) {
        kafkaContext(profiles)
                .withPropertyValues("BIDFLOW_MSK_BOOTSTRAP_SERVERS=" + BROKER_A + ", " + BROKER_B,
                        "BIDFLOW_KAFKA_BOOTSTRAP_SERVERS=localhost:19092")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    ProducerFactory<?, ?> producerFactory = context.getBean(ProducerFactory.class);
                    ConsumerFactory<?, ?> consumerFactory = context.getBean(ConsumerFactory.class);
                    var producer = producerFactory.getConfigurationProperties();
                    var consumer = consumerFactory.getConfigurationProperties();
                    var admin = context.getBean(KafkaAdmin.class).getConfigurationProperties();
                    for (Map<String, Object> properties : List.of(producer, consumer, admin)) {
                        assertThat(properties)
                                .containsEntry("bootstrap.servers", List.of(BROKER_A, BROKER_B))
                                .containsEntry("security.protocol", "SASL_SSL")
                                .containsEntry("sasl.mechanism", "AWS_MSK_IAM")
                                .containsEntry("sasl.jaas.config", LOGIN_MODULE + " required;")
                                .containsEntry("sasl.client.callback.handler.class", CALLBACK);
                    }
                    assertThat(producer).containsEntry("enable.idempotence", "true").containsEntry("acks", "all");
                    assertThat(consumer).containsEntry("allow.auto.create.topics", "false")
                            .containsEntry("enable.auto.commit", false);
                    assertThat(context.getBean(KafkaProperties.class).getAdmin().isAutoCreate()).isFalse();
                });
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", ",", "boot-a:9098,"})
    void missingOrEmptyBootstrapDoesNotFallBack(String bootstrap) {
        var runner = kafkaContext("msk").withPropertyValues("BIDFLOW_KAFKA_BOOTSTRAP_SERVERS=localhost:19092");
        if (bootstrap != null) runner = runner.withPropertyValues("BIDFLOW_MSK_BOOTSTRAP_SERVERS=" + bootstrap);
        runner.run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseMessage(
                    "MSK requires BIDFLOW_MSK_BOOTSTRAP_SERVERS with no empty entries.");
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {"local", "verification", ""})
    void otherProfilesKeepRegularKafkaSettings(String profiles) {
        kafkaContext(profiles)
                .withPropertyValues("BIDFLOW_MSK_BOOTSTRAP_SERVERS=" + BROKER_A,
                        "BIDFLOW_KAFKA_BOOTSTRAP_SERVERS=localhost:19092")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    ProducerFactory<?, ?> producerFactory = context.getBean(ProducerFactory.class);
                    assertThat(producerFactory.getConfigurationProperties())
                            .containsEntry("bootstrap.servers", List.of("localhost:19092"))
                            .doesNotContainKeys("sasl.mechanism", "sasl.jaas.config", "sasl.client.callback.handler.class");
                });
    }

    @Test
    void kafkaCanLoadTheIamPluginFromTheRuntimeClasspath() throws ClassNotFoundException {
        var loader = getClass().getClassLoader();
        assertThat(javax.security.auth.spi.LoginModule.class.isAssignableFrom(
                Class.forName(LOGIN_MODULE, false, loader))).isTrue();
        assertThat(org.apache.kafka.common.security.auth.AuthenticateCallbackHandler.class.isAssignableFrom(
                Class.forName(CALLBACK, false, loader))).isTrue();
    }

    private ApplicationContextRunner kafkaContext(String profiles) {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(KafkaAutoConfiguration.class))
                .withUserConfiguration(MskKafkaConfiguration.class)
                .withPropertyValues("spring.profiles.active=" + profiles, "spring.config.location=classpath:/")
                .withInitializer(context -> {
                    context.getEnvironment().getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
                    new ConfigDataApplicationContextInitializer().initialize(context);
                });
    }
}
