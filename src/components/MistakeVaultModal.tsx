import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Filter,
  HelpCircle,
  RotateCcw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { ExamAttempt, MockBlueprint, PublicQuestion, SubjectSlug } from '../types/mockrank';
import { fetchMockPaperSingleReadCached } from '../lib/firestoreService';
import { fetchExamPaperSafe } from '../lib/clientExamEngine';

interface MistakeVaultModalProps {
  completedAttempts: ExamAttempt[];
  blueprints: MockBlueprint[];
  startDateIST: string;
  onBackToDashboard: () => void;
  onBackToMocks: () => void;
  onOpenMockSolutions: (bp: MockBlueprint) => void;
}

interface MistakeItem {
  uniqueKey: string;
  mockId: string;
  mockTitle: string;
  dayNumber: number;
  questionNumber: number;
  question: PublicQuestion;
  status: 'wrong' | 'unattempted';
  userSelectedOption?: number;
  correctOption: number;
  submittedAt: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

const SUBJECT_LABELS: Record<SubjectSlug, string> = {
  'general-awareness': 'General Awareness',
  reasoning: 'Reasoning',
  mathematics: 'Mathematics',
  hindi: 'Hindi',
  english: 'English',
  'computer-science': 'Computer Science',
  'teaching-methodology': 'Teaching Methodology',
};

const MASTERED_STORAGE_KEY = 'mockrank_mistake_vault_mastered_v1';

export const MistakeVaultModal: React.FC<MistakeVaultModalProps> = ({
  completedAttempts,
  blueprints,
  startDateIST,
  onBackToDashboard,
  onBackToMocks,
  onOpenMockSolutions,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [papersByMockId, setPapersByMockId] = useState<Record<string, PublicQuestion[]>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'wrong' | 'unattempted'>('all');
  const [selectedMockFilter, setSelectedMockFilter] = useState<string>('all');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hideMastered, setHideMastered] = useState<boolean>(false);
  const [practiceMode, setPracticeMode] = useState<boolean>(true);

  // Interactive practice selection state per mistake item
  const [practiceSelections, setPracticeSelections] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [masteredKeys, setMasteredKeys] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(MASTERED_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const toggleMastered = (uniqueKey: string) => {
    setMasteredKeys((prev) => {
      const next = { ...prev, [uniqueKey]: !prev[uniqueKey] };
      try {
        localStorage.setItem(MASTERED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };

  // Load questions for all completed attempts (always pulling latest published answer key)
  useEffect(() => {
    let cancelled = false;
    const loadAllAttemptedMockPapers = async () => {
      if (completedAttempts.length === 0) {
        setPapersByMockId({});
        setLoading(false);
        return;
      }

      setLoading(true);
      const nextPapers: Record<string, PublicQuestion[]> = {};

      for (const att of completedAttempts) {
        if (nextPapers[att.mockId]) continue;
        const bp = blueprints.find((b) => b.mockId === att.mockId);
        try {
          const synced = await fetchMockPaperSingleReadCached(att.mockId, false);
          if (synced && synced.questions.length > 0) {
            nextPapers[att.mockId] = synced.questions;
            continue;
          }
          if (bp) {
            const fallbackPaper = await fetchExamPaperSafe({
              dayNumber: bp.dayNumber || att.dayNumber || 1,
              startDateIST,
              isPaused: false,
              blueprintOverride: bp,
              isAdminPreview: true,
            });
            nextPapers[att.mockId] = fallbackPaper.questions;
          } else {
            nextPapers[att.mockId] = [];
          }
        } catch {
          nextPapers[att.mockId] = [];
        }
      }

      if (!cancelled) {
        setPapersByMockId(nextPapers);
        setLoading(false);
      }
    };

    loadAllAttemptedMockPapers();
    return () => {
      cancelled = true;
    };
  }, [completedAttempts, blueprints, startDateIST]);

  // Build Mistake Vault items (Wrong + Not Attempted questions)
  const allMistakeItems = useMemo<MistakeItem[]>(() => {
    const list: MistakeItem[] = [];
    for (const att of completedAttempts) {
      const questions = papersByMockId[att.mockId] || [];
      if (questions.length === 0) continue;

      const bp = blueprints.find((b) => b.mockId === att.mockId);
      const mockTitle = bp?.title || `DSSSB Mock - ${att.mockId}`;

      questions.forEach((q, idx) => {
        const userAns = att.responses?.[q.id];
        const correctIdx =
          typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3
            ? q.correctIndex
            : 0;

        if (typeof userAns !== 'number') {
          list.push({
            uniqueKey: `${att.mockId}__${q.id}`,
            mockId: att.mockId,
            mockTitle,
            dayNumber: att.dayNumber,
            questionNumber: idx + 1,
            question: q,
            status: 'unattempted',
            userSelectedOption: undefined,
            correctOption: correctIdx,
            submittedAt: att.submittedAt || att.startedAt,
          });
        } else if (userAns !== correctIdx) {
          list.push({
            uniqueKey: `${att.mockId}__${q.id}`,
            mockId: att.mockId,
            mockTitle,
            dayNumber: att.dayNumber,
            questionNumber: idx + 1,
            question: q,
            status: 'wrong',
            userSelectedOption: userAns,
            correctOption: correctIdx,
            submittedAt: att.submittedAt || att.startedAt,
          });
        }
      });
    }
    return list;
  }, [completedAttempts, papersByMockId, blueprints]);

  const wrongCount = useMemo(
    () => allMistakeItems.filter((m) => m.status === 'wrong').length,
    [allMistakeItems]
  );
  const unattemptedCount = useMemo(
    () => allMistakeItems.filter((m) => m.status === 'unattempted').length,
    [allMistakeItems]
  );
  const masteredCount = useMemo(
    () => allMistakeItems.filter((m) => Boolean(masteredKeys[m.uniqueKey])).length,
    [allMistakeItems, masteredKeys]
  );

  const filteredMistakes = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase();
    return allMistakeItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (selectedMockFilter !== 'all' && item.mockId !== selectedMockFilter) return false;
      if (
        selectedSubjectFilter !== 'all' &&
        item.question.subject !== selectedSubjectFilter
      ) {
        return false;
      }
      if (hideMastered && masteredKeys[item.uniqueKey]) return false;

      if (qLower) {
        const hay = `${item.question.question} ${item.question.topic || ''} ${
          item.question.options.join(' ')
        } ${item.mockTitle}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [
    allMistakeItems,
    statusFilter,
    selectedMockFilter,
    selectedSubjectFilter,
    hideMastered,
    masteredKeys,
    searchQuery,
  ]);

  const attemptedMockOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { mockId: string; title: string }[] = [];
    for (const att of completedAttempts) {
      if (seen.has(att.mockId)) continue;
      seen.add(att.mockId);
      const bp = blueprints.find((b) => b.mockId === att.mockId);
      opts.push({
        mockId: att.mockId,
        title: bp?.title || `DSSSB Mock (${att.mockId})`,
      });
    }
    return opts;
  }, [completedAttempts, blueprints]);

  return (
    <div className="space-y-6">
      {/* Top Navigation & Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-mono font-semibold text-rose-600 dark:text-rose-400">
              Mistake Vault
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-950 dark:text-white">
            Mistake Vault — Wrong &amp; Not Attempted Questions
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Automatically stores all incorrect and unattempted questions from your completed mocks,
            synced with the latest official answer key.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPracticeMode((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              practiceMode
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-slate-900 dark:border-white'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {practiceMode ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Practice Mode: ON (Click Option to Test)</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Show All Answers &amp; Explanations</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onBackToMocks}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
          >
            Go to Mocks →
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
            statusFilter === 'all'
              ? 'border-slate-900 dark:border-white bg-slate-900/5 dark:bg-slate-900'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Vault Questions</div>
          <div className="text-2xl font-bold font-mono text-slate-950 dark:text-white mt-1">
            {allMistakeItems.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Wrong + Not Attempted
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('wrong')}
          className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
            statusFilter === 'wrong'
              ? 'border-rose-600 dark:border-rose-400 bg-rose-50/50 dark:bg-rose-950/30'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-rose-700 dark:text-rose-400 font-semibold">
            <span>Wrong Questions</span>
            <XCircle className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-700 dark:text-rose-400 mt-1">
            {wrongCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Negative marking impact
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('unattempted')}
          className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
            statusFilter === 'unattempted'
              ? 'border-amber-600 dark:border-amber-400 bg-amber-50/50 dark:bg-amber-950/30'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-400 font-semibold">
            <span>Not Attempted</span>
            <HelpCircle className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1">
            {unattemptedCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Skipped during mocks
          </div>
        </button>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
            <span>Mastered in Vault</span>
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
            {masteredCount}
          </div>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 mt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideMastered}
              onChange={(e) => setHideMastered(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>Hide mastered questions</span>
          </label>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search question text or topic..."
              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-950 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`flex-1 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All ({allMistakeItems.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('wrong')}
              className={`flex-1 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                statusFilter === 'wrong'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Wrong ({wrongCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unattempted')}
              className={`flex-1 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                statusFilter === 'unattempted'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Skipped ({unattemptedCount})
            </button>
          </div>

          {/* Mock Filter */}
          <select
            value={selectedMockFilter}
            onChange={(e) => setSelectedMockFilter(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Attempted Mocks ({attemptedMockOptions.length})</option>
            {attemptedMockOptions.map((m) => (
              <option key={m.mockId} value={m.mockId}>
                {m.title}
              </option>
            ))}
          </select>

          {/* Subject Filter */}
          <select
            value={selectedSubjectFilter}
            onChange={(e) => setSelectedSubjectFilter(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All 7 DSSSB Subjects</option>
            {(Object.keys(SUBJECT_LABELS) as SubjectSlug[]).map((slug) => (
              <option key={slug} value={slug}>
                {SUBJECT_LABELS[slug]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            <span>
              Showing <strong>{filteredMistakes.length}</strong> of{' '}
              <strong>{allMistakeItems.length}</strong> questions in Mistake Vault
            </span>
          </div>

          {(Object.keys(practiceSelections).length > 0 ||
            Object.keys(revealedKeys).length > 0) && (
            <button
              type="button"
              onClick={() => {
                setPracticeSelections({});
                setRevealedKeys({});
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Practice Selections</span>
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="p-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500 dark:text-slate-400">
          Loading your Mistake Vault across completed mocks...
        </div>
      ) : completedAttempts.length === 0 ? (
        <div className="p-12 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <div className="text-base font-bold text-slate-900 dark:text-white">
            No Completed Mock Attempts Yet
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            As soon as you complete a mock test, any wrong or unattempted questions will
            automatically appear here in your Mistake Vault for targeted revision.
          </p>
          <button
            type="button"
            onClick={onBackToMocks}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white rounded-lg cursor-pointer"
          >
            <span>Attempt Your First Mock Test →</span>
          </button>
        </div>
      ) : filteredMistakes.length === 0 ? (
        <div className="p-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <div className="text-sm font-bold text-slate-900 dark:text-white">
            No Matching Questions Found
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Try clearing your search or switching the status/subject filter above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMistakes.map((item) => {
            const isRevealed =
              !practiceMode ||
              Boolean(revealedKeys[item.uniqueKey]) ||
              typeof practiceSelections[item.uniqueKey] === 'number';
            const practiceChoice = practiceSelections[item.uniqueKey];
            const isMastered = Boolean(masteredKeys[item.uniqueKey]);
            const bp = blueprints.find((b) => b.mockId === item.mockId);

            return (
              <div
                key={item.uniqueKey}
                className={`p-4 sm:p-5 rounded-xl border transition-colors space-y-4 ${
                  isMastered
                    ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20 dark:bg-emerald-950/10'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                {/* Top Metadata Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded font-mono font-bold ${
                        item.status === 'wrong'
                          ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                          : 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {item.status === 'wrong' ? (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          <span>
                            WRONG (You Marked:{' '}
                            {OPTION_LETTERS[item.userSelectedOption ?? 0] || '?'})
                          </span>
                        </>
                      ) : (
                        <>
                          <HelpCircle className="w-3.5 h-3.5" />
                          <span>NOT ATTEMPTED</span>
                        </>
                      )}
                    </span>

                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                      {item.mockTitle} · Q#{item.questionNumber}
                    </span>

                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                      {SUBJECT_LABELS[item.question.subject] || item.question.subject}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleMastered(item.uniqueKey)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                        isMastered
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{isMastered ? 'Mastered' : 'Mark Mastered'}</span>
                    </button>

                    {bp && (
                      <button
                        type="button"
                        onClick={() => onOpenMockSolutions(bp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                        title="Open full mock paper in Solutions mode"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>Open Paper</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Question Stem */}
                <div className="text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed">
                  {item.question.question}
                </div>

                {/* Options Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {item.question.options.map((optText, optIdx) => {
                    const isCorrectOption = optIdx === item.correctOption;
                    const isPracticePicked = practiceChoice === optIdx;
                    const isOriginalWrongPick =
                      item.status === 'wrong' && item.userSelectedOption === optIdx;

                    let cardStyle =
                      'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600';

                    if (isRevealed) {
                      if (isCorrectOption) {
                        cardStyle =
                          'border-emerald-500 dark:border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-100 font-semibold';
                      } else if (isPracticePicked || isOriginalWrongPick) {
                        cardStyle =
                          'border-rose-400 dark:border-rose-600 bg-rose-50/70 dark:bg-rose-950/40 text-rose-950 dark:text-rose-200';
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => {
                          setPracticeSelections((prev) => ({
                            ...prev,
                            [item.uniqueKey]: optIdx,
                          }));
                          setRevealedKeys((prev) => ({
                            ...prev,
                            [item.uniqueKey]: true,
                          }));
                        }}
                        className={`p-3 rounded-lg border text-left text-xs sm:text-sm flex items-start justify-between gap-2.5 transition-all cursor-pointer ${cardStyle}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                              isRevealed && isCorrectOption
                                ? 'bg-emerald-600 text-white'
                                : isRevealed && (isPracticePicked || isOriginalWrongPick)
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {OPTION_LETTERS[optIdx]}
                          </span>
                          <span className="leading-snug">{optText}</span>
                        </div>

                        {isRevealed && (
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            {isCorrectOption && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-600 text-white">
                                Correct Answer
                              </span>
                            )}
                            {!isCorrectOption && isOriginalWrongPick && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-100 dark:bg-rose-900/70 text-rose-800 dark:text-rose-200">
                                Exam Pick
                              </span>
                            )}
                            {!isCorrectOption &&
                              isPracticePicked &&
                              practiceChoice !== item.userSelectedOption && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-600 text-white">
                                  Try Again
                                </span>
                              )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Reveal / Explanation Footer */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  {!isRevealed ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedKeys((prev) => ({
                          ...prev,
                          [item.uniqueKey]: true,
                        }))
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white underline cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Reveal Correct Answer &amp; Explanation</span>
                    </button>
                  ) : (
                    <div className="w-full p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono font-bold text-emerald-900 dark:text-emerald-300">
                        <span>
                          Official Correct Answer: Option {OPTION_LETTERS[item.correctOption]}
                        </span>
                        {typeof practiceChoice === 'number' && (
                          <span
                            className={
                              practiceChoice === item.correctOption
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {practiceChoice === item.correctOption
                              ? '✓ Solved Correctly in Practice!'
                              : '✗ Incorrect Practice Pick'}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                        {item.question.explanation ||
                          `Option (${OPTION_LETTERS[item.correctOption]}) "${
                            item.question.options[item.correctOption] || ''
                          }" is the verified correct answer as per the official DSSSB answer key.`}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
