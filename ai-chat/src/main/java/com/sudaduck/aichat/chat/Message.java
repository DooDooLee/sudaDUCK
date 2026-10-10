package com.sudaduck.aichat.chat;

import com.sudaduck.aichat.openai.ChatMessage;

/**
 * Redis 에 저장되는 대화 한 줄. at 은 epoch millis.
 */
public record Message(String role, String content, long at) {

    public static Message user(String content) {
        return new Message("user", content, System.currentTimeMillis());
    }

    public static Message assistant(String content) {
        return new Message("assistant", content, System.currentTimeMillis());
    }

    public ChatMessage toChatMessage() {
        return new ChatMessage(role, content);
    }
}
