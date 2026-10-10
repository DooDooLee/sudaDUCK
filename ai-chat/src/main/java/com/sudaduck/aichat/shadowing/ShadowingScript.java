package com.sudaduck.aichat.shadowing;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

import java.util.List;

/**
 * 대화 한 줄(user 또는 assistant)에 대한 쉐도잉 학습 자료.
 * role 외의 JSON 키는 A 의 GptScriptResponse 와 같은 snake_case.
 */
@JsonPropertyOrder({"role", "korean", "en", "blank_script", "similarity_phrases"})
public record ShadowingScript(
        String role,
        String korean,
        String en,
        @JsonProperty("blank_script") String blankScript,
        @JsonProperty("similarity_phrases") List<String> similarityPhrases
) {
}
