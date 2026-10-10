# OpenAI 실측 (mock 지연값 근거)

- 일시: 2026-10-11, 로컬 맥북, 모델 gpt-4o-mini
- 방법: `bench/measure-openai.py --n 10` 2회 (총 20회씩)
- 채팅: 실제 싱글 모드와 같은 system 프롬프트 + 대화 4줄 + 새 메시지, stream=true
- 쉐도잉: ScriptPrompt 와 동일한 프롬프트, stream=false

## 채팅 (stream=true)

| 회차 | 첫 토큰 avg | 첫 토큰 median | 전체 avg | 전체 median | 토큰 수 |
|---|---|---|---|---|---|
| 1 | 980 ms | 840 ms | 1265 ms | 1149 ms | 30 |
| 2 | 574 ms | 573 ms | 863 ms | 842 ms | 30 |

1회차는 첫 호출 3건이 1.5~1.8초로 튀었고(콜드), 2회차는 안정적. 20회 전체 median 은 첫 토큰 약 650 ms, 전체 약 950 ms.

## 쉐도잉 문장 생성 (stream=false)

| 회차 | 전체 avg | 전체 median | min | max |
|---|---|---|---|---|
| 1 | 1393 ms | 1271 ms | 1042 | 2222 |
| 2 | 1364 ms | 1298 ms | 1176 | 1684 |

## mock GPT 에 적용한 값

| 항목 | 값 | 근거 |
|---|---|---|
| 채팅 첫 토큰까지 | 700 ms | 20회 median 반올림 |
| 채팅 토큰 수 / 간격 | 30개 / 10 ms | 전체 ≈ 1.0 s 가 되도록 |
| 쉐도잉 응답 | 1300 ms | 20회 median 반올림 |

환경변수로 바꿀 수 있음 (`FIRST_TOKEN_MS`, `TOKEN_COUNT`, `TOKEN_INTERVAL_MS`, `SCRIPT_MS`).
