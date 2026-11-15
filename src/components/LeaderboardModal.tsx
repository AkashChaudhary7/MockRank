import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, RefreshCw, Search, Shield, Trophy, X } from 'lucide-react';
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
  isAdmin?: boolean;
  inspectingUid?: string | null;
  onInspectUserScorecard?: (uid: string, candidateName: string, preferredMockId?: string) => void;
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
  isAdmin = false,
  inspectingUid = null,
  onInspectUserScorecard,
  onRefreshOverall,
  onBackToDashboard,
  onBackToMocks,
}) => {
  const [selectedScope, setSelectedScope] = useState<string>(initialScope || 'overall');
  const [cohortFilter, setCohortFilter] = useState<'my_cohort' | 'all' | number>('my_cohort');
  const [mockEntries, setMockEntries] = useState<LeaderboardMockEntry[]>([]);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

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

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredOverallEntries = useMemo(() => {
    if (!normalizedQuery) return displayedOverallEntries;
    const rankQuery = normalizedQuery.replace(/^#/, '');
    return displayedOverallEntries.filter((entry) => {
      const nameMatch = (entry.candidateName || '').toLowerCase().includes(normalizedQuery);
      const rankMatch = String(entry.rank || '') === rankQuery;
      return nameMatch || rankMatch;
    });
  }, [displayedOverallEntries, normalizedQuery]);

  const filteredMockEntries = useMemo(() => {
    if (!normalizedQuery) return mockEntries;
    const rankQuery = normalizedQuery.replace(/^#/, '');
    return mockEntries.filter((entry) => {
      const nameMatch = (entry.candidateName || '').toLowerCase().includes(normalizedQuery);
      const rankMatch = String(entry.rank || '') === rankQuery;
      return nameMatch || rankMatch;
    });
  }, [mockEntries, normalizedQuery]);

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
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Dashboard</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              onClick={onBackToMocks}
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Mocks
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900 dark:text-slate-100 shrink-0" />
            <h1 className="text-xl sm:text-3xl font-bold text-slate-950 dark:text-white leading-snug">
              Live Competitive Leaderboard
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Standings</span>
        </button>
      </div>

      {/* Scope, Cohort Filter & Candidate Search Bar */}
      <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setSelectedScope('overall')}
              className={`w-full sm:w-auto px-3.5 py-2 sm:py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer text-center ${
                selectedScope === 'overall'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
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
                className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md text-slate-800 dark:text-slate-200 cursor-pointer"
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
            <div className="flex flex-col xs:flex-row xs:items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
              <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                Compare Cohort:
              </span>
              <select
                value={cohortFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setCohortFilter(
                    val === 'my_cohort' || val === 'all' ? val : Number(val)
                  );
                }}
                className="w-full sm:w-auto px-2.5 py-2 sm:py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 cursor-pointer"
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

        {/* Search Input Field to Find Candidate Name or Rank */}
        <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by candidate username or rank (e.g., Tanu or #1)..."
              aria-label="Search candidates on leaderboard"
              className="w-full pl-8 pr-8 py-1.5 text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">
              Showing{' '}
              <strong className="text-slate-900 dark:text-white">
                {selectedScope === 'overall'
                  ? filteredOverallEntries.length
                  : filteredMockEntries.length}
              </strong>{' '}
              of{' '}
              {selectedScope === 'overall'
                ? displayedOverallEntries.length
                : mockEntries.length}{' '}
              candidates
            </span>
          </div>
        </div>

        {isAdmin && onInspectUserScorecard && (
          <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span>
              Admin Rights Active: Click any candidate&apos;s score or &ldquo;Whole Scorecard&rdquo;
              to inspect their complete Scorecard, Section Breakdown &amp; Solutions.
            </span>
          </div>
        )}
      </div>

      {/* Table Body */}
      <div className="bg-white dark:bg-slate-900 rounded-xl">
        {selectedScope === 'overall' ? (
          displayedOverallEntries.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/50">
              No candidates in this exact mock-count cohort yet. Complete a mock to claim Rank #1!
            </div>
          ) : filteredOverallEntries.length === 0 ? (
            <div className="py-14 px-4 text-center space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/50">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No candidates matching &ldquo;{searchQuery}&rdquo;
              </div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-semibold text-slate-900 dark:text-white underline cursor-pointer"
              >
                Clear search filter
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">Cohort Rank</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                      Candidate Username
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Average Score
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Mocks Attempted
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Part A Avg
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Part B Avg
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Avg Accuracy
                    </th>
                    {isAdmin && onInspectUserScorecard && (
                      <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                        Admin Inspector
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredOverallEntries.map((entry) => {
                    const isMe = entry.uid === currentUid;
                    const isLoadingThis = inspectingUid === entry.uid;
                    return (
                      <tr
                        key={entry.uid}
                        className={
                          isMe
                            ? 'bg-slate-900/5 dark:bg-slate-800/70 font-semibold text-slate-950 dark:text-white'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200'
                        }
                      >
                        <td className="py-3.5 px-4 font-mono font-bold whitespace-nowrap">
                          #{entry.rank}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isAdmin && onInspectUserScorecard ? (
                            <button
                              type="button"
                              onClick={() =>
                                onInspectUserScorecard(entry.uid, entry.candidateName)
                              }
                              className="text-left font-semibold hover:underline text-slate-900 dark:text-white cursor-pointer"
                            >
                              {entry.candidateName}
                              {isMe ? ' (You)' : ''}
                            </button>
                          ) : (
                            <>
                              {entry.candidateName}
                              {isMe ? ' (You)' : ''}
                            </>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {isAdmin && onInspectUserScorecard ? (
                            <button
                              type="button"
                              disabled={isLoadingThis}
                              onClick={() =>
                                onInspectUserScorecard(entry.uid, entry.candidateName)
                              }
                              title="Click to open candidate's whole scorecard"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 underline decoration-dotted cursor-pointer"
                            >
                              {isLoadingThis ? 'Loading...' : entry.averageScore.toFixed(2)}
                            </button>
                          ) : (
                            entry.averageScore.toFixed(2)
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                          {entry.mocksAttempted}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                          {(entry.partAAverageScore || 0).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                          {(entry.partBAverageScore || 0).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                          {entry.averageAccuracy.toFixed(1)}%
                        </td>
                        {isAdmin && onInspectUserScorecard && (
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isLoadingThis}
                              onClick={() =>
                                onInspectUserScorecard(entry.uid, entry.candidateName)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-md cursor-pointer"
                            >
                              <BarChart3 className="w-3 h-3" />
                              <span>{isLoadingThis ? 'Opening...' : 'Whole Scorecard'}</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : mockEntries.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/50">
            No verified official attempts recorded for {selectedScope} yet.
          </div>
        ) : filteredMockEntries.length === 0 ? (
          <div className="py-14 px-4 text-center space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/50">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              No candidates matching &ldquo;{searchQuery}&rdquo;
            </div>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs font-semibold text-slate-900 dark:text-white underline cursor-pointer"
            >
              Clear search filter
            </button>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">Rank</th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                    Candidate Username
                  </th>
                  <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">Score</th>
                  <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                    Correct
                  </th>
                  <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                    Accuracy
                  </th>
                  <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                    Completion Time
                  </th>
                  <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                    Submitted At
                  </th>
                  {isAdmin && onInspectUserScorecard && (
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">
                      Admin Inspector
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredMockEntries.map((entry) => {
                  const isMe = entry.uid === currentUid;
                  const isLoadingThis = inspectingUid === entry.uid;
                  const mins = Math.floor(entry.timeTakenSeconds / 60);
                  const secs = entry.timeTakenSeconds % 60;
                  return (
                    <tr
                      key={entry.uid}
                      className={
                        isMe
                          ? 'bg-slate-900/5 dark:bg-slate-800/70 font-semibold text-slate-950 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200'
                      }
                    >
                      <td className="py-3.5 px-4 font-mono font-bold whitespace-nowrap">
                        #{entry.rank}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isAdmin && onInspectUserScorecard ? (
                          <button
                            type="button"
                            onClick={() =>
                              onInspectUserScorecard(entry.uid, entry.candidateName, selectedScope)
                            }
                            className="text-left font-semibold hover:underline text-slate-900 dark:text-white cursor-pointer"
                          >
                            {entry.candidateName}
                            {isMe ? ' (You)' : ''}
                          </button>
                        ) : (
                          <>
                            {entry.candidateName}
                            {isMe ? ' (You)' : ''}
                          </>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {isAdmin && onInspectUserScorecard ? (
                          <button
                            type="button"
                            disabled={isLoadingThis}
                            onClick={() =>
                              onInspectUserScorecard(entry.uid, entry.candidateName, selectedScope)
                            }
                            title="Click to view candidate's complete mock scorecard"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 underline decoration-dotted cursor-pointer"
                          >
                            {isLoadingThis ? 'Loading...' : entry.score.toFixed(2)}
                          </button>
                        ) : (
                          entry.score.toFixed(2)
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {entry.correctAnswers}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                        {entry.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                        {mins}m {secs}s
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {entry.submittedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      {isAdmin && onInspectUserScorecard && (
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            disabled={isLoadingThis}
                            onClick={() =>
                              onInspectUserScorecard(entry.uid, entry.candidateName, selectedScope)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-md cursor-pointer"
                          >
                            <BarChart3 className="w-3 h-3" />
                            <span>{isLoadingThis ? 'Opening...' : 'Whole Scorecard'}</span>
                          </button>
                        </td>
                      )}
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

