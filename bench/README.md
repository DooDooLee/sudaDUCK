# AI 채팅 부하 테스트 (A: Tomcat vs B: WebFlux)

같은 자원(CPU 2개, 메모리 1.5GB, `-Xmx1g`)을 준 A(`backend/`)와 B(`ai-chat/`)에 같은 k6 시나리오를 돌려 비교한다.
OpenAI 는 `mock-gpt` 로 대체한다. 결과 정리는 따로 쓴다.

## 준비

```bash
cd bench
cp .env.example .env      # JWT_SECRET 채우기. A·B 가 같은 키를 써야 토큰이 통한다
docker compose up -d --build
docker compose ps         # app-a, app-b, mysql, redis, mock-gpt 가 healthy 인지 확인
```

| 서비스 | 호스트 포트 | 비고 |
|---|---|---|
| app-a (Tomcat) | 18080 | 설정: `config/app-a.yaml`, 이미지: `docker/app-a.Dockerfile` |
| app-b (WebFlux) | 18081 | 설정: 환경변수, 이미지: `ai-chat/Dockerfile` |
| mock-gpt | 19000 | `/stats`, `/metrics`, `POST /reset` |
| Prometheus | 9090 | 5초 간격 수집 |
| Grafana | 3000 | 로그인 없음. http://localhost:3000/d/ai-chat-bench |
| mysql, redis | 내부 전용 | 로컬 개발용 8080/8081/6379 와 겹치지 않는다 |

## 실행

```bash
./run.sh a chat                     # A, 채팅 스트리밍 (기본 50→100→200→400→800 VU, 각 60초)
./run.sh b chat                     # B, 같은 시나리오
./run.sh a shadowing                # A, 메시지 2번 + 쉐도잉 생성 (기본 10→20→50→100 VU)
./run.sh b shadowing my-label       # 세 번째 인자는 결과 파일 라벨

STAGES=10:30s,0:5s ./run.sh a chat smoke-a   # 단계 덮어쓰기 (VU:시간, 마지막에 0 으로 내리기)
```

- `run.sh` 는 시작 전에 mock 카운터를 비우고(`POST /reset`), 끝나면 mock `/stats` 를 출력한다.
- 토큰은 항상 A 의 `test-signup`/`test-login` 으로 받는다. B 는 같은 JWT 키로 검증한다.
- 한 번에 한 앱만 테스트한다. 두 앱은 같이 떠 있어도 대기 중에는 자원을 거의 안 쓴다.

## 결과

`results/` 에 라벨별로 남는다.

- `<label>-<chat|shadowing>-summary.txt`: 요청 이름별 p50/p95/p99 표
  - `wait` = `http_req_waiting` (첫 바이트까지), `dur` = `http_req_duration` (SSE 끝까지)
- `<label>-<chat|shadowing>-summary.json`: 위 표 + k6 원본 요약
- `<label>-<chat|shadowing>-k6-export.json`: `--summary-export` 결과

실패율 1% 미만, checks 99% 이상은 정보용 임계값이다. 넘겨도 테스트는 끝까지 돌고 `run.sh` 는 성공으로 끝난다.

## 자원 제한

`docker-compose.yml` 의 `cpus: "2.0"`, `mem_limit: 1536m` 를 A·B 에 똑같이 건다. 적용 확인:

```bash
docker inspect sudaduck-bench-app-a-1 --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'
# 2000000000 1610612736
```

## mock 응답 시간

`FIRST_TOKEN_MS=700`, `TOKEN_COUNT=30`, `TOKEN_INTERVAL_MS=10`, `SCRIPT_MS=1300`.
gpt-4o-mini 실측값 기준이고 근거는 `results/openai-latency.md` (측정 스크립트 `measure-openai.py`).

## 초기화 / 정리

```bash
curl -X POST localhost:19000/reset     # mock 카운터만 초기화
docker compose restart app-a app-b     # 앱 상태(스레드, 힙) 초기화
docker compose down                    # 전체 종료 (Prometheus 데이터는 볼륨에 남는다)
docker compose down -v                 # 볼륨까지 삭제
```
