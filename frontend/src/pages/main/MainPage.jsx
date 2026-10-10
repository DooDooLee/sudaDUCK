import { useState, useEffect } from "react";
import styles from "./MainPage.module.css";
import { useNavigate, useLocation } from "react-router-dom";

import AppHeader from "@/components/layout/AppHeader/AppHeader";
import MainHero from "@/components/features/main/MainHero/MainHero";
import ModeSelectSection from "@/components/features/main/ModeSelectSection/ModeSelectSection";
import TipBanner from "@/components/common/TipBanner/TipBanner";
import StatsSection from "@/components/features/main/StatsSection/StatsSection";
import { getMyProfileCustom, getMypageSummary } from "@/api/mypage";

export default function MainPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state ?? {};
  const initialSummary = state.summary;
  const [summary, setSummary] = useState(() =>
    initialSummary ?? { attendanceDays: 0, sentenceCount: 0 }
  );
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");


  // 토스트 메시지 표시
  useEffect(() => {
    if (location.state?.toastMessage) {
      const message = location.state.toastMessage;
      setToastMessage(message);
      setToastVisible(true);

      // 3초 후 자동으로 사라짐
      const timer = setTimeout(() => {
        setToastVisible(false);
      }, 3000);

      // location state 정리
      navigate(location.pathname, {
        replace: true,
        state: { ...state, toastMessage: undefined },
      });


      // 이 cleanup은 location이 바뀔 때마다 실행되는데,
      // navigate를 호출하면 location이 바뀌어서 타이머가 바로 취소되는 버그가 있었음.
      // 따라서 여기서는 언마운트 시에만 정리되도록 하거나, 타이머를 유지해야 함.
      return () => {
        // 만약 페이지를 아예 떠나는 것이라면 정리, 
        // 하지만 navigate(replace)는 같은 컴포넌트를 유지하므로 주의 필요.
        // 여기서는 단순히 clearTimeout을 제거하거나, 
        // 의존성 배열에서 location을 빼고 location.state.toastMessage만 감시하는 것이 나음.
      };
    }
  }, [location.state?.toastMessage, navigate, location.pathname]);


  // 로그인 후 사용자 프로필 로드 (닉네임 등)
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const profileData = await getMyProfileCustom();
        if (profileData.nickname) {
          localStorage.setItem('userNickname', profileData.nickname);
          window.dispatchEvent(new Event('nicknameUpdated'));
        }

        const summaryData = await getMypageSummary();
        if (summaryData) {
          setSummary({
            attendanceDays: summaryData.attendanceDays ?? 0,
            sentenceCount: summaryData.sentenceCount ?? 0,
          });
        }
      } catch (error) {
        console.error("프로필 로드 실패:", error);
      }
    };

    // accessToken이 있으면 프로필 로드
    const token = localStorage.getItem('accessToken');
    if (token) {
      loadUserProfile();
    }
  }, []);

  const handlePractice = () => {
    navigate("/practice/ai");
  };

  const handleTogether = () => {
    navigate("/together", { state: { summary } });
  };


  return (
    <div className={styles.Page}>
      {/* 토스트 메시지 (화면 상단) */}
      {toastVisible && (
        <div className={styles.Toast}>
          {toastMessage}
        </div>
      )}

      <div className={styles.Shell}>
        <AppHeader userName="user" notifications={[]} />

        <div className={styles.Top}>
          <MainHero />
          <ModeSelectSection
            onClickPractice={handlePractice}
            onClickTogether={handleTogether}
          />
        </div>

        <div className={styles.Bottom}>
          <TipBanner text="Tip: 지금 바로 함께 하기 모드로 들어가 볼까요? 😊" />
          <StatsSection
            stats={[
              { value: "🔥", label: "오늘도 열심히 해볼까요?" },
              { value: `${summary.attendanceDays}일`, label: "연속 학습" },
              { value: `${summary.sentenceCount}개`, label: "저장된 문장" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
