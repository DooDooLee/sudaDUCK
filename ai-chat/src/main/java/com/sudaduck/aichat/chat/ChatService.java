package com.sudaduck.aichat.chat;

import com.sudaduck.aichat.config.ChatProperties;
import com.sudaduck.aichat.openai.ChatMessage;
import com.sudaduck.aichat.openai.OpenAiClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
public class ChatService {

    private static final String GREETING_INSTRUCTION =
            "지금 대화를 시작해. 주제에 맞게 짧게 인사하고 첫 질문을 하나 던져.";

    private static final String SYSTEM_PROMPT = """
            너는 '수덕'이라는 이름의 오리 캐릭터야. 한국어로 수다 떠는 연습 상대 역할을 해.
            오늘 대화 주제: %s

            규칙
            - 한국어로만 말한다.
            - 친구처럼 편한 반말을 쓴다.
            - 한 번에 한두 문장만 말한다. 길게 설명하지 않는다.
            - 매번 마지막에 상대가 더 이야기하게 만드는 질문을 하나 던진다.
            - 상대의 말을 평가하거나 고쳐주지 않는다. 그냥 자연스럽게 대화를 이어간다.
            """;

    private final ChatSessionRepository repository;
    private final OpenAiClient openAi;
    private final ChatProperties props;

    public ChatService(ChatSessionRepository repository, OpenAiClient openAi, ChatProperties props) {
        this.repository = repository;
        this.openAi = openAi;
        this.props = props;
    }

    public Mono<String> start(String topic, Long userId) {
        String sessionId = UUID.randomUUID().toString();
        return repository.create(sessionId, topic, userId)
                .doOnSuccess(v -> log.info("싱글 모드 세션 생성 - sessionId: {}, userId: {}", sessionId, userId))
                .thenReturn(sessionId);
    }

    /** 봇이 먼저 말을 거는 첫 메시지. 지시문은 저장하지 않고 답변만 저장한다. */
    public Flux<ChatEvent> greet(String sessionId) {
        return streamAssistant(sessionId, null);
    }

    /** 사용자 메시지를 저장한 뒤 봇 답변을 스트리밍한다. */
    public Flux<ChatEvent> reply(String sessionId, String text) {
        return streamAssistant(sessionId, text);
    }

    public Mono<List<Message>> history(String sessionId) {
        // 세션 하나의 대화는 수십 줄이라 모아서 JSON 배열로 내려도 된다
        return requireTopic(sessionId)
                .then(repository.allMessages(sessionId).collectList());
    }

    /** 세션 존재 확인 + TTL 갱신. A 의 getTopic 과 같은 역할. */
    Mono<String> requireTopic(String sessionId) {
        return repository.findTopic(sessionId)
                .switchIfEmpty(Mono.error(() -> new SessionNotFoundException(sessionId)))
                .flatMap(topic -> repository.touch(sessionId).thenReturn(topic));
    }

    /**
     * 흐름
     *  1. 세션 확인 (없으면 아무것도 저장하지 않고 실패), 사용자 메시지 저장, 최근 대화 로드
     *  2. OpenAI 스트림 구독. 조각이 올 때마다 token 이벤트로 흘리고 buf 에도 모은다
     *  3. 스트림이 끝나면 완성 문장을 Redis 에 저장하고 done 이벤트 하나를 붙인다
     * 토큰 Flux 자체에는 collectList / block 을 쓰지 않는다. 쓰는 순간 스트리밍이 사라진다.
     * 클라이언트가 중간에 끊으면 concatWith 뒤쪽은 실행되지 않아 미완성 답변은 저장되지 않는다 (A 와 동일).
     */
    private Flux<ChatEvent> streamAssistant(String sessionId, String userText) {
        return requireTopic(sessionId).flatMapMany(topic -> {
            long startedAt = System.currentTimeMillis();
            Mono<Void> saveUser = userText == null
                    ? Mono.empty()
                    : repository.append(sessionId, Message.user(userText));

            return saveUser
                    .then(repository.recentMessages(sessionId, props.historyLimit()).collectList())
                    .flatMapMany(history -> {
                        List<ChatMessage> prompt = buildPrompt(topic, history, userText == null);
                        StringBuilder buf = new StringBuilder();

                        Flux<ChatEvent> tokens = openAi.streamChat(prompt)
                                .doOnNext(buf::append)
                                .map(ChatEvent::token);

                        Mono<ChatEvent> done = Mono.defer(() -> {
                            String full = buf.toString();
                            return repository.append(sessionId, Message.assistant(full))
                                    .doOnSuccess(v -> log.info("싱글 모드 응답 완료 - sessionId: {}, {}ms",
                                            sessionId, System.currentTimeMillis() - startedAt))
                                    .thenReturn(ChatEvent.done(full));
                        });

                        return tokens.concatWith(done);
                    });
        });
    }

    private List<ChatMessage> buildPrompt(String topic, List<Message> history, boolean greeting) {
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.system(SYSTEM_PROMPT.formatted(topic)));
        history.forEach(m -> messages.add(m.toChatMessage()));
        if (greeting) {
            messages.add(ChatMessage.user(GREETING_INSTRUCTION));
        }
        return messages;
    }
}
