package com.sudaduck.aichat.chat;

/**
 * 클라이언트로 내려보내는 SSE 이벤트.
 * token: 글자 조각 / done: 완성된 답변 전문 / error: 실패 사유
 */
public record ChatEvent(String type, String text) {

    public static ChatEvent token(String text) {
        return new ChatEvent("token", text);
    }

    public static ChatEvent done(String fullText) {
        return new ChatEvent("done", fullText);
    }

    public static ChatEvent error(String reason) {
        return new ChatEvent("error", reason);
    }
}
