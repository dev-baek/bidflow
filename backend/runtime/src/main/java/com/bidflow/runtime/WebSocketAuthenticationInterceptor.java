package com.bidflow.runtime;

import java.security.Principal;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;

/** Rejects every STOMP CONNECT unless a configured Cognito verifier accepts its Bearer token. */
final class WebSocketAuthenticationInterceptor implements ChannelInterceptor {
    private final ObjectProvider<WebSocketAccessTokenVerifier> verifier;

    WebSocketAuthenticationInterceptor(ObjectProvider<WebSocketAccessTokenVerifier> verifier) {
        this.verifier = verifier;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() != StompCommand.CONNECT) return message;
        String authorization = accessor.getFirstNativeHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new IllegalArgumentException("WebSocket CONNECT requires a Bearer token");
        }
        WebSocketAccessTokenVerifier tokenVerifier = verifier.getIfAvailable();
        if (tokenVerifier == null) {
            throw new IllegalStateException("Cognito WebSocket token verifier is not configured");
        }
        Principal principal = tokenVerifier.verify(authorization.substring("Bearer ".length()));
        accessor.setUser(principal);
        return message;
    }
}
