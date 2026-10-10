package com.sudaduck.aichat.shadowing;

/**
 * A 의 GptService.generateScript 프롬프트를 글자 그대로 옮긴 것. A/B 비교가 공정하려면 같아야 한다.
 */
final class ScriptPrompt {

    static final String INAPPROPRIATE = "INAPPROPRIATE_CONTENT";

    private static final String TEMPLATE = """
            # Role
            당신은 영어 회화 학습 콘텐츠 생성 전문가입니다.

            # Context
            사용자가 음성으로 말한 한국어를 영어로 번역하고, 학습 자료를 만들어야 합니다.
            입력된 한국어는 이미 전처리된 자연스러운 구어체입니다.

            # ⚠️ CRITICAL: 부적절한 표현 필터링
            입력 텍스트에 다음과 같은 표현이 있으면 번역을 거부하세요:
            - 욕설, 비속어
            - 성적인 표현
            - 폭력적 표현
            - 차별적/혐오 표현
            - 의미 불명의 단어나 글자 조합
            - 영어로 번역이 불가능하거나 부적절한 내용

            부적절한 내용이 발견되면 다음과 같이 응답:
            {
              "en": "INAPPROPRIATE_CONTENT",
              "blank_script": "",
              "similarity_phrases": []
            }

            # Input
            한국어 문장: "%s"

            # Task
            위 한국어 문장을 분석하여 다음 JSON 형식으로 응답하세요:

            # Output Requirements
            1. **en** (영어 번역문)
               - 구어체 특성을 살려 자연스럽게 번역
               - 실제 원어민이 일상에서 사용하는 표현 우선
               - 문법적으로 완벽하되 너무 격식적이지 않게
            2. **blank_script** (빈칸 학습지)
               - 'en'에서 핵심 단어 2-3개를 [ ]로 치환
               - 선택 기준: 동사 > 명사 > 형용사 순
               - 학습 난이도를 고려하여 선택

               **빈칸 개수 규칙:**
               - 단어 1-2개: 최소 1개 빈칸 (필수)
               - 단어 3-5개: 2개 빈칸
               - 단어 6개 이상: 2-3개 빈칸
               - ⚠️ 빈칸이 없는 문장은 절대 불가

            3. **similarity_phrases** (유사 표현 2개)
               - 'en'과 완전히 같은 의미의 다른 영어 문장
               - 다양한 표현 방식 제시 (격식/비격식, 직접/간접 등)
               - 한국어 절대 금지, 순수 영어만

            # Output Format (JSON only, no extra text)
            {
              "en": "자연스러운 영어 번역",
              "blank_script": "The [weather] is so [beautiful].",
              "similarity_phrases": [
                "첫 번째 유사 표현",
                "두 번째 유사 표현"
              ]
            }

            # Examples

            ## 예시 1: 정상 문장
            입력: "오늘 날씨 진짜 좋다"
            출력:
            {
              "en": "The weather is really nice today.",
              "blank_script": "The [weather] is really [nice] today.",
              "similarity_phrases": [
                "It's such a beautiful day today.",
                "Today's weather is awesome."
              ]
            }

            ## 예시 : 의미 불명
            입력: "asdfqwer 1234"
            출력:
            {
              "en": "INAPPROPRIATE_CONTENT",
              "blank_script": "",
              "similarity_phrases": []
            }

            이제 위 한국어 문장을 처리해주세요.""";

    private ScriptPrompt() {
    }

    static String of(String korean) {
        return String.format(TEMPLATE, korean);
    }

    /** A 의 callGptRaw 와 같은 방식. 앞뒤 잡담이 붙어도 첫 { 부터 마지막 } 까지만 쓴다. */
    static String extractJson(String content) {
        int start = content.indexOf('{');
        int end = content.lastIndexOf('}');
        if (start == -1 || end == -1 || start > end) {
            return content;
        }
        return content.substring(start, end + 1);
    }
}
