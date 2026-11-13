import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Lock,
  Share2,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  ExamAttempt,
  LeaderboardMockEntry,
  PublicQuestion,
  QuestionReviewItem,
  SectionScoreBreakdown,
} from '../types/mockrank';
import { fetchExamReviewSafe } from '../lib/clientExamEngine';

interface MockResultPageProps {
  attempt: ExamAttempt;
  candidateName?: string;
  mockTitle: string;
  maxMarks: number;
  answerReleasePolicy: 'after-submission' | 'after-challenge' | 'manual';
  startDateIST: string;
  isAdmin: boolean;
  mockLeaderboard: LeaderboardMockEntry[];
  overallAverageScore: number;
  overallRank: number | null;
  customQuestions?: PublicQuestion[];
  onBackToMocks: () => void;
  onBackToDashboard: () => void;
  onOpenLeaderboard: (mockId: string) => void;
}

export const MockResultModal: React.FC<MockResultPageProps> = ({
  attempt,
  candidateName,
  mockTitle,
  maxMarks,
  answerReleasePolicy,
  startDateIST,
  isAdmin,
  mockLeaderboard,
  overallAverageScore,
  overallRank,
  customQuestions,
  onBackToMocks,
  onBackToDashboard,
  onOpenLeaderboard,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'solutions'>('summary');
  const [reviewItems, setReviewItems] = useState<QuestionReviewItem[]>([]);
  const [loadingReview, setLoadingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copiedScoreText, setCopiedScoreText] = useState<boolean>(false);
  const [showShareTextPreview, setShowShareTextPreview] = useState<boolean>(false);

  const totalParticipants = Math.max(1, mockLeaderboard.length);
  const myMockEntry = mockLeaderboard.find((e) => e.uid === attempt.uid);
  const myMockRank = myMockEntry?.rank || 1;
  const avgParticipantScore =
    mockLeaderboard.length > 0
      ? Number(
          (
            mockLeaderboard.reduce((acc, item) => acc + item.score, 0) / mockLeaderboard.length
          ).toFixed(2)
        )
      : attempt.score;

  const sectionList: SectionScoreBreakdown[] = attempt.sectionScores
    ? Object.values(attempt.sectionScores)
    : [];

  const partAScore =
    typeof attempt.partAScore === 'number'
      ? attempt.partAScore
      : Number(
          sectionList
            .filter(
              (s) =>
                s.part === 'Part A' ||
                ['general-awareness', 'reasoning', 'mathematics', 'hindi', 'english'].includes(
                  s.subject
                )
            )
            .reduce((acc, s) => acc + s.score, 0)
            .toFixed(2)
        );

  const partBScore =
    typeof attempt.partBScore === 'number'
      ? attempt.partBScore
      : Number(
          sectionList
            .filter(
              (s) =>
                s.part === 'Part B' ||
                ['computer-science', 'teaching-methodology'].includes(s.subject)
            )
            .reduce((acc, s) => acc + s.score, 0)
            .toFixed(2)
        );

  const attemptUrl = `${window.location.origin}/?mock=${encodeURIComponent(attempt.mockId)}`;

  const formattedShareScoreText = [
    `🏆 MockRank — Official DSSSB Mock Score`,
    `Candidate: ${candidateName || 'Aspirant'}`,
    `Mock Test: ${mockTitle} (${attempt.mockId})`,
    `Total Score: ${attempt.score.toFixed(2)} / ${maxMarks.toFixed(0)}`,
    `Part A Score: ${partAScore.toFixed(2)} | Part B Score: ${partBScore.toFixed(2)}`,
    `Correct: ${attempt.correctAnswers} | Incorrect: ${attempt.incorrectAnswers} | Accuracy: ${attempt.accuracy.toFixed(1)}%`,
    `Rank in Mock: #${myMockRank} of ${totalParticipants}`,
    ``,
    `Attempt this Mock Test here:`,
    attemptUrl,
  ].join('\n');

  const handleShareScoreInTextFormat = async () => {
    try {
      await navigator.clipboard.writeText(formattedShareScoreText);
      setCopiedScoreText(true);
      setShowShareTextPreview(true);
      window.setTimeout(() => setCopiedScoreText(false), 3000);
    } catch {
      setShowShareTextPreview(true);
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${mockTitle} — Mock Score`,
          text: formattedShareScoreText,
        });
      } catch {
        // Ignore user share cancellation
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadSolutions() {
      setLoadingReview(true);
      setReviewError(null);
      try {
        let cachedQuestions: PublicQuestion[] | undefined = customQuestions;
        if (!cachedQuestions || cachedQuestions.length === 0) {
          try {
            const rawCache = localStorage.getItem(`mockrank_paper_cache_${attempt.mockId}`);
            if (rawCache) {
              const parsedDoc = JSON.parse(rawCache);
              const parsedQs = JSON.parse(parsedDoc.questionsJson || '[]');
              if (Array.isArray(parsedQs) && parsedQs.length > 0) {
                cachedQuestions = parsedQs;
              }
            }
          } catch {
            // Ignore cache parse error
          }
        }

        if (!cachedQuestions || cachedQuestions.length === 0) {
          try {
            const { fetchMockPaperSingleReadCached } = await import('../lib/firestoreService');
            const remotePaper = await fetchMockPaperSingleReadCached(attempt.mockId, false);
            if (remotePaper && remotePaper.questions.length > 0) {
              cachedQuestions = remotePaper.questions;
            }
          } catch {
            // Ignore remote paper fetch error
          }
        }

        const data = await fetchExamReviewSafe({
          mockId: attempt.mockId,
          dayNumber: attempt.dayNumber,
          responses: attempt.responses,
          answerReleasePolicy,
          startDateIST,
          customQuestions: cachedQuestions,
          isAdmin,
        });
        if (!cancelled) {
          setReviewItems(data.reviewItems || []);
        }
      } catch (err) {
        if (!cancelled) {
          setReviewError(err instanceof Error ? err.message : 'Failed to fetch solutions.');
        }
      } finally {
        if (!cancelled) setLoadingReview(false);
      }
    }

    loadSolutions();
    return () => {
      cancelled = true;
    };
  }, [answerReleasePolicy, attempt, customQuestions, isAdmin, startDateIST]);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${mins}m ${remSec}s`;
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Top Page Breadcrumb & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToMocks}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Mocks</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              onClick={onBackToDashboard}
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Dashboard
            </button>
          </div>
          <h1 className="text-xl sm:text-3xl font-bold text-slate-950 dark:text-white leading-snug">
            {mockTitle} — Scorecard
          </h1>
        </div>

        <div className="grid grid-cols-1 xs:grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleShareScoreInTextFormat}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedScoreText ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Score &amp; Link Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                <span>Share Score (Text + Link)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenLeaderboard(attempt.mockId)}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Open Leaderboard</span>
          </button>
        </div>
      </div>

      {/* Shareable Text Format Box (With Direct Attempt Link Below) */}
      {showShareTextPreview && (
        <div className="p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              Shareable Mock Score in Text Format (Includes Attempt Link Below)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(formattedShareScoreText);
                  setCopiedScoreText(true);
                  window.setTimeout(() => setCopiedScoreText(false), 2500);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 rounded cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedScoreText ? 'Copied' : 'Copy Text'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowShareTextPreview(false)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
              >
                Hide
              </button>
            </div>
          </div>
          <pre className="p-3 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-all">
            {formattedShareScoreText}
          </pre>
        </div>
      )}

      {/* Section View Switcher */}
      <div className="grid grid-cols-2 sm:flex items-center gap-1.5 sm:gap-2 p-1 bg-slate-100 dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg w-full sm:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Score &amp; Analysis</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('solutions')}
          className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            activeTab === 'solutions'
              ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Solutions ({reviewItems.length})</span>
        </button>
      </div>

      {activeTab === 'summary' ? (
        <div className="space-y-6 sm:space-y-8">
          {/* Primary Metrics Grid (2x2 on Mobile) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Official Total Score
              </div>
              <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                {attempt.score.toFixed(2)}{' '}
                <span className="text-xs sm:text-sm font-normal text-slate-400 dark:text-slate-500">
                  / {maxMarks.toFixed(0)}
                </span>
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                Mock Avg: {avgParticipantScore.toFixed(2)}
              </div>
            </div>

            <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Part-Wise Breakdown
              </div>
              <div className="text-base sm:text-xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                Part A: {partAScore.toFixed(2)}
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-1">
                Part B: {partBScore.toFixed(2)}
              </div>
            </div>

            <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Rank in This Mock
              </div>
              <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                #{myMockRank}{' '}
                <span className="text-xs sm:text-sm font-normal text-slate-400 dark:text-slate-500">
                  of {totalParticipants}
                </span>
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
                Acc: {attempt.accuracy.toFixed(1)}% · {formatDuration(attempt.timeTakenSeconds)}
              </div>
            </div>

            <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                Personal Rank (Equal Cohort)
              </div>
              <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                {overallRank ? `#${overallRank}` : '#1'}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                Avg Score: {overallAverageScore.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Correct / Incorrect / Unattempted Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70">
            <div className="flex items-center justify-between sm:block sm:text-center">
              <div className="text-xs text-slate-500 dark:text-slate-400">Correct Answers (+1.00 each)</div>
              <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                {attempt.correctAnswers}
              </div>
            </div>
            <div className="flex items-center justify-between sm:block sm:text-center sm:border-x border-slate-200 dark:border-slate-800 sm:px-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Incorrect Answers (-0.25 each)</div>
              <div className="text-2xl font-bold font-mono text-red-700 dark:text-red-400 mt-1">
                {attempt.incorrectAnswers}
              </div>
            </div>
            <div className="flex items-center justify-between sm:block sm:text-center">
              <div className="text-xs text-slate-500 dark:text-slate-400">Unattempted Questions (0.00)</div>
              <div className="text-2xl font-bold font-mono text-slate-700 dark:text-slate-200 mt-1">
                {attempt.unattemptedQuestions}
              </div>
            </div>
          </div>

          {/* Section-Wise Performance Breakdown Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Section-Wise Score Breakdown
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab('solutions')}
                className="text-xs font-semibold text-slate-900 dark:text-slate-200 hover:underline cursor-pointer"
              >
                Inspect Question-by-Question Solutions →
              </button>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto bg-white dark:bg-slate-900">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4 font-semibold">Subject Section</th>
                    <th className="py-3 px-3 font-semibold text-right">Questions</th>
                    <th className="py-3 px-3 font-semibold text-right">Correct</th>
                    <th className="py-3 px-3 font-semibold text-right">Incorrect</th>
                    <th className="py-3 px-3 font-semibold text-right">Unattempted</th>
                    <th className="py-3 px-3 font-semibold text-right">Accuracy</th>
                    <th className="py-3 px-4 font-semibold text-right">Net Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sectionList.map((sec) => (
                    <tr key={sec.subject} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">{sec.label}</td>
                      <td className="py-3.5 px-3 text-right font-mono">{sec.totalQuestions}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                        {sec.correct}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono text-red-700 dark:text-red-400">
                        {sec.incorrect}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                        {sec.unattempted}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono">
                        {sec.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {sec.score.toFixed(2)} / {sec.maxMarks.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {loadingReview ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
              Retrieving official answer key and explanations...
            </div>
          ) : reviewError ? (
            <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-center space-y-2">
              <Lock className="w-6 h-6 text-slate-600 dark:text-slate-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Delayed Answer Key Release Active
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">{reviewError}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviewItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      Question {idx + 1} · {item.sectionLabel} · {item.topic}
                    </span>
                    <span className="font-mono">
                      {item.userOptionIndex === null ? (
                        <span className="text-slate-600 dark:text-slate-400">Unattempted (0.00)</span>
                      ) : item.isCorrect ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Correct (+1.00)
                        </span>
                      ) : (
                        <span className="text-red-700 dark:text-red-400 font-semibold flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> Incorrect (-0.25)
                        </span>
                      )}
                    </span>
                  </div>

                  <p className="text-sm sm:text-base font-medium text-slate-950 dark:text-white">{item.question}</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs sm:text-sm">
                    {item.options.map((opt, oIdx) => {
                      const isOfficial = oIdx === item.correctOptionIndex;
                      const isUserPick = oIdx === item.userOptionIndex;

                      let boxClass = 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 text-slate-700 dark:text-slate-300';
                      if (isOfficial) {
                        boxClass =
                          'border-emerald-600 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-200 font-semibold';
                      } else if (isUserPick && !isOfficial) {
                        boxClass = 'border-red-500 dark:border-red-500 bg-red-50/70 dark:bg-red-950/50 text-red-950 dark:text-red-200';
                      }

                      return (
                        <div
                          key={oIdx}
                          className={`p-3 rounded-lg border flex items-start justify-between gap-2 ${boxClass}`}
                        >
                          <span>
                            <strong className="font-mono mr-1.5">
                              {String.fromCharCode(65 + oIdx)}.
                            </strong>
                            {opt}
                          </span>
                          <span className="text-[11px] font-mono shrink-0">
                            {isOfficial ? 'Correct Key' : isUserPick ? 'Your Answer' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    <strong className="text-slate-900 dark:text-white">Explanation: </strong>
                    {item.explanation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
