package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.bidflow.application.search.ProductSearchDocumentWriter;
import com.bidflow.application.search.ProductSearchReader;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;

class SearchConfigurationTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withPropertyValues("spring.config.location=classpath:/")
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withUserConfiguration(SearchConfiguration.class)
            .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
            .withBean(ObjectMapper.class, ObjectMapper::new);

    @Test void awsModeWithoutManagedSettingsRefusesToFallBackToLocal() {
        context.withPropertyValues("BIDFLOW_SEARCH_MODE=aws", "BIDFLOW_SEARCH_AWS_ENDPOINT=", "BIDFLOW_SEARCH_AWS_REGION=")
                .run(result -> {
                    assertThat(result).hasFailed();
                    assertThat(result.getStartupFailure()).hasRootCauseMessage(
                            "Managed OpenSearch requires a private Tokyo HTTPS endpoint and Region.");
                });
    }

    @Test void localAndValidAwsModeBuildTheExistingReaderAndWriterWithoutNetworkAccess() {
        for (String[] properties : new String[][] {
                {"BIDFLOW_SEARCH_MODE=local"},
                {"BIDFLOW_SEARCH_MODE=aws", "BIDFLOW_SEARCH_AWS_REGION=ap-northeast-1",
                        "BIDFLOW_SEARCH_AWS_ENDPOINT=https://vpc-bidflow-verification-search-demo.ap-northeast-1.es.amazonaws.com"}
        }) {
            context.withPropertyValues(properties).run(result -> {
                assertThat(result).hasNotFailed().hasSingleBean(ProductSearchReader.class)
                        .hasSingleBean(ProductSearchDocumentWriter.class);
            });
        }
    }
}
