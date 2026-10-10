package com.sudaduck.aichat.openai;

/**
 * OpenAI chat/completions 요청 본문의 messages 항목. 필드명이 그대로 JSON 키가 된다.
 */
public record ChatMessage(String role, String content) {

    public static ChatMessage system(String content) {
        return new ChatMessage("system", content);
    }

    public static ChatMessage user(String content) {
        return new ChatMessage("user", content);
    }

    public static ChatMessage assistant(String content) {
        return new ChatMessage("assistant", content);
    }
}
