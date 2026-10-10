package com.example.DuckDuck.domain.ai.service;

import com.example.DuckDuck.domain.ai.dto.GptScriptResponse;
import com.example.DuckDuck.domain.ai.dto.ShadowingScript;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * 싱글 모드 쉐도잉 - 문장 1개 처리 (멀티 모드 TranslateService와 같은 방식)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiShadowingService {

    private final GptService gptService;

    /**
     * 한국어 문장 1개 -> 쉐도잉 스크립트 (role: user / assistant)
     * 부적절한 내용이거나 파싱 실패면 null (해당 문장은 건너뜀)
     */
    @Async("chatTaskExecutor")
    public CompletableFuture<ShadowingScript> generateOne(String role, String korean) {
        try {
            GptScriptResponse script = gptService.generateScript(korean);
            List<String> phrases = script.getSimilarityPhrases() == null
                    ? List.of()
                    : Arrays.asList(script.getSimilarityPhrases());
            return CompletableFuture.completedFuture(
                    new ShadowingScript(role, korean, script.getEn(), script.getBlankScript(), phrases));
        } catch (RuntimeException e) {
            log.warn("쉐도잉 문장 건너뜀 - '{}', 이유: {}", korean, e.getMessage());
            return CompletableFuture.completedFuture(null);
        }
    }
}
