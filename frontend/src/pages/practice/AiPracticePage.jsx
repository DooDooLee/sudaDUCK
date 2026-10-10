import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./AiPracticePage.module.css";

import AppHeader from "@/components/layout/AppHeader/AppHeader";
import ExitGuard from "@/components/common/ExitGuard/ExitGuard";
import ExitButton from "@/components/common/ExitButton/ExitButton";
import ConfirmModal from "@/components/common/ConfirmModal/ConfirmModal";
import LoadingOverlay from "@/components/common/LoadingOverlay/LoadingOverlay";

import {
  createChatSession,
  generateShadowing,
  getAiChatBackend,
  setAiChatBackend,
  streamGreeting,
  streamMessage,
} from "@/api/aiChat";

import duckImg from "@/assets/images/duck.png";
import duckBotCyanImg from "@/assets/images/duck_bot_cyan.png";
// 아이콘 파일명과 그림이 반대 (mic_off.png = 초록 마이크, mic_on.png = 음소거 마이크)
import micOnIcon from "@/assets/icons/mic_on.png";
import micOffIcon from "@/assets/icons/mic_off.png";

const TOPICS = [
  "좋아하는 음식",
  "주말에 한 일",
  "요즘 빠진 것",
  "최근에 본 영화나 드라마",
  "가보고 싶은 여행지",
  "스트레스 푸는 법",
  "어릴 적 기억에 남는 일",
  "요즘 자주 듣는 노래",
];

