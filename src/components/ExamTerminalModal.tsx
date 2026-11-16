import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  Maximize2,
  Moon,
  RotateCcw,
  Send,
  Sun,
  Type,
  X,
  XCircle,
} from 'lucide-react';
import {
  ExamAttempt,
  PublicQuestion,
  SectionBlueprint,
  SubjectSlug,
} from '../types/mockrank';
import { resolveSectionTimeMap } from '../lib/clientExamEngine';

interface ExamTerminalModalProps {
  mockId: string;
  dayNumber: number;
  title: string;
  candidateName: string;
  candidateEmail: string;
  durationMinutes: number;
  correctMarks: number;
  incorrectMarks: number;
  sections: SectionBlueprint[];
  questions: PublicQuestion[];
  attempt: ExamAttempt;
  initialMode?: 'exam' | 'solutions';
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  onReattemptMock?: () => Promise<void> | void;
  onAutosave: (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number
  ) => Promise<void>;
  onSubmitFinal: (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number,
    autoSubmitReason?: string,
    sectionTimeSeconds?: Partial<Record<SubjectSlug, number>>
  ) => Promise<void>;
  onExitWithoutSubmit: () => void;
}

type MockUiScale = 'compact' | 'standard' | 'large';

const DSSSB_SECTION_ORDER: {
  subject: SubjectSlug;
  label: string;
  shortLabel: string;
  part: 'Part A' | 'Part B';
}[] = [
  {
    subject: 'general-awareness',
    label: 'Part A: General Awareness',
    shortLabel: 'GA',
    part: 'Part A',
  },
  {
    subject: 'reasoning',
    label: 'Part A: Reasoning',
    shortLabel: 'Reasoning',
    part: 'Part A',
  },
  {
    subject: 'mathematics',
    label: 'Part A: Mathematics',
    shortLabel: 'Maths',
    part: 'Part A',
  },
  {
    subject: 'hindi',
    label: 'Part A: Hindi',
    shortLabel: 'Hindi',
    part: 'Part A',
  },
  {
    subject: 'english',
    label: 'Part A: English',
    shortLabel: 'English',
    part: 'Part A',
  },
  {
    subject: 'computer-science',
    label: 'Part B: Computer Science',
    shortLabel: 'Comp. Sci.',
    part: 'Part B',
  },
  {
    subject: 'teaching-methodology',
    label: 'Part B: Teaching Methodology',
    shortLabel: 'Teaching',
    part: 'Part B',
  },
];

/**
 * Formats a question stem into standard Testbook / TCS iON CBT layout:
 * - Splits multi-line questions cleanly
 * - Formats Statement I / II, Assertion (A) / Reason (R), numbered lists, and code blocks
 */
