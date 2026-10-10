// AI 채팅 스트리밍 부하 테스트. 세션 생성 -> 메시지 전송(SSE 끝까지 수신) -> 1초 쉼.
// TARGET_URL 로 A(18080) 또는 B(18081)를 고른다. 토큰은 항상 A 에서 받는다.
import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  TARGET_URL, TOPICS, SENTENCES, pick, parseStages, login, authHeaders,
  infoThresholds, SUMMARY_TREND_STATS, buildSummary,
} from './lib.js';

const NAMES = ['create_session', 'send_message'];

export const options = {
  scenarios: {
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: parseStages(__ENV.STAGES || '50:60s,100:60s,200:60s,400:60s,800:60s,0:15s'),
      gracefulRampDown: '30s',
    },
  },
  discardResponseBodies: false, // event:done 확인에 본문이 필요하다
  noConnectionReuse: false,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: infoThresholds(NAMES),
  setupTimeout: '60s',
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  const base = `${TARGET_URL}/api/v1/ai-chat`;

  const created = http.post(`${base}/sessions`, JSON.stringify({ topic: pick(TOPICS) }), {
    headers: authHeaders(data.token),
    tags: { name: 'create_session' },
  });
  const okSession = check(created, {
    'create_session 200': (r) => r.status === 200,
  });
  const sessionId = okSession ? created.json('sessionId') : null;
  if (!sessionId) {
    sleep(1);
    return;
  }

  // http.post 는 스트림이 끝날 때까지 본문을 모은다.
  // http_req_waiting = 첫 바이트까지, http_req_duration = 스트림 끝까지
  const res = http.post(`${base}/sessions/${sessionId}/messages`, JSON.stringify({ text: pick(SENTENCES) }), {
    headers: authHeaders(data.token, { Accept: 'text/event-stream' }),
    tags: { name: 'send_message' },
    timeout: '120s',
  });
  check(res, {
    'send_message 200': (r) => r.status === 200,
    'send_message event:done': (r) => typeof r.body === 'string' && /event:\s?done/.test(r.body),
  });

  sleep(1);
}

export function handleSummary(data) {
  return buildSummary(data, 'chat', NAMES);
}
