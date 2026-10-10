import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/api/api";
import { useOpenVidu } from "@/context/OpenViduContext"; // 👈 OpenVidu Hook 추가
import Recordinglayout from "@/components/features/recording/layout/RecordingLayout";
import styles from "./RecordingPage.module.css";
import {
  saveAssessment,
  toggleScriptLike,
  getTurnScripts,
  getTurnResults,
} from "@/api/shadowing";
import { leaveRoom, getRoomLobby, toggleReady, startRoom } from "@/api/rooms";
import useRoomWebSocket from "@/hooks/useRoomWebSocket";
import useMicAnalyzer from "@/hooks/useMicAnalyzer"; // 👈 추가
import LoadingOverlay from "@/components/common/LoadingOverlay/LoadingOverlay";
import duckTogether from "@/assets/images/duck_together.png";

// Profile Images
import duckProfile1 from "@/assets/images/duck_profile1.png";
import duckProfile2 from "@/assets/images/duck_profile2.png";
import duckProfile3 from "@/assets/images/duck_profile3.png";
import duckProfile4 from "@/assets/images/duck_profile4.png";

const DUCK_PROFILE_IMAGES = {
  profile1: duckProfile1,
  profile2: duckProfile2,
  profile3: duckProfile3,
  profile4: duckProfile4,
};

const COLOR_MAP = {
  white: "#ffffff",
  yellow: "#fef08a",
  blue: "#93c5fd",
  pink: "#f9a8d4",
  green: "#86efac",
  purple: "#c4b5fd",
  orange: "#fdba74",
};

const ACCESSORY_MAP = {
  hat: "🎩",
  sunglasses: "🕶️",
  ribbon: "🎀",
  crown: "👑",
  none: null,
};

function safeParseJson(str) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch {
    return null;
  }
}

function getDuckProfileDetail(duckCustomJson) {
  const parsed = safeParseJson(duckCustomJson);
  if (!parsed) {
    return {
      image: duckProfile1,
      color: "#ffffff",
      accessory: null,
    };
  }

  const style = parsed.style || "profile1";
  const color = parsed.color || "white";
  const accessory = parsed.accessory || "none";

  return {
    image: DUCK_PROFILE_IMAGES[style] || duckProfile1,
    color: COLOR_MAP[color] || "#ffffff",
    accessory: ACCESSORY_MAP[accessory] || null,
  };
}

// Components
import BottomIdle from "@/components/features/recording/bottom/BottomIdle";
import BottomAITimer from "@/components/features/recording/bottom/BottomAITimer";
import BottomAIPlaying from "@/components/features/recording/bottom/BottomAIPlaying";
import BottomRecordTimer from "@/components/features/recording/bottom/BottomRecordTimer";
import BottomRecording from "@/components/features/recording/bottom/BottomRecording";
import BottomRecordDone from "@/components/features/recording/bottom/BottomRecordDone";
import BottomAllDone from "@/components/features/recording/bottom/BottomAllDone";

// Libraries
import RecordRTC, { StereoAudioRecorder } from "recordrtc";

// 설정 상수
const AI_PLAYING_MS = 2500;

const STEP = {
  IDLE: "idle",
  AI_TIMER: "ai_timer",
  AI_PLAYING: "ai_playing",
  RECORD_TIMER: "record_timer",
  RECORDING: "recording",
  RECORD_DONE: "record_done",
  TURN_REPORT: "turn_report",
  ALL_DONE: "all_done",
};

// 더미 데이터
const DUMMY_CONVERSATIONS = {
  1: [
    {
      id: 1,
      scriptId: "dummy_1",
      speaker: "장가은",
      korean: "나는 카페에서 아르바이트를 했는데, 정말 힘들었어요.",
      english: "I worked at a coffee shop, and it was really tough.",
      blankWords: ["worked", "really"],
      score: null,
      tts_url: null,
    },
  ],
  2: [],
  3: [],
};

// AI 싱글 모드 스크립트 -> 화면용 문장 포맷 (멀티 모드와 같은 형태, 대화 순서 유지)
const REGEX_UNSAFE = /[()[\]{}*+?\\|^$]/;
function formatAiScripts(scripts) {
  return scripts.map((s, i) => ({
    id: i + 1,
    scriptId: `ai-${i}`,
    // role: "user" | "assistant" (없으면 사용자로 간주)
    speaker: s.role === "assistant" ? "수덕" : "나",
    role: s.role === "assistant" ? "assistant" : "user",
    korean: s.korean || "",
    english: s.en || s.english || "",
    blankWords: s.blank_script
      ? (s.blank_script.match(/\[([^\]]+)\]/g) || [])
          .map((w) => w.slice(1, -1))
          .filter((w) => w && !REGEX_UNSAFE.test(w))
      : [],
    similarPhrases: Array.isArray(s.similarity_phrases) ? s.similarity_phrases : [],
    score: null,
    tts_url: null,
  }));
}

const AZURE_NOTICE = {
  tts: "TTS는 Azure 키 설정 후 사용 가능",
  assessment: "발음 평가는 Azure 키 설정 후 사용 가능",
};

