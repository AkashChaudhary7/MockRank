import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Trophy } from 'lucide-react';
import {
  LeaderboardMockEntry,
  LeaderboardOverallEntry,
  MockBlueprint,
} from '../types/mockrank';
import {
  sortAndRankEqualMocksCohort,
  sortAndRankOverallLeaderboard,
  subscribeToMockLeaderboard,
} from '../lib/firestoreService';

interface LeaderboardPageProps {
  currentUid: string;
  currentUserMocksAttempted: number;
  initialScope: 'overall' | string;
  overallEntries: LeaderboardOverallEntry[];
  blueprints: MockBlueprint[];
  onRefreshOverall: () => void;
  onBackToDashboard: () => void;
  onBackToMocks: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardPageProps> = ({
  currentUid,
  currentUserMocksAttempted,
  initialScope,
  overallEntries,
  blueprints,
  onRefreshOverall,
  onBackToDashboard,
  onBackToMocks,
}) => {
  const [selectedScope, setSelectedScope] = useState<string>(initialScope || 'overall');
  const [cohortFilter, setCohortFilter] = useState<'my_cohort' | 'all' | number>('my_cohort');
  const [mockEntries, setMockEntries] = useState<LeaderboardMockEntry[]>([]);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  useEffect(() => {
    setSelectedScope(initialScope || 'overall');
  }, [initialScope]);

  useEffect(() => {
    if (selectedScope === 'overall') return;
    const unsub = subscribeToMockLeaderboard(selectedScope, (entries) => {
      setMockEntries(entries);
    });
    return () => unsub();
  }, [selectedScope, refreshCounter]);

  const displayedOverallEntries = useMemo(() => {
    if (cohortFilter === 'all') {
      return sortAndRankOverallLeaderboard(overallEntries, 1);
    }
    const targetCount =
      cohortFilter === 'my_cohort'
        ? Math.max(1, currentUserMocksAttempted || 1)
        : Number(cohortFilter);
    return sortAndRankEqualMocksCohort(overallEntries, targetCount);
  }, [cohortFilter, currentUserMocksAttempted, overallEntries]);

  const handleManualRefresh = () => {
    if (selectedScope === 'overall') {
      onRefreshOverall();
    } else {
      setRefreshCounter((c) => c + 1);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Full-Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-950 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Dashboard</span>
            </button>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              onClick={onBackToMocks}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Mocks
            </button>
          </div>
          <div className="flex items-center gap-2.5 pt-1">
            <Trophy className="w-6 h-6 text-slate-900" />
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-950">
              Live Competitive Leaderboard
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Standings</span>
        </button>
      </div>

      {/* Scope Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedScope('overall')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              selectedScope === 'overall'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Average Score Leaderboard (Equal-Mocks Cohort)
          </button>

          {blueprints.length > 0 && (
            <select
              value={selectedScope === 'overall' ? '' : selectedScope}
              onChange={(e) => {
                if (e.target.value) setSelectedScope(e.target.value);
              }}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-800 cursor-pointer"
            >
              <option value="" disabled>
                Select Individual Mock...
              </option>
              {blueprints.map((bp) => (
                <option key={bp.mockId} value={bp.mockId}>
                  [{bp.category || 'DSSSB'}] {bp.title} ({bp.mockId})
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedScope === 'overall' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Compare Cohort:</span>
            <select
              value={cohortFilter}
              onChange={(e) => {
                const val = e.target.value;
                setCohortFilter(
                  val === 'my_cohort' || val === 'all' ? val : Number(val)
                );
              }}
              className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-md text-slate-900 cursor-pointer"
            >
              <option value="my_cohort">
                My Equal-Mock Cohort ({Math.max(1, currentUserMocksAttempted)} Mock
                {Math.max(1, currentUserMocksAttempted) > 1 ? 's' : ''} Attempted)
              </option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  Exactly {n} Mock{n > 1 ? 's' : ''} Attempted
                </option>
              ))}
              <option value="all">All Candidates</option>
            </select>
          </div>
        )}
      </div>

      {/* Table Body */}
      <div className="bg-white">
        {selectedScope === 'overall' ? (
          displayedOverallEntries.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500 border border-slate-200 rounded-xl bg-slate-50/40">
              No candidates in this exact mock-count cohort yet. Complete a mock to claim Rank #1!
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-3.5 px-4 font-semibold">Cohort Rank</th>
                    <th className="py-3.5 px-4 font-semibold">Candidate Username</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Average Score</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Mocks Attempted</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Part A Avg</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Part B Avg</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Avg Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {displayedOverallEntries.map((entry) => {
                    const isMe = entry.uid === currentUid;
                    return (
                      <tr
                        key={entry.uid}
                        className={
                          isMe
                            ? 'bg-slate-900/5 font-semibold text-slate-950'
                            : 'hover:bg-slate-50 text-slate-800'
                        }
                      >
                        <td className="py-3.5 px-4 font-mono font-bold">#{entry.rank}</td>
                        <td className="py-3.5 px-4">
                          {entry.candidateName}
                          {isMe ? ' (You)' : ''}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                          {entry.averageScore.toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          {entry.mocksAttempted}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          {(entry.partAAverageScore || 0).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          {(entry.partBAverageScore || 0).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          {entry.averageAccuracy.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : mockEntries.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500 border border-slate-200 rounded-xl bg-slate-50/40">
            No verified official attempts recorded for {selectedScope} yet.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3.5 px-4 font-semibold">Rank</th>
                  <th className="py-3.5 px-4 font-semibold">Candidate Username</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Score</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Correct</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Accuracy</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Completion Time</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {mockEntries.map((entry) => {
                  const isMe = entry.uid === currentUid;
                  const mins = Math.floor(entry.timeTakenSeconds / 60);
                  const secs = entry.timeTakenSeconds % 60;
                  return (
                    <tr
                      key={entry.uid}
                      className={
                        isMe
                          ? 'bg-slate-900/5 font-semibold text-slate-950'
                          : 'hover:bg-slate-50 text-slate-800'
                      }
                    >
                      <td className="py-3.5 px-4 font-mono font-bold">#{entry.rank}</td>
                      <td className="py-3.5 px-4">
                        {entry.candidateName}
                        {isMe ? ' (You)' : ''}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {entry.score.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-emerald-700">
                        {entry.correctAnswers}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono">
                        {entry.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono">
                        {mins}m {secs}s
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-500">
                        {entry.submittedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
