package com.example.DuckDuck.domain.ai.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class AiChatSessionRequest {

    @NotBlank(message = "topic은 필수입니다.")
    @Size(max = 100, message = "topic은 100자 이하여야 합니다.")
    private String topic;
}
