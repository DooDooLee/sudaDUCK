package com.example.DuckDuck.domain.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 싱글 모드 대화 메시지 (Redis 리스트에 JSON으로 저장)
 * role: user / assistant
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class AiChatMessage {

    private String role;
    private String content;
    private long at;
}
