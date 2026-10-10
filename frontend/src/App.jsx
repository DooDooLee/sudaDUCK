import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { OpenViduProvider } from "@/context/OpenViduContext";
import { SoundProvider } from "@/context/SoundContext";
import useClickSound from "@/hooks/useClickSound";

import LandingPage from "./pages/landing/LandingPage";
import OAuth2RedirectHandler from "./pages/auth/OAuth2RedirectHandler";
import MainPage from "./pages/main/MainPage";
import PracticePage from "./pages/practice/PracticePage";
import SoloPracticePage from "./pages/practice/SoloPracticePage";
import AiPracticePage from "./pages/practice/AiPracticePage";
import TogetherPage from "./pages/together/TogetherPage";
import MakeRoomPage from "./pages/together/MakeRoomPage";
import JoinRoomPage from "./pages/together/JoinRoomPage";
import WaitingRoomPage from "./pages/together/WaitingRoomPage";
import TogetherTalkPage from "./pages/together/TogetherTalkPage";
import RecordingPage from "./pages/recording/RecordingPage";
import MyPage from "./pages/mypage/MyPage";
import MiniGame1Page from "./pages/minigame/MiniGame1Page";
import MiniGame2Page from "./pages/minigame/MiniGame2Page";
import VoiceRoom from "./pages/together/VoiceRoom";

// [DEV ONLY] 로컬 테스트 로그인 (프로덕션 빌드에서는 제외됨)
const DevLoginPage = import.meta.env.DEV
  ? lazy(() => import("./pages/auth/DevLoginPage"))
  : null;

function AppContent() {
  useEffect(() => {
    document.body.classList.add("duck-cursor");
    return () => document.body.classList.remove("duck-cursor");
  }, []);

  const { pathname } = useLocation();

  // ❌ 클릭 효과음 "안 되는" 페이지들 (prefix 기준)
  const clickSoundDisabledPrefixes = [
    "/together/waiting",
    "/together/talk",
    "/minigame",   // /minigame1, /minigame2 등 확장 대응
  ];

  const clickSoundEnabled = !clickSoundDisabledPrefixes.some((p) =>
    pathname.startsWith(p)
  );

  useClickSound(clickSoundEnabled, { volume: 0.1 });

  const content = (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/oauth2/redirect" element={<OAuth2RedirectHandler />} />
      <Route path="/main" element={<MainPage />} />

      <Route path="/practice" element={<PracticePage />} />
      <Route path="/practice/solo" element={<SoloPracticePage />} />
      <Route path="/practice/ai" element={<AiPracticePage />} />

      <Route path="/together" element={<TogetherPage />} />
      <Route path="/together/make" element={<MakeRoomPage />} />
      <Route path="/together/join" element={<JoinRoomPage />} />
      <Route path="/together/waiting" element={<WaitingRoomPage />} />
      <Route path="/together/talk" element={<TogetherTalkPage />} />

      <Route path="/recording" element={<RecordingPage />} />
      <Route path="/mypage" element={<MyPage />} />

      <Route path="/minigame1" element={<MiniGame1Page />} />
      <Route path="/minigame2" element={<MiniGame2Page />} />

      <Route path="/test" element={<VoiceRoom />} />

      {DevLoginPage && (
        <Route
          path="/dev-login"
          element={
            <Suspense fallback={null}>
              <DevLoginPage />
            </Suspense>
          }
        />
      )}
      {/* /login 라우트는 원래 없음. 토큰 갱신 실패 시 여기로 튕기므로 개발 중엔 dev 로그인으로, 그 외엔 랜딩으로 */}
      <Route path="/login" element={<Navigate to={DevLoginPage ? "/dev-login" : "/"} replace />} />
    </Routes>
  );

  return (
    <OpenViduProvider>
      {pathname === "/" ? (
        content
      ) : (
        <div key={pathname} className="page-transition">
          {content}
        </div>
      )}
    </OpenViduProvider>
  );
}

export default function App() {
  return (
    <SoundProvider>
      <AppContent />
    </SoundProvider>
  );
}