// 직전 주제와 겹치지 않게 랜덤 선택
function pickTopic(exclude) {
  const pool = TOPICS.filter((t) => t !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

const SpeechRecognitionApi =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function TypingDots() {
  return (
    <span className={styles.Typing} aria-label="입력 중">
      <span className={styles.TypingDot} />
      <span className={styles.TypingDot} />
      <span className={styles.TypingDot} />
    </span>
  );
}

// [DEV ONLY] AI 채팅 백엔드 전환 (세션은 Redis 공유라 대화가 그대로 이어짐)
const DEV_BACKEND_OPTIONS = [
  { key: "tomcat", label: "기존 방식 (블로킹)", port: 8080 },
  { key: "webflux", label: "WebFlux (논블로킹)", port: 8081 },
];

function DevBackendToggle({ disabled }) {
  const [backend, setBackend] = useState(() => getAiChatBackend());

  const select = (key) => {
    setAiChatBackend(key);
    setBackend(key);
  };

  const current = DEV_BACKEND_OPTIONS.find((o) => o.key === backend);

  return (
    <div className={styles.DevBar}>
      <div className={styles.DevBarRow}>
        <span className={styles.DevBadge}>DEV</span>
        <div className={styles.Segmented} role="group" aria-label="AI 채팅 백엔드 선택">
          {DEV_BACKEND_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`${styles.SegmentButton} ${backend === o.key ? styles.SegmentActive : ""}`}
              onClick={() => select(o.key)}
              disabled={disabled}
              aria-pressed={backend === o.key}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className={styles.DevTarget}>
          {current ? `→ localhost:${current.port}` : "→ 프록시 기본"}
        </span>
      </div>
      <div className={styles.DevCaption}>같은 세션을 두 서버가 Redis로 공유합니다</div>
    </div>
  );
}

export default function AiPracticePage() {
  const navigate = useNavigate();

  const [showBackConfirm, setShowBackConfirm] = useState(false);

  const handleBack = () => {
    setShowBackConfirm(true);
  };

  const handleBackConfirm = useCallback(() => {
    setShowBackConfirm(false);
    if (window.history.length > 1) navigate(-1);
    else navigate("/main");
  }, [navigate]);

  const handleBackCancel = useCallback(() => {
    setShowBackConfirm(false);
  }, []);

  // 주제 / 세션
  const [topic, setTopic] = useState(() => pickTopic());
  const [sessionId, setSessionId] = useState(null);
  const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState("");
  const [showTopicConfirm, setShowTopicConfirm] = useState(false);

  // 채팅
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // 쉐도잉 문장 생성
  const [generating, setGenerating] = useState(false);
  const [shadowingNotice, setShadowingNotice] = useState("");

  // 음성 인식
  const [listening, setListening] = useState(false);
  const sttSupported = Boolean(SpeechRecognitionApi);

  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const idRef = useRef(0);
  const startedRef = useRef(false);
  const aliveRef = useRef(false);
  const genRef = useRef(0);

  const nextId = () => {
    idRef.current += 1;
    return `m${idRef.current}`;
  };

  const patchMessage = useCallback((id, updater) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updater(m) } : m)));
  }, []);

  // 봇 답변 스트리밍 공통 처리
  const runBotStream = useCallback(
    (startStream) => {
      const botId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: botId, role: "assistant", content: "", at: Date.now(), status: "typing" },
      ]);
      setIsStreaming(true);

      streamRef.current = startStream({
        onToken: (text) => {
          patchMessage(botId, (m) => ({ content: m.content + text, status: "streaming" }));
        },
        onDone: (fullText) => {
          patchMessage(botId, (m) => ({ content: fullText || m.content, status: "done", at: Date.now() }));
          streamRef.current = null;
          setIsStreaming(false);
        },
        onError: (reason) => {
          patchMessage(botId, () => ({ status: "error", error: reason, at: Date.now() }));
          streamRef.current = null;
          setIsStreaming(false);
        },
      });
    },
    [patchMessage],
  );

  const stopRecording = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    setListening(false);
  }, []);

  // 언마운트 시 스트림/음성 인식 정리
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      streamRef.current?.abort();
      streamRef.current = null;
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // 새 내용이 생기면 맨 아래로
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 스트리밍 끝나면 입력창 포커스
  useEffect(() => {
    if (!isStreaming && sessionId) inputRef.current?.focus();
  }, [isStreaming, sessionId]);

  // 세션 생성 -> 인사 스트리밍
  // genRef 로 주제 변경 등으로 낡아진 요청 결과는 버린다
  const startSession = useCallback(
    async (picked) => {
      const gen = ++genRef.current;
      try {
        const data = await createChatSession(picked);
        if (!aliveRef.current || gen !== genRef.current) return;
        const id = data?.sessionId;
        if (!id) throw new Error("세션 ID가 없습니다.");

        setSessionId(id);
        setStarting(false);
        runBotStream((handlers) => streamGreeting(id, handlers));
      } catch (e) {
        if (!aliveRef.current || gen !== genRef.current) return;
        console.error("[AiChat] 세션 생성 실패:", e);
        const status = e?.response?.status;
        setStarting(false);
        setStartError(
          status === 401
            ? "로그인이 필요합니다. 다시 로그인해 주세요."
            : "대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }
    },
    [runBotStream],
  );

  // 진입 시 자동 시작 (StrictMode 이중 실행에도 세션은 한 번만 생성)
  // 초기 주제는 useState 초기값에서 정해지고, 여기서는 세션만 만든다
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startSession(topic);
  }, [startSession, topic]);

  // 주제를 바꿔 새 세션 시작
  const restartWithNewTopic = useCallback(() => {
    setShowTopicConfirm(false);
    streamRef.current?.abort();
    streamRef.current = null;
    stopRecording();

    const next = pickTopic(topic);
    setMessages([]);
    setInput("");
    setIsStreaming(false);
    setSessionId(null);
    setStartError("");
    setStarting(true);
    setTopic(next);
    startSession(next);
  }, [topic, stopRecording, startSession]);

  const handleChangeTopic = useCallback(() => {
    if (messages.some((m) => m.role === "user")) setShowTopicConfirm(true);
    else restartWithNewTopic();
  }, [messages, restartWithNewTopic]);

  const handleRetryStart = useCallback(() => {
    setStartError("");
    setStarting(true);
    startSession(topic);
  }, [startSession, topic]);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    resizeInput();
  }, [input]);

  const canSend = Boolean(sessionId) && !isStreaming && input.trim().length > 0;

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !sessionId || isStreaming) return;

    if (listening) stopRecording();
    setShadowingNotice("");

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: text, at: Date.now(), status: "done" },
    ]);
    setInput("");
    runBotStream((handlers) => streamMessage(sessionId, text, handlers));
  }, [input, sessionId, isStreaming, listening, stopRecording, runBotStream]);

  const handleKeyDown = (e) => {
    // 한글 조합 중 Enter 는 무시
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = useCallback(() => {
    if (!SpeechRecognitionApi || recognitionRef.current) return;

    try {
      const recognition = new SpeechRecognitionApi();
      recognition.lang = "ko-KR";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal) continue;
          const transcript = event.results[i][0].transcript.trim();
          if (!transcript) continue;
          setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${transcript}` : transcript));
        }
      };

      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          alert("마이크 권한을 허용해주세요.\n\n브라우저 설정 > 개인정보 보호 > 마이크에서 권한을 허용하세요.");
        } else {
          console.error("[STT] 에러:", event.error);
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch (e) {
      console.error("[STT] 시작 오류:", e);
      recognitionRef.current = null;
      setListening(false);
    }
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) stopRecording();
    else startRecording();
  }, [listening, startRecording, stopRecording]);

  // 스트리밍 시작되면 녹음 중지
  useEffect(() => {
    if (isStreaming && recognitionRef.current) stopRecording();
  }, [isStreaming, stopRecording]);

  const userSentences = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.content),
    [messages],
  );

  const EMPTY_NOTICE = "먼저 한 마디 이상 나눠주세요";

  const handleGoShadowing = useCallback(async () => {
    if (!sessionId || generating) return;
    stopRecording();
    setShadowingNotice("");

    if (userSentences.length === 0) {
      setShadowingNotice(EMPTY_NOTICE);
      return;
    }

    setGenerating(true);
    try {
      const data = await generateShadowing(sessionId);
      if (!aliveRef.current) return;
      const scripts = Array.isArray(data?.scripts) ? data.scripts : [];
      if (scripts.length === 0) {
        setShadowingNotice(EMPTY_NOTICE);
        setGenerating(false);
        return;
      }
      navigate("/recording", {
        replace: true,
        state: { mode: "ai", sessionId, topic, scripts },
      });
    } catch (e) {
      if (!aliveRef.current) return;
      console.error("[AiChat] 쉐도잉 문장 생성 실패:", e);
      const reason = e?.response?.data?.message;
      setShadowingNotice(reason ? `문장을 만들지 못했어요: ${reason}` : "문장을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
      setGenerating(false);
    }
  }, [sessionId, generating, stopRecording, userSentences.length, navigate, topic]);

  const composerDisabled = !sessionId || isStreaming;

  const micTitle = !sttSupported
    ? "이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)"
    : listening
      ? "음성 입력 중지"
      : "음성으로 입력하기";

  return (
    <div className={styles.Page}>
      <div className={styles.Shell}>
        <ExitGuard to="/" message="메인 화면으로 나가시겠습니까?" />
        <AppHeader userName="user" notifications={[]} />

        <div className={styles.Content}>
          <button
            className={styles.BackButton}
            type="button"
            onClick={handleBack}
            aria-label="뒤로 가기"
          >
            &lt;
          </button>

          <div className={styles.HeaderRow}>
            <div className={styles.ExitCol}>
              <ExitButton to="/" label="나가기" confirmMessage="연습을 종료하고 나가시겠습니까?" />
            </div>
          </div>

          <section className={styles.ChatPanel} aria-label="AI 수덕과 대화">
            <div className={styles.ChatTopBar}>
              <div className={styles.TopBarAvatar}>
                <img src={duckBotCyanImg} alt="AI 수덕" />
              </div>
              <div className={styles.TopBarText}>
                <div className={styles.TopBarName}>
                  AI 수덕
                  <span className={`${styles.StatusDot} ${isStreaming ? styles.StatusDotBusy : ""}`} aria-hidden="true" />
                </div>
                <div className={styles.TopBarTopic}>
                  대화 주제 <span className={styles.TopicHighlight}>{topic}</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.TopicChangeButton}
                onClick={handleChangeTopic}
                disabled={starting}
              >
                주제 바꾸기
              </button>
            </div>

            {import.meta.env.DEV && <DevBackendToggle disabled={isStreaming} />}

            <div className={styles.MessageList} ref={listRef} aria-live="polite">
              {messages.length === 0 && starting && (
                <div className={styles.EmptyHint}>대화를 준비하고 있어요...</div>
              )}

              {startError && (
                <div className={styles.StartError}>
                  <span>{startError}</span>
                  <button type="button" className={styles.SecondaryButton} onClick={handleRetryStart}>
                    다시 시도
                  </button>
                </div>
              )}

              {messages.map((m, idx) => {
                const prev = messages[idx - 1];
                const next = messages[idx + 1];
                const isBot = m.role === "assistant";
                const groupStart = !prev || prev.role !== m.role;
                const showTime =
                  m.status !== "typing" &&
                  (!next || next.role !== m.role || formatTime(next.at) !== formatTime(m.at));

                if (isBot) {
                  return (
                    <div
                      key={m.id}
                      className={`${styles.Row} ${styles.RowBot} ${groupStart ? styles.RowGroupStart : ""}`}
                    >
                      <div className={styles.AvatarSlot}>
                        {groupStart && (
                          <div className={styles.BotAvatar}>
                            <img src={duckBotCyanImg} alt="" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <div className={styles.BotCol}>
                        {groupStart && <div className={styles.SenderName}>AI 수덕</div>}
                        <div className={styles.BubbleLine}>
                          <div
                            className={`${styles.Bubble} ${styles.BubbleBot} ${
                              groupStart ? styles.BubbleBotTail : ""
                            }`}
                          >
                            {m.status === "typing" && <TypingDots />}
                            {m.content.trim() && <span className={styles.BubbleText}>{m.content.trimStart()}</span>}
                            {m.status === "error" && (
                              <span className={styles.BubbleError}>
                                {m.error || "응답을 받지 못했어요."}
                              </span>
                            )}
                          </div>
                          {showTime && <span className={styles.Time}>{formatTime(m.at)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`${styles.Row} ${styles.RowUser} ${groupStart ? styles.RowGroupStart : ""}`}
                  >
                    <div className={styles.BubbleLine}>
                      {showTime && <span className={styles.Time}>{formatTime(m.at)}</span>}
                      <div
                        className={`${styles.Bubble} ${styles.BubbleUser} ${
                          groupStart ? styles.BubbleUserTail : ""
                        }`}
                      >
                        <span className={styles.BubbleText}>{m.content}</span>
                      </div>
                    </div>
                    <div className={styles.AvatarSlot}>
                      {groupStart && (
                        <div className={styles.UserAvatar}>
                          <img src={duckImg} alt="" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.Composer}>
              <span className={styles.MicWrap} title={micTitle}>
                <button
                  type="button"
                  className={`${styles.MicButton} ${listening ? styles.MicButtonOn : ""}`}
                  onClick={toggleMic}
                  disabled={!sttSupported || composerDisabled}
                  aria-label={micTitle}
                  aria-pressed={listening}
                >
                  <img src={sttSupported ? micOffIcon : micOnIcon} alt="" aria-hidden="true" />
                </button>
              </span>

              <textarea
                ref={inputRef}
                className={styles.Input}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isStreaming
                    ? "수덕이가 답장 중이에요..."
                    : listening
                      ? "듣고 있어요... 말해 보세요"
                      : "한국어로 메시지를 입력하세요"
                }
                disabled={composerDisabled}
                aria-label="메시지 입력"
              />

              <button
                type="button"
                className={styles.SendButton}
                onClick={handleSend}
                disabled={!canSend}
                aria-label="보내기"
              >
                전송
              </button>
            </div>
          </section>

          <div className={styles.BottomActions}>
            <button
              type="button"
              className={styles.PrimaryButton}
              onClick={handleGoShadowing}
              disabled={!sessionId || isStreaming || generating}
            >
              쉐도잉 넘어가기
            </button>
          </div>
          {shadowingNotice && (
            <div className={styles.ShadowingNotice} role="status">
              {shadowingNotice}
            </div>
          )}
        </div>
      </div>

      {generating && (
        <LoadingOverlay
          title="문장 만드는 중..."
          subtitle="방금 나눈 대화로 쉐도잉 문장을 만들고 있어요"
          image={duckBotCyanImg}
        />
      )}

      <ConfirmModal
        open={showTopicConfirm}
        message="지금까지의 대화를 지우고 새 주제로 시작할까요?"
        confirmText="바꾸기"
        cancelText="취소"
        onConfirm={restartWithNewTopic}
        onClose={() => setShowTopicConfirm(false)}
      />

      <ConfirmModal
        open={showBackConfirm}
        message="연습을 종료하고 나가시겠습니까?"
        confirmText="나가기"
        cancelText="취소"
        onConfirm={handleBackConfirm}
        onClose={handleBackCancel}
      />
    </div>
  );
}
