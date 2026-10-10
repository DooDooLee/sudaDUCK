package com.example.DuckDuck.domain.ai.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 싱글 모드 쉐도잉 스크립트 (대화 메시지 1개당 1개, role: user / assistant)
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class ShadowingScript {

    private String role;
    private String korean;
    private String en;

    @JsonProperty("blank_script")
    private String blankScript;

    @JsonProperty("similarity_phrases")
    private List<String> similarityPhrases;
}
