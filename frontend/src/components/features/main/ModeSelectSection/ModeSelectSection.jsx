import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./ModeSelectSection.module.css";
import ModeCard from "@/components/common/ModeCard/ModeCard";

export default function ModeSelectSection({ onClickPractice, onClickTogether }) {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(1); // '함께하기'를 기본 중앙으로 설정

  const cards = [
    {
      id: "practice",
      title: "싱글 모드",
      description: "AI 수덕과 한국어로 수다 떨고 쉐도잉까지",
      variant: "practice",
      disabled: false,
      action: onClickPractice
    },
    {
      id: "together",
      title: "함께하기",
      description: "친구들과 함께 수다 떨며 영어 공부하기",
      variant: "together",
      disabled: false,
      action: onClickTogether
    },
    {
      id: "mypage",
      title: "마이페이지",
      description: "내가 학습한 문장들을 모아보고 복습하세요",
      variant: "mypage",
      disabled: false,
      action: () => navigate("/mypage")
    }
  ];

  const handlePrev = () => {
    setActiveIndex((prev) => (prev === 0 ? cards.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev === cards.length - 1 ? 0 : prev + 1));
  };

  const handleCardClick = (index, action) => {
    if (index === activeIndex) {
      action();
    } else {
      setActiveIndex(index);
    }
  };

  const getCardClass = (index) => {
    if (index === activeIndex) return styles.Active;
    
    const diff = index - activeIndex;
    if (diff === -1 || diff === 2) return styles.Left;
    if (diff === 1 || diff === -2) return styles.Right;
    
    return "";
  };

  return (
    <section className={styles.Section} aria-label="학습 모드 선택">
      {/* 왼쪽 화살표 (SVG로 굵게) */}
      <button className={`${styles.Arrow} ${styles.ArrowLeft}`} onClick={handlePrev} aria-label="이전 모드">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <div className={styles.CarouselContainer}>
        {cards.map((card, index) => (
          <div 
            key={card.id} 
            className={`${styles.CardWrapper} ${getCardClass(index)}`}
            onClick={() => handleCardClick(index, card.action)}
          >
            <ModeCard
              title={card.title}
              description={card.description}
              variant={card.variant}
              disabled={card.disabled}
              disabledMessage={card.disabledMessage}
              isActive={index === activeIndex}
              onClick={() => {}} 
            />
          </div>
        ))}
      </div>

      {/* 오른쪽 화살표 (SVG로 굵게) */}
      <button className={`${styles.Arrow} ${styles.ArrowRight}`} onClick={handleNext} aria-label="다음 모드">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </section>
  );
}
