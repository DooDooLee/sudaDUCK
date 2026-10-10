package com.example.DuckDuck.domain.ai.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import com.example.DuckDuck.domain.ai.dto.GptScriptResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RequestCallback;
import org.springframework.web.client.ResponseExtractor;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;

@Service
@RequiredArgsConstructor
@Slf4j
public class GptService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    // GMS 프록시 종료로 사용 안 함 (설정 없어도 기동되도록 기본값)
    @Value("${gms.token:}")
    private String gmsToken;

    @Value("${openai.api.key}")
    private String openAiApiKey;

    @Value("${openai.model:gpt-4o-mini}")
    private String model;

    // 부하 테스트 때 mock 서버로 돌릴 수 있도록 base URL 을 설정으로 뺀다
    @Value("${openai.api.base-url:https://api.openai.com}")
    private String openAiBaseUrl;

    private String chatCompletionsUrl() {
        return openAiBaseUrl + "/v1/chat/completions";
    }

    /**
     * 방 생성 시 주제 추천
     */
    public List<String> getRecommendedTopics() {
        String prompt = """
        보고 바로 주제를 파악할 수 있게 '대화 소재 3가지'를 추천해줘.
        
        **중요: 매번 완전히 다른 주제 3가지를 생성해야 함**
        - 이전에 자주 사용했을 만한 뻔한 주제는 절대 금지
        - 18개 카테고리 중 무작위로 3개를 골라 각각 하나씩 선정
        
        **카테고리 목록 (반드시 서로 다른 카테고리 선택):**
        1. 음식/요리 (예: "최애 야식", "엄마표 음식 추억")
        2. 여행/장소 (예: "혼자 떠난 첫 여행", "다시 가고 싶은 곳")
        3. 취미/여가 (예: "어릴 적 수집품", "배우고 싶은 악기")
        4. 문화/예술 (예: "인생 영화", "최애 캐릭터")
        5. 관계/사람 (예: "초등학교 단짝", "롤모델 인물")
        6. 추억/경험 (예: "첫 월급 사용처", "잊지 못할 생일")
        7. 일상/루틴 (예: "완벽한 주말", "스트레스 해소법")
        8. 반려동물 (예: "반려동물 자랑", "키우고 싶은 동물")
        9. 자연/계절 (예: "좋아하는 계절 이유", "산 vs 바다")
        10. 운동/스포츠 (예: "즐겨하는 운동", "응원하는 팀")
        11. 기술/디지털 (예: "없으면 안 되는 앱", "갖고 싶은 미래 기술")
        12. 학습/교육 (예: "배워서 좋았던 것", "외국어 경험")
        13. 건강/웰빙 (예: "건강 비법", "수면 습관")
        14. 패션/스타일 (예: "패션 스타일", "꼭 갖고 싶은 옷")
        15. 실패/해프닝 (예: "요리 실패담", "민망했던 순간")
        16. 미래/목표 (예: "10년 후 꿈", "버킷리스트")
        17. 습관/성향 (예: "고치고 싶은 습관", "아침형 vs 저녁형")
        18. 돈/소비 (예: "최고의 가성비 구매", "충동구매 후회")
        
        **선정 규칙:**
        1. 말투: 10자 내외, 명사로 끝나게
        2. 구체성: 구체적이고 이미지가 떠오르는 표현
        3. 깊이: 1분 이하 대화 가능한 주제
        4. 독창성: 뻔하지 않고 독특한 소재
        
        **절대 금지 주제 (너무 흔함):**
        ❌ "요즘 관심사", "최근 취미", "주말 계획"
        ❌ "좋아하는 음식", "좋아하는 영화" (너무 광범위)
        ❌ "오늘 기분", "날씨 이야기" (일시적)
        
        **좋은 예시:**
        ✅ "최악의 요리 실패담" (실패/해프닝)
        ✅ "어릴 적 단짝 친구" (관계/사람)
        ✅ "인생 영화 한 편" (문화/예술)
        ✅ "반려동물과의 추억" (반려동물)
        ✅ "첫 해외여행 기억" (여행/장소)
        ✅ "꼭 배우고 싶은 악기" (취미/여가)
        
        응답 형식 (JSON 배열만):
        [
          "소재 1",
          "소재 2",
          "소재 3"
        ]
        """;

        try {
            String jsonResponse = callGptRaw(prompt, 0.7);
            @SuppressWarnings("unchecked")
            List<String> topics = objectMapper.readValue(jsonResponse, List.class);

            if (topics != null && !topics.isEmpty()) {
                log.info("주제 추천 성공: {}", topics);
                return topics;
            }

        } catch (Exception e) {
            log.error("주제 추천 파싱 실패: {}", e.getMessage(), e);
        }

        return List.of(
                "오늘 뭐 했어?",
                "좋아하는 음식은?",
                "요즘 관심사는?"
        );
    }

    /**
     * 번역 및 학습 콘텐츠 생성
     * ✅ 부적절한 표현 필터링 추가
     */
    public GptScriptResponse generateScript(String koreanText) {
        String prompt = String.format(
                "# Role\n" +
                        "당신은 영어 회화 학습 콘텐츠 생성 전문가입니다.\n\n" +

                        "# Context\n" +
                        "사용자가 음성으로 말한 한국어를 영어로 번역하고, 학습 자료를 만들어야 합니다.\n" +
                        "입력된 한국어는 이미 전처리된 자연스러운 구어체입니다.\n\n" +

                        "# ⚠️ CRITICAL: 부적절한 표현 필터링\n" +
                        "입력 텍스트에 다음과 같은 표현이 있으면 번역을 거부하세요:\n" +
                        "- 욕설, 비속어\n" +
                        "- 성적인 표현\n" +
                        "- 폭력적 표현\n" +
                        "- 차별적/혐오 표현\n" +
                        "- 의미 불명의 단어나 글자 조합\n" +
                        "- 영어로 번역이 불가능하거나 부적절한 내용\n\n" +

                        "부적절한 내용이 발견되면 다음과 같이 응답:\n" +
                        "{\n" +
                        "  \"en\": \"INAPPROPRIATE_CONTENT\",\n" +
                        "  \"blank_script\": \"\",\n" +
                        "  \"similarity_phrases\": []\n" +
                        "}\n\n" +

                        "# Input\n" +
                        "한국어 문장: \"%s\"\n\n" +

                        "# Task\n" +
                        "위 한국어 문장을 분석하여 다음 JSON 형식으로 응답하세요:\n\n" +

                        "# Output Requirements\n" +
                        "1. **en** (영어 번역문)\n" +
                        "   - 구어체 특성을 살려 자연스럽게 번역\n" +
                        "   - 실제 원어민이 일상에서 사용하는 표현 우선\n" +
                        "   - 문법적으로 완벽하되 너무 격식적이지 않게\n" +

                        "2. **blank_script** (빈칸 학습지)\n" +
                        "   - 'en'에서 핵심 단어 2-3개를 [ ]로 치환\n" +
                        "   - 선택 기준: 동사 > 명사 > 형용사 순\n" +
                        "   - 학습 난이도를 고려하여 선택\n\n" +
                        "   **빈칸 개수 규칙:**\n" +
                        "   - 단어 1-2개: 최소 1개 빈칸 (필수)\n" +
                        "   - 단어 3-5개: 2개 빈칸\n" +
                        "   - 단어 6개 이상: 2-3개 빈칸\n" +
                        "   - ⚠️ 빈칸이 없는 문장은 절대 불가\n\n" +

                        "3. **similarity_phrases** (유사 표현 2개)\n" +
                        "   - 'en'과 완전히 같은 의미의 다른 영어 문장\n" +
                        "   - 다양한 표현 방식 제시 (격식/비격식, 직접/간접 등)\n" +
                        "   - 한국어 절대 금지, 순수 영어만\n\n" +

                        "# Output Format (JSON only, no extra text)\n" +
                        "{\n" +
                        "  \"en\": \"자연스러운 영어 번역\",\n" +
                        "  \"blank_script\": \"The [weather] is so [beautiful].\",\n" +
                        "  \"similarity_phrases\": [\n" +
                        "    \"첫 번째 유사 표현\",\n" +
                        "    \"두 번째 유사 표현\"\n" +
                        "  ]\n" +
                        "}\n\n" +

                        "# Examples\n\n" +
                        
                        "## 예시 1: 정상 문장\n" +
                        "입력: \"오늘 날씨 진짜 좋다\"\n" +
                        "출력:\n" +
                        "{\n" +
                        "  \"en\": \"The weather is really nice today.\",\n" +
                        "  \"blank_script\": \"The [weather] is really [nice] today.\",\n" +
                        "  \"similarity_phrases\": [\n" +
                        "    \"It's such a beautiful day today.\",\n" +
                        "    \"Today's weather is awesome.\"\n" +
                        "  ]\n" +
                        "}\n\n" +

                        
                        "## 예시 : 의미 불명\n" +
                        "입력: \"asdfqwer 1234\"\n" +
                        "출력:\n" +
                        "{\n" +
                        "  \"en\": \"INAPPROPRIATE_CONTENT\",\n" +
                        "  \"blank_script\": \"\",\n" +
                        "  \"similarity_phrases\": []\n" +
                        "}\n\n" +

                        "이제 위 한국어 문장을 처리해주세요.", koreanText
        );

        String jsonResponse = callGptRaw(prompt);
        
        try {
            GptScriptResponse response = objectMapper.readValue(jsonResponse, GptScriptResponse.class);
            
            // 부적절한 콘텐츠 체크
            if ("INAPPROPRIATE_CONTENT".equals(response.getEn())) {
                log.warn("부적절한 콘텐츠 감지됨 - 원본: '{}'", koreanText);
                throw new RuntimeException("부적절한 콘텐츠가 포함되어 번역할 수 없습니다");
            }
            
            return response;
            
        } catch (Exception e) {
            log.error("스크립트 생성 파싱 실패: {}", e.getMessage());
            throw new RuntimeException("GPT 응답 파싱 실패", e);
        }
    }

    /**
     * JSON 응답을 요청하는 범용 GPT 호출
     */
    public String callGptForJson(String prompt) {
        log.info("GPT JSON 호출 - prompt length: {}", prompt.length());
        return callGptRaw(prompt);
    }

    /**
     * JSON 문자열을 Map으로 파싱
     */
    public Map<String, Object> parseJsonResponse(String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> result = objectMapper.readValue(json, Map.class);
            return result;
        } catch (Exception e) {
            log.error("JSON 파싱 실패 - json: {}", json, e);
            throw new RuntimeException("GPT 응답 파싱 실패", e);
        }
    }

    public String callGptRaw(String prompt) {
        return callGptRaw(prompt, null);
    }

    /**
     * GPT 호출 (JSON 문자열 반환)
     */
    public String callGptRaw(String prompt, Double temperature) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + openAiApiKey);

        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("messages", List.of(Map.of("role", "user", "content", prompt)));
        if (temperature != null) {
            body.put("temperature", temperature);
        }

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
        ResponseEntity<Map> response = restTemplate.postForEntity(chatCompletionsUrl(), entity, Map.class);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> choices = (List<Map<String, Object>>) response.getBody().get("choices");
        
        @SuppressWarnings("unchecked")
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        String content = (String) message.get("content");

        // JSON 추출
        int startIndex = content.indexOf("{");
        int endIndex = content.lastIndexOf("}");
        
        if (startIndex == -1 || endIndex == -1) {
            startIndex = content.indexOf("[");
            endIndex = content.lastIndexOf("]");
        }
        
        if (startIndex == -1 || endIndex == -1 || startIndex > endIndex) {
            log.warn("JSON을 찾을 수 없음. 원본 반환: {}", content);
            return content;
        }
        
        String extracted = content.substring(startIndex, endIndex + 1);
        log.debug("JSON 추출 완료: {}", extracted);
        return extracted;
    }

    /**
     * GPT 스트리밍 호출 (stream=true)
     * - 응답 InputStream을 한 줄씩 읽어서 조각(delta.content)마다 onToken 호출
     * - 호출한 쓰레드는 스트림이 끝날 때까지 블로킹됨
     * @return 전체 응답 텍스트
     */
    public String streamChat(List<Map<String, String>> messages, Consumer<String> onToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("messages", messages);
        body.put("stream", true);

        RequestCallback requestCallback = request -> {
            request.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            request.getHeaders().setAccept(List.of(MediaType.TEXT_EVENT_STREAM));
            request.getHeaders().set("Authorization", "Bearer " + openAiApiKey);
            objectMapper.writeValue(request.getBody(), body);
        };

        ResponseExtractor<String> responseExtractor = response -> {
            StringBuilder full = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(response.getBody(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (!line.startsWith("data: ")) {
                        continue;
                    }
                    String data = line.substring(6).trim();
                    if ("[DONE]".equals(data)) {
                        break;
                    }
                    JsonNode content = objectMapper.readTree(data).path("choices").path(0).path("delta").path("content");
                    if (content.isMissingNode() || content.isNull() || content.asText().isEmpty()) {
                        continue;
                    }
                    String text = content.asText();
                    full.append(text);
                    onToken.accept(text);
                }
            }
            return full.toString();
        };

        return restTemplate.execute(chatCompletionsUrl(), HttpMethod.POST, requestCallback, responseExtractor);
    }
}
