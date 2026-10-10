package com.sudaduck.aichat.shadowing;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ShadowingServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    // parse 는 OpenAI/Redis 를 쓰지 않으므로 나머지 의존성은 비워 둔다
    private final ShadowingService service = new ShadowingService(null, null, null, objectMapper);

    @Test
    void 대화_역할이_스크립트에_담긴다() {
        String content = "{\"en\":\"Hi there.\",\"blank_script\":\"[Hi] there.\",\"similarity_phrases\":[\"Hello.\",\"Hey.\"]}";

        StepVerifier.create(service.parse("assistant", "안녕", content))
                .assertNext(s -> {
                    assertThat(s.role()).isEqualTo("assistant");
                    assertThat(s.korean()).isEqualTo("안녕");
                    assertThat(s.en()).isEqualTo("Hi there.");
                    assertThat(s.blankScript()).isEqualTo("[Hi] there.");
                    assertThat(s.similarityPhrases()).containsExactly("Hello.", "Hey.");
                })
                .verifyComplete();
    }

    @Test
    void 부적절_판정과_파싱_실패는_건너뛴다() {
        StepVerifier.create(service.parse("user", "x", "{\"en\":\"INAPPROPRIATE_CONTENT\"}")).verifyComplete();
        StepVerifier.create(service.parse("user", "x", "not json")).verifyComplete();
    }

    @Test
    void JSON_에서_role_이_맨_앞이다() throws Exception {
        String json = objectMapper.writeValueAsString(
                new ShadowingScript("user", "안녕", "Hi", "[Hi]", List.of("Hello")));
        assertThat(json).startsWith("{\"role\":\"user\",\"korean\":\"안녕\"");
    }
}
