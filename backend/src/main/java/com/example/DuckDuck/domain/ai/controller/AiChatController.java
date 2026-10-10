package com.example.DuckDuck.domain.ai.controller;

import com.example.DuckDuck.domain.ai.dto.AiChatMessage;
import com.example.DuckDuck.domain.ai.dto.AiChatMessageRequest;
import com.example.DuckDuck.domain.ai.dto.AiChatSessionRequest;
import com.example.DuckDuck.domain.ai.dto.ShadowingResponse;
import com.example.DuckDuck.domain.ai.exception.AiChatSessionNotFoundException;
import com.example.DuckDuck.domain.ai.exception.AiShadowingTimeoutException;
import com.example.DuckDuck.domain.ai.service.AiChatService;
import com.example.DuckDuck.domain.ai.service.AiChatSessionService;
import com.example.DuckDuck.global.security.jwt.JwtTokenProvider;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

/**
 * 싱글 모드 (AI 오리와 1:1 대화) API
 */
@RestController
@RequestMapping("/api/v1/ai-chat")
@RequiredArgsConstructor
@Slf4j
public class AiChatController {

    private final AiChatService aiChatService;
    private final AiChatSessionService sessionService;
    private final JwtTokenProvider jwtTokenProvider;

    private static final long SSE_TIMEOUT_MS = 60_000L;

    @PostMapping("/sessions")
    public ResponseEntity<Map<String, String>> createSession(
            @RequestHeader("Authorization") String authHeader,
            @Valid @RequestBody AiChatSessionRequest request) {

        String token = authHeader.substring(7);
        Long userId = jwtTokenProvider.getUserId(token);

        String sessionId = sessionService.createSession(request.getTopic(), userId);
        return ResponseEntity.ok(Map.of("sessionId", sessionId));
    }

    @PostMapping(value = "/sessions/{sessionId}/greeting", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter greeting(@PathVariable String sessionId) {
        SseEmitter emitter = createEmitter(sessionId);
        aiChatService.streamGreeting(sessionId, emitter);
        return emitter;
    }

    @PostMapping(value = "/sessions/{sessionId}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sendMessage(
            @PathVariable String sessionId,
            @Valid @RequestBody AiChatMessageRequest request) {

        SseEmitter emitter = createEmitter(sessionId);
        aiChatService.streamReply(sessionId, request.getText(), emitter);
        return emitter;
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public ResponseEntity<List<AiChatMessage>> getMessages(@PathVariable String sessionId) {
        return ResponseEntity.ok(sessionService.getAllMessages(sessionId));
    }

    /**
     * 대화 끝난 뒤 사용자 문장으로 쉐도잉 스크립트 생성 (동기 응답)
     */
    @PostMapping("/sessions/{sessionId}/shadowing")
    public ResponseEntity<ShadowingResponse> shadowing(@PathVariable String sessionId) {
        return ResponseEntity.ok(new ShadowingResponse(sessionId, aiChatService.generateShadowing(sessionId)));
    }

    @ExceptionHandler(AiShadowingTimeoutException.class)
    public ResponseEntity<Map<String, String>> handleShadowingTimeout(AiShadowingTimeoutException e) {
        return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT).body(Map.of("message", e.getMessage()));
    }

    @ExceptionHandler(AiChatSessionNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(AiChatSessionNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", e.getMessage()));
    }

    private SseEmitter createEmitter(String sessionId) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        emitter.onTimeout(() -> {
            log.warn("SSE 타임아웃 - sessionId: {}", sessionId);
            emitter.complete();
        });
        return emitter;
    }
}
