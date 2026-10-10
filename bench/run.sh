#!/usr/bin/env bash
# 사용법: ./run.sh <a|b> <chat|shadowing> [label]
#   STAGES=10:30s,0:5s ./run.sh a chat smoke-a   처럼 단계를 덮어쓸 수 있다
#   K6_EXTRA="--out csv=results/x.csv.gz" 로 k6 옵션을 더 넘길 수 있다 (단계별 분석용 시계열)
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BENCH_DIR"

usage() { echo "사용법: $0 <a|b> <chat|shadowing> [label]" >&2; exit 2; }
[[ $# -ge 2 ]] || usage

case "$1" in
  a) TARGET_URL="http://localhost:18080"; APP="A (Tomcat)" ;;
  b) TARGET_URL="http://localhost:18081"; APP="B (WebFlux)" ;;
  *) usage ;;
esac
case "$2" in
  chat)      SCRIPT="k6/chat-stream.js" ;;
  shadowing) SCRIPT="k6/shadowing.js" ;;
  *) usage ;;
esac
LABEL="${3:-$1-$2-$(date +%Y%m%d-%H%M%S)}"
MOCK_URL="${MOCK_URL:-http://localhost:19000}"
mkdir -p results

# 이전 실행의 mock 카운터를 비운다
curl -fsS -X POST "$MOCK_URL/reset" > /dev/null || { echo "mock-gpt($MOCK_URL) 에 연결할 수 없다. docker compose up -d 먼저" >&2; exit 1; }

echo "대상     : $APP  $TARGET_URL"
echo "시나리오 : $2 ($SCRIPT)"
echo "라벨     : $LABEL"
echo "단계     : ${STAGES:-(스크립트 기본값)}"
echo "Grafana  : http://localhost:3000/d/ai-chat-bench"
echo

set +e
k6 run \
  -e TARGET_URL="$TARGET_URL" \
  -e A_URL="${A_URL:-http://localhost:18080}" \
  -e LABEL="$LABEL" \
  -e RESULTS_DIR="results" \
  ${STAGES:+-e STAGES="$STAGES"} \
  --summary-export "results/$LABEL-$2-k6-export.json" \
  ${K6_EXTRA:-} \
  "$SCRIPT"
rc=$?
set -e

echo
echo "mock-gpt 통계:"
curl -fsS "$MOCK_URL/stats" || true
echo
echo
echo "결과     : results/$LABEL-$2-summary.txt, results/$LABEL-$2-summary.json, results/$LABEL-$2-k6-export.json"
echo "Grafana  : http://localhost:3000/d/ai-chat-bench"
# 99 는 정보용 임계값을 넘겼다는 뜻일 뿐 테스트 자체는 끝까지 돌았다
if [[ $rc -ne 0 && $rc -ne 99 ]]; then
  echo "k6 종료 코드 $rc" >&2
  exit $rc
fi
[[ $rc -eq 99 ]] && echo "참고: 정보용 임계값(실패율 1% 미만, checks 99% 이상)을 넘겼다 (k6 종료 코드 99)"
exit 0
