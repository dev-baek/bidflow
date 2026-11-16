package com.bidflow.runtime;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@Profile("local")
class LocalCorsConfiguration implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("http://127.0.0.1:5173", "http://localhost:5173")
                .allowedMethods("GET", "POST", "PUT", "OPTIONS")
                .allowedHeaders("Content-Type", "Idempotency-Key", "X-Actor-Id")
                .exposedHeaders("X-Correlation-Id")
                .maxAge(3600);
    }
}
