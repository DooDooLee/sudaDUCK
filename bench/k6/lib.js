// chat-stream.js / shadowing.js 공통 코드: 토큰 발급, 단계 파싱, 결과 요약
import http from 'k6/http';

export const A_URL = __ENV.A_URL || 'http://localhost:18080';
export const TARGET_URL = __ENV.TARGET_URL || A_URL;
export const LABEL = __ENV.LABEL || 'run';
export const RESULTS_DIR = __ENV.RESULTS_DIR || 'results';

export const TOPICS = ['음식', '여행', '취미', '영화', '운동', '학교생활', '날씨', '음악'];
export const SENTENCES = [
  '나는 어제 친구랑 떡볶이를 먹었어.',
  '주말에 부산으로 여행을 가고 싶어.',
  '요즘 기타 치는 걸 배우고 있어.',
  '오늘 아침에 늦잠을 자서 지각할 뻔했어.',
  '나는 매운 음식을 정말 좋아해.',
  '어제 본 영화가 생각보다 재미있었어.',
  '저녁마다 한강에서 달리기를 해.',
  '비가 와서 집에서 책을 읽었어.',
];

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// "50:60s,100:60s,0:15s" -> [{target:50,duration:'60s'}, ...]
export function parseStages(raw) {
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [target, duration] = s.split(':');
    return { target: parseInt(target, 10), duration };
  });
}

// A 에서 테스트 계정을 만들고 토큰을 받는다. B 도 같은 JWT 키라 이 토큰을 그대로 쓴다.
export function login() {
  const headers = { 'Content-Type': 'application/json' };
  // 이미 있으면 401/500 이 오지만 무시한다
  http.post(`${A_URL}/api/v1/auth/test-signup`,
    JSON.stringify({ userId: 1, email: 'test@local.dev', name: 'tester', nickname: 'tester' }),
    { headers, responseCallback: http.expectedStatuses({ min: 200, max: 599 }) });
  const res = http.post(`${A_URL}/api/v1/auth/test-login`,
    JSON.stringify({ userId: 1, email: 'test@local.dev' }), { headers });
  if (res.status !== 200) {
    throw new Error(`test-login 실패: ${res.status} ${res.body}`);
  }
  const token = res.json('accessToken');
  if (!token) throw new Error(`accessToken 없음: ${res.body}`);
  return token;
}

export function authHeaders(token, extra) {
  return Object.assign({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, extra || {});
}

// 이름(name 태그)별 하위 지표가 요약에 나오도록 정보용 임계값을 건다. 실패해도 중단하지 않는다.
export function infoThresholds(names) {
  const t = {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }],
    checks: [{ threshold: 'rate>0.99', abortOnFail: false }],
  };
  for (const n of names) {
    t[`http_req_waiting{name:${n}}`] = [{ threshold: 'p(95)>=0', abortOnFail: false }];
    t[`http_req_duration{name:${n}}`] = [{ threshold: 'p(95)>=0', abortOnFail: false }];
    t[`http_reqs{name:${n}}`] = [{ threshold: 'count>=0', abortOnFail: false }];
    t[`http_req_failed{name:${n}}`] = [{ threshold: 'rate<0.01', abortOnFail: false }];
  }
  return t;
}

export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

function ms(v) {
  return v === undefined || v === null ? '-' : `${Math.round(v)}ms`;
}
function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// 이름별 p50/p95/p99 표 + 전체 요청률/실패율
export function buildSummary(data, scenario, names) {
  const m = data.metrics;
  const durSec = (data.state && data.state.testRunDurationMs ? data.state.testRunDurationMs : 0) / 1000;
  const lines = [];
  lines.push(`[${LABEL}] ${scenario} @ ${TARGET_URL}  (실행 ${durSec.toFixed(1)}s, 최대 VU ${m.vus_max ? m.vus_max.values.max : '-'})`);
  lines.push(pad('name', 16) + pad('reqs', 8) + pad('req/s', 9) + pad('failed', 9)
    + pad('wait p50', 10) + pad('wait p95', 10) + pad('wait p99', 10)
    + pad('dur p50', 10) + pad('dur p95', 10) + pad('dur p99', 10));
  const table = {};
  for (const n of names) {
    const w = m[`http_req_waiting{name:${n}}`];
    const d = m[`http_req_duration{name:${n}}`];
    const r = m[`http_reqs{name:${n}}`];
    const f = m[`http_req_failed{name:${n}}`];
    const row = {
      reqs: r ? r.values.count : 0,
      rps: r ? r.values.rate : 0,
      failedRate: f ? f.values.rate : 0,
      waiting: w ? { p50: w.values.med, p95: w.values['p(95)'], p99: w.values['p(99)'] } : null,
      duration: d ? { p50: d.values.med, p95: d.values['p(95)'], p99: d.values['p(99)'] } : null,
    };
    table[n] = row;
    lines.push(pad(n, 16) + pad(row.reqs, 8) + pad(row.rps.toFixed(2), 9)
      + pad(`${(row.failedRate * 100).toFixed(2)}%`, 9)
      + pad(ms(row.waiting && row.waiting.p50), 10) + pad(ms(row.waiting && row.waiting.p95), 10)
      + pad(ms(row.waiting && row.waiting.p99), 10)
      + pad(ms(row.duration && row.duration.p50), 10) + pad(ms(row.duration && row.duration.p95), 10)
      + pad(ms(row.duration && row.duration.p99), 10));
  }
  const total = m.http_reqs ? m.http_reqs.values : { count: 0, rate: 0 };
  const failed = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  const checks = m.checks ? m.checks.values : { passes: 0, fails: 0, rate: 0 };
  const iters = m.iterations ? m.iterations.values : { count: 0, rate: 0 };
  lines.push(`전체: ${total.count} req (${total.rate.toFixed(2)} req/s), 실패 ${(failed * 100).toFixed(2)}%, `
    + `checks ${checks.passes}/${checks.passes + checks.fails} 통과, iterations ${iters.count} (${iters.rate.toFixed(2)}/s)`);
  lines.push('wait = http_req_waiting (첫 바이트까지), dur = http_req_duration (스트림 끝까지)');
  const text = lines.join('\n') + '\n';

  const compact = {
    label: LABEL, scenario, target: TARGET_URL, finishedAt: new Date().toISOString(),
    durationSec: durSec, totalReqs: total.count, reqRate: total.rate, failedRate: failed,
    checks: { passes: checks.passes, fails: checks.fails }, iterations: iters.count,
    byName: table,
  };
  const base = `${RESULTS_DIR}/${LABEL}-${scenario}-summary`;
  const out = { stdout: '\n' + text };
  out[`${base}.json`] = JSON.stringify({ summary: compact, k6: data }, null, 2);
  out[`${base}.txt`] = text;
  return out;
}
