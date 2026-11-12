package com.bidflow.runtime;

import java.security.Principal;

interface WebSocketAccessTokenVerifier {
    Principal verify(String accessToken);
}
