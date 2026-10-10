'use strict';
// 부하 테스트용 OpenAI chat/completions 목 서버. 의존성 없이 내장 http 모듈만 쓴다.
// 목이 병목이 되면 안 되므로 요청당 타이머 하나만 두고 이벤트 루프를 막는 작업은 하지 않는다.

const http = require('http');

const intEnv = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
};

const CONFIG = {
  port: intEnv('PORT', 9000),
  firstTokenMs: intEnv('FIRST_TOKEN_MS', 700),
  tokenCount: intEnv('TOKEN_COUNT', 30),
  tokenIntervalMs: intEnv('TOKEN_INTERVAL_MS', 10),
  scriptMs: intEnv('SCRIPT_MS', 1300),
};

const MODEL = 'gpt-4o-mini';
const MAX_BODY = 1024 * 1024;

// "안녕! 오늘은 좋아하는 음식에 대해 얘기해보자. 너는 어떤 음식 제일 좋아해? 나는 떡볶이가 최고라고 생각해." 를 30조각으로
const PIECES = [
  '안녕', '!', ' 오늘', '은', ' 좋아', '하는', ' 음식', '에', ' 대해', ' 얘기',
  '해', '보자', '.', ' 너', '는', ' 어떤', ' 음식', ' 제일', ' 좋아', '해',
  '?', ' 나', '는', ' 떡볶이', '가', ' 최고', '라고', ' 생각', '해', '.',
];

// 카운터. streamsOpen/scriptsOpen 은 현재 상태라 reset 대상이 아니다.
const ABORT_BUCKETS = [0, 1, 2, 5, 10, 20, 30];
function freshCounters() {
  return {
    requestsTotal: 0,
    streamRequests: 0,
    scriptRequests: 0,
    otherRequests: 0,
    badRequests: 0,
    streamsCompleted: 0,
    streamsAborted: 0,
    abortTokensSentSum: 0,
    abortTokensSentBuckets: ABORT_BUCKETS.map(() => 0),
    tokensSentTotal: 0,
    scriptsCompleted: 0,
    scriptsAborted: 0,
  };
}
let c = freshCounters();
let streamsOpen = 0;
let scriptsOpen = 0;
let resetAt = Date.now();

// 중단 로그는 1초에 한 줄로 묶는다
let abortLogPending = 0;
let abortLogLastTokens = 0;
let abortLogTimer = null;
function logAbort(tokensSent) {
  abortLogPending++;
  abortLogLastTokens = tokensSent;
  if (abortLogTimer) return;
  abortLogTimer = setTimeout(() => {
    console.log(`[mock-gpt] stream aborted x${abortLogPending} (last tokens_sent=${abortLogLastTokens}, open=${streamsOpen}, aborted_total=${c.streamsAborted})`);
    abortLogPending = 0;
    abortLogTimer = null;
  }, 1000);
  abortLogTimer.unref();
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function errorJson(res, status, message, type) {
  sendJson(res, status, { error: { message, type, param: null, code: null } });
}

function headerMs(req, name, def) {
  const raw = req.headers[name];
  if (raw === undefined) return def;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

function chunkLine(created, delta, finishReason) {
  return 'data: ' + JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created,
    model: MODEL,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  }) + '\n\n';
}

