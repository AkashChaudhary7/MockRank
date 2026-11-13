import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  Lock,
  Maximize2,
  Moon,
  Send,
  Sun,
  Type,
  X,
} from 'lucide-react';
import {
  ExamAttempt,
  PublicQuestion,
  SectionBlueprint,
  SubjectSlug,
} from '../types/mockrank';

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
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  onAutosave: (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number
  ) => Promise<void>;
  onSubmitFinal: (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number,
    autoSubmitReason?: string
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
  darkMode,
  onToggleDarkMode,
  onAutosave,
  onSubmitFinal,
  onExitWithoutSubmit,
}) => {
  const [instructionsAccepted, setInstructionsAccepted] = useState<boolean>(
    Object.keys(attempt.responses || {}).length > 0 || (attempt.timeTakenSeconds || 0) > 10
  );
  const [declarationChecked, setDeclarationChecked] = useState<boolean>(false);

  // Mobile-First UI Scale ('compact' by default on mobile viewports < 640px so question + 4 options fit without scrolling)
  const [uiScale, setUiScale] = useState<MockUiScale>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return 'compact';
    }
    return 'standard';
  });
  const [showMobilePalette, setShowMobilePalette] = useState<boolean>(false);

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

  // Authoritative remaining timer derived from attempt.expiresAt
  const computeRemainingSeconds = useCallback(() => {
    const expiryMs = new Date(attempt.expiresAt).getTime();
    const nowMs = Date.now();
    const diffSec = Math.floor((expiryMs - nowMs) / 1000);
    if (Number.isNaN(diffSec)) return durationMinutes * 60;
    return Math.max(0, Math.min(durationMinutes * 60, diffSec));
  }, [attempt.expiresAt, durationMinutes]);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(computeRemainingSeconds);

  // Per-Question 60-Second Timer (DSSSB Rule: 1-minute limit on any question except Mathematics & Reasoning)
  const [questionSeconds, setQuestionSeconds] = useState<number>(0);

  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [autosaveState, setAutosaveState] = useState<'saved' | 'saving'>('saved');

  const submittedRef = useRef<boolean>(false);
  const responsesRef = useRef(responses);
  const reviewRef = useRef(markedForReview);
  const remainingRef = useRef(remainingSeconds);

  responsesRef.current = responses;
  reviewRef.current = markedForReview;
  remainingRef.current = remainingSeconds;

  const currentQuestion = questions[currentIndex];
  const isMathsOrReasoning =
    currentQuestion?.subject === 'mathematics' || currentQuestion?.subject === 'reasoning';

  // Reset per-question timer whenever the active question changes
  useEffect(() => {
    setQuestionSeconds(0);
  }, [currentIndex]);

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

  // Restore local backup if newer
  useEffect(() => {
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
      }
    } catch {
      // Ignore local storage errors
    }
  }, [localBackupKey]);

  // Save to localStorage on every response or review update
  useEffect(() => {
    if (!instructionsAccepted) return;
    try {
      localStorage.setItem(
        localBackupKey,
        JSON.stringify({
          responses,
          markedForReview: Array.from(markedForReview),
          updatedAt: Date.now(),
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [responses, markedForReview, instructionsAccepted, localBackupKey]);

  const triggerFinalSubmit = useCallback(
    async (autoReason?: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      const totalAllocated = durationMinutes * 60;
      const timeTaken = Math.max(1, totalAllocated - remainingRef.current);

      try {
        localStorage.removeItem(localBackupKey);
      } catch {
        // Ignore
      }

      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      await onSubmitFinal(
        responsesRef.current,
        Array.from(reviewRef.current),
        timeTaken,
        autoReason
      );
    },
    [durationMinutes, localBackupKey, onSubmitFinal]
  );

  // 1-second authoritative exam countdown + per-question 60s timer
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current) return;

    const timer = window.setInterval(() => {
      const nextRem = computeRemainingSeconds();
      setRemainingSeconds(nextRem);
      if (nextRem <= 0) {
        window.clearInterval(timer);
        triggerFinalSubmit('Time expired (00:00). Examination auto-submitted.');
        return;
      }

      setQuestionSeconds((prevSec) => {
        const nextQSec = prevSec + 1;
        if (!isMathsOrReasoning && nextQSec >= 60) {
          window.clearInterval(timer);
          triggerFinalSubmit(
            `DSSSB 1-Minute Question Rule: You spent 60 seconds on a single question in ${
              currentSection?.label || 'this section'
            } (outside Mathematics & Reasoning). Exam submitted immediately.`
          );
        }
        return nextQSec;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    computeRemainingSeconds,
    currentSection?.label,
    instructionsAccepted,
    isMathsOrReasoning,
    triggerFinalSubmit,
  ]);

  // Periodic Firestore autosave every 25 seconds
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current) return;

    const interval = window.setInterval(async () => {
      setAutosaveState('saving');
      const totalAllocated = durationMinutes * 60;
      const timeTaken = Math.max(1, totalAllocated - remainingRef.current);
      try {
        await onAutosave(
          responsesRef.current,
          Array.from(reviewRef.current),
          timeTaken
        );
      } finally {
        setAutosaveState('saved');
      }
    }, 25000);

    return () => window.clearInterval(interval);
  }, [durationMinutes, instructionsAccepted, onAutosave]);

  // DSSSB Anti-Cheating Rule: Immediate Exam Submit on Screen / Window Resize
  useEffect(() => {
    if (!instructionsAccepted || submittedRef.current) return;

    let baselineWidth = window.innerWidth;
    let baselineHeight = window.innerHeight;
    let resizeGuardArmed = false;

    const armTimer = window.setTimeout(() => {
      baselineWidth = window.innerWidth;
      baselineHeight = window.innerHeight;
      resizeGuardArmed = true;
    }, 1500);

    const handleFullscreenChange = () => {
      resizeGuardArmed = false;
      window.setTimeout(() => {
        baselineWidth = window.innerWidth;
        baselineHeight = window.innerHeight;
        resizeGuardArmed = true;
      }, 600);
    };

    const handleResize = () => {
      if (!resizeGuardArmed || submittedRef.current) return;
      const deltaW = Math.abs(window.innerWidth - baselineWidth);
      const deltaH = Math.abs(window.innerHeight - baselineHeight);
      const isTouchMobile = window.innerWidth < 768;

      // On mobile browsers, vertical URL bar auto-hiding shifts innerHeight by ~50-90px;
      // any width change (split-screen/rotation/window resize) or major height change (>140px on mobile, >15px on desktop) triggers immediate submit
      if (deltaW > 15 || (!isTouchMobile && deltaH > 15) || (isTouchMobile && deltaH > 140)) {
        triggerFinalSubmit(
          'DSSSB Anti-Cheating Rule: Screen/Window resize detected during active examination. Exam auto-submitted immediately.'
        );
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleVisibilityChange = () => {
      if (document.hidden && !submittedRef.current) {
        setWarningBanner(
          'Warning: Switching tabs or minimizing the window is strictly monitored.'
        );
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [instructionsAccepted, triggerFinalSubmit]);

  const requestExamFullscreen = () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleStartExamSession = () => {
    if (!declarationChecked) return;
    requestExamFullscreen();
    setInstructionsAccepted(true);
  };

  const handleSelectOption = (optionIdx: number) => {
    if (!currentQuestion) return;
    if (lockedSections.has(currentQuestion.subject as SubjectSlug)) return;
    setResponses((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIdx,
    }));
  };

  const handleClearResponse = () => {
    if (!currentQuestion) return;
    if (lockedSections.has(currentQuestion.subject as SubjectSlug)) return;
    setResponses((prev) => {
      const next = { ...prev };
      delete next[currentQuestion.id];
      return next;
    });
  };

  const handleToggleMarkForReview = () => {
    if (!currentQuestion) return;
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

  // Navigate only within the currently active unlocked section
  const posInCurrentSection = currentSectionIndices.indexOf(currentIndex);
  const hasPrevInSection = posInCurrentSection > 0;
  const hasNextInSection =
    posInCurrentSection >= 0 && posInCurrentSection < currentSectionIndices.length - 1;

  const handlePrevInSection = () => {
    if (hasPrevInSection) {
      setCurrentIndex(currentSectionIndices[posInCurrentSection - 1]);
    }
  };

  const handleSaveAndNextInSection = () => {
    if (hasNextInSection) {
      setCurrentIndex(currentSectionIndices[posInCurrentSection + 1]);
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

    for (const q of questions) {
      const isAns = typeof responses[q.id] === 'number';
      const isRev = markedForReview.has(q.id);
      const isVis = visitedIds.has(q.id);

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

  // Dynamic Scale Classes for Question Stem & Options so Mock Format Scales Perfectly on Mobile
  const questionStemScaleClass =
    uiScale === 'compact'
      ? 'py-3 sm:py-5 text-sm sm:text-base leading-snug sm:leading-relaxed'
      : uiScale === 'large'
      ? 'py-4 sm:py-6 text-base sm:text-xl leading-relaxed'
      : 'py-3.5 sm:py-6 text-[15px] sm:text-lg leading-relaxed';

  const optionCardScaleClass =
    uiScale === 'compact'
      ? 'p-2.5 sm:p-3.5 rounded-lg sm:rounded-xl gap-2.5 sm:gap-3'
      : uiScale === 'large'
      ? 'p-3.5 sm:p-4 rounded-xl gap-3.5'
      : 'p-3 sm:p-4 rounded-xl gap-3';

  const optionTextScaleClass =
    uiScale === 'compact'
      ? 'text-xs sm:text-sm leading-snug sm:leading-relaxed'
      : uiScale === 'large'
      ? 'text-sm sm:text-lg leading-relaxed'
      : 'text-[13px] sm:text-base leading-relaxed';

  const optionBadgeScaleClass =
    uiScale === 'compact'
      ? 'w-6 h-6 sm:w-7 sm:h-7 text-[11px] sm:text-xs'
      : 'w-6 h-6 sm:w-7 sm:h-7 text-xs';

  // Pre-Exam Official Instructions Screen
  if (!instructionsAccepted) {
    return (
      <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col overflow-y-auto">
        <header className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 sm:py-4 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900">
          <div className="min-w-0">
            <div className="text-[11px] sm:text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
              DSSSB TGT CS · OFFICIAL CBT TERMINAL ({mockId})
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
                {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
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
              Strict DSSSB Examination Pattern &amp; Anti-Cheating Rules
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Sequential Section Locking (DSSSB Pattern):</strong> Sections are attempted
                one by one in strict sequence. To move to the next section, click{' '}
                <strong>&ldquo;Lock Section &amp; Next Section&rdquo;</strong>. Once locked, you
                cannot return to that section.
              </li>
              <li>
                <strong>Screen / Window Resize Immediate Auto-Submit:</strong> Do{' '}
                <strong>NOT</strong> resize the browser window, split-screen, or rotate screen
                dimensions during the exam. Any resize immediately submits your exam.
              </li>
              <li>
                <strong>1-Minute Per-Question Rule (Except Maths &amp; Reasoning):</strong> Apart
                from <strong>Mathematics</strong> and <strong>Reasoning</strong> sections, spending{' '}
                <strong>1 minute (60 seconds)</strong> on a single question immediately
                auto-submits the exam.
              </li>
              <li>
                <strong>Mobile-Scaled CBT Interface:</strong> Use the <strong>A-/A/A+</strong> scale
                button in the top bar anytime to fit long questions comfortably on your mobile
                screen, and tap <strong>Palette</strong> to jump between questions in the active
                section.
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
                I have read and understood the DSSSB sequential section-locking rule, the 1-minute
                per-question limit (excluding Mathematics &amp; Reasoning), and the immediate
                auto-submit rule upon screen resizing.
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
              Launch DSSSB CBT Terminal →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col select-none overflow-hidden">
      {/* Top CBT Header Bar — Scaled for Mobile & Desktop */}
      <header className="min-h-12 py-1.5 px-2.5 sm:px-5 border-b border-slate-800 flex items-center justify-between gap-1.5 sm:gap-3 bg-slate-950 text-white shrink-0">
        {/* Left: Mock Identifier & Title */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden xs:inline-block px-1.5 py-0.5 text-[10px] sm:text-xs font-mono font-semibold bg-slate-800 text-slate-200 rounded border border-slate-700 shrink-0">
            {mockId}
          </span>
          <h1 className="text-xs sm:text-sm font-semibold truncate max-w-[110px] xs:max-w-[150px] sm:max-w-xs md:max-w-md">
            {title}
          </h1>
        </div>

        {/* Right: Scale Control + Theme + Per-Q Timer + Main Timer + Submit */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Mobile & Desktop Font/Format Scale Button (Compact / Standard / Large) */}
          <button
            type="button"
            onClick={cycleUiScale}
            title="Scale Mock Question & Option Format for Screen"
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

          {/* Per-Question 60s Rule Badge (Compact on Mobile, Detailed on Desktop) */}
          <div
            className={`px-2 py-1 rounded border font-mono text-[11px] sm:text-xs font-bold flex items-center gap-1 ${
              isMathsOrReasoning
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                : questionSeconds >= 45
                ? 'bg-red-900/90 border-red-500 text-red-100 animate-pulse'
                : 'bg-slate-900 border-slate-700 text-amber-300'
            }`}
            title={
              isMathsOrReasoning
                ? 'Mathematics & Reasoning are exempt from the 60-second per-question limit'
                : 'DSSSB Rule: Max 60 seconds allowed on any question outside Maths & Reasoning'
            }
          >
            <Clock className="w-3 h-3 hidden sm:inline" />
            <span className="sm:hidden">
              {isMathsOrReasoning
                ? `M/R:${questionSeconds}s`
                : `Q:${Math.max(0, 60 - questionSeconds)}s`}
            </span>
            <span className="hidden sm:inline">
              {isMathsOrReasoning
                ? `Maths/Reasoning (${questionSeconds}s)`
                : `Q Limit: ${Math.max(0, 60 - questionSeconds)}s`}
            </span>
          </div>

          {/* Main Exam Countdown Clock */}
          <div
            className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded font-mono text-xs sm:text-sm font-bold border ${
              remainingSeconds < 300
                ? 'bg-red-950 text-red-200 border-red-800'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-slate-400 hidden xs:inline" />
            <span>{formatClock(remainingSeconds)}</span>
          </div>

          {/* Submit Exam Button */}
          <button
            type="button"
            onClick={() => setShowSubmitConfirm(true)}
            className="flex items-center gap-1 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
          >
            <Send className="w-3 h-3" />
            <span className="hidden sm:inline">Submit Exam</span>
            <span className="sm:hidden">Submit</span>
          </button>
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

      {/* DSSSB Sequential Section Bar (Compact & Scrollable on Mobile) */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          {orderedSections.map((sec, idx) => {
            const isCurrentSection = idx === activeSectionIndex;
            const isLocked = lockedSections.has(sec.subject) || idx < activeSectionIndex;

            return (
              <button
                key={sec.subject}
                type="button"
                onClick={() => {
                  if (idx === activeSectionIndex) return;
                  if (idx < activeSectionIndex || isLocked) {
                    setSectionLockNotice(
                      `Section "${sec.label}" is locked. DSSSB pattern does not allow revisiting locked sections.`
                    );
                  } else {
                    setSectionLockNotice(
                      `Section "${sec.label}" is locked. Click "Lock & Next" after finishing "${currentSection?.shortLabel}" to unlock it.`
                    );
                  }
                }}
                className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                  isCurrentSection
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 shadow-2xs'
                    : isLocked
                    ? 'bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                }`}
              >
                {!isCurrentSection && <Lock className="w-2.5 h-2.5 opacity-75 shrink-0" />}
                <span className="sm:hidden">
                  {idx + 1}. {sec.shortLabel} ({sec.questionCount})
                </span>
                <span className="hidden sm:inline">
                  {idx + 1}. {sec.label} ({sec.questionCount})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeSectionIndex < orderedSections.length - 1 && (
            <button
              type="button"
              onClick={() => setShowLockSectionConfirm(true)}
              className="px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3 h-3" />
              <span className="hidden sm:inline">Lock Section &amp; Next →</span>
              <span className="sm:hidden">Lock &amp; Next</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Horizontal Quick-Jump Question Strip (< lg only) */}
      <div className="lg:hidden border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1">
          {currentSectionIndices.map((globalIdx, localIdx) => {
            const q = questions[globalIdx];
            if (!q) return null;
            const isCurrent = globalIdx === currentIndex;
            const isAns = typeof responses[q.id] === 'number';
            const isRev = markedForReview.has(q.id);
            const isVis = visitedIds.has(q.id);

            let pillStyle =
              'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';
            if (isAns && isRev) {
              pillStyle = 'bg-amber-600 text-white border-amber-700';
            } else if (isAns) {
              pillStyle = 'bg-emerald-600 text-white border-emerald-700';
            } else if (isRev) {
              pillStyle = 'bg-amber-500 text-white border-amber-600';
            } else if (isVis) {
              pillStyle = 'bg-red-600 text-white border-red-700';
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
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shrink-0 cursor-pointer"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>
            {paletteStats.sectionAnswered}/{currentSection?.questionCount || 0}
          </span>
        </button>
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Active Question Area (Full Height on Mobile!) */}
        <div className="flex-1 flex flex-col overflow-y-auto px-3.5 py-3 sm:p-6 lg:p-8 bg-white dark:bg-slate-950">
          {currentQuestion ? (
            <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col">
              {/* Question Metadata Header */}
              <div className="flex items-center justify-between gap-2 pb-2.5 sm:pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                  <span className="text-xs sm:text-sm font-bold font-mono text-slate-900 dark:text-white">
                    Q.{posInCurrentSection + 1}/{currentSectionIndices.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
                    {currentSection?.shortLabel}
                  </span>
                  {currentQuestion.topic && (
                    <>
                      <span className="hidden sm:inline" aria-hidden="true">
                        ·
                      </span>
                      <span className="hidden sm:inline truncate">{currentQuestion.topic}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-mono shrink-0">
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    +{correctMarks.toFixed(2)}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700">/</span>
                  <span className="text-red-700 dark:text-red-400 font-semibold">
                    {incorrectMarks.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Question Stem (Scaled for Mobile & Desktop) */}
              <div
                className={`font-medium text-slate-900 dark:text-slate-100 select-text whitespace-pre-line ${questionStemScaleClass}`}
              >
                {currentQuestion.question}
              </div>

              {/* 4 Options (Scaled for Mobile & Desktop) */}
              <div className="space-y-2 sm:space-y-3 pb-4">
                {currentQuestion.options.map((optText, optIdx) => {
                  const isSelected = responses[currentQuestion.id] === optIdx;
                  const optionLetter = String.fromCharCode(65 + optIdx);

                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => handleSelectOption(optIdx)}
                      className={`w-full text-left border transition-all flex items-start cursor-pointer ${optionCardScaleClass} ${
                        isSelected
                          ? 'border-slate-900 dark:border-slate-200 bg-slate-900/5 dark:bg-slate-800/90 ring-1 ring-slate-900 dark:ring-slate-200'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <span
                        className={`rounded-md font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 border ${optionBadgeScaleClass} ${
                          isSelected
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 border-slate-900 dark:border-slate-100'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {optionLetter}
                      </span>
                      <span
                        className={`text-slate-800 dark:text-slate-200 flex-1 ${optionTextScaleClass}`}
                      >
                        {optText}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Sticky / Bottom Action Controls — Mobile-Ergonomic 2-Row on Phones, Single-Row on Tablet/Desktop */}
              <div className="mt-auto pt-3 sm:pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 bg-white dark:bg-slate-950">
                {/* Secondary Controls: Mark for Review & Clear Response */}
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleMarkForReview}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium border transition-colors cursor-pointer ${
                      markedForReview.has(currentQuestion.id)
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {markedForReview.has(currentQuestion.id) ? 'Marked Review' : 'Mark Review'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClearResponse}
                    disabled={typeof responses[currentQuestion.id] !== 'number'}
                    className="px-3 py-2 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-center"
                  >
                    Clear Answer
                  </button>
                </div>

                {/* Primary Navigation Controls: Previous & Save & Next */}
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrevInSection}
                    disabled={!hasPrevInSection}
                    className="flex items-center justify-center gap-1 px-3.5 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4 shrink-0" />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveAndNextInSection}
                    className="flex items-center justify-center gap-1 px-4 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
                  >
                    <span className="truncate">
                      {hasNextInSection
                        ? 'Save & Next'
                        : activeSectionIndex < orderedSections.length - 1
                        ? 'Lock & Next →'
                        : 'Review & Submit'}
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Desktop Question Palette Sidebar (lg+ screens) */}
        <aside className="hidden lg:flex w-80 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex-col shrink-0">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Active Section Palette ({currentSection?.questionCount || 0} Qs)
              </div>
              <button
                type="button"
                onClick={requestExamFullscreen}
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                title="Enter Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </button>
            </div>
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              {currentSection?.label} · Section {activeSectionIndex + 1} of{' '}
              {orderedSections.length}
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-xs pt-1">
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
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-5 gap-2">
              {currentSectionIndices.map((globalIdx, localIdx) => {
                const q = questions[globalIdx];
                if (!q) return null;
                const isCurrent = globalIdx === currentIndex;
                const isAns = typeof responses[q.id] === 'number';
                const isRev = markedForReview.has(q.id);
                const isVis = visitedIds.has(q.id);

                let btnStyle =
                  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700';
                if (isAns && isRev) {
                  btnStyle = 'bg-amber-600 text-white border-amber-700';
                } else if (isAns) {
                  btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                } else if (isRev) {
                  btnStyle = 'bg-amber-500 text-white border-amber-600';
                } else if (isVis) {
                  btnStyle = 'bg-red-600 text-white border-red-700';
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

          {activeSectionIndex < orderedSections.length - 1 && (
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setShowLockSectionConfirm(true)}
                className="w-full py-2.5 px-3 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-950 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  Lock {currentSection?.shortLabel || 'Section'} &amp; Go to Next Section
                </span>
              </button>
            </div>
          )}
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

            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-emerald-600 inline-block" />
                <span className="text-slate-700 dark:text-slate-300">
                  Answered ({paletteStats.answered})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-red-600 inline-block" />
                <span className="text-slate-700 dark:text-slate-300">
                  Not Answered ({paletteStats.notAnswered})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                <span className="text-slate-700 dark:text-slate-300">
                  Marked ({paletteStats.markedOnly + paletteStats.answeredAndMarked})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 inline-block" />
                <span className="text-slate-700 dark:text-slate-300">
                  Not Visited ({paletteStats.notVisited})
                </span>
              </div>
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-5 sm:grid-cols-8 gap-2.5">
              {currentSectionIndices.map((globalIdx, localIdx) => {
                const q = questions[globalIdx];
                if (!q) return null;
                const isCurrent = globalIdx === currentIndex;
                const isAns = typeof responses[q.id] === 'number';
                const isRev = markedForReview.has(q.id);
                const isVis = visitedIds.has(q.id);

                let btnStyle =
                  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700';
                if (isAns && isRev) {
                  btnStyle = 'bg-amber-600 text-white border-amber-700';
                } else if (isAns) {
                  btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                } else if (isRev) {
                  btnStyle = 'bg-amber-500 text-white border-amber-600';
                } else if (isVis) {
                  btnStyle = 'bg-red-600 text-white border-red-700';
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
              {activeSectionIndex < orderedSections.length - 1 ? (
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
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobilePalette(false);
                    setShowSubmitConfirm(true);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Exam</span>
                </button>
              )}
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
                  You are about to permanently lock{' '}
                  <strong>{currentSection.label}</strong> and unlock the next section:{' '}
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
                Stay in Current Section
              </button>
              <button
                type="button"
                onClick={handleConfirmLockCurrentSection}
                className="w-full sm:w-auto px-5 py-2.5 sm:py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-950 cursor-pointer"
              >
                Yes, Lock Section &amp; Continue →
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
              Once submitted, your answers are locked and evaluated immediately for official
              ranking.
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
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
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
