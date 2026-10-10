package com.example.DuckDuck.domain.ai.service;

import com.example.DuckDuck.domain.ai.dto.AiChatMessage;
import com.example.DuckDuck.domain.ai.dto.ShadowingScript;
import com.example.DuckDuck.domain.ai.exception.AiChatSessionNotFoundException;
import com.example.DuckDuck.domain.ai.exception.AiShadowingTimeoutException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 싱글 모드 AI 대화 (SSE 스트리밍)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiChatService {

    private final GptService gptService;
    private final AiChatSessionService sessionService;
    private final AiShadowingService shadowingService;
    private final ObjectMapper objectMapper;

    private static final long SHADOWING_TIMEOUT_SECONDS = 60;

    private static final String SYSTEM_PROMPT = """
            너는 '수덕'이라는 이름의 오리 캐릭터야. 한국어로 수다 떠는 연습 상대 역할을 해.
            오늘 대화 주제: %s

            규칙
            - 한국어로만 말한다.
            - 친구처럼 편한 반말을 쓴다.
            - 한 번에 한두 문장만 말한다. 길게 설명하지 않는다.
            - 매번 마지막에 상대가 더 이야기하게 만드는 질문을 하나 던진다.
            - 상대의 말을 평가하거나 고쳐주지 않는다. 그냥 자연스럽게 대화를 이어간다.
            """;

    private static final String GREETING_INSTRUCTION = "지금 대화를 시작해. 주제에 맞게 짧게 인사하고 첫 질문을 하나 던져.";

    /**
     * 봇이 먼저 인사 (인사 지시문은 Redis에 저장하지 않음)
     */
    @Async("chatTaskExecutor")
    public void streamGreeting(String sessionId, SseEmitter emitter) {
        stream(sessionId, null, emitter);
    }

    /**
     * 사용자 메시지 저장 후 답변 스트리밍
     */
    @Async("chatTaskExecutor")
    public void streamReply(String sessionId, String text, SseEmitter emitter) {
        stream(sessionId, text, emitter);
    }

    // OpenAI 스트림이 끝날 때까지 chatTaskExecutor 쓰레드 하나를 계속 점유함 (의도된 동작)
    private void stream(String sessionId, String userText, SseEmitter emitter) {
        long start = System.currentTimeMillis();
        try {
            String topic = sessionService.getTopic(sessionId);

            if (userText != null) {
                sessionService.appendMessage(sessionId, "user", userText);
            }

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "system", "content", String.format(SYSTEM_PROMPT, topic)));
            for (AiChatMessage m : sessionService.getRecentMessages(sessionId)) {
                messages.add(Map.of("role", m.getRole(), "content", m.getContent()));
            }
            if (userText == null) {
                messages.add(Map.of("role", "user", "content", GREETING_INSTRUCTION));
            }

            String reply = gptService.streamChat(messages, token -> {
                try {
                    send(emitter, "token", token);
                } catch (IOException e) {
                    // 클라이언트 연결 끊김 -> 예외로 OpenAI 스트림 읽기 중단
                    throw new UncheckedIOException(e);
                }
            });

            sessionService.appendMessage(sessionId, "assistant", reply);
            send(emitter, "done", reply);
            emitter.complete();
            log.info("싱글 모드 응답 완료 - sessionId: {}, {}ms", sessionId, System.currentTimeMillis() - start);

        } catch (AiChatSessionNotFoundException e) {
            sendErrorAndComplete(emitter, e.getMessage());
        } catch (UncheckedIOException e) {
            log.warn("SSE 전송 실패 (연결 끊김) - sessionId: {}", sessionId);
            emitter.complete();
        } catch (Exception e) {
            log.error("싱글 모드 스트리밍 실패 - sessionId: {}, error: {}", sessionId, e.getMessage());
            sendErrorAndComplete(emitter, "AI 응답 생성에 실패했습니다.");
        }
    }

    /**
     * 대화 메시지(user/assistant)마다 쉐도잉 스크립트 생성 (문장당 @Async 작업 1개) 후 Redis 저장
     */
    public List<ShadowingScript> generateShadowing(String sessionId) {
        long start = System.currentTimeMillis();

        // 사용자·봇 메시지 모두 대화 순서대로
        List<AiChatMessage> sentences = sessionService.getAllMessages(sessionId);

        List<CompletableFuture<ShadowingScript>> futures = sentences.stream()
                .map(m -> shadowingService.generateOne(m.getRole(), m.getContent()))
                .toList();

        // 호출한 Tomcat 쓰레드는 모든 문장이 끝날 때까지 여기서 대기하고, executor 쓰레드도 각자 OpenAI 응답을 기다리며 막혀 있음
        try {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                    .orTimeout(SHADOWING_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof TimeoutException) {
                log.warn("쉐도잉 생성 시간 초과 - sessionId: {}", sessionId);
                throw new AiShadowingTimeoutException();
            }
            throw e;
        }

        // 문장 순서 유지, 건너뛴 문장(null) 제외
        List<ShadowingScript> scripts = futures.stream()
                .map(CompletableFuture::join)
                .filter(Objects::nonNull)
                .toList();

        sessionService.saveShadowing(sessionId, scripts);
        log.info("쉐도잉 생성 완료 - sessionId: {}, 문장 {}개 중 {}개, {}ms",
                sessionId, sentences.size(), scripts.size(), System.currentTimeMillis() - start);
        return scripts;
    }

    private void send(SseEmitter emitter, String type, String text) throws IOException {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("text", text);
        String json = objectMapper.writeValueAsString(payload);
        emitter.send(SseEmitter.event().name(type).data(json, MediaType.APPLICATION_JSON));
    }

    private void sendErrorAndComplete(SseEmitter emitter, String reason) {
        try {
            send(emitter, "error", reason);
        } catch (Exception ignored) {
            // 이미 끊긴 연결
        }
        emitter.complete();
    }
}
