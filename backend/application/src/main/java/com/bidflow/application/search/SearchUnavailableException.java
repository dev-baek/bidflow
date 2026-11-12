package com.bidflow.application.search;

public final class SearchUnavailableException extends RuntimeException {
    public SearchUnavailableException(Throwable cause) { super(cause); }
    public SearchUnavailableException(String message) { super(message); }
}
