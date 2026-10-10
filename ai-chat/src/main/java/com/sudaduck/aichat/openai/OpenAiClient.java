package com.sudaduck.aichat.openai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sudaduck.aichat.config.OpenAiProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
@Component
public class OpenAiClient {

    private static final ParameterizedTypeReference<ServerSentEvent<String>> SSE_STRING =
            new ParameterizedTypeReference<>() {};
    private static final String DONE_MARKER = "[DONE]";
    private static final String COMPLETIONS_URI = "/v1/chat/completions";

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final OpenAiProperties props;

    public OpenAiClient(WebClient openAiWebClient, ObjectMapper objectMapper, OpenAiProperties props) {
        this.webClient = openAiWebClient;
        this.objectMapper = objectMapper;
        this.props = props;
    }

    /**
     * stream=true 로 호출해 토큰 조각을 Flux 로 흘려보낸다.
     * 구독 전에는 아무 요청도 나가지 않는다. 컨트롤러가 이 Flux 를 반환하면 Spring 이 구독한다.
     *
     * 재시도는 "응답 헤더를 받는 단계"(Mono)에만 건다. 429/5xx 는 상태코드로 오기 때문에 이 단계에서 걸러지고,
     * 본문(토큰) Flux 가 한 번 흐르기 시작하면 재시도하지 않는다. 중간에 다시 요청하면 앞부분 토큰이 중복으로 나간다.
     */
    public Flux<String> streamChat(List<ChatMessage> messages) {
        Map<String, Object> body = Map.of(
                "model", props.model(),
                "stream", true,
                "messages", messages
        );

        Mono<ResponseEntity<Flux<ServerSentEvent<String>>>> response = webClient.post()
                .uri(COMPLETIONS_URI)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .toEntityFlux(SSE_STRING)
                .retryWhen(retrySpec());

        Flux<String> tokens = response
                .flatMapMany(entity -> entity.getBody() == null ? Flux.empty() : entity.getBody())
                .mapNotNull(ServerSentEvent::data)      // "data: {...}" 한 줄이 이벤트 하나
                .takeWhile(data -> !DONE_MARKER.equals(data.trim()))
                .map(this::extractDelta)
                .filter(text -> !text.isEmpty());

        return withDeadline(tokens, props.streamTimeout())
                .doOnCancel(() -> log.info("OpenAI 스트림 취소 - 하류 구독 해제로 업스트림 연결을 끊음"));
    }

    /** stream=false 한 번 호출. 응답 본문에서 choices[0].message.content 만 꺼낸다. */
    public Mono<String> complete(List<ChatMessage> messages) {
        Map<String, Object> body = Map.of(
                "model", props.model(),
                "messages", messages
        );

        return webClient.post()
                .uri(COMPLETIONS_URI)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .retryWhen(retrySpec())
                .map(root -> root.path("choices").path(0).path("message").path("content").asText(""))
                .timeout(props.streamTimeout());
    }

    private Retry retrySpec() {
        return Retry.backoff(props.retryMaxAttempts(), props.retryBackoff())
                .filter(OpenAiClient::isRetryable)
                .doBeforeRetry(signal -> log.warn("OpenAI 재시도 {}회차: {}",
                        signal.totalRetries() + 1, signal.failure().toString()))
                .onRetryExhaustedThrow((spec, signal) -> signal.failure());
    }

    private static boolean isRetryable(Throwable e) {
        return e instanceof WebClientResponseException w
                && (w.getStatusCode().value() == 429 || w.getStatusCode().is5xxServerError());
    }

    /**
     * Flux.timeout(Duration) 은 "토큰 사이 간격" 상한이라 전체 길이는 못 막는다.
     * 구독 시점 기준 마감 시각을 잡아두고, 매 토큰마다 남은 시간만큼만 기다리게 해서 전체 상한으로 쓴다.
     */
    private static <T> Flux<T> withDeadline(Flux<T> source, Duration limit) {
        return Flux.defer(() -> {
            long deadline = Schedulers.parallel().now(TimeUnit.NANOSECONDS) + limit.toNanos();
            return source.timeout(
                    remaining(deadline),
                    item -> remaining(deadline),
                    Flux.error(new TimeoutException("OpenAI 응답이 " + limit.toSeconds() + "초 안에 끝나지 않음")));
        });
    }

    private static Mono<Long> remaining(long deadline) {
        long left = Math.max(0, deadline - Schedulers.parallel().now(TimeUnit.NANOSECONDS));
        return Mono.delay(Duration.ofNanos(left));
    }

    private String extractDelta(String json) {
        try {
            JsonNode root = objectMapper.readTree(json);
            return root.path("choices").path(0).path("delta").path("content").asText("");
        } catch (Exception e) {
            log.warn("OpenAI 스트림 조각 파싱 실패: {}", json);
            return "";
        }
    }
}
