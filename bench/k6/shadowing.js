// 쉐도잉 스크립트 생성 부하 테스트. 세션 생성 -> 메시지 2번(각각 done 까지) -> 쉐도잉 생성 -> 1초 쉼.
import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  TARGET_URL, TOPICS, SENTENCES, pick, parseStages, login, authHeaders,
  infoThresholds, SUMMARY_TREND_STATS, buildSummary,
} from './lib.js';

const NAMES = ['create_session', 'send_message', 'shadowing'];

export const options = {
  scenarios: {
    shadowing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: parseStages(__ENV.STAGES || '10:60s,20:60s,50:60s,100:60s,0:15s'),
      gracefulRampDown: '30s',
    },
  },
  discardResponseBodies: false,
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
  const sessionId = check(created, { 'create_session 200': (r) => r.status === 200 })
    ? created.json('sessionId') : null;
  if (!sessionId) {
    sleep(1);
    return;
  }

  for (let i = 0; i < 2; i++) {
    const res = http.post(`${base}/sessions/${sessionId}/messages`, JSON.stringify({ text: pick(SENTENCES) }), {
      headers: authHeaders(data.token, { Accept: 'text/event-stream' }),
      tags: { name: 'send_message' },
      timeout: '120s',
    });
    check(res, {
      'send_message 200': (r) => r.status === 200,
      'send_message event:done': (r) => typeof r.body === 'string' && /event:\s?done/.test(r.body),
    });
  }

  const sh = http.post(`${base}/sessions/${sessionId}/shadowing`, null, {
    headers: authHeaders(data.token),
    tags: { name: 'shadowing' },
    timeout: '120s',
  });
  check(sh, {
    'shadowing 200': (r) => r.status === 200,
    'shadowing scripts >= 1': (r) => {
      try {
        const s = r.json('scripts');
        return Array.isArray(s) && s.length >= 1;
      } catch (e) {
        return false;
      }
    },
  });

  sleep(1);
}

export function handleSummary(data) {
  return buildSummary(data, 'shadowing', NAMES);
}
