package com.sudaduck.aichat.openai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sudaduck.aichat.config.OpenAiProperties;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeFunction;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class OpenAiClientTest {

    private static final List<ChatMessage> PROMPT = List.of(ChatMessage.user("안녕"));

    // 실제 OpenAI 응답 모양. 첫 조각은 role 만 있고 content 가 비어 있다.
    private static final String SSE_BODY = """
            data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

            data: {"choices":[{"index":0,"delta":{"content":"안녕"}}]}

            data: {"choices":[{"index":0,"delta":{"content":" 나는"}}]}

            data: {"choices":[{"index":0,"delta":{"content":" 수덕이야!\\n"}}]}

            data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

            data: [DONE]

            """;

    private static OpenAiClient client(ExchangeFunction exchange) {
        OpenAiProperties props = new OpenAiProperties("http://stub", "test-key", "gpt-4o-mini",
                Duration.ofSeconds(5), Duration.ofSeconds(5), 10, 3, Duration.ofMillis(10));
        WebClient webClient = WebClient.builder()
                .baseUrl(props.baseUrl())
                .exchangeFunction(exchange)
                .build();
        return new OpenAiClient(webClient, new ObjectMapper(), props);
    }

    private static ClientResponse sse(Flux<DataBuffer> body) {
        return ClientResponse.create(HttpStatus.OK)
                .header(HttpHeaders.CONTENT_TYPE, "text/event-stream")
                .body(body)
                .build();
    }

    private static Flux<DataBuffer> chunks(String... parts) {
        return Flux.fromArray(parts)
                .map(p -> DefaultDataBufferFactory.sharedInstance.wrap(p.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void SSE_조각을_토큰으로_바꾸고_DONE에서_끝낸다() {
        OpenAiClient client = client(req -> Mono.just(sse(chunks(SSE_BODY))));

        StepVerifier.create(client.streamChat(PROMPT))
                .expectNext("안녕")
                .expectNext(" 나는")          // 앞 공백 보존
                .expectNext(" 수덕이야!\n")    // 줄바꿈 보존
                .verifyComplete();
    }

    @Test
    void DONE_뒤에_오는_데이터는_무시한다() {
        String afterDone = "data: [DONE]\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"유령\"}}]}\n\n";
        OpenAiClient client = client(req -> Mono.just(sse(chunks(
                "data: {\"choices\":[{\"delta\":{\"content\":\"하나\"}}]}\n\n", afterDone))));

        StepVerifier.create(client.streamChat(PROMPT))
                .expectNext("하나")
                .verifyComplete();
    }

    @Test
    void 첫_토큰_전_429는_재시도하고_토큰은_한_번만_나간다() {
        AtomicInteger calls = new AtomicInteger();
        OpenAiClient client = client(req -> {
            if (calls.incrementAndGet() == 1) {
                return Mono.just(ClientResponse.create(HttpStatus.TOO_MANY_REQUESTS).build());
            }
            return Mono.just(sse(chunks(SSE_BODY)));
        });

        StepVerifier.create(client.streamChat(PROMPT))
                .expectNext("안녕", " 나는", " 수덕이야!\n")
                .verifyComplete();
        assertThat(calls).hasValue(2);
    }

    @Test
    void 재시도_대상이_아닌_400은_바로_실패한다() {
        AtomicInteger calls = new AtomicInteger();
        OpenAiClient client = client(req -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.BAD_REQUEST).build());
        });

        StepVerifier.create(client.streamChat(PROMPT))
                .expectError(WebClientResponseException.BadRequest.class)
                .verify();
        assertThat(calls).hasValue(1);
    }

    @Test
    void 토큰이_나간_뒤의_실패는_재시도하지_않는다() {
        AtomicInteger calls = new AtomicInteger();
        // 첫 조각을 보낸 다음 본문이 503 계열 예외로 끊기는 상황. 재시도 대상 예외라도 다시 요청하면 안 된다.
        WebClientResponseException midStream = WebClientResponseException.create(
                503, "Service Unavailable", HttpHeaders.EMPTY, new byte[0], StandardCharsets.UTF_8);
        OpenAiClient client = client(req -> {
            calls.incrementAndGet();
            return Mono.just(sse(Flux.concat(
                    chunks("data: {\"choices\":[{\"delta\":{\"content\":\"안녕\"}}]}\n\n"),
                    Flux.error(midStream))));
        });

        StepVerifier.create(client.streamChat(PROMPT))
                .expectNext("안녕")
                .expectErrorMatches(e -> e == midStream)
                .verify();
        assertThat(calls).hasValue(1);
    }

    @Test
    void 재시도를_다_써도_429면_원래_예외로_실패한다() {
        AtomicInteger calls = new AtomicInteger();
        OpenAiClient client = client(req -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.TOO_MANY_REQUESTS).build());
        });

        StepVerifier.create(client.streamChat(PROMPT))
                .expectError(WebClientResponseException.TooManyRequests.class)
                .verify();
        assertThat(calls).hasValue(4); // 최초 1 + 재시도 3
    }

    @Test
    void 전체_스트림이_마감을_넘기면_TimeoutException() {
        OpenAiProperties props = new OpenAiProperties("http://stub", "k", "m",
                Duration.ofSeconds(5), Duration.ofMillis(300), 10, 0, Duration.ofMillis(10));
        // 토큰은 100ms 마다 꾸준히 오지만 끝나지 않는다. 토큰 간격 기준 timeout 이었다면 잡지 못한다.
        Flux<DataBuffer> endless = Flux.interval(Duration.ofMillis(100))
                .map(i -> DefaultDataBufferFactory.sharedInstance.wrap(
                        ("data: {\"choices\":[{\"delta\":{\"content\":\"t" + i + "\"}}]}\n\n")
                                .getBytes(StandardCharsets.UTF_8)));
        WebClient webClient = WebClient.builder().baseUrl("http://stub")
                .exchangeFunction(req -> Mono.just(sse(endless))).build();
        OpenAiClient client = new OpenAiClient(webClient, new ObjectMapper(), props);

        StepVerifier.create(client.streamChat(PROMPT))
                .thenConsumeWhile(t -> true)
                .expectError(java.util.concurrent.TimeoutException.class)
                .verify(Duration.ofSeconds(3));
    }

    @Test
    void 논스트리밍_응답에서_content를_꺼낸다() {
        String json = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"en\\\":\\\"Hi\\\"}\"}}]}";
        OpenAiClient client = client(req -> Mono.just(ClientResponse.create(HttpStatus.OK)
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .body(json)
                .build()));

        StepVerifier.create(client.complete(PROMPT))
                .expectNext("{\"en\":\"Hi\"}")
                .verifyComplete();
    }
}
