package com.bidflow.runtime;

import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
class WebSocketSupportConfiguration {
    @Bean
    ThreadPoolTaskScheduler webSocketHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("websocket-heartbeat-");
        scheduler.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        return scheduler;
    }

    @Bean
    WebSocketAuthenticationInterceptor webSocketAuthenticationInterceptor(ObjectProvider<WebSocketAccessTokenVerifier> verifier) {
        return new WebSocketAuthenticationInterceptor(verifier);
    }
}
