package com.sudaduck.aichat.chat;

import com.sudaduck.aichat.security.JwtAuthFilter;
import com.sudaduck.aichat.shadowing.ShadowingResponse;
import com.sudaduck.aichat.shadowing.ShadowingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

/**
 * 싱글 모드 (AI 오리와 1:1 대화) API. 경로/본문/SSE 형식은 A(Tomcat)와 같다.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/ai-chat")
public class ChatController {

    private static final String STREAM_FAILED = "AI 응답 생성에 실패했습니다.";

    private final ChatService chatService;
    private final ShadowingService shadowingService;

    public ChatController(ChatService chatService, ShadowingService shadowingService) {
        this.chatService = chatService;
        this.shadowingService = shadowingService;
    }

    public record StartRequest(
            @NotBlank(message = "topic은 필수입니다.")
            @Size(max = 100, message = "topic은 100자 이하여야 합니다.")
            String topic) {}

    public record StartResponse(String sessionId) {}

    public record MessageRequest(
            @NotBlank(message = "text는 필수입니다.")
            @Size(max = 1000, message = "text는 1000자 이하여야 합니다.")
            String text) {}

    @PostMapping("/sessions")
    public Mono<StartResponse> start(@RequestAttribute(JwtAuthFilter.USER_ID) Long userId,
                                     @Valid @RequestBody StartRequest request) {
        return chatService.start(request.topic(), userId)
                .map(StartResponse::new);
    }

    @PostMapping(value = "/sessions/{sessionId}/greeting", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<ChatEvent>> greet(@PathVariable String sessionId) {
        return toSse(sessionId, chatService.greet(sessionId));
    }

    @PostMapping(value = "/sessions/{sessionId}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<ChatEvent>> send(@PathVariable String sessionId,
                                                 @Valid @RequestBody MessageRequest request) {
        return toSse(sessionId, chatService.reply(sessionId, request.text()));
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public Mono<List<Message>> history(@PathVariable String sessionId) {
        return chatService.history(sessionId);
    }

    @PostMapping("/sessions/{sessionId}/shadowing")
    public Mono<ShadowingResponse> shadowing(@PathVariable String sessionId) {
        return shadowingService.generate(sessionId);
    }

    /**
     * 스트림 도중 실패하면 이미 200 헤더가 나간 뒤라 상태코드를 바꿀 수 없다.
     * 대신 error 이벤트를 하나 보내고 정상 종료한다. 클라이언트는 이 이벤트로 실패를 안다.
     * 세션 없음은 A 처럼 첫 이벤트부터 error 로 나간다.
     */
    private Flux<ServerSentEvent<ChatEvent>> toSse(String sessionId, Flux<ChatEvent> events) {
        return events
                .onErrorResume(e -> {
                    if (e instanceof SessionNotFoundException) {
                        return Flux.just(ChatEvent.error(e.getMessage()));
                    }
                    log.error("싱글 모드 스트리밍 실패 - sessionId: {}, error: {}", sessionId, e.toString());
                    return Flux.just(ChatEvent.error(STREAM_FAILED));
                })
                .map(event -> ServerSentEvent.builder(event).event(event.type()).build());
    }
}
