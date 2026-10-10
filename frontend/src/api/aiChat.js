import api, { API_BASE_URL } from "./api";

const BASE = "/api/v1/ai-chat/sessions";

// [DEV ONLY] AI 채팅 백엔드 선택 (localStorage.aiChatBackend)
// 프로덕션 빌드에서는 빈 객체가 되어 항상 API_BASE_URL(프록시/배포 주소)을 사용
const DEV_CHAT_BACKENDS = import.meta.env.DEV
  ? {
      tomcat: "http://localhost:8080",
      webflux: "http://localhost:8081",
    }
  : {};
const BACKEND_STORAGE_KEY = "aiChatBackend";

export function getAiChatBackend() {
  if (!import.meta.env.DEV) return null;
  try {
    const v = localStorage.getItem(BACKEND_STORAGE_KEY);
    return v && DEV_CHAT_BACKENDS[v] ? v : null;
  } catch {
    return null;
  }
}

export function setAiChatBackend(key) {
  if (!import.meta.env.DEV) return;
  try {
    if (key && DEV_CHAT_BACKENDS[key]) localStorage.setItem(BACKEND_STORAGE_KEY, key);
    else localStorage.removeItem(BACKEND_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// 개발용 백엔드 override 주소 (없으면 "")
function devOverrideUrl() {
  const key = getAiChatBackend();
  return key ? DEV_CHAT_BACKENDS[key] : "";
}

// fetch 용 (axios 는 baseURL 이 자동으로 붙으므로 override 만 붙인다)
function chatBaseUrl() {
  return devOverrideUrl() || API_BASE_URL;
}

/**
 * AI 대화 세션 생성
 * POST /api/v1/ai-chat/sessions
 */
export async function createChatSession(topic) {
  const res = await api.post(`${devOverrideUrl()}${BASE}`, { topic });
  return res.data; // { sessionId }
}

/**
 * 대화 기록 조회
 * GET /api/v1/ai-chat/sessions/{sessionId}/messages
 */
export async function getChatHistory(sessionId) {
  const res = await api.get(`${devOverrideUrl()}${BASE}/${encodeURIComponent(sessionId)}/messages`);
  return res.data; // [{ role, content, at }]
}

/**
 * SSE 텍스트 파서
 * 청크 단위로 push 하면 완성된 이벤트 블록마다 onEvent({ event, data }) 호출
 * 블록이 청크 경계에서 잘려도 버퍼에 남겨 다음 청크와 합쳐 처리한다
 */
export function createSseParser(onEvent) {
  let buffer = "";

  const parseBlock = (block) => {
    let event = "message";
    const dataLines = [];

    block.split("\n").forEach((line) => {
      if (!line || line.startsWith(":")) return;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    });

    if (dataLines.length === 0) return;

    const raw = dataLines.join("\n");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { type: event, text: raw };
    }
    onEvent({ event: data?.type || event, data });
  };

  return {
    push(text) {
      buffer += text.replace(/\r\n?/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        parseBlock(block);
        sep = buffer.indexOf("\n\n");
      }
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      if (rest) parseBlock(rest);
    },
  };
}

async function readErrorReason(res) {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json?.message || json?.error || json?.text || `요청 실패 (${res.status})`;
    } catch {
      return text || `요청 실패 (${res.status})`;
    }
  } catch {
    return `요청 실패 (${res.status})`;
  }
}

/**
 * fetch + ReadableStream 으로 SSE 소비
 * 반환된 AbortController 로 취소 가능 (취소 시 핸들러는 호출되지 않음)
 */
function streamSse(path, body, handlers = {}) {
  const controller = new AbortController();
  const { onToken, onDone, onError } = handlers;

  let finished = false;
  let acc = "";

  // 취소된 뒤에는 어떤 핸들러도 호출하지 않는다
  const finishDone = (text) => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    onDone?.(text);
  };
  const finishError = (reason) => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    onError?.(reason);
  };

  const run = async () => {
    const token = localStorage.getItem("accessToken");
    const headers = { Accept: "text/event-stream" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${chatBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401) {
        finishError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
        return;
      }
      finishError(await readErrorReason(res));
      return;
    }
    if (!res.body) {
      finishError("스트리밍을 지원하지 않는 응답입니다.");
      return;
    }

    const parser = createSseParser(({ event, data }) => {
      if (finished || controller.signal.aborted) return;
      if (event === "token") {
        const piece = data?.text ?? "";
        acc += piece;
        onToken?.(piece);
      } else if (event === "done") {
        finishDone(typeof data?.text === "string" && data.text ? data.text : acc);
      } else if (event === "error") {
        finishError(data?.text || "응답 생성 중 오류가 발생했습니다.");
      }
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (!finished && !controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }

    if (finished || controller.signal.aborted) {
      reader.cancel().catch(() => {});
      return;
    }

    parser.push(decoder.decode());
    parser.flush();

    // done 이벤트 없이 스트림이 끝난 경우
    if (acc) finishDone(acc);
    else finishError("응답이 비어 있습니다.");
  };

  run().catch((e) => {
    if (controller.signal.aborted || e?.name === "AbortError") return;
    finishError("네트워크 오류가 발생했습니다.");
  });

  return controller;
}

/**
 * 봇 첫 인사 스트리밍
 * POST /api/v1/ai-chat/sessions/{sessionId}/greeting
 */
export function streamGreeting(sessionId, handlers) {
  return streamSse(`${BASE}/${encodeURIComponent(sessionId)}/greeting`, undefined, handlers);
}

/**
 * 사용자 메시지 전송 + 봇 답변 스트리밍
 * POST /api/v1/ai-chat/sessions/{sessionId}/messages
 */
export function streamMessage(sessionId, text, handlers) {
  return streamSse(`${BASE}/${encodeURIComponent(sessionId)}/messages`, { text }, handlers);
}

/**
 * 쉐도잉 스크립트 생성 (사용자 메시지마다 1개)
 * POST /api/v1/ai-chat/sessions/{sessionId}/shadowing
 * -> { sessionId, scripts: [{ korean, en, blank_script, similarity_phrases }] }
 */
export async function generateShadowing(sessionId) {
  const res = await api.post(
    `${devOverrideUrl()}${BASE}/${encodeURIComponent(sessionId)}/shadowing`,
    null,
    { timeout: 60000 },
  );
  return res.data;
}
