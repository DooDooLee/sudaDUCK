package com.sudaduck.aichat.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sudaduck.aichat.config.ChatProperties;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * Redis 키 구조 (A 의 AiChatSessionService 와 동일. 세션을 A/B 어느 쪽에서 이어가도 된다)
 *  ai-chat:{id}             Hash  topic, userId, createdAt
 *  ai-chat:{id}:messages    List  {"role","content","at"} JSON (오래된 것이 앞)
 *  ai-chat:{id}:shadowing   String 쉐도잉 스크립트 JSON 배열 (B 전용)
 * 모든 키는 마지막 활동 기준으로 TTL 을 다시 건다.
 */
@Repository
public class ChatSessionRepository {

    private final ReactiveStringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final ChatProperties props;

    public ChatSessionRepository(ReactiveStringRedisTemplate redis, ObjectMapper objectMapper, ChatProperties props) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.props = props;
    }

    public Mono<Void> create(String sessionId, String topic, Long userId) {
        Map<String, String> fields = Map.of(
                "topic", topic,
                "userId", String.valueOf(userId),
                "createdAt", String.valueOf(System.currentTimeMillis())
        );
        return redis.opsForHash().putAll(sessionKey(sessionId), fields)
                .then(redis.expire(sessionKey(sessionId), props.sessionTtl()))
                .then();
    }

    public Mono<String> findTopic(String sessionId) {
        return redis.<String, String>opsForHash().get(sessionKey(sessionId), "topic");
    }

    public Flux<Message> recentMessages(String sessionId, int limit) {
        // 끝에서 limit 개. 프롬프트에 넣을 대화 길이를 제한한다.
        return redis.opsForList().range(messagesKey(sessionId), -limit, -1)
                .map(this::read);
    }

    public Flux<Message> allMessages(String sessionId) {
        return redis.opsForList().range(messagesKey(sessionId), 0, -1)
                .map(this::read);
    }

    public Mono<Void> append(String sessionId, Message message) {
        return Mono.fromCallable(() -> write(message))
                .flatMap(json -> redis.opsForList().rightPush(messagesKey(sessionId), json))
                .then(touch(sessionId));
    }

    public Mono<Void> saveShadowing(String sessionId, Object scripts) {
        return Mono.fromCallable(() -> write(scripts))
                .flatMap(json -> redis.opsForValue().set(shadowingKey(sessionId), json, props.sessionTtl()))
                .then();
    }

    public Mono<Void> touch(String sessionId) {
        // 없는 키에 EXPIRE 는 아무 일도 안 한다. 세 키를 한 번에 갱신해도 안전하다.
        return Flux.just(sessionKey(sessionId), messagesKey(sessionId), shadowingKey(sessionId))
                .flatMap(key -> redis.expire(key, props.sessionTtl()))
                .then();
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

    private String write(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("직렬화 실패", e);
        }
    }

    private Message read(String json) {
        try {
            return objectMapper.readValue(json, Message.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("메시지 역직렬화 실패: " + json, e);
        }
    }
}