export default function RecordingPage() {
  const { state } = useLocation();
  const navigate = useNavigate();
  // 👇 OpenVidu Publisher, Subscribers, leaveSession 가져오기
  const { publisher, subscribers, leaveSession } = useOpenVidu(); 

  const roomInfo = state?.roomInfo || {};

  // AI 싱글 모드: 채팅 페이지에서 받은 스크립트만 사용 (방/턴 조회, 웹소켓 없음)
  const isAiMode =
    state?.mode === "ai" && Array.isArray(state?.scripts) && state.scripts.length > 0;
  const myUserId = state?.myUserId; // 본인 userId
  const [participants, setParticipants] = useState(state?.participants || []); // 참여자 목록

  useEffect(() => {
    console.log("[RecordingPage] 페이지 로드 - 전체 state:", state);
  }, []); // 마운트 시 1회만 실행

  const TURNS = isAiMode ? 1 : roomInfo.turnCount || 3;

  const [step, setStep] = useState(STEP.AI_TIMER);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // 👈 제출 중 상태 추가
  const [isReady, setIsReady] = useState(false); // 👈 내 준비 상태 추가
  // state로 전달받은 currentTurn 사용
  const [currentTurn, setCurrentTurn] = useState(() => {
    return roomInfo.currentTurn ?? roomInfo.roomInfo?.currentTurn ?? 1;
  });

  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingCountdown, setRecordingCountdown] = useState(10); // 녹음 카운트다운 (10초)
  const [sentenceScores, setSentenceScores] = useState({});
  const [bookmarkedSentences, setBookmarkedSentences] = useState([]);
  const [conversations, setConversations] = useState(() =>
    isAiMode ? { 1: formatAiScripts(state.scripts) } : {},
  );
  const [selectedTurnForReport, setSelectedTurnForReport] = useState(null);
  const [scriptError, setScriptError] = useState(null);
  const [isLoadingScript, setIsLoadingScript] = useState(false);
  const [turnResults, setTurnResults] = useState({});
  const [showBlanks, setShowBlanks] = useState(true); // 👈 빈칸 모드 상태 추가
  const [toastMessage, setToastMessage] = useState(""); // 👈 토스트 메시지 상태 추가
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(true); // 👈 상대방 소리 음소거 상태 추가

  const timerRef = useRef(null);
  const intervalRef = useRef(null);
  // MediaRecorder 대신 RecordRTC 사용을 위한 ref
  const recorderRef = useRef(null);
  const audioRef = useRef(null);
  const prevIsConversationStepRef = useRef(null); // 👈 이전 마이크 상태 저장용 Ref
  const hasNavigatedRef = useRef(false); // 👈 중복 이동 방지용 Ref

  // --- 🪄 [추가] 패널 드래그 및 최소화 상태 ---
  const [panelPos, setPanelPos] = useState({ top: 130, right: 40 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    // 버튼 클릭 시에는 드래그 방지
    if (e.target.closest('button')) return;
    
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      const newLeft = e.clientX - dragOffset.current.x;
      const newTop = e.clientY - dragOffset.current.y;
      
      // 오른쪽 기준 좌표로 변환 (화면 크기 변화 대응)
      const panelWidth = 280; 
      const newRight = window.innerWidth - (newLeft + panelWidth);
      
      setPanelPos({ 
        top: Math.max(10, Math.min(window.innerHeight - 50, newTop)), 
        right: Math.max(10, Math.min(window.innerWidth - 50, newRight)) 
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 2500);
  }, []);

  // Azure 미설정 안내는 종류별로 한 번만
  const azureNoticeShownRef = useRef({});
  const showAzureNoticeOnce = useCallback(
    (key) => {
      if (azureNoticeShownRef.current[key]) return;
      azureNoticeShownRef.current[key] = true;
      showToast(AZURE_NOTICE[key]);
    },
    [showToast],
  );

  // roomId 추출
  const roomId = useMemo(() => {
    const fromState =
      roomInfo.roomId ||
      roomInfo.id ||
      roomInfo.roomCode ||
      roomInfo.inviteCode ||
      roomInfo.joinCode;

    if (fromState) return fromState;
    try {
      const testRoomInfo = sessionStorage.getItem("testRoomInfo");
      if (testRoomInfo) return JSON.parse(testRoomInfo).id;
    } catch (e) {
      /* ignore */
    }
    return null;
  }, [roomInfo]);

  // roomCode 추출
  const roomCode = useMemo(() => {
    return (
      roomInfo.roomCode ||
      roomInfo.inviteCode ||
      roomInfo.joinCode ||
      roomInfo.code ||
      ""
    );
  }, [roomInfo]);

  // [추가] 내가 방장인지 여부를 participants 리스트를 통해 더 확실하게 판별
  const amIHost = useMemo(() => {
    const me = participants.find((p) => String(p.id || p.userId) === String(myUserId));
    if (me) return me.isHost === true;
    return roomInfo.isHost === true; // 리스트에서 못 찾을 경우 fallback
  }, [participants, myUserId, roomInfo.isHost]);

  // 모든 참여자(방장 제외)가 준비되었는지 확인
  const allReady = useMemo(() => {
    const nonHostParticipants = participants.filter((p) => !p.isHost);
    if (nonHostParticipants.length === 0) return true;
    return nonHostParticipants.every((p) => p.isReady);
  }, [participants]);

  // 초기 로비 정보 가져오기 (준비 상태 동기화)
  const fetchLobby = useCallback(async () => {
    if (!roomCode) return;
    try {
      const data = await getRoomLobby(roomCode);
      const members = data.participants || [];
      
      setParticipants((prev) => {
        // 기존 참여자들의 마이크/발화 상태를 기억하기 위한 맵
        const prevMap = new Map(prev.map(p => [String(p.id || p.userId), p]));
        
        return members.map((m) => {
          const id = String(m.userId);
          const prevInfo = prevMap.get(id);
          
          return {
            id: id,
            userId: m.userId,
            name: m.nickname,
            isMe: id === String(myUserId),
            isReady: m.readyStatus === "READY",
            isHost: m.isHost,
            duckCustomJson: m.duckCustomJson,
            // 👈 중요: 기존에 이미 완료(micOn: true)했다면 그 상태를 유지함
            micOn: prevInfo ? (prevInfo.micOn || (m.micOn ?? false)) : false,
            voiceLevel: prevInfo?.voiceLevel || 0,
            isSpeaking: prevInfo?.isSpeaking || false,
          };
        });
      });
      
      const me = members.find(m => String(m.userId) === String(myUserId));
      if (me) setIsReady(me.readyStatus === "READY");
    } catch (e) {
      console.error("[RecordingPage] 로비 정보 조회 실패:", e);
    }
  }, [roomCode, myUserId]);

  const handleRoomClosed = useCallback(() => {
    console.log("[RecordingPage] ROOM_CLOSED 수신 - 방장 퇴장");
    // 👇 강제 퇴장 시에도 세션 종료
    if (leaveSession) leaveSession();
    
    navigate("/main", {
      replace: true,
      state: { toastMessage: "방장이 퇴장하여 대화가 종료되었습니다." },
    });
  }, [navigate, leaveSession]);

  const handleMiniGameStart = useCallback(() => {
    console.log('🎮 모든 참여자 미니게임으로 이동 시작');
    navigate("/minigame1", { 
      state: { 
        ...state, // 기존 state(openviduSessionId 포함) 유지
        roomId: roomId,
        roomCode: roomCode,
        isHost: amIHost, 
        participantsCount: participants.length,
        timeLimit: roomInfo.timeLimit || 40
      } 
    });
  }, [navigate, state, roomId, roomCode, amIHost, participants.length, roomInfo.timeLimit]);

  const { sendReady, sendMiniGameStart, sendVoiceLevel, sendMic, isConnected } = useRoomWebSocket(
    roomCode,
    {
      onRoomClosed: handleRoomClosed,
      onMiniGameStart: handleMiniGameStart,
      onVoiceLevelChanged: (payload, senderKey) => {
        if (!senderKey) return;
        const k = String(senderKey);
        setParticipants((prev) =>
          prev.map((p) => {
            if (p.id === k) {
              const level = payload?.level ?? 0;
              const isSpeaking = p.micOn && level > 0.03;
              return { ...p, voiceLevel: level, isSpeaking };
            }
            return p;
          })
        );
      },
      onMicChanged: (payload, senderKey) => {
        if (!senderKey) return;
        const k = String(senderKey);
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === k ? { ...p, micOn: payload?.micOn ?? true, isSpeaking: (payload?.micOn ?? true) ? p.isSpeaking : false } : p
          )
        );
      },
      onReadyChanged: (payload, senderKey) => {
        if (senderKey) {
          let newReady = false;
          if (payload?.myReadyStatus === "READY" || payload?.readyStatus === "READY") {
            newReady = true;
          } else if (payload?.myReadyStatus === "NOT_READY" || payload?.readyStatus === "NOT_READY") {
            newReady = false;
          } else if (payload?.ready !== undefined) {
            newReady = payload.ready === true;
          } else if (payload?.isReady !== undefined) {
            newReady = payload.isReady === true;
          }

          setParticipants((prev) =>
            prev.map((p) =>
              String(p.id || p.userId) === String(senderKey)
                ? { ...p, isReady: newReady } // 기존 정보(duckCustomJson 등) 유지하며 상태만 변경
                : p
            )
          );
        }
      },
      onRoomStarted: (payload) => {
        console.log("[RecordingPage] 🎮 ROOM_STARTED 수신 - 단계 이동 시작");
        if (hasNavigatedRef.current) return;

        // 마지막 턴인 경우: 더 이상 TogetherTalkPage로 이동하지 않고 
        // handleStartNextTurn(sendMiniGameStart)에 의해 미니게임으로 이동하게 됨
        if (currentTurn >= TURNS) {
          console.log("[RecordingPage] 마지막 턴 리포트 완료 대기 중...");
          return;
        }

        // 중간 턴인 경우: 모든 참여자가 동시에 다음 대화방으로 이동
        hasNavigatedRef.current = true;
        const nextTurn = currentTurn + 1;
        const navigationState = {
          ...state,
          currentTurn: nextTurn,
          roomInfo: {
            ...roomInfo,
            currentTurn: nextTurn,
          },
          myUserId,
        };

        setIsTransitioning(true);
        setTimeout(() => {
          navigate("/together/talk", {
            replace: true,
            state: navigationState,
          });
        }, 2000);
      },
      onMemberJoined: (payload) => fetchLobby(),
      onMemberLeft: (payload, senderKey) => {
        if (senderKey) {
          setParticipants((prev) => prev.filter((p) => String(p.id || p.userId) !== String(senderKey)));
        }
      },
    },
    roomId
  );

  // 🎤 실시간 음성 분석기
  const { voiceLevel: localVoiceLevel, isSpeaking: localIsSpeaking, start: startMicAnalytic, stop: stopMicAnalytic } = useMicAnalyzer({
    threshold: 0.03,
    holdMs: 220,
  });

  // 🎤 내 목소리 크기를 다른 사람들에게 전송
  useEffect(() => {
    if (!isSpeakerMuted && sendVoiceLevel && localVoiceLevel > 0) {
      sendVoiceLevel(localVoiceLevel);
    }
    
    // 내 화면의 내 아바타에도 표시하기 위해 participants 업데이트
    if (localIsSpeaking !== undefined) {
      setParticipants(prev => prev.map(p => 
        p.isMe ? { ...p, isSpeaking: localIsSpeaking, voiceLevel: localVoiceLevel } : p
      ));
    }
  }, [localVoiceLevel, localIsSpeaking, isSpeakerMuted, sendVoiceLevel]);

  // 🎤 초기 마이크 상태 전송 (접속 즉시 모두 '평가 중'으로 설정)
  useEffect(() => {
    if (isConnected && sendMic) {
      console.log("🎤 [RecordingPage] 초기 마이크 상태 전송 (false)");
      sendMic(false);
    }
  }, [isConnected, sendMic]);

  // 👇 [New] OpenVidu 제어 로직 (쉐도잉 중에는 입과 귀를 모두 닫음)
  useEffect(() => {
    if (!publisher) return;

    // 대화가 허용되는 단계: 결과 리포트 화면 또는 완전히 종료된 화면
    const isConversationStep = (step === STEP.TURN_REPORT || step === STEP.ALL_DONE || step === STEP.IDLE);

    if (isConversationStep) {
      // 결과 화면에서는 팀원들과 대화할 수 있도록 마이크 Unmute & 스피커 Unmute
      console.log(`🎤 [OpenVidu] 결과 확인 단계(${step}) -> 마이크 & 스피커 Unmute`);
      publisher.publishAudio(true);
      setIsSpeakerMuted(false);
      
      // 🎤 내 음성 분석 시작 및 서버에 마이크 켜짐 알림
      startMicAnalytic();
      if (sendMic) sendMic(true);
      
      // 음소거가 풀릴 때만 알림 표시 (쉐도잉 -> 결과 화면 전환 시)
      if (prevIsConversationStepRef.current === false) {
        showToast("팀원들과 대화가 가능합니다. 🎙️");
      }
    } else {
      // 쉐도잉 진행 중에는 집중을 위해 마이크 Mute & 스피커 Mute
      console.log(`🎤 [OpenVidu] 쉐도잉 진행 단계(${step}) -> 마이크 & 스피커 Mute`);
      publisher.publishAudio(false);
      setIsSpeakerMuted(true);

      // 🎤 내 음성 분석 중지 및 서버에 마이크 꺼짐 알림
      stopMicAnalytic();
      if (sendMic) sendMic(false);
    }
    
    prevIsConversationStepRef.current = isConversationStep;
  }, [step, publisher, showToast, startMicAnalytic, stopMicAnalytic, sendMic]);

  useEffect(() => {
    if (step === STEP.TURN_REPORT && currentTurn < TURNS) {
      fetchLobby();
    }
  }, [step, fetchLobby, currentTurn, TURNS]);

  const currentTurnSentences = useMemo(() => {
    const turnToShow = selectedTurnForReport || currentTurn;
    return conversations[turnToShow] || DUMMY_CONVERSATIONS[turnToShow] || [];
  }, [currentTurn, selectedTurnForReport, conversations]);

  const currentSentence = useMemo(() => {
    return currentTurnSentences[currentSentenceIndex];
  }, [currentTurnSentences, currentSentenceIndex]);

  const isLastSentence = useMemo(() => {
    if (currentTurn === TURNS) {
      return currentSentenceIndex === currentTurnSentences.length - 1;
    }
    return false;
  }, [currentTurn, currentSentenceIndex, currentTurnSentences.length, TURNS]);

  // --- 함수들 ---

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  // [수정] RecordRTC로 녹음 시작 (WAV 포맷)
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // RecordRTC 설정: Azure가 좋아하는 완벽한 WAV 포맷으로 설정
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav", // WAV 포맷 강제
        recorderType: StereoAudioRecorder,
        numberOfAudioChannels: 1, // 모노 (Azure 권장)
        desiredSampRate: 16000, // 16kHz (Azure 권장)
      });

      recorder.startRecording();
      recorderRef.current = recorder; // ref에 저장

      console.log("녹음 시작 (WAV 포맷)");
    } catch (error) {
      console.error("녹음 시작 실패:", error);
    }
  }, []);

  const goNextSentence = useCallback(() => {
    if (currentSentenceIndex < currentTurnSentences.length - 1) {
      setCurrentSentenceIndex((idx) => idx + 1);
      setStep(STEP.AI_TIMER);
    } else {
      // AI 모드는 턴이 하나뿐이라 바로 완료 화면으로
      setStep(isAiMode ? STEP.ALL_DONE : STEP.TURN_REPORT);
    }
  }, [currentSentenceIndex, currentTurnSentences.length, isAiMode]);

  // [수정] RecordRTC로 녹음 중지 및 전송
  const stopRecording = useCallback(() => {
    // AI 모드: 녹음만 끝내고 발음 평가 업로드는 생략 (room/turn 기반 API 사용 불가)
    if (isAiMode) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      const finish = () => {
        showAzureNoticeOnce("assessment");
        setStep(STEP.RECORD_DONE);
      };
      if (!recorder) {
        finish();
        return;
      }
      recorder.stopRecording(() => {
        try {
          recorder.getInternalRecorder()?.stream?.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        finish();
      });
      return;
    }

    if (!currentSentence || !currentSentence.scriptId) {
  console.error("❌ 발음 평가 실패: scriptId가 유효하지 않습니다.");
  return;
}
console.log(`📤 발음 평가 전송 시작`, {
  roomId,
  turnNo: currentTurn,
  scriptId: currentSentence.scriptId,
});

    const recorder = recorderRef.current;

    // 레코더가 없으면 함수 종료
    if (!recorder) return;

    // RecordRTC의 stopRecording은 콜백 방식으로 동작합니다.
    recorder.stopRecording(async () => {
      // 1. WAV Blob 생성
      const blob = recorder.getBlob();

      // 2. 마이크 스트림 정지
      try {
        const internalRecorder = recorder.getInternalRecorder();
        if (internalRecorder && internalRecorder.stream) {
          internalRecorder.stream.getTracks().forEach((track) => track.stop());
        }
      } catch (e) {
        console.warn("마이크 스트림 정지 중 경미한 오류:", e);
      }

      // 3. 방어 로직: 현재 문장 정보나 scriptId가 없으면 중단
      if (!currentSentence || !currentSentence.scriptId) {
        console.error(
          "❌ 발음 평가 실패: scriptId가 유효하지 않습니다.",
          currentSentence
        );
        setStep(STEP.RECORD_DONE);
        return;
      }

      // 4. API 전송 및 점수 업데이트
      if (blob && blob.size > 0) {
        try {
          console.log(`📤 발음 평가 전송 시작 (WAV, ${blob.size} bytes)`, {
            roomId,
            turnNo: currentTurn,
            scriptId: currentSentence.scriptId,
          });

          // UI 업데이트: 평가 중 상태(-1)
          setSentenceScores((prev) => ({
            ...prev,
            [currentSentence.id]: -1,
          }));

          setIsSubmitting(true);

          // API 호출 (shadowing.js의 saveAssessment)
          const response = await saveAssessment(
            blob,
            roomId,
            currentTurn,
            currentSentence.scriptId
          );

          // [핵심] 백엔드에서 받은 점수(score)가 있으면 UI에 즉시 반영
          if (response && response.score) {
            const score = parseInt(response.score, 10);
            console.log("💯 발음 점수 수신:", score);

            setSentenceScores((prev) => ({
              ...prev,
              [currentSentence.id]: score, // 실제 점수로 업데이트
            }));
          } else {
            console.warn("⚠️ 응답에 점수가 없습니다.", response);
          }

          setStep(STEP.RECORD_DONE);
        } catch (error) {
          console.error("❌ 평가 저장 실패:", error);
          setSentenceScores((prev) => ({
            ...prev,
            [currentSentence.id]: -2,
          }));
          setStep(STEP.RECORD_DONE);
        } finally {
          setIsSubmitting(false);
        }
      } else {
        console.warn("⚠️ 녹음된 데이터가 없습니다 (Blob size 0)");
        setStep(STEP.RECORD_DONE);
      }
    });
  }, [currentSentence, roomId, currentTurn, isAiMode, showAzureNoticeOnce]);

  const goNextTurn = () => {
    if (currentTurn >= TURNS) {
      console.log("[RecordingPage] 마지막 턴 완료 - ALL_DONE으로 전환");
      setStep(STEP.ALL_DONE);
      return;
    }
    // 중간 턴 이동은 handleStartNextTurn -> onRoomStarted를 통해 다함께 진행됩니다.
    console.log("[RecordingPage] 다음 턴 대기 중 (방장 시작 대기)");
  };

  const startFlow = () => setStep(STEP.AI_TIMER);

  const restart = () => {
    clearAllTimers();
    setCurrentTurn(1);
    setCurrentSentenceIndex(0);
    setStep(STEP.IDLE);
    setSentenceScores({});
    setSelectedTurnForReport(null);
  };

  // [수정] 북마크 토글: scriptId 기준으로 동작하도록 수정
  const handleBookmarkToggle = useCallback(
    async (id, isBookmarked) => {
      if (isAiMode) {
        showToast("AI 모드 문장 저장은 아직 지원되지 않아요");
        return;
      }
      try {
        // id는 UI에서 넘어온 값 (보통 sentence.id = order_no일 가능성 높음)
        // currentTurnSentences에서 해당 문장의 진짜 scriptId 찾기
        const sentence = currentTurnSentences.find((s) => s.id === id);
        const realScriptId = sentence?.scriptId;

        if (!realScriptId) {
          console.error("스크립트 ID를 찾을 수 없습니다.");
          return;
        }

        const targetTurn = selectedTurnForReport || currentTurn;

        console.log("[RecordingPage] 북마크 토글:", {
          id,
          realScriptId,
          roomId,
          isBookmarked,
          turnNo: targetTurn,
        });

        // API 호출 - 응답에서 isLiked 상태를 받아옴
        const response = await toggleScriptLike(
          realScriptId,
          roomId,
          targetTurn
        );

        console.log("[RecordingPage] 북마크 API 응답:", response);

        // scriptId는 고유하므로 scriptId를 북마크 키로 사용
        const bookmarkKey = realScriptId;

        // API 응답의 isLiked 값을 기준으로 로컬 상태 업데이트
        setBookmarkedSentences((prev) => {
          const next = response.isLiked
            ? [...new Set([...prev, bookmarkKey])]  // API가 저장됨(true)을 반환하면 추가
            : prev.filter((key) => key !== bookmarkKey);  // API가 삭제됨(false)을 반환하면 제거
          localStorage.setItem("bookmarkedSentences", JSON.stringify(next));
          return next;
        });
      } catch (error) {
        console.error("북마크 실패:", error);
        alert("북마크 저장에 실패했습니다.");
      }
    },
    [currentTurnSentences, roomId, selectedTurnForReport, currentTurn, isAiMode, showToast]
  );

  const handleReady = useCallback(async () => {
    console.log("[RecordingPage] 🔘 handleReady 호출:", {
      isConnected,
      isReady,
      roomCode,
      myUserId,
      hasToken: !!localStorage.getItem("accessToken")
    });

    if (!isConnected) {
      showToast("서버와 연결되지 않았습니다.");
      return;
    }
    const nextReady = !isReady;
    try {
      console.log("[RecordingPage] 📡 toggleReady API 호출 시작:", { roomCode, nextReady });
      await toggleReady(roomCode, nextReady);
      console.log("[RecordingPage] ✅ toggleReady API 호출 성공");

      setIsReady(nextReady);
      if (sendReady) sendReady(nextReady);
      setParticipants((prev) =>
        prev.map((p) => (String(p.id || p.userId) === String(myUserId) ? { ...p, isReady: nextReady } : p))
      );
    } catch (e) {
      console.error("[RecordingPage] ❌ toggleReady API 호출 실패:", e);
      console.error("[RecordingPage] 에러 상세:", {
        status: e.response?.status,
        statusText: e.response?.statusText,
        data: e.response?.data,
        headers: e.response?.headers
      });
      showToast("준비 상태 변경에 실패했습니다.");
    }
  }, [isConnected, isReady, roomCode, sendReady, myUserId, showToast]);

  const handleStartNextTurn = useCallback(async () => {
    if (!amIHost) return;
    if (!allReady && participants.length > 1) {
      showToast("모든 참여자가 준비되어야 합니다.");
      return;
    }

    const isLastTurn = currentTurn >= TURNS;

    try {
      if (isLastTurn) {
        console.log("🎮 [방장] 마지막 턴 완료 - 미니게임 시작 신호 전송");
        if (sendMiniGameStart) {
          sendMiniGameStart();
        } else {
          console.error("❌ sendMiniGameStart 함수가 없습니다.");
        }
      } else {
        console.log("↻ [방장] 다음 턴 시작 API 호출");
        await startRoom(roomCode);
      }
    } catch (e) {
      showToast(isLastTurn ? "미니게임 시작에 실패했습니다." : "다음 턴 시작에 실패했습니다.");
    }
  }, [allReady, roomCode, showToast, participants.length, amIHost, currentTurn, TURNS, sendMiniGameStart]);

  const handleLogoExit = useCallback(async () => {
    // 👇 진짜 방을 나갈 때는 세션 종료
    if (leaveSession) leaveSession();

    if (roomCode) {
      try {
        await leaveRoom({ roomCode });
        console.log("[RecordingPage] 방 퇴장 성공");
      } catch (e) {
        console.error("[RecordingPage] 방 퇴장 실패:", e);
      }
    }
  }, [roomCode, leaveSession]);

  const fetchTurnResults = useCallback(
    async (turnNo = currentTurn) => {
      if (!roomId || !turnNo) {
        console.warn(
          "[RecordingPage] roomId 또는 turnNo가 없어 점수 조회 불가",
        );
        return;
      }

      try {
        console.log(`🔍 [RecordingPage] 턴 ${turnNo} 점수 조회 시작`);
        const results = await getTurnResults(roomId, turnNo);

        console.log("📊 [RecordingPage] 점수 조회 결과:", results);

        if (!Array.isArray(results) || results.length === 0) {
          console.warn("⚠️ [RecordingPage] 점수 데이터가 비어있음");
          return;
        }

        setTurnResults((prev) => ({
          ...prev,
          [turnNo]: results,
        }));

        const targetConversations =
          conversations[turnNo] || currentTurnSentences;
        const scores = {};

        results.forEach((result) => {
          const sentence = targetConversations.find(
            (s) => s.scriptId === result.scriptId,
          );
          if (sentence) {
            scores[sentence.id] = result.score;
          }
        });

        console.log("✅ [RecordingPage] 점수 업데이트:", scores);
        setSentenceScores((prev) => ({ ...prev, ...scores }));
      } catch (error) {
        console.error("❌ [RecordingPage] 점수 조회 실패:", error);
      }
    },
    [roomId, currentTurn, conversations, currentTurnSentences],
  );

  // --- Effect 로직 ---

  useEffect(() => {
    const saved = localStorage.getItem("bookmarkedSentences");
    if (saved) setBookmarkedSentences(JSON.parse(saved));
  }, []);

  // 턴 스크립트 로드
  useEffect(() => {
    const fetchTurnScripts = async () => {
      if (isAiMode) return;
      if (conversations[currentTurn]) {
        console.log(
          `[RecordingPage] turn ${currentTurn} 스크립트 이미 로드됨`
        );
        return;
      }

      setIsLoadingScript(true);
      setScriptError(null);

      if (!roomId) {
        console.warn(`[RecordingPage] roomId 없음 - 더미 데이터 사용`);
        setConversations((prev) => ({
          ...prev,
          [currentTurn]: DUMMY_CONVERSATIONS[currentTurn] || [],
        }));
        setIsLoadingScript(false);
        return;
      }

      try {
        console.log(`[RecordingPage] turn ${currentTurn} 스크립트 로드 시작`);
        const response = await getTurnScripts(roomId, currentTurn);
        console.log(`[RecordingPage] 응답:`, response);

        const scripts = Array.isArray(response) ? response : [response];

        if (
          scripts.length === 0 ||
          (scripts.length === 1 && !scripts[0]?.scriptId)
        ) {
          const errorMsg = `턴 ${currentTurn}에 대화 내용이 없습니다.`;
          console.log(`[RecordingPage] ${errorMsg}`);
          setScriptError(errorMsg);
          setConversations((prev) => ({ ...prev, [currentTurn]: [] }));
          setIsLoadingScript(false);
          return;
        }

        const formatted = scripts
          .filter((s) => s && s.scriptId)
          .sort((a, b) => (a.order_no || 0) - (b.order_no || 0))
          .map((s, i) => {
            let speakerName =
              s.speakerName ||
              s.speaker ||
              s.userName ||
              s.nickname ||
              s.name ||
              null;

            if (
              !speakerName &&
              participants &&
              participants.length > 0
            ) {
              const firstParticipant = participants[0];
              speakerName =
                firstParticipant?.name ||
                firstParticipant?.nickname ||
                "참여자";
            }

            if (!speakerName || speakerName === "Unknown") {
              speakerName = "참여자";
            }

            let isMe = false;
            if (participants && participants.length > 0) {
              const myParticipant = participants.find(
                (p) => p.isMe === true
              );
              if (myParticipant) {
                isMe =
                  participants.length === 1 && myParticipant.isMe;
              }
            }

            const displayName = isMe
              ? `${speakerName}(나)`
              : speakerName;

            return {
              id: s.order_no ?? i + 1,
              scriptId: s.scriptId,
              speaker: displayName,
              korean: s.korean || "",
              english: s.english || "",
              blankWords: s.blank_script
                ? s.blank_script
                    .match(/\[([^\]]+)\]/g)
                    ?.map((w) => w.slice(1, -1)) || []
                : [],
              score: null,
              tts_url: s.tts_url || null,
            };
          });

        console.log(
          `[RecordingPage] 포맷팅 완료 (${formatted.length}개):`,
          formatted
        );
        setConversations((prev) => ({
          ...prev,
          [currentTurn]: formatted,
        }));
        setIsLoadingScript(false);
      } catch (e) {
        console.error(`[RecordingPage] 로드 실패:`, e);
        const errorMsg = `오류 발생: ${e.message || "네트워크 오류"}`;
        setScriptError(errorMsg);
        setConversations((prev) => ({ ...prev, [currentTurn]: [] }));
        setIsLoadingScript(false);
      }
    };
    fetchTurnScripts();
  }, [currentTurn, roomId, conversations, participants, isAiMode]);

  // 메인 타이머 및 자동 흐름 제어
  useEffect(() => {
    clearAllTimers();

    if (step === STEP.AI_TIMER) {
      if (conversations[currentTurn] === undefined) return;
      if (conversations[currentTurn].length === 0) return;

      // ★ 스크립트가 아직 로드되지 않은 경우 대기
      if (conversations[currentTurn] === undefined) {
        console.log(
          `⏳ [RecordingPage] turn ${currentTurn} 스크립트 로드 대기 중...`,
        );
        return;
      }

      // ★ 해당 턴의 스크립트가 빈 배열인 경우 (스크립트 없음)
      if (conversations[currentTurn].length === 0) {
        console.log(
          `⚠️ [RecordingPage] turn ${currentTurn} 스크립트가 없음 - 동기화 단계로 이동`,
        );
        setTimeout(() => {
          setStep(STEP.TURN_REPORT);
        }, 1000); 
        return;
      }

      // 정상: 3초 카운트다운 시작
      console.log("✅ [STEP] AI_TIMER 카운트다운 시작 (3초)");
      setCountdown(3);
      intervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearAllTimers();
            setStep(STEP.AI_PLAYING);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } else if (step === STEP.RECORD_TIMER) {
      setCountdown(3);
      intervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearAllTimers();
            setStep(STEP.RECORDING);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } else if (step === STEP.AI_PLAYING) {
      if (currentSentence?.tts_url) {
        // TTS URL 보정 (프록시용)
        let ttsUrl = currentSentence.tts_url;
        if (ttsUrl && ttsUrl.startsWith("/audio")) {
          ttsUrl = ttsUrl.replace("/audio", "/api/v1/audio");
        }

        const accessToken = localStorage.getItem("accessToken");

        api
          .get(ttsUrl, {
            headers: accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {},
            responseType: "blob",
          })
          .then((response) => {
            const blob = response.data;
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            audioRef.current = audio;

            audio.onended = () => {
              URL.revokeObjectURL(blobUrl);
              setStep(STEP.RECORD_TIMER);
            };

            audio.onerror = () => {
              URL.revokeObjectURL(blobUrl);
              setStep(STEP.RECORD_TIMER);
            };

            audio.play().catch(() => {
              URL.revokeObjectURL(blobUrl);
              setStep(STEP.RECORD_TIMER);
            });
          })
          .catch(() => {
            setStep(STEP.RECORD_TIMER);
          });
      } else {
        if (isAiMode) showAzureNoticeOnce("tts");
        timerRef.current = setTimeout(
          () => setStep(STEP.RECORD_TIMER),
          AI_PLAYING_MS
        );
      }
    } else if (step === STEP.RECORDING) {
      setRecordingTime(0);
      
      // 문장 길이에 따른 동적 시간 계산 (단어 수 기준)
      const words = currentSentence?.english?.split(' ')?.length || 0;
      const dynamicDuration = Math.max(8, Math.min(30, Math.ceil(words * 1.5) + 5));
      
      console.log(`🎙️ [RecordingPage] 문장 길이(${words}단어)에 따른 제한시간 설정: ${dynamicDuration}초`);
      setRecordingCountdown(dynamicDuration);
      startRecording();

      intervalRef.current = setInterval(() => {
        setRecordingTime((p) => p + 1);
        setRecordingCountdown((c) => {
          if (c <= 1) {
            clearAllTimers();
            stopRecording();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } else if (step === STEP.RECORD_DONE) {
      timerRef.current = setTimeout(() => goNextSentence(), 1500);
    }

    return () => clearAllTimers();
  }, [
    step,
    currentTurn,
    currentSentence,
    conversations,
    clearAllTimers,
    startRecording,
    stopRecording,
    goNextSentence,
    isAiMode,
    showAzureNoticeOnce,
  ]);

  useEffect(() => {
    if (step === STEP.TURN_REPORT && roomId && currentTurn) {
      console.log("[RecordingPage] TURN_REPORT 진입 → 점수 조회");
      fetchTurnResults(currentTurn);
    }
  }, [step, currentTurn, roomId, fetchTurnResults]);

  // 스크립트 에러 발생 시 동기화 단계로 진입
  useEffect(() => {
    if (scriptError) {
      console.log("[RecordingPage] 스크립트 오류 발생 - 동기화 단계로 이동");
      const timer = setTimeout(() => {
        setStep(STEP.TURN_REPORT);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [scriptError]);

  // UI 데이터 가공
  const sentenceCardsData = useMemo(() => {
    const isReportMode = step === STEP.TURN_REPORT || step === STEP.ALL_DONE;
    const targetTurn = selectedTurnForReport || currentTurn;

    let resultsMap = {};
    if (isReportMode && turnResults[targetTurn]) {
      turnResults[targetTurn].forEach((result) => {
        resultsMap[result.scriptId] = {
          score: result.score,
          averageScore: result.averageScore,
        };
      });
      console.log("🔍 [RecordingPage] resultsMap:", resultsMap);
    }

    return currentTurnSentences.map((s, i) => {
      const resultData = resultsMap[s.scriptId];
      const finalScore = resultData?.score ?? sentenceScores[s.id];

      // scriptId는 고유하므로 scriptId만 사용 (턴 번호 불필요)
      const bookmarkKey = s.scriptId;
      return {
        ...s,
        scriptId: s.scriptId,
        score: finalScore,
        averageScore: resultData?.averageScore,
        isActive: isReportMode ? true : i === currentSentenceIndex,
        currentSentence: i + 1,
        totalSentences: currentTurnSentences.length,
        isBookmarked: bookmarkedSentences.includes(bookmarkKey),
      };
    });
  }, [
    currentTurnSentences,
    currentSentenceIndex,
    sentenceScores,
    bookmarkedSentences,
    step,
    turnResults,
    currentTurn,
    selectedTurnForReport,
  ]);

  const handleManualStop = useCallback(() => {
    console.log("⏹️ [RecordingPage] 사용자가 녹음을 수동으로 종료했습니다.");
    clearAllTimers();
    stopRecording();
  }, [clearAllTimers, stopRecording]);

  const bottomContent = () => {
    if (isLoadingScript) {
      return (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            background: "#fff",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <p style={{ fontSize: "16px", color: "#666" }}>
            스크립트를 불러오는 중입니다...
          </p>
        </div>
      );
    }

    const isReportMode = step === STEP.TURN_REPORT || step === STEP.ALL_DONE;

    if (scriptError && !isReportMode) {
      return (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            background: "#fff",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "200px",
          }}
        >
          <p
            style={{
              fontSize: "16px",
              color: "#6b7280",
              whiteSpace: "pre-line",
              marginBottom: "24px",
              lineHeight: "1.6",
            }}
          >
            {scriptError}
          </p>
          <div className={styles.spinner} />
        </div>
      );
    }

    switch (step) {
      case STEP.IDLE:
        return <BottomIdle onNext={startFlow} onStart={startFlow} />;
      case STEP.AI_TIMER:
        return <BottomAITimer seconds={countdown} />;
      case STEP.AI_PLAYING:
        return <BottomAIPlaying />;
      case STEP.RECORD_TIMER:
        return <BottomRecordTimer seconds={countdown} />;
      case STEP.RECORDING:
        return <BottomRecording onStop={handleManualStop} />;
      case STEP.RECORD_DONE:
        return <BottomRecordDone isLast={isLastSentence} />;
      case STEP.TURN_REPORT:
        // 모든 턴(중간 및 마지막)에 대해 동기화 로직(준비/시작) 적용
        const readyCount = participants.filter(p => !p.isHost && p.isReady).length;
        const totalToReady = participants.length - 1;

        return (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              background: "#fff",
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {/* 스크립트 에러/내용없음 메시지가 있으면 버튼 위에 표시 */}
            {scriptError && (
              <p style={{ fontSize: "15px", color: "#6b7280", marginBottom: "4px", whiteSpace: "pre-line" }}>
                {scriptError}
              </p>
            )}

            {/* 준비 현황을 모든 유저에게 표시 */}
            <div style={{ fontSize: "14px", color: "#666", fontWeight: "500" }}>
              {participants.length > 1 
                ? `팀원 준비 현황: ${readyCount} / ${totalToReady}`
                : "참여자를 기다리고 있습니다."}
            </div>

            {amIHost ? (
              <button
                onClick={handleStartNextTurn}
                disabled={!allReady && participants.length > 1}
                style={{
                  padding: "12px 32px",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#fff",
                  background: (!allReady && participants.length > 1) ? "#ccc" : "#2b7fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: (!allReady && participants.length > 1) ? "not-allowed" : "pointer",
                }}
              >
                {currentTurn >= TURNS ? "복습 게임 시작" : "다음 단계로"}
              </button>
            ) : (
              <button
                onClick={handleReady}
                style={{
                  padding: "12px 32px",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#fff",
                  background: isReady ? "#10b981" : "#2b7fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                {isReady ? "준비 완료!" : "준비하기"}
              </button>
            )}
          </div>
        );
      case STEP.ALL_DONE:
        if (isAiMode) {
          return (
            <BottomAllDone
              onRestart={restart}
              onComplete={() => navigate("/main", { replace: true })}
              isHost
              completeLabel="메인으로"
            />
          );
        }
        return (
          <BottomAllDone onRestart={restart} onComplete={handleMiniGameStart} isHost={amIHost} />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* 📊 실시간 학습 현황 패널 추가 (드래그/최소화 기능) */}
      {!isAiMode && (
      <div 
        className={`${styles.StatusPanel} ${isDragging ? styles.Dragging : ''} ${isMinimized ? styles.Minimized : ''}`}
        style={{ 
          top: `${panelPos.top}px`, 
          right: `${panelPos.right}px`,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className={styles.StatusTitle}>
          <div className={styles.TitleLeft}>
            <span>학습 현황</span>
            {!isMinimized && <span className={styles.LiveBadge}>LIVE</span>}
          </div>
          <button 
            className={styles.MinimizeButton} 
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(!isMinimized);
            }}
            title={isMinimized ? "펼치기" : "최소화"}
          >
            {isMinimized ? "∨" : "∧"}
          </button>
        </div>
        
        {!isMinimized && participants.map((p) => {
          const profile = getDuckProfileDetail(p.duckCustomJson);
          // 🔴/🟢 점은 오직 '평가(쉐도잉) 완료' 여부만 나타냄 (준비 상태와 분리)
          // 내가 리포트 단계거나, 상대방의 마이크가 켜졌다면(쉐도잉 완료) '평가 완료'
          const isEvalFinished = p.isMe 
            ? (step === STEP.TURN_REPORT || step === STEP.ALL_DONE) 
            : p.micOn;
          
          return (
            <div key={p.id} className={styles.ParticipantStatus}>
              <div 
                className={`${styles.AvatarWrapper} ${p.isSpeaking ? styles.Speaking : ''}`}
                style={{ backgroundColor: profile.color }}
              >
                <img 
                  src={profile.image} 
                  alt={p.name} 
                  className={styles.StatusAvatar}
                />
                {profile.accessory && profile.accessory !== 'none' && (
                  <span className={styles.StatusAccessory}>{profile.accessory}</span>
                )}
              </div>
              <div className={styles.StatusInfo}>
                <div className={styles.NameRow}>
                  <span className={styles.StatusName}>
                    {p.isMe 
                      ? `${p.name.length > 5 ? p.name.slice(0, 5) + '..' : p.name}(나)` 
                      : (p.name.length > 5 ? p.name.slice(0, 5) + '..' : p.name)}
                  </span>
                </div>
                <div className={styles.StatusLabel}>
                  <span className={`${styles.StatusDot} ${isEvalFinished ? styles.DotGreen : styles.DotRed}`} />
                  <span className={isEvalFinished ? styles.TextGreen : styles.TextRed}>
                    {isEvalFinished ? '평가 완료' : '평가 중'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* 👇 소리 재생용 컴포넌트 추가 (음소거 상태 전달) */}
      {subscribers.map((sub, i) => (
        <div key={i} style={{ display: 'none' }}>
          <UserAudioComponent streamManager={sub} muted={isSpeakerMuted} />
        </div>
      ))}
      <Recordinglayout
        currentTurn={selectedTurnForReport || currentTurn}
      sentenceCards={sentenceCardsData}
      activeCardState={
        step === STEP.AI_PLAYING
          ? "ai_playing"
          : step === STEP.RECORD_TIMER
          ? "record_timer"
          : step === STEP.RECORDING
          ? "recording"
          : step === STEP.RECORD_DONE
          ? "record_done"
          : "idle"
      }
      countdown={countdown}
      recordingTime={recordingTime}
      recordingCountdown={recordingCountdown}
      bottomContent={bottomContent()}
      onBookmarkToggle={handleBookmarkToggle}
      onStop={handleManualStop}
      showBlanks={showBlanks}
      isSubmitting={isSubmitting}
      onToggleBlanks={() => {
        console.log("🔄 [RecordingPage] 빈칸 모드 토글:", !showBlanks);
        setShowBlanks(!showBlanks);
      }}
      totalTurns={TURNS}
      isAllDone={step === STEP.ALL_DONE}
      onTurnClick={(t) => {
        if (step === STEP.ALL_DONE) {
          setSelectedTurnForReport(t);
          if (!turnResults[t]) {
            fetchTurnResults(t);
          }
        }
      }}
      selectedTurnForReport={selectedTurnForReport}
      logoExitMessage="메인 화면으로 나가시겠습니까?"
      onLogoExit={handleLogoExit}
      disableProfileClick={true}
      />
      {isTransitioning && (
        <LoadingOverlay
          title="대화 단계로 이동합니다!"
          subtitle="팀원들과 즐거운 대화를 나눠보세요."
          image={duckTogether}
        />
      )}
      {toastMessage && <div className={styles.Toast}>{toastMessage}</div>}
    </>
  );
}

// 👇 소리 재생용 컴포넌트
const UserAudioComponent = ({ streamManager, muted }) => {
  const audioRef = useRef(null);

  useEffect(() => {
    if (streamManager && audioRef.current) {
      streamManager.addVideoElement(audioRef.current);
    }
  }, [streamManager]);

  // muted 프로퍼티가 변경될 때 실제 엘리먼트에 적용
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
    }
  }, [muted]);

  return <audio autoPlay ref={audioRef} muted={muted} />;
};