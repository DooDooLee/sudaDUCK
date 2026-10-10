import { useState, useEffect } from 'react';
import styles from './SentenceCard.module.css';
import bookmarkAddIcon from '@/assets/icons/bookmark_add.png';
import bookmarkAddedIcon from '@/assets/icons/bookmakr_added.png';

export default function SentenceCard({
  speaker = '나',
  currentSentence = 1,
  totalSentences = 3,
  korean = '나는 카페에서 아르바이트를 했는데, 정말 힘들었어요.',
  english = 'I worked at a coffee shop, and it was really tough.',
  blankWords = [],
  similarPhrases = [],
  score = null,
  averageScore = null,
  isActive = false,
  cardState = 'idle',
  countdown = 3,
  recordingTime = 0,
  recordingCountdown = 10,
  sentenceId = null,
  initialBookmarked = false,
  onBookmarkToggle = null,
  onStop = null,
  showBlanks = true,
  isSubmitting = false,
  onToggleBlanks = null,
}) {
  const [isBookmarked, setIsBookmarked] = useState(initialBookmarked);

  useEffect(() => {
    setIsBookmarked(initialBookmarked);
  }, [initialBookmarked]);

  const handleBookmark = () => {
    const newBookmarkedState = !isBookmarked;
    setIsBookmarked(newBookmarkedState);

    if (onBookmarkToggle) {
      onBookmarkToggle(sentenceId, newBookmarkedState);
    }

    console.log('북마크 토글:', sentenceId, newBookmarkedState);
  };

  // 점수에 따른 색상 클래스 반환
  const getScoreColorClass = (scoreValue) => {
    if (scoreValue < 40) return styles.scoreRed;
    if (scoreValue < 60) return styles.scoreOrange;
    if (scoreValue < 80) return styles.scoreYellow;
    return styles.scoreGreen;
  };

  const getDisplayEnglish = () => {
    if (blankWords.length === 0) {
      return <>{english}</>;
    }

    // AI가 읽는 중이거나 녹음 대기 중에는 전체 문장 보여주기
    if (cardState === 'ai_playing' || cardState === 'record_timer') {
      return <>{english}</>;
    }

    if (cardState === 'idle' && isActive) {
      return <>{english}</>;
    }

    if (!isActive) {
      let parts = [english];
      blankWords.forEach((word) => {
        const newParts = [];
        parts.forEach((part) => {
          if (typeof part === 'string') {
            const regex = new RegExp(`\\b(${word})\\b`, 'gi');
            const splits = part.split(regex);

            splits.forEach((split, idx) => {
              if (split.toLowerCase() === word.toLowerCase()) {
                newParts.push(
                  <span key={`blank-${word}-${idx}`} className={styles.blankBracket}>
                    [{split}]
                  </span>
                );
              } else if (split) {
                newParts.push(split);
              }
            });
          } else {
            newParts.push(part);
          }
        });
        parts = newParts;
      });

      return <>{parts}</>;
    }

    let parts = [english];
    blankWords.forEach((word) => {
      const newParts = [];
      parts.forEach((part) => {
        if (typeof part === 'string') {
          const regex = new RegExp(`\\b(${word})\\b`, 'gi');
          const splits = part.split(regex);

          splits.forEach((split, idx) => {
            if (split.toLowerCase() === word.toLowerCase()) {
              if (showBlanks) {
                newParts.push(
                  <span key={`blank-${word}-${idx}`} className={styles.blank}>
                    {'\u00A0'.repeat(split.length)}
                  </span>
                );
              } else {
                // 빈칸 모드가 꺼져있을 때는 텍스트를 보여주되 강조 표시
                newParts.push(
                  <span key={`hint-${word}-${idx}`} className={styles.blankTextHint}>
                    {split}
                  </span>
                );
              }
            } else if (split) {
              newParts.push(split);
            }
          });
        } else {
          newParts.push(part);
        }
      });
      parts = newParts;
    });

    return <>{parts}</>;
  };
  
  const getRecordingBoxContent = () => {
    if (!isActive) {
      return null;
    }

    switch (cardState) {
      case 'record_timer':
        return (
          <div className={styles.recordingActive}>
            <div className={styles.recordingStatus}>
              <div className={styles.statusColumn}>
                <div className={styles.countdownCircleBig}>
                  <span className={styles.countdownNumberBig}>{Math.max(0, countdown)}</span>
                </div>
                <span className={styles.statusTextLarge}>잠시 후 녹음이 시작됩니다</span>
                <span className={styles.recordingHintLarge}>영어로 읽을 준비!!! 🎙️</span>
              </div>
            </div>
          </div>
        );

      case 'recording':
        const formatCountdown = (seconds) => {
          const mins = Math.floor(seconds / 60);
          const secs = seconds % 60;
          return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        };

        return (
          <div className={styles.recordingColumn}>
            <div className={styles.recordingActive}>
              {/* 좌측: 스위치 토글 영역 */}
              <div className={styles.sideArea}>
                <div className={styles.switchWrapper}>
                  <span className={styles.switchLabel}>빈칸</span>
                  <button 
                    type="button" 
                    className={`${styles.iosSwitch} ${showBlanks ? styles.switchOn : ""}`}
                    onClick={onToggleBlanks}
                    disabled={isSubmitting}
                    aria-label={showBlanks ? "빈칸 끄기" : "빈칸 켜기"}
                  >
                    <div className={styles.switchHandle} />
                  </button>
                </div>
              </div>

              {/* 중앙: 카운트다운 */}
              <div className={styles.centerArea}>
                <div className={styles.recordingCircle}>
                  <span className={styles.countdownNumber}>{formatCountdown(recordingCountdown)}</span>
                </div>
              </div>

              {/* 우측: 정지 버튼 영역 */}
              <div className={styles.sideArea}>
                {onStop && (
                  <button 
                    className={styles.stopButtonCircle} 
                    onClick={onStop}
                    type="button"
                    aria-label="녹음 끝내기"
                    disabled={isSubmitting}
                  >
                    <div className={styles.stopActionIconWrap}>
                      {isSubmitting ? (
                        <div className={styles.spinner} />
                      ) : (
                        <div className={styles.stopIcon} />
                      )}
                    </div>
                    <span className={styles.stopText}>
                      {isSubmitting ? '평가 중' : '끝내기'}
                    </span>
                  </button>
                )}
              </div>
            </div>
            <p className={styles.recordingHintText}>문장을 천천히 또박또박 따라 말해보세요.</p>
          </div>
        );

      case 'record_done':
        return (
          <div className={styles.recordingStatus}>
            {isSubmitting ? (
              <div className={styles.submittingStatus}>
                <div className={styles.spinnerBlue} />
                <span className={styles.statusText}>평가 전송 중...</span>
              </div>
            ) : (
              <div className={styles.statusColumn}>
                <span className={`${styles.statusText} ${styles.statusSuccess}`}>
                  ✅ 문장 녹음 완료!
                </span>
                <span className={styles.nextSentenceHint}>다음 문장으로..</span>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const showRecordingBox = isActive && (cardState === 'record_timer' || cardState === 'recording' || cardState === 'record_done');

  // 점수에 따른 등급 클래스 결정
  const getScoreGradeClass = () => {
    if (score === null || cardState !== 'idle') return '';
    if (score >= 90) return styles.excellent; // Green
    if (score >= 70) return styles.good;      // Yellow
    return styles.poor;                       // Red
  };

  const getScoreGradeText = () => {
    if (score === null) return '';
    if (score >= 90) return 'Great!';
    if (score >= 70) return 'Good';
    return 'Keep it up!';
  };

  return (
    <div className={`${styles.sentenceCard} ${isActive ? styles.active : ''} ${getScoreGradeClass()}`}>
      <div className={styles.header}>
        <div className={styles.speakerInfo}>
          <span className={styles.speakerName}>🎙️ 발화자 : {speaker}</span>
        </div>
        <div className={styles.headerRight}>
          {score !== null && cardState === 'idle' && (
            <div className={styles.scoreContainer}>
              <span className={styles.gradeBadge}>{getScoreGradeText()}</span>
              <div className={styles.scoreWrapper}>
                <strong className={styles.scoreValueBig}>{score}</strong>
                <span className={styles.scoreUnit}>pt</span>
              </div>
              {averageScore !== null && averageScore !== undefined && (
                <span className={styles.averageScore}>
                  Avg. {averageScore}pt
                </span>
              )}
            </div>
          )}
          <span className={styles.progress}>{currentSentence} / {totalSentences}</span>
          {score !== null && cardState === 'idle' && (
            <button
              className={`${styles.bookmarkButton} ${isBookmarked ? styles.bookmarked : ''}`}
              onClick={handleBookmark}
              aria-label={isBookmarked ? "저장 해제" : "저장하기"}
              title={isBookmarked ? "저장 해제" : "저장하기"}
            >
              <img
                src={isBookmarked ? bookmarkAddedIcon : bookmarkAddIcon}
                alt="bookmark"
                className={styles.bookmarkIcon}
              />
              <span className={styles.bookmarkText}>
                {isBookmarked ? "저장됨" : "저장하기"}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.section}>
          <span className={styles.label}>한국어</span>
          <p className={styles.text}>{korean}</p>
        </div>

        <div className={`${styles.section} ${styles.englishSection}`}>
          <div className={styles.englishHeader}>
            <span className={styles.label}>English</span>
            {isActive && cardState === 'ai_playing' && (
              <span className={styles.aiStatus}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h4l3-6 3 12 3-6h3" stroke="#2B7FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                AI 읽는 중...
              </span>
            )}
          </div>
          <p className={styles.text}>{getDisplayEnglish()}</p>
        </div>

        {/* 비슷한 표현 (AI 모드에서만 전달됨, 녹음 중에는 숨김) */}
        {similarPhrases.length > 0 && cardState !== 'record_timer' && cardState !== 'recording' && (
          <div className={`${styles.section} ${styles.similarSection}`}>
            <span className={styles.label}>비슷한 표현</span>
            <ul className={styles.similarList}>
              {similarPhrases.map((phrase, idx) => (
                <li key={idx} className={styles.similarItem}>{phrase}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