function handleStream(req, res) {
  c.streamRequests++;
  streamsOpen++;
  const firstMs = headerMs(req, 'x-mock-first-token-ms', CONFIG.firstTokenMs);
  const created = Math.floor(Date.now() / 1000);
  let sent = 0;
  let done = false;
  let timer = null;
  let interval = null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  const finish = () => {
    done = true;
    if (interval) clearInterval(interval);
    res.write(chunkLine(created, {}, 'stop'));
    res.end('data: [DONE]\n\n');
  };

  const sendOne = () => {
    const piece = PIECES[sent % PIECES.length];
    // 첫 조각은 실제 API 처럼 role 청크를 앞에 붙인다
    const prefix = sent === 0 ? chunkLine(created, { role: 'assistant', content: '' }, null) : '';
    res.write(prefix + chunkLine(created, { content: piece }, null));
    sent++;
    c.tokensSentTotal++;
    if (sent >= CONFIG.tokenCount) finish();
  };

  timer = setTimeout(() => {
    timer = null;
    if (CONFIG.tokenCount === 0) return finish();
    sendOne();
    if (!done) interval = setInterval(sendOne, CONFIG.tokenIntervalMs);
  }, firstMs);

  // [DONE] 전에 소켓이 닫히면 중단으로 집계
  res.on('close', () => {
    streamsOpen--;
    if (done) {
      c.streamsCompleted++;
      return;
    }
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    c.streamsAborted++;
    c.abortTokensSentSum += sent;
    ABORT_BUCKETS.forEach((le, i) => { if (sent <= le) c.abortTokensSentBuckets[i]++; });
    logAbort(sent);
  });
}

function lastUserContent(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.map((p) => (p && p.text) || '').join('\n');
    }
  }
  return '';
}

function handleScript(req, res, body) {
  c.scriptRequests++;
  scriptsOpen++;
  const waitMs = headerMs(req, 'x-mock-script-ms', CONFIG.scriptMs);
  const prompt = lastUserContent(body.messages);
  const m = prompt.match(/한국어 문장:\s*"([^"\n]*)"/);
  const sentence = m ? m[1] : prompt.slice(0, 50);
  let done = false;

  const timer = setTimeout(() => {
    done = true;
    const content = JSON.stringify({
      en: `Mock translation of: ${sentence}`,
      blank_script: `Mock [translation] of: ${sentence}`,
      similarity_phrases: ['Mock phrase one.', 'Mock phrase two.'],
    });
    const promptTokens = Math.max(1, Math.ceil(prompt.length / 2));
    const completionTokens = Math.max(1, Math.ceil(content.length / 4));
    sendJson(res, 200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        logprobs: null,
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      system_fingerprint: 'fp_mock',
    });
  }, waitMs);

  res.on('close', () => {
    scriptsOpen--;
    if (done) {
      c.scriptsCompleted++;
    } else {
      clearTimeout(timer);
      c.scriptsAborted++;
    }
  });
}

function snapshot() {
  const mem = process.memoryUsage();
  return {
    config: CONFIG,
    uptime_s: Math.round(process.uptime() * 10) / 10,
    since_reset_s: Math.round((Date.now() - resetAt) / 100) / 10,
    rss_bytes: mem.rss,
    rss_mb: Math.round(mem.rss / 1048576 * 10) / 10,
    heap_used_mb: Math.round(mem.heapUsed / 1048576 * 10) / 10,
    requests_total: c.requestsTotal,
    requests_stream: c.streamRequests,
    requests_script: c.scriptRequests,
    requests_other: c.otherRequests,
    bad_requests: c.badRequests,
    streams_open: streamsOpen,
    streams_completed: c.streamsCompleted,
    streams_aborted: c.streamsAborted,
    abort_tokens_sent_sum: c.abortTokensSentSum,
    abort_tokens_sent_avg: c.streamsAborted ? Math.round(c.abortTokensSentSum / c.streamsAborted * 100) / 100 : 0,
    tokens_sent_total: c.tokensSentTotal,
    scripts_open: scriptsOpen,
    scripts_completed: c.scriptsCompleted,
    scripts_aborted: c.scriptsAborted,
  };
}