function renderStandardQuestionStem(rawQuestion: string) {
  const cleaned = (rawQuestion || '').trim();
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (lines.length <= 1) {
    return <p className="leading-relaxed">{cleaned}</p>;
  }

  return (
    <div className="space-y-2.5">
      {lines.map((line, idx) => {
        const isStatementOrAssertion =
          /^(Statement\s+[I123V]+|Assertion\s*\(A\)|Reason\s*\(R\)|Conclusion\s+[I123V]+|List\s*[-–]?\s*[I12]+)\s*[:.-]/i.test(
            line
          );
        const isNumberedOrRomanItem =
          /^(\([a-zA-Z0-9ivxIVX]+\)|[1-9]\.|[ivxIVX]+\.)\s+/.test(line);
        const isCodeLike =
          /[{};=<>]/.test(line) &&
          /\b(int|void|char|float|double|return|printf|cout|cin|SELECT|FROM|WHERE|def|function|class|public|static|if|else|for|while)\b/.test(
            line
          );

        if (isCodeLike) {
          return (
            <pre
              key={idx}
              className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs sm:text-sm text-slate-900 dark:text-slate-100 overflow-x-auto whitespace-pre-wrap"
            >
              {line}
            </pre>
          );
        }

        if (isStatementOrAssertion) {
          const colonIdx = line.indexOf(':');
          const prefix = colonIdx > -1 ? line.slice(0, colonIdx + 1) : '';
          const rest = colonIdx > -1 ? line.slice(colonIdx + 1).trim() : line;
          return (
            <div
              key={idx}
              className="p-2.5 sm:p-3 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 leading-relaxed"
            >
              {prefix ? (
                <>
                  <strong className="font-bold text-slate-950 dark:text-white">{prefix} </strong>
                  <span>{rest}</span>
                </>
              ) : (
                <span>{line}</span>
              )}
            </div>
          );
        }

        if (isNumberedOrRomanItem) {
          return (
            <div key={idx} className="pl-2 sm:pl-3 leading-relaxed">
              {line}
            </div>
          );
        }

        return (
          <p key={idx} className="leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
}

export const ExamTerminalModal: React.FC<ExamTerminalModalProps> = ({
  mockId,
  title,
  candidateName,
  candidateEmail,
  durationMinutes,
  correctMarks,
  incorrectMarks,
  questions,
  attempt,
  initialMode = 'exam',
  darkMode,
  onToggleDarkMode,
  onReattemptMock,
  onAutosave,
  onSubmitFinal,
  onExitWithoutSubmit,
}) => {
  const isCompletedAttempt = attempt.status === 'completed';
  const [terminalMode, setTerminalMode] = useState<'exam' | 'solutions'>(
    initialMode === 'solutions' || isCompletedAttempt ? 'solutions' : 'exam'
  );
  const isSolutionsMode = terminalMode === 'solutions';

  const hasSavedProgress =
    Object.keys(attempt.responses || {}).length > 0 || (attempt.timeTakenSeconds || 0) > 10;

  // Always show the Fullscreen Gate before starting/resuming a live exam so browser Fullscreen + Keyboard Lock engage cleanly
  const [instructionsAccepted, setInstructionsAccepted] = useState<boolean>(isSolutionsMode);
  const [declarationChecked, setDeclarationChecked] = useState<boolean>(hasSavedProgress);

  // Standard Testbook/CBT Typography Scale ('standard' by default across devices; user can toggle A- / A / A+)
  const [uiScale, setUiScale] = useState<MockUiScale>('standard');
  const [showMobilePalette, setShowMobilePalette] = useState<boolean>(false);

  // Per-question inline solution visibility in Mock Screen (auto-enabled in solutions mode, toggleable anytime in exam mode)
  const [showSolutionInMockScreen, setShowSolutionInMockScreen] = useState<boolean>(
    isSolutionsMode
  );
  const [reattemptBusy, setReattemptBusy] = useState<boolean>(false);

  useEffect(() => {
    if (isSolutionsMode) {
      setShowSolutionInMockScreen(true);
      setInstructionsAccepted(true);
    }
  }, [isSolutionsMode]);

  const cycleUiScale = () => {
    setUiScale((prev) =>
      prev === 'compact' ? 'standard' : prev === 'standard' ? 'large' : 'compact'
    );
  };

  // Build ordered DSSSB sections that exist in this question paper
  const orderedSections = useMemo(() => {
    const present = DSSSB_SECTION_ORDER.map((meta) => {
      const indices: number[] = [];
      questions.forEach((q, idx) => {
        if (q.subject === meta.subject) {
          indices.push(idx);
        }
      });
      return {
        ...meta,
        questionIndices: indices,
        questionCount: indices.length,
      };
    }).filter((sec) => sec.questionCount > 0);

    if (present.length > 0) return present;

    return [
      {
        subject: 'computer-science' as SubjectSlug,
        label: 'Part B: Computer Science',
        shortLabel: 'Comp. Sci.',
        part: 'Part B' as const,
        questionIndices: questions.map((_, i) => i),
        questionCount: questions.length,
      },
    ];
  }, [questions]);

  const [activeSectionIndex, setActiveSectionIndex] = useState<number>(0);
  const [lockedSections, setLockedSections] = useState<Set<SubjectSlug>>(() => new Set());
  const [showLockSectionConfirm, setShowLockSectionConfirm] = useState<boolean>(false);
  const [sectionLockNotice, setSectionLockNotice] = useState<string | null>(null);

  const currentSection = orderedSections[activeSectionIndex] || orderedSections[0];
  const currentSectionIndices = currentSection ? currentSection.questionIndices : [];

  const [currentIndex, setCurrentIndex] = useState<number>(
    () => currentSectionIndices[0] ?? 0
  );
  const [responses, setResponses] = useState<Record<string, number>>(() => ({
    ...(attempt.responses || {}),
  }));
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(
    () => new Set(attempt.markedForReview || [])
  );
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => {
    const init = new Set<string>(Object.keys(attempt.responses || {}));
    const firstIdx = currentSectionIndices[0] ?? 0;
    if (questions[firstIdx]) init.add(questions[firstIdx].id);
    return init;
  });

  // Per-subject elapsed time tracking (in seconds) across all 7 DSSSB subjects
  const [sectionTimes, setSectionTimes] = useState<Record<SubjectSlug, number>>(() =>
    resolveSectionTimeMap(attempt.timeTakenSeconds || 0, attempt.sectionScores)
  );

  // Sync responses if attempt prop changes (e.g., when user clicks Reattempt Paper)
  useEffect(() => {
    setResponses({ ...(attempt.responses || {}) });
    setMarkedForReview(new Set(attempt.markedForReview || []));
    setSectionTimes(resolveSectionTimeMap(attempt.timeTakenSeconds || 0, attempt.sectionScores));
    if (attempt.status === 'in-progress' && initialMode !== 'solutions') {
      setTerminalMode('exam');
      setShowSolutionInMockScreen(false);
      setLockedSections(new Set());
      setActiveSectionIndex(0);
      const firstIdx = orderedSections[0]?.questionIndices[0] ?? 0;
      setCurrentIndex(firstIdx);
    }
  }, [
    attempt.attemptId,
    attempt.sectionScores,
    attempt.startedAt,
    attempt.status,
    attempt.timeTakenSeconds,
    initialMode,
    orderedSections,
  ]);

  // Authoritative remaining timer derived from attempt.expiresAt
  const computeRemainingSeconds = useCallback(() => {
    const expiryMs = new Date(attempt.expiresAt).getTime();
    const nowMs = Date.now();
    const diffSec = Math.floor((expiryMs - nowMs) / 1000);
    if (Number.isNaN(diffSec)) return durationMinutes * 60;
    return Math.max(0, Math.min(durationMinutes * 60, diffSec));
  }, [attempt.expiresAt, durationMinutes]);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(computeRemainingSeconds);

  // Standard Testbook-style elapsed question timer (no 1-minute auto-submit)
  const [questionSeconds, setQuestionSeconds] = useState<number>(0);

  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const submittedRef = useRef<boolean>(false);
  const responsesRef = useRef(responses);
  const reviewRef = useRef(markedForReview);
  const remainingRef = useRef(remainingSeconds);
  const sectionTimesRef = useRef(sectionTimes);
  const currentSubjectRef = useRef<SubjectSlug>(
    currentSection?.subject || 'general-awareness'
  );

  responsesRef.current = responses;
  reviewRef.current = markedForReview;
  remainingRef.current = remainingSeconds;
  sectionTimesRef.current = sectionTimes;
  currentSubjectRef.current = currentSection?.subject || 'general-awareness';

  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    setQuestionSeconds(0);
    setShowSolutionInMockScreen(isSolutionsMode);
  }, [currentIndex, isSolutionsMode]);

  // Mark current question as visited when index changes
  useEffect(() => {
    if (instructionsAccepted && currentQuestion) {
      setVisitedIds((prev) => {
        if (prev.has(currentQuestion.id)) return prev;
        const next = new Set(prev);
        next.add(currentQuestion.id);
        return next;
      });
    }
  }, [currentIndex, currentQuestion, instructionsAccepted]);

  // LocalStorage backup key
  const localBackupKey = `mockrank_backup_${attempt.attemptId}`;

  // Restore local backup if in-progress exam
  useEffect(() => {
    if (isSolutionsMode) return;
    try {
      const saved = localStorage.getItem(localBackupKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.responses && typeof parsed.responses === 'object') {
          setResponses((prev) => ({ ...prev, ...parsed.responses }));
        }
        if (Array.isArray(parsed.markedForReview)) {
          setMarkedForReview(new Set(parsed.markedForReview));
        }
        if (parsed.sectionTimes && typeof parsed.sectionTimes === 'object') {
          setSectionTimes((prev) => ({ ...prev, ...parsed.sectionTimes }));
        }
      }
    } catch {
      // Ignore local storage errors
    }
  }, [isSolutionsMode, localBackupKey]);

  // Save to localStorage on every response, review, or sectionTime update
  useEffect(() => {
    if (!instructionsAccepted || isSolutionsMode) return;
    try {
      localStorage.setItem(
        localBackupKey,
        JSON.stringify({
          responses,
          markedForReview: Array.from(markedForReview),
          sectionTimes,
          updatedAt: Date.now(),
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [
    responses,
    markedForReview,
    sectionTimes,
    instructionsAccepted,
    isSolutionsMode,
    localBackupKey,
  ]);

  const unlockBrowserKeyboardAndExitFullscreen = () => {
    try {
      const navWithKb = navigator as unknown as {
        keyboard?: { unlock?: () => void };
      };
      navWithKb.keyboard?.unlock?.();
    } catch {
      // Ignore keyboard unlock error
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const triggerFinalSubmit = useCallback(
    async (autoReason?: string) => {
      if (submittedRef.current || isSolutionsMode) return;
      submittedRef.current = true;
      setSubmitting(true);

      const totalAllocated = durationMinutes * 60;
      const sumSectionSec = (Object.values(sectionTimesRef.current) as number[]).reduce(
        (acc, v) => acc + Number(v || 0),
        0
      );
      const timeTaken = Math.max(
        1,
        sumSectionSec,
        totalAllocated - remainingRef.current
      );

      try {
        localStorage.removeItem(localBackupKey);
      } catch {
        // Ignore
      }

      unlockBrowserKeyboardAndExitFullscreen();

      await onSubmitFinal(
        responsesRef.current,
        Array.from(reviewRef.current),
        timeTaken,
        autoReason,
        sectionTimesRef.current
      );
    },
    [durationMinutes, isSolutionsMode, localBackupKey, onSubmitFinal]
  );

  // 1-second authoritative exam countdown + per-question & per-subject elapsed timers
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current || isSolutionsMode) return;

    const timer = window.setInterval(() => {
      const nextRem = computeRemainingSeconds();
      setRemainingSeconds(nextRem);
      if (nextRem <= 0) {
        window.clearInterval(timer);
        triggerFinalSubmit('Time expired (00:00). Examination auto-submitted.');
        return;
      }

      setQuestionSeconds((prevSec) => prevSec + 1);
      const activeSubj = currentSubjectRef.current;
      setSectionTimes((prevMap) => ({
        ...prevMap,
        [activeSubj]: (prevMap[activeSubj] || 0) + 1,
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [computeRemainingSeconds, instructionsAccepted, isSolutionsMode, triggerFinalSubmit]);

  // Periodic Firestore autosave every 25 seconds
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current || isSolutionsMode) return;

    const interval = window.setInterval(async () => {
      const totalAllocated = durationMinutes * 60;
      const sumSectionSec = (Object.values(sectionTimesRef.current) as number[]).reduce(
        (acc, v) => acc + Number(v || 0),
        0
      );
      const timeTaken = Math.max(
        1,
        sumSectionSec,
        totalAllocated - remainingRef.current
      );
      try {
        await onAutosave(
          responsesRef.current,
          Array.from(reviewRef.current),
          timeTaken
        );
      } catch {
        // Ignore transient autosave error
      }
    }, 25000);

    return () => window.clearInterval(interval);
  }, [durationMinutes, instructionsAccepted, isSolutionsMode, onAutosave]);

  const requestExamFullscreen = useCallback(async () => {
    try {
      const docEl = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (!document.fullscreenElement) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      }
      // Lock system/escape keys where supported by the browser (Chromium Keyboard Lock API)
      const navWithKb = navigator as unknown as {
        keyboard?: { lock?: (keys?: string[]) => Promise<void> };
      };
      if (navWithKb.keyboard?.lock) {
        await navWithKb.keyboard.lock([
          'Escape',
          'F11',
          'MetaLeft',
          'MetaRight',
          'AltLeft',
          'AltRight',
          'Tab',
        ]);
      }
    } catch {
      // Ignore if running inside a restricted preview frame
    }
  }, []);

  // Strict Fullscreen Lock, Total Keyboard Disable, and Immediate Auto-Submit on Any Exit Attempt
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current || isSolutionsMode) return;

    // Ensure fullscreen is requested immediately when exam becomes active
    requestExamFullscreen();

    let armFullscreenExitGuard = Boolean(document.fullscreenElement);
    const guardTimer = window.setTimeout(() => {
      if (document.fullscreenElement) {
        armFullscreenExitGuard = true;
      }
    }, 700);

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleBlockAllKeys = (e: KeyboardEvent) => {
      if (submittedRef.current) return;

      // Disable ALL keyboard keys during active exam until submitted
      e.preventDefault();
      e.stopPropagation();

      const key = e.key || '';
      const code = e.code || '';

      // If candidate presses Escape, F11, F12, F5, Alt, Meta, or Ctrl+W/R/Q trying to exit fullscreen or exam -> Auto-submit immediately
      const isExitAttemptKey =
        key === 'Escape' ||
        code === 'Escape' ||
        key === 'F11' ||
        code === 'F11' ||
        key === 'F12' ||
        code === 'F12' ||
        key === 'F5' ||
        code === 'F5' ||
        key === 'Meta' ||
        key === 'OS' ||
        e.metaKey ||
        e.altKey ||
        (e.ctrlKey &&
          ['w', 'W', 'r', 'R', 'q', 'Q', 'n', 'N', 't', 'T', 'Tab'].includes(key));

      if (isExitAttemptKey) {
        triggerFinalSubmit(
          `DSSSB Strict Proctoring Rule: Attempted to exit fullscreen or used restricted key (${
            key || code || 'Shortcut'
          }) during active examination. Exam auto-submitted immediately.`
        );
      }
    };

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        armFullscreenExitGuard = true;
        return;
      }
      if (armFullscreenExitGuard && !submittedRef.current) {
        triggerFinalSubmit(
          'DSSSB Strict Proctoring Rule: Exited Fullscreen mode during active examination. Exam auto-submitted immediately.'
        );
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && !submittedRef.current) {
        triggerFinalSubmit(
          'DSSSB Strict Proctoring Rule: Tab switching or leaving the exam screen detected during active examination. Exam auto-submitted immediately.'
        );
      }
    };

    const handleWindowBlur = () => {
      if (!submittedRef.current && document.hasFocus && !document.hasFocus()) {
        triggerFinalSubmit(
          'DSSSB Strict Proctoring Rule: Switched focus away from the locked exam screen. Exam auto-submitted immediately.'
        );
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!submittedRef.current) {
        triggerFinalSubmit(
          'DSSSB Strict Proctoring Rule: Attempted to close or reload the exam window. Exam auto-submitted immediately.'
        );
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('keydown', handleBlockAllKeys, { capture: true });
    window.addEventListener('keyup', handleBlockAllKeys, { capture: true });
    window.addEventListener('keypress', handleBlockAllKeys, { capture: true });
    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      window.clearTimeout(guardTimer);
      window.removeEventListener('keydown', handleBlockAllKeys, { capture: true });
      window.removeEventListener('keyup', handleBlockAllKeys, { capture: true });
      window.removeEventListener('keypress', handleBlockAllKeys, { capture: true });
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [instructionsAccepted, isSolutionsMode, requestExamFullscreen, triggerFinalSubmit]);

  const handleStartExamSession = async () => {
    if (!declarationChecked) return;
    await requestExamFullscreen();
    setInstructionsAccepted(true);
  };

  const handleTriggerReattemptFromMockScreen = async () => {
    if (!onReattemptMock || reattemptBusy) return;
    setReattemptBusy(true);
    try {
      submittedRef.current = false;
      await onReattemptMock();
      await requestExamFullscreen();
      setTerminalMode('exam');
      setInstructionsAccepted(true);
      setShowSolutionInMockScreen(false);
      setLockedSections(new Set());
      setActiveSectionIndex(0);
      const firstIdx = orderedSections[0]?.questionIndices[0] ?? 0;
      setCurrentIndex(firstIdx);
      setResponses({});
      setMarkedForReview(new Set());
      setSectionTimes({
        'general-awareness': 0,
        reasoning: 0,
        mathematics: 0,
        hindi: 0,
        english: 0,
        'computer-science': 0,
        'teaching-methodology': 0,
      });
    } finally {
      setReattemptBusy(false);
    }
  };

  const handleSelectOption = (optionIdx: number) => {
    if (!currentQuestion || isSolutionsMode) return;
    if (lockedSections.has(currentQuestion.subject as SubjectSlug)) return;
    setResponses((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIdx,
    }));
  };

  const handleClearResponse = () => {
    if (!currentQuestion || isSolutionsMode) return;
    if (lockedSections.has(currentQuestion.subject as SubjectSlug)) return;
    setResponses((prev) => {
      const next = { ...prev };
      delete next[currentQuestion.id];
      return next;
    });
  };

  const handleToggleMarkForReview = () => {
    if (!currentQuestion || isSolutionsMode) return;
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(currentQuestion.id)) {
        next.delete(currentQuestion.id);
      } else {
        next.add(currentQuestion.id);
      }
      return next;
    });
  };

  const handleMarkForReviewAndNext = () => {
    if (!currentQuestion) return;
    if (!isSolutionsMode) {
      setMarkedForReview((prev) => {
        const next = new Set(prev);
        next.add(currentQuestion.id);
        return next;
      });
    }
    handleSaveAndNextInSection();
  };

  // Navigation within current section (or across sections when in Solutions Mode)
  const posInCurrentSection = currentSectionIndices.indexOf(currentIndex);
  const hasPrevInSection = posInCurrentSection > 0;
  const hasNextInSection =
    posInCurrentSection >= 0 && posInCurrentSection < currentSectionIndices.length - 1;

  const handlePrevInSection = () => {
    if (hasPrevInSection) {
      setCurrentIndex(currentSectionIndices[posInCurrentSection - 1]);
    } else if (isSolutionsMode && activeSectionIndex > 0) {
      const prevSecIdx = activeSectionIndex - 1;
      const prevSecIndices = orderedSections[prevSecIdx]?.questionIndices || [];
      setActiveSectionIndex(prevSecIdx);
      setCurrentIndex(prevSecIndices[prevSecIndices.length - 1] ?? 0);
    }
  };

  const handleSaveAndNextInSection = () => {
    if (hasNextInSection) {
      setCurrentIndex(currentSectionIndices[posInCurrentSection + 1]);
    } else if (isSolutionsMode) {
      if (activeSectionIndex < orderedSections.length - 1) {
        const nextSecIdx = activeSectionIndex + 1;
        setActiveSectionIndex(nextSecIdx);
        setCurrentIndex(orderedSections[nextSecIdx]?.questionIndices[0] ?? 0);
      }
    } else {
      if (activeSectionIndex < orderedSections.length - 1) {
        setShowLockSectionConfirm(true);
      } else {
        setShowSubmitConfirm(true);
      }
    }
  };

  const handleConfirmLockCurrentSection = () => {
    if (!currentSection) return;
    const nextLocked = new Set(lockedSections);
    nextLocked.add(currentSection.subject);
    setLockedSections(nextLocked);
    setShowLockSectionConfirm(false);
    setShowMobilePalette(false);
    setSectionLockNotice(null);

    if (activeSectionIndex < orderedSections.length - 1) {
      const nextSecIdx = activeSectionIndex + 1;
      setActiveSectionIndex(nextSecIdx);
      const nextSecFirstQ = orderedSections[nextSecIdx].questionIndices[0] ?? 0;
      setCurrentIndex(nextSecFirstQ);
    } else {
      setShowSubmitConfirm(true);
    }
  };

  // Compute palette state counts
  const paletteStats = useMemo(() => {
    let answered = 0;
    let notAnswered = 0;
    let notVisited = 0;
    let markedOnly = 0;
    let answeredAndMarked = 0;
    let correctCount = 0;
    let wrongCount = 0;

    for (const q of questions) {
      const userAns = responses[q.id];
      const isAns = typeof userAns === 'number';
      const isRev = markedForReview.has(q.id);
      const isVis = visitedIds.has(q.id);

      if (isAns) {
        if (typeof q.correctIndex === 'number') {
          if (userAns === q.correctIndex) correctCount += 1;
          else wrongCount += 1;
        }
      }

      if (isAns && isRev) {
        answeredAndMarked += 1;
        answered += 1;
      } else if (isAns) {
        answered += 1;
      } else if (isRev) {
        markedOnly += 1;
      } else if (isVis) {
        notAnswered += 1;
      } else {
        notVisited += 1;
      }
    }

    let sectionAnswered = 0;
    for (const idx of currentSectionIndices) {
      const q = questions[idx];
      if (q && typeof responses[q.id] === 'number') {
        sectionAnswered += 1;
      }
    }

    return {
      answered,
      notAnswered,
      notVisited,
      markedOnly,
      answeredAndMarked,
      unattemptedTotal: questions.length - answered,
      sectionAnswered,
      correctCount,
      wrongCount,
    };
  }, [questions, responses, markedForReview, visitedIds, currentSectionIndices]);

  const formatClock = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const remSec = sec % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
        remSec
      ).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
  };

  // Standard Testbook-style Typography & Spacing Scale
  const questionStemScaleClass =
    uiScale === 'compact'
      ? 'text-sm sm:text-[15px] leading-relaxed'
      : uiScale === 'large'
      ? 'text-base sm:text-lg leading-relaxed'
      : 'text-[15px] sm:text-base leading-relaxed';

  const optionCardScaleClass =
    uiScale === 'compact'
      ? 'px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-lg gap-3'
      : uiScale === 'large'
      ? 'px-4 py-3.5 sm:px-5 sm:py-4 rounded-xl gap-3.5'
      : 'px-3.5 py-3 sm:px-4 sm:py-3.5 rounded-lg gap-3';

  const optionTextScaleClass =
    uiScale === 'compact'
      ? 'text-xs sm:text-sm leading-relaxed'
      : uiScale === 'large'
      ? 'text-[15px] sm:text-base leading-relaxed'
      : 'text-sm sm:text-[15px] leading-relaxed';

  const optionBadgeScaleClass =
    uiScale === 'compact'
      ? 'w-6 h-6 text-xs'
      : uiScale === 'large'
      ? 'w-7 h-7 sm:w-8 sm:h-8 text-xs sm:text-sm'
      : 'w-6 h-6 sm:w-7 sm:h-7 text-xs';

  // Pre-Exam Official Instructions Screen
  if (!instructionsAccepted) {
    return (
      <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col overflow-y-auto">
        <header className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 sm:py-4 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900">
          <div className="min-w-0">
            <div className="text-[11px] sm:text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
              DSSSB TGT CS · STANDARD CBT TERMINAL ({mockId})
            </div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleDarkMode && (
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md cursor-pointer"
              >
                {darkMode ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5" />
                )}
                <span>{darkMode ? 'Light' : 'Dark'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onExitWithoutSubmit}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 cursor-pointer"
            >
              Exit
            </button>
          </div>
        </header>

        <div className="max-w-4xl mx-auto w-full flex-1 px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">
          <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Total Questions
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono text-slate-900 dark:text-white">
                {questions.length} MCQs
              </div>
            </div>
            <div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Duration
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono text-slate-900 dark:text-white">
                {durationMinutes} Mins
              </div>
            </div>
            <div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Correct Answer
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                +{correctMarks.toFixed(2)} Mark
              </div>
            </div>
            <div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Negative Marking
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono text-red-700 dark:text-red-400">
                {incorrectMarks.toFixed(2)} Mark
              </div>
            </div>
          </div>

          <div className="space-y-3 sm:space-y-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              DSSSB Standard CBT Examination Pattern &amp; Instructions
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Sequential Section Locking (DSSSB Pattern):</strong> Sections are attempted
                in sequence. To move to the next section, click{' '}
                <strong>&ldquo;Lock Section &amp; Next Section&rdquo;</strong>. Once locked, you
                cannot return to that section during the live attempt.
              </li>
              <li>
                <strong>No Per-Question Time Limit:</strong> You can manage your overall{' '}
                <strong>{durationMinutes}-minute</strong> examination timer freely across questions
                within the active section. A per-question elapsed time counter is shown for your
                reference.
              </li>
              <li>
                <strong>Total Time &amp; Per-Subject Time Tracking:</strong> Both your overall test
                time and the exact time spent in each of the 7 subjects are recorded and displayed
                on your Scorecard and Dashboard.
              </li>
              <li>
                <strong>Mandatory Locked Fullscreen &amp; Disabled Keyboard Keys:</strong> The mock
                test runs in locked Fullscreen mode. All keyboard keys (including{' '}
                <code>Esc</code>, <code>F11</code>, <code>Alt+Tab</code>, etc.) are disabled until
                the exam is submitted. Attempting to exit Fullscreen, switch tabs, or leave the
                exam screen by any method will immediately auto-submit your test.
              </li>
            </ul>
          </div>

          <div className="p-3.5 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={declarationChecked}
                onChange={(e) => setDeclarationChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 shrink-0"
              />
              <span className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-snug">
                I have read and understood the standard CBT instructions, marking scheme (+
                {correctMarks.toFixed(2)} / {incorrectMarks.toFixed(2)}), mandatory locked
                fullscreen rule, and auto-submit policy on any exit attempt.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1 pb-6">
            <button
              type="button"
              disabled={!declarationChecked}
              onClick={handleStartExamSession}
              className={`w-full sm:w-auto px-6 py-3 rounded-lg text-sm font-semibold transition-colors ${
                declarationChecked
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              {hasSavedProgress
                ? 'Enter Locked Fullscreen & Resume Mock Test →'
                : 'Enter Locked Fullscreen & Start Mock Test →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const userSelectedOption = currentQuestion ? responses[currentQuestion.id] : undefined;
  const hasUserAnsweredCurrent = typeof userSelectedOption === 'number';
  const correctOptionIndex =
    currentQuestion && typeof currentQuestion.correctIndex === 'number'
      ? currentQuestion.correctIndex
      : 0;
  const isCurrentAnswerCorrect =
    hasUserAnsweredCurrent && userSelectedOption === correctOptionIndex;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col select-none overflow-hidden">
      {/* Top Standard CBT Header Bar (Testbook / TCS iON Style) */}
      <header className="min-h-12 py-1.5 px-3 sm:px-5 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-950 text-white shrink-0">
        {/* Left: Mock Title & Mode Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden sm:inline-block px-2 py-0.5 text-[11px] font-mono font-semibold bg-slate-800 text-slate-200 rounded border border-slate-700 shrink-0">
            {mockId}
          </span>
          <h1 className="text-xs sm:text-sm font-bold truncate max-w-[130px] xs:max-w-[180px] sm:max-w-md">
            {title}
          </h1>
          {isSolutionsMode && (
            <span className="px-2 py-0.5 text-[10px] sm:text-xs font-semibold bg-emerald-900/90 text-emerald-200 border border-emerald-700 rounded shrink-0">
              Solutions Mode
            </span>
          )}
        </div>

        {/* Right: Font Scale + Theme + Mode/Reattempt + Timer + Submit/Exit */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Font Scale Button (A- / A / A+) */}
          <button
            type="button"
            onClick={cycleUiScale}
            title="Adjust Question Font Size (Compact / Standard / Large)"
            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-mono font-semibold text-slate-200 cursor-pointer"
          >
            <Type className="w-3 h-3 text-slate-400 hidden sm:inline" />
            <span>
              {uiScale === 'compact' ? 'A-' : uiScale === 'standard' ? 'A' : 'A+'}
            </span>
          </button>

          {onToggleDarkMode && (
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
            >
              {darkMode ? (
                <Sun className="w-3.5 h-3.5 text-amber-300" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span className="hidden md:inline">{darkMode ? 'Light' : 'Dark'}</span>
            </button>
          )}

          {/* Reattempt Paper Button — ONLY shown in Solutions Mode, never while actively attempting a mock */}
          {isSolutionsMode && onReattemptMock && (
            <button
              type="button"
              disabled={reattemptBusy}
              onClick={handleTriggerReattemptFromMockScreen}
              title="Start a Fresh Reattempt of this Question Paper"
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-sky-700 bg-sky-950/90 hover:bg-sky-900 text-sky-200 text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">
                {reattemptBusy ? 'Resetting...' : 'Reattempt Paper'}
              </span>
              <span className="sm:hidden">Reattempt</span>
            </button>
          )}

          {!isSolutionsMode ? (
            <>
              {/* Total Elapsed Time + Remaining Exam Countdown Clock */}
              <div
                title="Total Elapsed Time in Mock"
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-xs font-semibold bg-slate-900 text-emerald-300 border border-slate-700"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Total:{' '}
                  {formatClock(
                    (Object.values(sectionTimes) as number[]).reduce(
                      (acc, v) => acc + Number(v || 0),
                      0
                    )
                  )}
                </span>
              </div>

              <div
                title="Remaining Exam Time"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-xs sm:text-sm font-bold border ${
                  remainingSeconds < 300
                    ? 'bg-red-950 text-red-200 border-red-800'
                    : 'bg-slate-900 text-white border-slate-700'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-slate-400 hidden xs:inline" />
                <span>Left: {formatClock(remainingSeconds)}</span>
              </div>

              {/* Submit Exam Button */}
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="flex items-center gap-1 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
              >
                <Send className="w-3 h-3" />
                <span className="hidden sm:inline">Submit Test</span>
                <span className="sm:hidden">Submit</span>
              </button>
            </>
          ) : (
            <>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-xs font-semibold bg-slate-900 text-emerald-300 border border-slate-700">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Total Time: {formatClock(attempt.timeTakenSeconds || 0)}</span>
              </div>
              <button
                type="button"
                onClick={onExitWithoutSubmit}
                className="flex items-center gap-1 px-3 py-1 sm:py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Exit Solutions</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Warning or Section-Lock Notice Banner */}
      {(warningBanner || sectionLockNotice) && (
        <div className="bg-amber-50 dark:bg-amber-950/70 border-b border-amber-200 dark:border-amber-800 px-3 sm:px-4 py-1.5 flex items-center justify-between text-[11px] sm:text-xs text-amber-900 dark:text-amber-200 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="truncate">{sectionLockNotice || warningBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setWarningBanner(null);
              setSectionLockNotice(null);
            }}
            className="text-amber-800 dark:text-amber-300 underline font-medium ml-3 shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Standard Testbook / DSSSB Section Tabs Bar (With Per-Subject Time Display) */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-2 shrink-0 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          {orderedSections.map((sec, idx) => {
            const isCurrentSection = idx === activeSectionIndex;
            const isLocked =
              !isSolutionsMode && (lockedSections.has(sec.subject) || idx < activeSectionIndex);
            const secElapsedSec = sectionTimes[sec.subject] || 0;

            return (
              <button
                key={sec.subject}
                type="button"
                onClick={() => {
                  if (idx === activeSectionIndex) return;
                  if (isSolutionsMode) {
                    setActiveSectionIndex(idx);
                    setCurrentIndex(sec.questionIndices[0] ?? 0);
                    return;
                  }
                  if (idx < activeSectionIndex || isLocked) {
                    setSectionLockNotice(
                      `Section "${sec.label}" is locked during live test. Complete or switch to Solutions Mode to jump freely across all sections.`
                    );
                  } else {
                    setSectionLockNotice(
                      `Section "${sec.label}" unlocks after locking "${currentSection?.shortLabel}".`
                    );
                  }
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isCurrentSection
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 shadow-2xs'
                    : isLocked
                    ? 'bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {!isCurrentSection && !isSolutionsMode && (
                  <Lock className="w-3 h-3 opacity-70 shrink-0" />
                )}
                <span className="sm:hidden">
                  {sec.shortLabel} ({sec.questionCount}) · {formatClock(secElapsedSec)}
                </span>
                <span className="hidden sm:inline">
                  {sec.label} ({sec.questionCount}) ·{' '}
                  <span className="font-mono text-[11px] opacity-90">
                    {formatClock(secElapsedSec)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isSolutionsMode && activeSectionIndex < orderedSections.length - 1 && (
            <button
              type="button"
              onClick={() => setShowLockSectionConfirm(true)}
              className="px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3 h-3" />
              <span className="hidden sm:inline">Lock Section &amp; Next →</span>
              <span className="sm:hidden">Lock &amp; Next</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Horizontal Quick-Jump Question Strip (< lg only) */}
      <div className="lg:hidden border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1">
          {currentSectionIndices.map((globalIdx, localIdx) => {
            const q = questions[globalIdx];
            if (!q) return null;
            const isCurrent = globalIdx === currentIndex;
            const userAns = responses[q.id];
            const isAns = typeof userAns === 'number';
            const isRev = markedForReview.has(q.id);
            const isVis = visitedIds.has(q.id);

            let pillStyle =
              'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';

            if (isSolutionsMode) {
              if (isAns && userAns === q.correctIndex) {
                pillStyle = 'bg-emerald-600 text-white border-emerald-700';
              } else if (isAns) {
                pillStyle = 'bg-red-600 text-white border-red-700';
              }
            } else {
              if (isAns && isRev) {
                pillStyle = 'bg-amber-600 text-white border-amber-700';
              } else if (isAns) {
                pillStyle = 'bg-emerald-600 text-white border-emerald-700';
              } else if (isRev) {
                pillStyle = 'bg-amber-500 text-white border-amber-600';
              } else if (isVis) {
                pillStyle = 'bg-red-600 text-white border-red-700';
              }
            }

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCurrentIndex(globalIdx)}
                className={`w-7 h-7 rounded font-mono text-[11px] font-bold border shrink-0 flex items-center justify-center transition-all cursor-pointer ${pillStyle} ${
                  isCurrent
                    ? 'ring-2 ring-slate-950 dark:ring-white ring-offset-1 dark:ring-offset-slate-900'
                    : ''
                }`}
              >
                {localIdx + 1}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowMobilePalette(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shrink-0 cursor-pointer"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>
            {paletteStats.sectionAnswered}/{currentSection?.questionCount || 0}
          </span>
        </button>
      </div>

      {/* Main Split CBT Workspace (Standard Testbook Layout) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Question Paper & Explanation Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-950">
          {currentQuestion ? (
            <>
              {/* Testbook-Style Question Sub-Header Strip */}
              <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-xs sm:text-sm font-bold text-slate-950 dark:text-white">
                    Question No. {posInCurrentSection + 1}
                  </span>
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                    (of {currentSectionIndices.length})
                  </span>
                  {currentQuestion.topic && (
                    <span className="hidden md:inline-block px-2 py-0.5 text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                      {currentQuestion.topic}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:gap-3 text-xs">
                  {/* Elapsed Time on Current Subject & Current Question */}
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 font-mono text-[11px] sm:text-xs text-emerald-900 dark:text-emerald-200">
                    <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>
                      {currentSection?.shortLabel || 'Subj'}:{' '}
                      {formatClock(
                        currentSection ? sectionTimes[currentSection.subject] || 0 : 0
                      )}
                    </span>
                  </div>
                  {!isSolutionsMode && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] sm:text-xs text-slate-700 dark:text-slate-300">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Q: {formatClock(questionSeconds)}</span>
                    </div>
                  )}

                  {/* Marks Badge (+1.00 / -0.25) */}
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] sm:text-xs">
                    <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">
                      Marks:
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      +{correctMarks.toFixed(2)}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="font-bold text-red-600 dark:text-red-400">
                      {incorrectMarks.toFixed(2)}
                    </span>
                  </div>

                  {/* Detailed Solution Toggle — ONLY shown in Solutions Mode, never while attempting */}
                  {isSolutionsMode && (
                    <button
                      type="button"
                      onClick={() => setShowSolutionInMockScreen((prev) => !prev)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                        showSolutionInMockScreen
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {showSolutionInMockScreen ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Hide Solution</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detailed Solution</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Question Stem + Options + Inline Detailed Solution */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6">
                <div className="max-w-4xl mx-auto space-y-5">
                  {/* Question Stem (Standard Testbook Formatting) */}
                  <div
                    className={`font-medium text-slate-900 dark:text-slate-100 select-text ${questionStemScaleClass}`}
                  >
                    {renderStandardQuestionStem(currentQuestion.question)}
                  </div>

                  {/* 4 Standard Options List */}
                  <div className="space-y-2.5 sm:space-y-3 pt-1">
                    {currentQuestion.options.map((optText, optIdx) => {
                      const isSelected = userSelectedOption === optIdx;
                      const isCorrectOption =
                        showSolutionInMockScreen && optIdx === correctOptionIndex;
                      const isWrongUserSelection =
                        showSolutionInMockScreen && isSelected && optIdx !== correctOptionIndex;
                      const optionLetter = String.fromCharCode(65 + optIdx);

                      let cardStyle =
                        'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900';
                      let badgeStyle =
                        'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';

                      if (isCorrectOption) {
                        cardStyle =
                          'border-emerald-500 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 ring-1 ring-emerald-500';
                        badgeStyle =
                          'bg-emerald-600 text-white border-emerald-600';
                      } else if (isWrongUserSelection) {
                        cardStyle =
                          'border-red-500 dark:border-red-500 bg-red-50/70 dark:bg-red-950/40 ring-1 ring-red-500';
                        badgeStyle = 'bg-red-600 text-white border-red-600';
                      } else if (isSelected) {
                        cardStyle =
                          'border-sky-600 dark:border-sky-400 bg-sky-50/60 dark:bg-sky-950/40 ring-1 ring-sky-600 dark:ring-sky-400';
                        badgeStyle =
                          'bg-sky-600 dark:bg-sky-400 text-white dark:text-slate-950 border-sky-600 dark:border-sky-400';
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleSelectOption(optIdx)}
                          className={`w-full text-left border transition-all flex items-start justify-between cursor-pointer ${optionCardScaleClass} ${cardStyle}`}
                        >
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <span
                              className={`rounded-full font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 border ${optionBadgeScaleClass} ${badgeStyle}`}
                            >
                              {optionLetter}
                            </span>
                            <span
                              className={`text-slate-800 dark:text-slate-100 flex-1 select-text ${optionTextScaleClass}`}
                            >
                              {optText}
                            </span>
                          </div>

                          {/* Status Badges when Solution is Shown */}
                          {showSolutionInMockScreen && (
                            <div className="flex items-center gap-1.5 ml-3 shrink-0">
                              {isCorrectOption && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Correct Answer</span>
                                </span>
                              )}
                              {isWrongUserSelection && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 dark:bg-red-900/70 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700">
                                  <XCircle className="w-3 h-3" />
                                  <span>Your Answer</span>
                                </span>
                              )}
                              {isCorrectOption && isSelected && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-100 dark:bg-sky-900/70 text-sky-800 dark:text-sky-200 border border-sky-300 dark:border-sky-700">
                                  <span>Your Answer</span>
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Inline Detailed Solution & Explanation Panel inside Mock Screen (Testbook Style) */}
                  {showSolutionInMockScreen && (
                    <div className="mt-5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/25 p-4 sm:p-5 space-y-3 select-text">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-emerald-200/80 dark:border-emerald-800/60">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                          <span className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200">
                            Detailed Solution &amp; Explanation
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                          <span className="px-2.5 py-0.5 rounded font-bold bg-emerald-600 text-white">
                            Correct Option: {String.fromCharCode(65 + correctOptionIndex)}
                          </span>
                          {hasUserAnsweredCurrent ? (
                            <span
                              className={`px-2.5 py-0.5 rounded font-semibold ${
                                isCurrentAnswerCorrect
                                  ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                                  : 'bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200'
                              }`}
                            >
                              Your Choice: Option {String.fromCharCode(65 + userSelectedOption)} (
                              {isCurrentAnswerCorrect ? 'Correct' : 'Incorrect'})
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              Unattempted
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line space-y-2">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          Answer: Option {String.fromCharCode(65 + correctOptionIndex)} —{' '}
                          {currentQuestion.options[correctOptionIndex]}
                        </div>
                        <p>
                          {currentQuestion.explanation ||
                            'Detailed step-by-step explanation verified as per the official DSSSB TGT Computer Science syllabus and answer key.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Standard Testbook Bottom Action Footer Bar */}
              <div className="px-3.5 sm:px-6 py-2.5 sm:py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
                {/* Left Group: Mark for Review & Next + Clear Response (During Exam) OR Detailed Solution + Reattempt (In Solutions Mode) */}
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  {!isSolutionsMode ? (
                    <>
                      <button
                        type="button"
                        onClick={handleMarkForReviewAndNext}
                        className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                          markedForReview.has(currentQuestion.id)
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <Bookmark className="w-3.5 h-3.5 shrink-0 hidden xs:inline" />
                        <span className="truncate">Mark for Review &amp; Next</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleClearResponse}
                        disabled={typeof responses[currentQuestion.id] !== 'number'}
                        className="px-2.5 sm:px-3.5 py-2 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-center truncate"
                      >
                        Clear Response
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowSolutionInMockScreen((prev) => !prev)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                          showSolutionInMockScreen
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200'
                            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {showSolutionInMockScreen ? 'Hide Detailed Solution' : 'Detailed Solution'}
                        </span>
                      </button>

                      {onReattemptMock && (
                        <button
                          type="button"
                          disabled={reattemptBusy}
                          onClick={handleTriggerReattemptFromMockScreen}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            {reattemptBusy ? 'Resetting...' : 'Reattempt Paper'}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Right Group: Previous & Save & Next */}
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrevInSection}
                    disabled={!hasPrevInSection && !(isSolutionsMode && activeSectionIndex > 0)}
                    className="flex items-center justify-center gap-1 px-3.5 py-2 rounded-md text-xs sm:text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4 shrink-0" />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveAndNextInSection}
                    className="flex items-center justify-center gap-1 px-5 py-2 rounded-md text-xs sm:text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer shadow-2xs"
                  >
                    <span className="truncate">
                      {isSolutionsMode
                        ? hasNextInSection || activeSectionIndex < orderedSections.length - 1
                          ? 'Next Question'
                          : 'End of Solutions'
                        : hasNextInSection
                        ? 'Save & Next'
                        : activeSectionIndex < orderedSections.length - 1
                        ? 'Lock Section & Next →'
                        : 'Review & Submit'}
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Right: Desktop Question Palette Sidebar (lg+ screens) */}
        <aside className="hidden lg:flex w-80 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex-col shrink-0">
          {/* Candidate Mini Header inside Sidebar (Testbook Style) */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-950/50">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {candidateName}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {isSolutionsMode ? 'Solution & Explanation Review' : 'Active Candidate'}
              </div>
            </div>
            {isSolutionsMode ? (
              <button
                type="button"
                onClick={requestExamFullscreen}
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer shrink-0"
                title="Enter Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </button>
            ) : (
              <span
                title="Fullscreen Locked — Exiting fullscreen or pressing any keyboard key auto-submits the exam"
                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 shrink-0"
              >
                <Lock className="w-3 h-3" />
                <span>Fullscreen Locked</span>
              </span>
            )}
          </div>

          {/* Palette Legend */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
            {isSolutionsMode ? (
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-emerald-600 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Correct ({paletteStats.correctCount})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-red-600 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Incorrect ({paletteStats.wrongCount})
                  </span>
                </div>
                <div className="flex items-center gap-2 col-span-2">
                  <span className="w-3 h-3 rounded-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Unattempted ({paletteStats.unattemptedTotal})
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-emerald-600 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Answered ({paletteStats.answered})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-red-600 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Not Answered ({paletteStats.notAnswered})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Marked ({paletteStats.markedOnly + paletteStats.answeredAndMarked})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 inline-block" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Not Visited ({paletteStats.notVisited})
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-2 bg-slate-100/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">
            SECTION: {currentSection?.label}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-5 gap-2">
              {currentSectionIndices.map((globalIdx, localIdx) => {
                const q = questions[globalIdx];
                if (!q) return null;
                const isCurrent = globalIdx === currentIndex;
                const userAns = responses[q.id];
                const isAns = typeof userAns === 'number';
                const isRev = markedForReview.has(q.id);
                const isVis = visitedIds.has(q.id);

                let btnStyle =
                  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700';

                if (isSolutionsMode) {
                  if (isAns && userAns === q.correctIndex) {
                    btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                  } else if (isAns) {
                    btnStyle = 'bg-red-600 text-white border-red-700';
                  }
                } else {
                  if (isAns && isRev) {
                    btnStyle = 'bg-amber-600 text-white border-amber-700';
                  } else if (isAns) {
                    btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                  } else if (isRev) {
                    btnStyle = 'bg-amber-500 text-white border-amber-600';
                  } else if (isVis) {
                    btnStyle = 'bg-red-600 text-white border-red-700';
                  }
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIndex(globalIdx)}
                    className={`h-9 rounded-md font-mono text-xs font-bold border transition-all flex items-center justify-center cursor-pointer ${btnStyle} ${
                      isCurrent
                        ? 'ring-2 ring-slate-950 dark:ring-white ring-offset-1 dark:ring-offset-slate-900'
                        : ''
                    }`}
                  >
                    {localIdx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
            {!isSolutionsMode && activeSectionIndex < orderedSections.length - 1 && (
              <button
                type="button"
                onClick={() => setShowLockSectionConfirm(true)}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  Lock {currentSection?.shortLabel || 'Section'} &amp; Next Section
                </span>
              </button>
            )}

            {!isSolutionsMode ? (
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="w-full py-2.5 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit Test</span>
              </button>
            ) : (
              onReattemptMock && (
                <button
                  type="button"
                  disabled={reattemptBusy}
                  onClick={handleTriggerReattemptFromMockScreen}
                  className="w-full py-2.5 px-3 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-950 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{reattemptBusy ? 'Starting Reattempt...' : 'Reattempt This Mock Paper'}</span>
                </button>
              )
            )}
          </div>
        </aside>
      </div>

      {/* Mobile Slide-Up Question Palette Drawer (< lg screens) */}
      {showMobilePalette && (
        <div className="fixed inset-0 z-50 lg:hidden bg-slate-950/60 dark:bg-black/75 flex flex-col justify-end">
          <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {currentSection?.label} — Question Palette
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Section {activeSectionIndex + 1} of {orderedSections.length} · Tap a question
                  number to jump
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMobilePalette(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-5 sm:grid-cols-8 gap-2.5">
              {currentSectionIndices.map((globalIdx, localIdx) => {
                const q = questions[globalIdx];
                if (!q) return null;
                const isCurrent = globalIdx === currentIndex;
                const userAns = responses[q.id];
                const isAns = typeof userAns === 'number';
                const isRev = markedForReview.has(q.id);
                const isVis = visitedIds.has(q.id);

                let btnStyle =
                  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700';
                if (isSolutionsMode) {
                  if (isAns && userAns === q.correctIndex) {
                    btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                  } else if (isAns) {
                    btnStyle = 'bg-red-600 text-white border-red-700';
                  }
                } else {
                  if (isAns && isRev) {
                    btnStyle = 'bg-amber-600 text-white border-amber-700';
                  } else if (isAns) {
                    btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                  } else if (isRev) {
                    btnStyle = 'bg-amber-500 text-white border-amber-600';
                  } else if (isVis) {
                    btnStyle = 'bg-red-600 text-white border-red-700';
                  }
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(globalIdx);
                      setShowMobilePalette(false);
                    }}
                    className={`h-10 rounded-lg font-mono text-xs font-bold border transition-all flex items-center justify-center cursor-pointer ${btnStyle} ${
                      isCurrent
                        ? 'ring-2 ring-slate-950 dark:ring-white ring-offset-1 dark:ring-offset-slate-900'
                        : ''
                    }`}
                  >
                    {localIdx + 1}
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900">
              {!isSolutionsMode && activeSectionIndex < orderedSections.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobilePalette(false);
                    setShowLockSectionConfirm(true);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Section &amp; Next Section →</span>
                </button>
              ) : !isSolutionsMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobilePalette(false);
                    setShowSubmitConfirm(true);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Test</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowMobilePalette(false)}
                className="py-2.5 px-4 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lock Current Section Confirmation Modal */}
      {showLockSectionConfirm && currentSection && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 sm:p-6 shadow-xl space-y-5">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Lock Current Section &amp; Proceed?
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  You are about to lock <strong>{currentSection.label}</strong> and proceed to{' '}
                  <strong>
                    {orderedSections[activeSectionIndex + 1]?.label || 'Next Section'}
                  </strong>
                  . Under DSSSB examination rules, you cannot return to this section once locked.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowLockSectionConfirm(false)}
                className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Stay in Section
              </button>
              <button
                type="button"
                onClick={handleConfirmLockCurrentSection}
                className="w-full sm:w-auto px-5 py-2.5 sm:py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-950 cursor-pointer"
              >
                Yes, Lock &amp; Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Submission Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 sm:p-6 shadow-xl space-y-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Confirm Final Examination Submission
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                Candidate: {candidateName} ({candidateEmail})
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5 p-3.5 sm:p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center">
              <div>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                  Answered
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400">
                  {paletteStats.answered}
                </div>
              </div>
              <div>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                  Unattempted
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-slate-800 dark:text-slate-200">
                  {paletteStats.unattemptedTotal}
                </div>
              </div>
              <div>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                  Marked
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-amber-700 dark:text-amber-400">
                  {paletteStats.markedOnly + paletteStats.answeredAndMarked}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Once submitted, your answers are evaluated immediately and you can review detailed
              explanations or reattempt the paper anytime.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitConfirm(false)}
                className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Resume Test
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => triggerFinalSubmit()}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-200 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{submitting ? 'Evaluating...' : 'Submit Final Attempt'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
