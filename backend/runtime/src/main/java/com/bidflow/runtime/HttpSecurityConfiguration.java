package com.bidflow.runtime;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
@Profile("local")
class LocalHttpSecurityConfiguration {
    @Bean
    LocalActorAuthenticationFilter localActorAuthenticationFilter() {
        return new LocalActorAuthenticationFilter();
    }

    @Bean
    SecurityFilterChain localSecurityFilterChain(HttpSecurity http, LocalActorAuthenticationFilter actorFilter) throws Exception {
        ApiSecurityErrorHandler errors = new ApiSecurityErrorHandler();
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(configuration -> configuration.authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/listings/**").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(actorFilter, AnonymousAuthenticationFilter.class)
                .build();
    }
}

@Configuration
@Profile("!local")
@ConditionalOnProperty(prefix = "bidflow.cognito", name = "issuer-uri")
class CognitoJwtDecoderConfiguration {
    @Bean
    JwtDecoder cognitoJwtDecoder(@Value("${bidflow.cognito.issuer-uri}") String issuerUri,
            @Value("${bidflow.cognito.client-id}") String clientId) {
        NimbusJwtDecoder decoder = (NimbusJwtDecoder) JwtDecoders.fromIssuerLocation(issuerUri);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuerUri), new CognitoAccessTokenValidator(clientId)));
        return decoder;
    }
}

@Configuration
@Profile("!local")
class CognitoHttpSecurityConfiguration {
    @Bean
    SecurityFilterChain cognitoSecurityFilterChain(HttpSecurity http, ObjectProvider<JwtDecoder> decoder) throws Exception {
        ApiSecurityErrorHandler errors = new ApiSecurityErrorHandler();
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(configuration -> configuration.authenticationEntryPoint(errors).accessDeniedHandler(errors));
        if (decoder.getIfAvailable() == null) {
            return http.authorizeHttpRequests(authorize -> authorize
                    .requestMatchers("/actuator/health/**").permitAll()
                    .anyRequest().denyAll()).build();
        }
        return http
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/listings/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .build();
    }
}
