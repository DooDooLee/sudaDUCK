package com.sudaduck.aichat.shadowing;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sudaduck.aichat.chat.ChatService;
import com.sudaduck.aichat.chat.ChatSessionRepository;
import com.sudaduck.aichat.chat.Message;
import com.sudaduck.aichat.openai.ChatMessage;
import com.sudaduck.aichat.openai.OpenAiClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

/**
 * 대화가 끝난 뒤 대화 전체(user, assistant 모두)를 대화 순서대로 쉐도잉 스크립트로 바꾼다.
 * 문장마다 OpenAI 를 한 번씩 부르는데, 순서대로 부르면 문장 수 x 응답시간이 걸린다.
 * flatMapSequential 로 최대 4개를 동시에 보내고 결과는 원래 문장 순서대로 받는다.
 */
@Slf4j
@Service
public class ShadowingService {

    // OpenAI rate limit 과 응답시간 사이 절충. 한 세션이 커넥션 풀을 독점하지 않게 한다.
    private static final int CONCURRENCY = 4;

    private final ChatService chatService;
    private final ChatSessionRepository repository;
    private final OpenAiClient openAi;
    private final ObjectMapper objectMapper;

    public ShadowingService(ChatService chatService, ChatSessionRepository repository,
                            OpenAiClient openAi, ObjectMapper objectMapper) {
        this.chatService = chatService;
        this.repository = repository;
        this.openAi = openAi;
        this.objectMapper = objectMapper;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record GptScript(
            String en,
            @JsonProperty("blank_script") String blankScript,
            @JsonProperty("similarity_phrases") List<String> similarityPhrases) {
    }

    public Mono<ShadowingResponse> generate(String sessionId) {
        long startedAt = System.currentTimeMillis();
        return chatService.history(sessionId)
                .flatMap(messages -> Flux.fromIterable(messages)
                        .flatMapSequential(this::toScript, CONCURRENCY)
                        .collectList())
                .flatMap(scripts -> repository.saveShadowing(sessionId, scripts)
                        .doOnSuccess(v -> log.info("쉐도잉 스크립트 생성 - sessionId: {}, {}문장, {}ms",
                                sessionId, scripts.size(), System.currentTimeMillis() - startedAt))
                        .thenReturn(new ShadowingResponse(sessionId, scripts)));
    }

    /** 부적절/파싱 실패 문장은 empty 로 건너뛴다. OpenAI 호출 자체 실패는 그대로 올려 502 로 보낸다. */
    private Mono<ShadowingScript> toScript(Message message) {
        return openAi.complete(List.of(ChatMessage.user(ScriptPrompt.of(message.content()))))
                .flatMap(content -> parse(message.role(), message.content(), content));
    }

    Mono<ShadowingScript> parse(String role, String korean, String content) {
        GptScript gpt;
        try {
            gpt = objectMapper.readValue(ScriptPrompt.extractJson(content), GptScript.class);
        } catch (Exception e) {
            log.warn("쉐도잉 응답 파싱 실패, 문장 건너뜀 - '{}'", korean);
            return Mono.empty();
        }
        if (gpt.en() == null || ScriptPrompt.INAPPROPRIATE.equals(gpt.en())) {
            log.warn("부적절한 콘텐츠로 판단, 문장 건너뜀 - '{}'", korean);
            return Mono.empty();
        }
        List<String> phrases = gpt.similarityPhrases() == null ? List.of() : gpt.similarityPhrases();
        return Mono.just(new ShadowingScript(role, korean, gpt.en(), gpt.blankScript(), phrases));
    }
}
