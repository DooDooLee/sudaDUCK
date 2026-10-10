package com.sudaduck.aichat.chat;

public class SessionNotFoundException extends RuntimeException {

    public SessionNotFoundException(String sessionId) {
        super("세션이 없거나 만료됐습니다: " + sessionId);
    }
}
