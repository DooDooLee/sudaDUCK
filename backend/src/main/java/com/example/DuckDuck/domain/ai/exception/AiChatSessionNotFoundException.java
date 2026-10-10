package com.example.DuckDuck.domain.ai.exception;

public class AiChatSessionNotFoundException extends RuntimeException {

    public AiChatSessionNotFoundException(String sessionId) {
        super("세션이 없거나 만료됐습니다: " + sessionId);
    }
}