function metrics() {
  const mem = process.memoryUsage();
  const L = [];
  const metric = (name, type, help, samples) => {
    L.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of samples) L.push(`${name}${labels} ${v}`);
  };
  metric('mock_requests_total', 'counter', 'Requests by kind.', [
    ['{kind="stream"}', c.streamRequests],
    ['{kind="script"}', c.scriptRequests],
    ['{kind="other"}', c.otherRequests],
  ]);
  metric('mock_bad_requests_total', 'counter', 'Malformed or rejected requests.', [['', c.badRequests]]);
  metric('mock_streams_open', 'gauge', 'Streams currently open.', [['', streamsOpen]]);
  metric('mock_streams_completed_total', 'counter', 'Streams that reached [DONE].', [['', c.streamsCompleted]]);
  metric('mock_streams_aborted_total', 'counter', 'Streams closed by the client before [DONE].', [['', c.streamsAborted]]);
  // 히스토그램이라 mock_stream_abort_tokens_sent_sum / _count 가 같이 나온다
  metric('mock_stream_abort_tokens_sent', 'histogram', 'Content tokens sent before abort.', [
    ...ABORT_BUCKETS.map((le, i) => [`_bucket{le="${le}"}`, c.abortTokensSentBuckets[i]]),
    ['_bucket{le="+Inf"}', c.streamsAborted],
    ['_sum', c.abortTokensSentSum],
    ['_count', c.streamsAborted],
  ]);
  metric('mock_tokens_sent_total', 'counter', 'Content tokens written to streams.', [['', c.tokensSentTotal]]);
  metric('mock_scripts_open', 'gauge', 'Non-stream requests currently waiting.', [['', scriptsOpen]]);
  metric('mock_scripts_completed_total', 'counter', 'Non-stream requests answered.', [['', c.scriptsCompleted]]);
  metric('mock_scripts_aborted_total', 'counter', 'Non-stream requests closed before answer.', [['', c.scriptsAborted]]);
  metric('mock_process_resident_memory_bytes', 'gauge', 'Process RSS.', [['', mem.rss]]);
  metric('mock_process_uptime_seconds', 'gauge', 'Process uptime.', [['', process.uptime().toFixed(1)]]);
  return L.join('\n') + '\n';
}

const server = http.createServer((req, res) => {
  c.requestsTotal++;
  const path = req.url.split('?')[0];

  if (req.method === 'GET' && path === '/stats') {
    c.otherRequests++;
    return sendJson(res, 200, snapshot());
  }
  if (req.method === 'GET' && path === '/metrics') {
    c.otherRequests++;
    const body = metrics();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    c.otherRequests++;
    return sendJson(res, 200, { status: 'ok' });
  }
  if (req.method === 'POST' && path === '/reset') {
    c = freshCounters();
    resetAt = Date.now();
    return sendJson(res, 200, { reset: true });
  }
  // base url 에 /v1 이 붙어 있어도 동작하도록 /chat/completions 도 받는다
  if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (d) => {
      size += d.length;
      if (size > MAX_BODY) { tooBig = true; return; }
      chunks.push(d);
    });
    req.on('end', () => {
      if (tooBig) { c.badRequests++; return errorJson(res, 413, 'Request body too large', 'invalid_request_error'); }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
      } catch (e) {
        c.badRequests++;
        return errorJson(res, 400, 'We could not parse the JSON body of your request.', 'invalid_request_error');
      }
      if (body.stream === true) handleStream(req, res);
      else handleScript(req, res, body);
    });
    return;
  }
  c.otherRequests++;
  errorJson(res, 404, `Unknown request URL: ${req.method} ${path}`, 'invalid_request_error');
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0; // 느린 LLM 시나리오에서 긴 응답이 잘리지 않게
server.maxConnections = Infinity;

// accept 큐. 실제 상한은 OS 의 somaxconn 과의 최솟값 (macOS 기본 128, Linux 컨테이너 보통 4096)
server.listen({ port: CONFIG.port, backlog: 4096 }, () => {
  console.log(`[mock-gpt] listening on :${CONFIG.port} FIRST_TOKEN_MS=${CONFIG.firstTokenMs} TOKEN_COUNT=${CONFIG.tokenCount} TOKEN_INTERVAL_MS=${CONFIG.tokenIntervalMs} SCRIPT_MS=${CONFIG.scriptMs} node=${process.version}`);
});

// docker stop 시 열린 스트림을 오래 기다리지 않고 종료
function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
