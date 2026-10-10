package com.example.DuckDuck.domain.ai.service;

import com.example.DuckDuck.domain.ai.dto.AiChatMessage;
import com.example.DuckDuck.domain.ai.dto.ShadowingScript;
import com.example.DuckDuck.domain.ai.exception.AiChatSessionNotFoundException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 싱글 모드 세션/메시지 Redis 저장소
 * - ai-chat:{sessionId}          : hash (topic, userId, createdAt)
 * - ai-chat:{sessionId}:messages : list (메시지 JSON)
 * - ai-chat:{sessionId}:shadowing : string (쉐도잉 스크립트 JSON 배열)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiChatSessionService {

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final long TTL_MINUTES = 30;
    private static final int PROMPT_HISTORY_SIZE = 20;

    public String createSession(String topic, Long userId) {
        String sessionId = UUID.randomUUID().toString();
        String key = sessionKey(sessionId);

        redisTemplate.opsForHash().putAll(key, Map.of(
                "topic", topic,
                "userId", String.valueOf(userId),
                "createdAt", String.valueOf(System.currentTimeMillis())
        ));
        redisTemplate.expire(key, TTL_MINUTES, TimeUnit.MINUTES);

        log.info("싱글 모드 세션 생성 - sessionId: {}, userId: {}", sessionId, userId);
        return sessionId;
    }

    /**
     * 세션 주제 조회 + TTL 갱신 (없으면 예외)
     */
    public String getTopic(String sessionId) {
        Object topic = redisTemplate.opsForHash().get(sessionKey(sessionId), "topic");
        if (topic == null) {
            throw new AiChatSessionNotFoundException(sessionId);
        }
        touch(sessionId);
        return topic.toString();
    }

    public void appendMessage(String sessionId, String role, String content) {
        AiChatMessage message = new AiChatMessage(role, content, System.currentTimeMillis());
        try {
            redisTemplate.opsForList().rightPush(messagesKey(sessionId), objectMapper.writeValueAsString(message));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("메시지 직렬화 실패", e);
        }
        touch(sessionId);
    }

    public List<AiChatMessage> getRecentMessages(String sessionId) {
        return readMessages(sessionId, -PROMPT_HISTORY_SIZE, -1);
    }

    public List<AiChatMessage> getAllMessages(String sessionId) {
        getTopic(sessionId); // 존재 확인 + TTL 갱신
        return readMessages(sessionId, 0, -1);
    }

    /**
     * 쉐도잉 결과 저장 (세션과 같은 TTL)
     */
    public void saveShadowing(String sessionId, List<ShadowingScript> scripts) {
        try {
            redisTemplate.opsForValue().set(shadowingKey(sessionId), objectMapper.writeValueAsString(scripts),
                    TTL_MINUTES, TimeUnit.MINUTES);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("쉐도잉 직렬화 실패", e);
        }
        touch(sessionId);
    }

    private List<AiChatMessage> readMessages(String sessionId, long start, long end) {
        List<String> raw = redisTemplate.opsForList().range(messagesKey(sessionId), start, end);
        List<AiChatMessage> messages = new ArrayList<>();
        if (raw == null) {
            return messages;
        }
        for (String json : raw) {
            try {
                messages.add(objectMapper.readValue(json, AiChatMessage.class));
            } catch (JsonProcessingException e) {
                log.warn("메시지 파싱 실패 - sessionId: {}", sessionId);
            }
        }
        return messages;
    }

    private void touch(String sessionId) {
        redisTemplate.expire(sessionKey(sessionId), TTL_MINUTES, TimeUnit.MINUTES);
        redisTemplate.expire(messagesKey(sessionId), TTL_MINUTES, TimeUnit.MINUTES);
        redisTemplate.expire(shadowingKey(sessionId), TTL_MINUTES, TimeUnit.MINUTES);
    }

    private String sessionKey(String sessionId) {
        return "ai-chat:" + sessionId;
    }

    private String messagesKey(String sessionId) {
        return "ai-chat:" + sessionId + ":messages";
    }

    private String shadowingKey(String sessionId) {
        return "ai-chat:" + sessionId + ":shadowing";
    }
}
