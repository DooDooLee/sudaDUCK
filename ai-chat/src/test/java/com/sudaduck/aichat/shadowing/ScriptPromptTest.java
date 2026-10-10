package com.sudaduck.aichat.shadowing;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ScriptPromptTest {

    @Test
    void 앞뒤_잡담을_떼고_JSON만_꺼낸다() {
        String content = "물론이죠!\n```json\n{\"en\":\"Hi\",\"blank_script\":\"[Hi]\"}\n```";
        assertThat(ScriptPrompt.extractJson(content)).isEqualTo("{\"en\":\"Hi\",\"blank_script\":\"[Hi]\"}");
    }

    @Test
    void 입력_문장이_프롬프트에_들어간다() {
        assertThat(ScriptPrompt.of("오늘 날씨 좋다")).contains("한국어 문장: \"오늘 날씨 좋다\"");
    }
}
