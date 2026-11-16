import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  RefreshCw,
  Search,
  Share2,
  Shield,
  Trophy,
  X,
} from 'lucide-react';
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
import {
  GeneratedLeaderboardImage,
  generateLeaderboardImage,
  LeaderboardExportConfig,
} from '../lib/leaderboardImageExporter';

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

  const [exportTheme, setExportTheme] = useState<'light' | 'dark'>('light');
  const [exportMaxRows, setExportMaxRows] = useState<number>(25);
  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [previewStudioOpen, setPreviewStudioOpen] = useState<boolean>(false);
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedLeaderboardImage | null>(null);

  const handleManualRefresh = () => {
    if (selectedScope === 'overall') {
      onRefreshOverall();
    } else {
      setRefreshCounter((c) => c + 1);
    }
  };

  const buildExportConfig = useCallback(
    (themeOverride?: 'light' | 'dark', maxRowsOverride?: number): LeaderboardExportConfig => {
      const activeTheme = themeOverride || exportTheme;
      const activeMax = maxRowsOverride || exportMaxRows;

      if (selectedScope === 'overall') {
        const cohortSubtitle =
          cohortFilter === 'all'
            ? 'All Candidates · Overall Average Score Standings'
            : cohortFilter === 'my_cohort'
            ? `Equal-Mocks Cohort (${Math.max(1, currentUserMocksAttempted)} Mock${
                Math.max(1, currentUserMocksAttempted) > 1 ? 's' : ''
              } Attempted)`
            : `Equal-Mocks Cohort (Exactly ${cohortFilter} Mock${
                Number(cohortFilter) > 1 ? 's' : ''
              } Attempted)`;

        return {
          mode: 'overall',
          title: 'Overall Average Score Leaderboard',
          subtitle: cohortSubtitle,
          theme: activeTheme,
          maxRows: activeMax,
          overallEntries: filteredOverallEntries,
        };
      }

      const matchedBp = blueprints.find((b) => b.mockId === selectedScope);
      return {
        mode: 'mock',
        title: matchedBp ? matchedBp.title : `Mock Test — ${selectedScope}`,
        subtitle: matchedBp
          ? `${matchedBp.category || 'DSSSB TGT Computer Science'} · ${matchedBp.totalQuestions} Qs · ${matchedBp.maxMarks} Marks`
          : `Official Mock Standings (${selectedScope})`,
        theme: activeTheme,
        maxRows: activeMax,
        mockEntries: filteredMockEntries,
      };
    },
    [
      blueprints,
      cohortFilter,
      currentUserMocksAttempted,
      exportMaxRows,
      exportTheme,
      filteredMockEntries,
      filteredOverallEntries,
      selectedScope,
    ]
  );

  useEffect(() => {
    if (!previewStudioOpen || !isAdmin) return;
    let cancelled = false;
    setExportBusy(true);
    generateLeaderboardImage(buildExportConfig(exportTheme, exportMaxRows))
      .then((res) => {
        if (!cancelled) setGeneratedPreview(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setExportStatusMsg(
            err instanceof Error ? err.message : 'Failed to generate leaderboard image.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setExportBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildExportConfig, exportMaxRows, exportTheme, isAdmin, previewStudioOpen]);

  const handleDownloadLeaderboardImage = async () => {
    setExportBusy(true);
    setExportStatusMsg(null);
    try {
      const img =
        previewStudioOpen && generatedPreview
          ? generatedPreview
          : await generateLeaderboardImage(buildExportConfig());
      const link = document.createElement('a');
      link.href = img.dataUrl;
      link.download = img.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setExportStatusMsg(`Downloaded "${img.filename}"`);
      window.setTimeout(() => setExportStatusMsg(null), 4000);
    } catch (err) {
      setExportStatusMsg(
        err instanceof Error ? err.message : 'Could not download leaderboard image.'
      );
    } finally {
      setExportBusy(false);
    }
  };

  const handleShareLeaderboardImage = async () => {
    setExportBusy(true);
    setExportStatusMsg(null);
    try {
      const img =
        previewStudioOpen && generatedPreview
          ? generatedPreview
          : await generateLeaderboardImage(buildExportConfig());
      setGeneratedPreview(img);

      const pngFile = new File([img.blob], img.filename, { type: 'image/png' });

      // 1. Try native Web Share API with image file
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [pngFile] })
      ) {
        await navigator.share({
          title: 'MockRank Official Leaderboard',
          text: img.shareText,
          files: [pngFile],
        });
        setExportStatusMsg('Leaderboard image shared successfully.');
        window.setTimeout(() => setExportStatusMsg(null), 4000);
        return;
      }

      // 2. Try copying PNG image directly to system clipboard (for instant Ctrl+V into WhatsApp/Telegram)
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItem !== 'undefined'
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': img.blob,
          }),
        ]);
        setPreviewStudioOpen(true);
        setExportStatusMsg(
          'Leaderboard PNG image copied to clipboard! Paste (Ctrl+V) directly into WhatsApp, Telegram, or social media.'
        );
        window.setTimeout(() => setExportStatusMsg(null), 5000);
        return;
      }

      // 3. Fallback: Open Preview Studio & copy share text
      setPreviewStudioOpen(true);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(img.shareText);
        setExportStatusMsg('Opened Share Studio & copied rank summary text to clipboard.');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled native share sheet
        return;
      }
      setPreviewStudioOpen(true);
      setExportStatusMsg('Opened Leaderboard Image Studio to download or copy image.');
    } finally {
      setExportBusy(false);
    }
  };

  const handleCopyImageToClipboard = async () => {
    setExportBusy(true);
    try {
      const img =
        generatedPreview || (await generateLeaderboardImage(buildExportConfig()));
      setGeneratedPreview(img);
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItem !== 'undefined'
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': img.blob,
          }),
        ]);
        setExportStatusMsg('High-resolution PNG copied to clipboard! Press Ctrl+V to paste.');
      } else {
        await handleDownloadLeaderboardImage();
      }
    } catch {
      setExportStatusMsg('Browser blocked image clipboard write — downloading PNG instead.');
      await handleDownloadLeaderboardImage();
    } finally {
      setExportBusy(false);
      window.setTimeout(() => setExportStatusMsg(null), 4500);
    }
  };

  const handleCopyShareText = async () => {
    try {
      const img =
        generatedPreview || (await generateLeaderboardImage(buildExportConfig()));
      await navigator.clipboard.writeText(img.shareText);
      setExportStatusMsg('Formatted rank list text copied for WhatsApp / Telegram!');
      window.setTimeout(() => setExportStatusMsg(null), 4000);
    } catch {
      setExportStatusMsg('Could not copy text to clipboard.');
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

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                disabled={exportBusy}
                onClick={handleDownloadLeaderboardImage}
                className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportBusy ? 'Generating...' : 'Download Image'}</span>
              </button>

              <button
                type="button"
                disabled={exportBusy}
                onClick={handleShareLeaderboardImage}
                className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share Leaderboard</span>
              </button>

              <button
                type="button"
                onClick={() => setPreviewStudioOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Preview Poster</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleManualRefresh}
            className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Standings</span>
          </button>
        </div>
      </div>

      {exportStatusMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{exportStatusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportStatusMsg(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

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

      {/* Admin Leaderboard Image Preview & Share Studio Modal */}
      {isAdmin && previewStudioOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                  Admin Leaderboard Image Studio
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-950 dark:text-white">
                  Download &amp; Share Official Leaderboard Image (2x Retina PNG)
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setPreviewStudioOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Customization & Quick Action Toolbar */}
            <div className="px-4 sm:px-6 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600 dark:text-slate-400">
                  Poster Theme:
                </span>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setExportTheme('light')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      exportTheme === 'light'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportTheme('dark')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      exportTheme === 'dark'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Dark
                  </button>
                </div>

                <span className="font-semibold text-slate-600 dark:text-slate-400 ml-2">
                  Rows:
                </span>
                <select
                  value={exportMaxRows}
                  onChange={(e) => setExportMaxRows(Number(e.target.value))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold cursor-pointer"
                >
                  <option value={10}>Top 10 Candidates</option>
                  <option value={25}>Top 25 Candidates</option>
                  <option value={50}>Top 50 Candidates</option>
                  <option value={100}>Top 100 Candidates</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={handleDownloadLeaderboardImage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PNG</span>
                </button>

                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={handleCopyImageToClipboard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Image</span>
                </button>

                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={handleCopyShareText}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Text</span>
                </button>

                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={handleShareLeaderboardImage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Now</span>
                </button>
              </div>
            </div>

            {/* Live Image Preview Area */}
            <div className="p-4 sm:p-6 overflow-y-auto bg-slate-100 dark:bg-slate-950/80 flex-1 flex flex-col items-center justify-start">
              {exportBusy || !generatedPreview ? (
                <div className="py-20 text-xs font-mono text-slate-500">
                  Rendering high-resolution Leaderboard image...
                </div>
              ) : (
                <img
                  src={generatedPreview.dataUrl}
                  alt="MockRank Leaderboard Poster Preview"
                  className="w-full max-w-3xl rounded-lg shadow-md border border-slate-300 dark:border-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

