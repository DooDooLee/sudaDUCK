package com.example.DuckDuck.domain.ai.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class AiChatMessageRequest {

    @NotBlank(message = "text는 필수입니다.")
    @Size(max = 1000, message = "text는 1000자 이하여야 합니다.")
    private String text;
}
