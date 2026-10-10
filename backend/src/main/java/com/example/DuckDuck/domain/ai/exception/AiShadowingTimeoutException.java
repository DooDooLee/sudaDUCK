package com.example.DuckDuck.domain.ai.exception;

public class AiShadowingTimeoutException extends RuntimeException {

    public AiShadowingTimeoutException() {
        super("쉐도잉 생성 시간 초과");
    }
}
