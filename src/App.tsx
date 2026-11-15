/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  Layers,
  Lock,
  LogOut,
  Moon,
  Play,
  RotateCcw,
  Share2,
  Shield,
  Sun,
  Trophy,
  UserCheck,
  X,
} from 'lucide-react';
import {
  AppUserSession,
  auth,
  clearCustomDomainUserSession,
  deriveDeterministicUidFromEmail,
  getStoredCustomDomainUser,
  googleProvider,
  isCustomHostedDomain,
  saveCustomDomainUserSession,
} from './lib/firebase';
import {
  DEFAULT_SECTIONS_CLIENT,
  evaluateExamAttemptSafe,
  fetchExamPaperSafe,
  fetchTimeAndConfigSafe,
} from './lib/clientExamEngine';
import {
  autosaveExamAttemptProgress,
  checkIsAdminUser,
  createOrResumeExamAttempt,
  ensureUserProfile,
  fetchAdminCreatedMocks,
  fetchChallengeConfig,
  fetchMockPaperSingleReadCached,
  fetchUserAttempts,
  fetchUserProfileByUid,
  finalizeExamSubmissionAndSyncLeaderboards,
  hasStoredAdminConsoleSession,
  saveCandidateUsername,
  setStoredAdminConsoleSession,
  sortAndRankEqualMocksCohort,
  subscribeToMockLeaderboard,
  subscribeToOverallLeaderboard,
} from './lib/firestoreService';
import {
  ChallengeConfig,
  ExamAttempt,
  LeaderboardMockEntry,
  LeaderboardOverallEntry,
  MockBlueprint,
  PublicQuestion,
  SectionBlueprint,
  SubjectSlug,
  UserProfile,
} from './types/mockrank';
import { ExamTerminalModal } from './components/ExamTerminalModal';
import { MockResultModal } from './components/MockResultModal';
import { LeaderboardModal } from './components/LeaderboardModal';
import { MistakeVaultModal } from './components/MistakeVaultModal';
import { AdminPanel } from './components/AdminPanel';
import { LegalModal } from './components/LegalModal';

type StudentNavTab = 'dashboard' | 'mocks' | 'leaderboard' | 'mistake-vault' | 'result';

interface AdminInspectedUserState {
  uid: string;
  candidateName: string;
  profile: UserProfile | null;
  completedAttempts: ExamAttempt[];
  cohortRank: number | null;
  overallAverageScore: number;
}

interface ActiveExamSession {
  mockId: string;
  dayNumber: number;
  title: string;
  durationMinutes: number;
  correctMarks: number;
  incorrectMarks: number;
  maxMarks: number;
  sections: SectionBlueprint[];
  questions: PublicQuestion[];
  attempt: ExamAttempt;
  mode?: 'exam' | 'solutions';
  blueprint?: MockBlueprint;
  isCustomUploadedPaper?: boolean;
}

const SECTION_CARDS_META: {
  subject: SubjectSlug;
  label: string;
  part: 'Part A' | 'Part B';
}[] = [
  {
    subject: 'hindi',
    label: 'Hindi',
    part: 'Part A',
  },
  {
    subject: 'english',
    label: 'English',
    part: 'Part A',
  },
  {
    subject: 'mathematics',
    label: 'Mathematics',
    part: 'Part A',
  },
  {
    subject: 'reasoning',
    label: 'Reasoning',
    part: 'Part A',
  },
  {
    subject: 'general-awareness',
    label: 'General Awareness',
    part: 'Part A',
  },
  {
    subject: 'computer-science',
    label: 'Computer Science',
    part: 'Part B',
  },
  {
    subject: 'teaching-methodology',
    label: 'Teaching Methodology',
    part: 'Part B',
  },
];

export default function App() {
  // Dark Mode State for late-night study sessions (persisted in localStorage)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mockrank_theme_dark') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('mockrank_theme_dark', String(darkMode));
    } catch {
      // Ignore storage error
    }
  }, [darkMode]);

  // Auth & User State (Supports both Firebase Google Auth and Custom Domain Gmail Session on mock.dsssbpyq.online)
  const [firebaseUser, setFirebaseUser] = useState<User | AppUserSession | null>(() =>
    getStoredCustomDomainUser()
  );
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(() => hasStoredAdminConsoleSession());
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Direct Gmail + Username Login inputs (Used automatically on mock.dsssbpyq.online or when popup is blocked/unauthorized)
  const [gmailLoginInput, setGmailLoginInput] = useState<string>('');
  const [gmailUsernameInput, setGmailUsernameInput] = useState<string>('');

  // Username Setup State (Required before attempting mocks)
  const [usernameInput, setUsernameInput] = useState<string>('');
  const [savingUsername, setSavingUsername] = useState<boolean>(false);
  const [showUsernameModal, setShowUsernameModal] = useState<boolean>(false);
  const [pendingMockAfterUsername, setPendingMockAfterUsername] =
    useState<MockBlueprint | null>(null);

  // Primary Full-Page Navigation (Dashboard | Mocks | Full-Page Leaderboard | Mistake Vault | Full-Page Result)
  const [activeNav, setActiveNav] = useState<StudentNavTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mock') ? 'mocks' : 'dashboard';
  });
  const [leaderboardScope, setLeaderboardScope] = useState<string>('overall');

  // Category Filter on Mocks Page
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [copiedShareKey, setCopiedShareKey] = useState<string | null>(null);

  // Server Time, Schedule & Admin-Added Mock Blueprints
  const [serverISTDate, setServerISTDate] = useState<string>('');
  const [challengeConfig, setChallengeConfig] = useState<ChallengeConfig>({
    configId: 'active',
    startDateIST: '2026-11-10',
    endDateIST: '2026-11-25',
    isPaused: false,
    minEligibilityAttempts: 1,
    lateAttemptPolicy: 'allow-unlocked',
    defaultCorrectMarks: 1,
    defaultIncorrectMarks: -0.25,
    delayedAnswerRelease: false,
  });
  const [blueprints, setBlueprints] = useState<MockBlueprint[]>([]);
  const [userAttempts, setUserAttempts] = useState<ExamAttempt[]>([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState<LeaderboardOverallEntry[]>([]);
  const [selectedMockLeaderboard, setSelectedMockLeaderboard] = useState<LeaderboardMockEntry[]>(
    []
  );

  // Active CBT Session, Dedicated Result Page State, Admin Whole-Scorecard Inspector & Modals
  const [activeExam, setActiveExam] = useState<ActiveExamSession | null>(null);
  const [viewingResultAttempt, setViewingResultAttempt] = useState<ExamAttempt | null>(null);
  const [adminInspectedUser, setAdminInspectedUser] = useState<AdminInspectedUserState | null>(
    null
  );
  const [inspectingUid, setInspectingUid] = useState<string | null>(null);
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [showLegalModal, setShowLegalModal] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [startingMockId, setStartingMockId] = useState<string | null>(null);

  // Sync Server-Authoritative IST Date & Load ONLY Admin-Added Mocks from Firestore
  const syncServerTimeAndAdminMocks = useCallback(async (customStartDate?: string) => {
    try {
      const data = await fetchTimeAndConfigSafe(customStartDate);
      const currentIST = data.istDateString || new Date().toISOString().slice(0, 10);
      if (!customStartDate && data.defaultStartDateIST) {
        setChallengeConfig((prev) => ({
          ...prev,
          startDateIST: data.defaultStartDateIST,
        }));
      }
      setServerISTDate(currentIST);

      const adminMocks = await fetchAdminCreatedMocks(currentIST);
      setBlueprints(adminMocks);
    } catch (err) {
      console.error('Failed to sync server time or admin mocks:', err);
    }
  }, []);

  useEffect(() => {
    syncServerTimeAndAdminMocks();
  }, [syncServerTimeAndAdminMocks]);

  const hydrateAuthenticatedCandidate = useCallback(
    async (activeUser: User | AppUserSession, customUsername?: string) => {
      try {
        const [profile, adminFlag, storedConfig] = await Promise.all([
          ensureUserProfile(activeUser, customUsername),
          checkIsAdminUser(activeUser),
          fetchChallengeConfig(),
        ]);

        // Ensure firebaseUser UID matches any existing Firestore profile UID linked by email
        if (profile.uid !== activeUser.uid && 'isCustomDomainSession' in activeUser) {
          const syncedSession: AppUserSession = {
            ...activeUser,
            uid: profile.uid,
            displayName: profile.username || profile.fullName || activeUser.displayName,
          };
          saveCustomDomainUserSession(syncedSession);
          setFirebaseUser(syncedSession);
        }

        const attempts = await fetchUserAttempts(profile.uid);

        setUserProfile(profile);
        setUsernameInput(profile.username || '');
        if (!profile.username || !profile.username.trim()) {
          setShowUsernameModal(true);
        } else {
          setShowUsernameModal(false);
        }
        setIsAdmin(adminFlag);
        setUserAttempts(attempts);

        if (storedConfig) {
          setChallengeConfig(storedConfig);
          await syncServerTimeAndAdminMocks(storedConfig.startDateIST);
        } else {
          await syncServerTimeAndAdminMocks();
        }
      } catch (err) {
        console.error('Profile initialization error:', err);
      }
    },
    [syncServerTimeAndAdminMocks]
  );

  // Firebase Auth Listener + Custom Domain Session Fallback (mock.dsssbpyq.online)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const effectiveUser: User | AppUserSession | null = user || getStoredCustomDomainUser();
      setFirebaseUser(effectiveUser);
      setAuthReady(true);

      if (!effectiveUser) {
        setUserProfile(null);
        setIsAdmin(hasStoredAdminConsoleSession());
        setUserAttempts([]);
        return;
      }

      await hydrateAuthenticatedCandidate(effectiveUser);
    });

    return () => unsub();
  }, [hydrateAuthenticatedCandidate]);

  // Subscribe to Overall Leaderboard when authenticated
  const [leaderboardRefreshNonce, setLeaderboardRefreshNonce] = useState<number>(0);
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const unsub = subscribeToOverallLeaderboard(1, (entries) => {
      setOverallLeaderboard(entries);
    });
    return () => unsub();
  }, [authReady, firebaseUser, leaderboardRefreshNonce]);

  // Subscribe to active result page's mock leaderboard
  useEffect(() => {
    if (!viewingResultAttempt || !firebaseUser) return;
    const unsub = subscribeToMockLeaderboard(viewingResultAttempt.mockId, (entries) => {
      setSelectedMockLeaderboard(entries);
    });
    return () => unsub();
  }, [viewingResultAttempt, firebaseUser]);

  const reloadUserData = useCallback(async () => {
    if (!firebaseUser) {
      await syncServerTimeAndAdminMocks();
      return;
    }
    const [profile, adminFlag, storedConfig] = await Promise.all([
      ensureUserProfile(firebaseUser),
      checkIsAdminUser(firebaseUser),
      fetchChallengeConfig(),
    ]);
    const attempts = await fetchUserAttempts(profile.uid);
    setUserProfile(profile);
    setIsAdmin(adminFlag);
    setUserAttempts(attempts);
    if (storedConfig) {
      setChallengeConfig(storedConfig);
      await syncServerTimeAndAdminMocks(storedConfig.startDateIST);
    } else {
      await syncServerTimeAndAdminMocks();
    }
  }, [firebaseUser, syncServerTimeAndAdminMocks]);

  const activeMockIdsSet = useMemo(
    () => new Set(blueprints.map((b) => b.mockId)),
    [blueprints]
  );

  // Only count completed attempts belonging to currently active (non-deleted) mocks
  const completedAttempts = useMemo(
    () =>
      userAttempts.filter(
        (a) => a.status === 'completed' && activeMockIdsSet.has(a.mockId)
      ),
    [userAttempts, activeMockIdsSet]
  );

  const completedAttemptsCount = completedAttempts.length;

  const effectiveAverageScore = useMemo(() => {
    if (completedAttempts.length === 0) return 0;
    const sum = completedAttempts.reduce((acc, a) => acc + Number(a.score || 0), 0);
    return Number((sum / completedAttempts.length).toFixed(2));
  }, [completedAttempts]);

  const effectiveAverageAccuracy = useMemo(() => {
    if (completedAttempts.length === 0) return 0;
    const sum = completedAttempts.reduce((acc, a) => acc + Number(a.accuracy || 0), 0);
    return Number((sum / completedAttempts.length).toFixed(2));
  }, [completedAttempts]);

  // Equal-Mocks Cohort Ranking: Compare ONLY with candidates who have given the exact same number of mocks
  const equalMocksCohortLeaderboard = useMemo(() => {
    if (completedAttemptsCount <= 0) return [];
    return sortAndRankEqualMocksCohort(overallLeaderboard, completedAttemptsCount);
  }, [completedAttemptsCount, overallLeaderboard]);

  const myEqualCohortRank = useMemo(() => {
    if (!userProfile || completedAttemptsCount <= 0) return null;
    const found = equalMocksCohortLeaderboard.find((e) => e.uid === userProfile.uid);
    return found?.rank || 1;
  }, [completedAttemptsCount, equalMocksCohortLeaderboard, userProfile]);

  // Compute Section-Wise & Part-Wise Average Scores strictly from active completedAttempts
  const { sectionAvgMap, partAAvg, partBAvg } = useMemo(() => {
    const map: Record<SubjectSlug, number> = {
      'general-awareness': 0,
      'reasoning': 0,
      'mathematics': 0,
      'hindi': 0,
      'english': 0,
      'computer-science': 0,
      'teaching-methodology': 0,
    };

    if (completedAttempts.length === 0) {
      return { sectionAvgMap: map, partAAvg: 0, partBAvg: 0 };
    }

    const n = completedAttempts.length;
    let hasSectionBreakdowns = false;

    for (const att of completedAttempts) {
      if (att.sectionScores && Object.keys(att.sectionScores).length > 0) {
        hasSectionBreakdowns = true;
        for (const item of SECTION_CARDS_META) {
          map[item.subject] += Number(att.sectionScores[item.subject]?.score || 0);
        }
      }
    }

    if (hasSectionBreakdowns) {
      for (const item of SECTION_CARDS_META) {
        map[item.subject] = Number((map[item.subject] / n).toFixed(2));
      }
      const pA = Number(
        (
          map['general-awareness'] +
          map['reasoning'] +
          map['mathematics'] +
          map['hindi'] +
          map['english']
        ).toFixed(2)
      );
      const pB = Number((map['computer-science'] + map['teaching-methodology']).toFixed(2));
      return { sectionAvgMap: map, partAAvg: pA, partBAvg: pB };
    }

    if (userProfile?.sectionAverages && Object.keys(userProfile.sectionAverages).length > 0) {
      for (const item of SECTION_CARDS_META) {
        map[item.subject] = Number(userProfile.sectionAverages[item.subject] || 0);
      }
      const pA =
        typeof userProfile.partAAverageScore === 'number'
          ? userProfile.partAAverageScore
          : Number(
              (
                map['general-awareness'] +
                map['reasoning'] +
                map['mathematics'] +
                map['hindi'] +
                map['english']
              ).toFixed(2)
            );
      const pB =
        typeof userProfile.partBAverageScore === 'number'
          ? userProfile.partBAverageScore
          : Number((map['computer-science'] + map['teaching-methodology']).toFixed(2));
      return { sectionAvgMap: map, partAAvg: pA, partBAvg: pB };
    }

    return { sectionAvgMap: map, partAAvg: 0, partBAvg: 0 };
  }, [completedAttempts, userProfile]);

  const attemptsByMockId = useMemo(() => {
    const map: Record<string, ExamAttempt> = {};
    for (const att of userAttempts) {
      if (att.status !== 'invalidated') {
        map[att.mockId] = att;
      }
    }
    return map;
  }, [userAttempts]);

  // Distinct Categories across Admin-added mocks
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    for (const bp of blueprints) {
      set.add(bp.category || 'DSSSB TGT Computer Science');
    }
    return ['All', ...Array.from(set)];
  }, [blueprints]);

  const filteredBlueprints = useMemo(() => {
    if (selectedCategory === 'All') return blueprints;
    return blueprints.filter(
      (bp) => (bp.category || 'DSSSB TGT Computer Science') === selectedCategory
    );
  }, [blueprints, selectedCategory]);

  // Open Dedicated Result & Analysis Page (Full Page)
  const openResultPage = useCallback((attempt: ExamAttempt) => {
    setAdminInspectedUser(null);
    setViewingResultAttempt(attempt);
    setActiveNav('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Open Dedicated Leaderboard Page (Full Page, Not Popup)
  const openLeaderboardPage = useCallback((scope = 'overall') => {
    setAdminInspectedUser(null);
    setLeaderboardScope(scope);
    setActiveNav('leaderboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Admin Whole-Scorecard Inspector: Open any candidate's complete Scorecard (all attempted mocks + solutions)
  const openAdminUserScorecard = useCallback(
    async (targetUid: string, targetCandidateName: string, preferredMockId?: string) => {
      if (!isAdmin && !hasStoredAdminConsoleSession()) {
        setBannerMessage('Administrator authentication is required to inspect other candidates.');
        return;
      }
      setInspectingUid(targetUid);
      setBannerMessage(null);
      try {
        const [profile, attempts] = await Promise.all([
          fetchUserProfileByUid(targetUid),
          fetchUserAttempts(targetUid),
        ]);

        const allCompleted = attempts.filter((a) => a.status === 'completed');
        const activeCompleted = allCompleted.filter((a) => activeMockIdsSet.has(a.mockId));
        const completed = activeCompleted.length > 0 ? activeCompleted : allCompleted;

        if (completed.length === 0) {
          setBannerMessage(
            `${targetCandidateName || targetUid} has not completed any mock tests yet.`
          );
          return;
        }

        const preferredAttempt = preferredMockId
          ? completed.find((a) => a.mockId === preferredMockId)
          : undefined;
        const selectedAttempt = preferredAttempt || completed[completed.length - 1];

        const cohortList = sortAndRankEqualMocksCohort(
          overallLeaderboard,
          Math.max(1, completed.length)
        );
        const cohortRank = cohortList.find((e) => e.uid === targetUid)?.rank || null;
        const avgScore = Number(
          (
            completed.reduce((acc, a) => acc + Number(a.score || 0), 0) / completed.length
          ).toFixed(2)
        );

        const resolvedName =
          targetCandidateName ||
          (profile?.username ? `@${profile.username}` : profile?.fullName || targetUid);

        setAdminInspectedUser({
          uid: targetUid,
          candidateName: resolvedName,
          profile,
          completedAttempts: completed,
          cohortRank,
          overallAverageScore: avgScore,
        });
        setViewingResultAttempt(selectedAttempt);
        setActiveNav('result');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        setBannerMessage(
          err instanceof Error ? err.message : 'Failed to load candidate whole scorecard.'
        );
      } finally {
        setInspectingUid(null);
      }
    },
    [activeMockIdsSet, isAdmin, overallLeaderboard]
  );

  // Admin: Open any candidate's attempted mock in read-only Mock Screen Solutions view
  const openInspectedAttemptSolutionsInMockScreen = useCallback(
    async (attempt: ExamAttempt) => {
      const matchedBp = blueprints.find((b) => b.mockId === attempt.mockId);
      const resolvedBp: MockBlueprint = matchedBp || {
        mockId: attempt.mockId,
        dayNumber: attempt.dayNumber || 1,
        title: `DSSSB Mock - ${attempt.mockId}`,
        category: 'DSSSB TGT Computer Science',
        enabled: true,
        unlockDateIST: challengeConfig.startDateIST,
        durationMinutes: 120,
        totalQuestions: 200,
        correctMarks: 1,
        incorrectMarks: -0.25,
        unattemptedMarks: 0,
        maxMarks: 200,
        answerReleasePolicy: 'after-submission',
        sections: DEFAULT_SECTIONS_CLIENT,
      };
      setStartingMockId(attempt.mockId);
      try {
        const syncedPaper = await fetchMockPaperSingleReadCached(attempt.mockId, false);
        const paperData = await fetchExamPaperSafe({
          dayNumber: resolvedBp.dayNumber,
          startDateIST: challengeConfig.startDateIST,
          isPaused: challengeConfig.isPaused,
          blueprintOverride: resolvedBp,
          syncedQuestions: syncedPaper?.questions,
          isAdminPreview: true,
        });

        const finalQuestions: PublicQuestion[] =
          syncedPaper && syncedPaper.questions.length > 0
            ? syncedPaper.questions
            : paperData.questions;
        const finalTitle =
          syncedPaper?.paperDoc?.title || paperData.title || resolvedBp.title;

        setActiveExam({
          mockId: attempt.mockId,
          dayNumber: attempt.dayNumber,
          title: finalTitle,
          durationMinutes: resolvedBp.durationMinutes || paperData.durationMinutes,
          correctMarks: resolvedBp.correctMarks || paperData.correctMarks,
          incorrectMarks: resolvedBp.incorrectMarks ?? paperData.incorrectMarks,
          maxMarks: Number((finalQuestions.length * (resolvedBp.correctMarks || 1)).toFixed(2)),
          sections: paperData.sections,
          questions: finalQuestions,
          attempt,
          mode: 'solutions',
          blueprint: resolvedBp,
          isCustomUploadedPaper: Boolean(syncedPaper && syncedPaper.questions.length > 0),
        });
      } catch (err) {
        setBannerMessage(
          err instanceof Error ? err.message : 'Failed to open candidate mock solutions screen.'
        );
      } finally {
        setStartingMockId(null);
      }
    },
    [blueprints, challengeConfig.isPaused, challengeConfig.startDateIST]
  );

  // Share Mock Test or Mock Score in Text Format with Link Below to Attempt It
  const handleShareMockOrScoreText = async (
    bp: MockBlueprint,
    completedAttempt?: ExamAttempt
  ) => {
    const shareUrl = `${window.location.origin}/?mock=${encodeURIComponent(bp.mockId)}`;
    const textLines = completedAttempt
      ? [
          `🏆 MockRank — Official DSSSB Mock Score`,
          `Candidate: @${userProfile?.username || userProfile?.fullName || 'Aspirant'}`,
          `Category: ${bp.category || 'DSSSB TGT Computer Science'}`,
          `Mock Test: ${bp.title}`,
          `Total Score: ${completedAttempt.score.toFixed(2)} / ${bp.maxMarks.toFixed(0)} (Part A: ${(
            completedAttempt.partAScore ?? 0
          ).toFixed(2)} | Part B: ${(completedAttempt.partBScore ?? 0).toFixed(2)})`,
          `Accuracy: ${completedAttempt.accuracy.toFixed(1)}%`,
          ``,
          `Attempt this Mock Test here:`,
          shareUrl,
        ]
      : [
          `📝 MockRank — DSSSB Mock Test Invitation`,
          `Category: ${bp.category || 'DSSSB TGT Computer Science'}`,
          `Mock Name: ${bp.title}`,
          `Duration: ${bp.durationMinutes} Mins | Marking: +${bp.correctMarks} / ${bp.incorrectMarks}`,
          `Status: ${
            bp.isUnlockedByServerTime
              ? 'Unlocked & Available Now'
              : `Unlocks on ${bp.unlockDateIST}`
          }`,
          ``,
          `Attempt this Mock Test here:`,
          shareUrl,
        ];

    const fullText = textLines.join('\n');
    const key = completedAttempt ? `score_${bp.mockId}` : `mock_${bp.mockId}`;

    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedShareKey(key);
      setBannerMessage(
        `Copied "${bp.title}" ${
          completedAttempt ? 'Score & Attempt Link' : 'Details & Attempt Link'
        } in text format!`
      );
      window.setTimeout(() => setCopiedShareKey(null), 3000);
    } catch {
      setBannerMessage(fullText);
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: bp.title,
          text: fullText,
        });
      } catch {
        // Ignore user share cancellation
      }
    }
  };

  // Direct Gmail + Username Login Handler (Works on mock.dsssbpyq.online & any custom domain without Firebase unauthorized-domain error)
  const completeDirectGmailSession = async (emailRaw: string, customUsernameRaw?: string) => {
    const cleanEmail = emailRaw.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setAuthError('Please enter a valid Gmail ID (e.g., yourname@gmail.com).');
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      if (auth.currentUser && auth.currentUser.email?.toLowerCase() !== cleanEmail) {
        try {
          await signOut(auth);
        } catch {
          // Ignore if sign-out is not needed
        }
      }

      const fallbackName =
        (customUsernameRaw || '').trim() || cleanEmail.split('@')[0] || 'Aspirant';
      const sessionObj: AppUserSession = {
        uid: deriveDeterministicUidFromEmail(cleanEmail),
        email: cleanEmail,
        displayName: fallbackName,
        photoURL: null,
        emailVerified: true,
        isCustomDomainSession: true,
      };

      saveCustomDomainUserSession(sessionObj);
      setFirebaseUser(sessionObj);
      await hydrateAuthenticatedCandidate(sessionObj, (customUsernameRaw || '').trim());
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in with Gmail ID.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDirectGmailFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await completeDirectGmailSession(gmailLoginInput, gmailUsernameInput);
  };

  // Google Sign-In Handler (Automatically avoids auth/unauthorized-domain on custom domains like mock.dsssbpyq.online)
  const handleGoogleSignIn = async () => {
    // If the user already typed their Gmail ID in the input box, sign in directly with it
    if (gmailLoginInput.trim().includes('@')) {
      await completeDirectGmailSession(gmailLoginInput, gmailUsernameInput);
      return;
    }

    // If running on custom domain (mock.dsssbpyq.online), focus the Gmail ID input instead of triggering Firebase's unauthorized domain popup
    if (isCustomHostedDomain()) {
      const inputEl = document.getElementById('candidate-gmail-input');
      if (inputEl) {
        inputEl.focus();
      }
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('auth/unauthorized-domain') ||
        msg.includes('auth/popup-blocked') ||
        msg.includes('auth/cancelled-popup-request') ||
        msg.includes('auth/operation-not-supported')
      ) {
        setAuthError(null);
        const inputEl = document.getElementById('candidate-gmail-input');
        if (inputEl) inputEl.focus();
      } else {
        setAuthError(msg || 'Gmail Sign-In failed. Please enter your Gmail ID below.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  // Sign Out Handler (Clears Firebase Auth, Custom Domain session, and Admin Console Rights)
  const handleSignOut = async () => {
    clearCustomDomainUserSession();
    setStoredAdminConsoleSession(false);
    try {
      await signOut(auth);
    } catch {
      // Ignore if Firebase auth wasn't active
    }
    setFirebaseUser(null);
    setUserProfile(null);
    setIsAdmin(false);
    setAdminInspectedUser(null);
    setUserAttempts([]);
  };

  // Save Candidate Username Handler
  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !usernameInput.trim()) return;
    setSavingUsername(true);
    try {
      const clean = usernameInput.trim();
      const targetUid = userProfile?.uid || firebaseUser.uid;
      await saveCandidateUsername(targetUid, clean);
      await reloadUserData();
      setShowUsernameModal(false);
      setBannerMessage(`Username set to "${clean}".`);
      if (pendingMockAfterUsername) {
        const nextMock = pendingMockAfterUsername;
        setPendingMockAfterUsername(null);
        await startMockInternal(nextMock, clean);
      }
    } catch (err) {
      setBannerMessage(err instanceof Error ? err.message : 'Failed to save username.');
    } finally {
      setSavingUsername(false);
    }
  };

  const startMockInternal = async (
    bp: MockBlueprint,
    verifiedUsername?: string,
    options?: { forceReattempt?: boolean; mode?: 'exam' | 'solutions' }
  ) => {
    if (!bp.isUnlockedByServerTime && !isAdmin) {
      setBannerMessage(`${bp.title} unlocks on ${bp.unlockDateIST} (IST).`);
      return;
    }
    if (!bp.enabled && !isAdmin) {
      setBannerMessage(`${bp.title} is currently disabled by the administrator.`);
      return;
    }

    setStartingMockId(bp.mockId);
    setBannerMessage(null);

    try {
      const syncedPaper = await fetchMockPaperSingleReadCached(bp.mockId, false);

      const paperData = await fetchExamPaperSafe({
        dayNumber: bp.dayNumber,
        startDateIST: challengeConfig.startDateIST,
        isPaused: challengeConfig.isPaused,
        blueprintOverride: bp,
        syncedQuestions: syncedPaper?.questions,
        isAdminPreview: isAdmin,
      });

      if (!firebaseUser || !userProfile) return;

      const finalQuestions: PublicQuestion[] =
        syncedPaper && syncedPaper.questions.length > 0
          ? syncedPaper.questions
          : paperData.questions;

      const finalTitle =
        syncedPaper?.paperDoc?.title || paperData.title || bp.title;

      const attemptDoc = await createOrResumeExamAttempt({
        uid: userProfile.uid,
        mockId: bp.mockId,
        dayNumber: bp.dayNumber,
        startedAt: paperData.startedAtUTC,
        expiresAt: paperData.expiresAtUTC,
        questionBankVersion:
          syncedPaper?.paperDoc?.version || paperData.questionBankVersion || 1,
        forceReattempt: Boolean(options?.forceReattempt),
      });

      if (
        attemptDoc.status === 'completed' &&
        !options?.forceReattempt &&
        options?.mode !== 'solutions'
      ) {
        openResultPage(attemptDoc);
        return;
      }

      if (verifiedUsername) {
        setUserProfile((prev) =>
          prev ? { ...prev, username: verifiedUsername, fullName: verifiedUsername } : prev
        );
      }

      setActiveExam({
        mockId: bp.mockId,
        dayNumber: bp.dayNumber,
        title: finalTitle,
        durationMinutes: bp.durationMinutes || paperData.durationMinutes,
        correctMarks: bp.correctMarks || paperData.correctMarks,
        incorrectMarks: bp.incorrectMarks ?? paperData.incorrectMarks,
        maxMarks: Number((finalQuestions.length * (bp.correctMarks || 1)).toFixed(2)),
        sections: paperData.sections,
        questions: finalQuestions,
        attempt: attemptDoc,
        mode:
          options?.mode ||
          (attemptDoc.status === 'completed' && !options?.forceReattempt
            ? 'solutions'
            : 'exam'),
        blueprint: bp,
        isCustomUploadedPaper: Boolean(syncedPaper && syncedPaper.questions.length > 0),
      });
    } catch (err) {
      setBannerMessage(err instanceof Error ? err.message : 'Failed to start mock test.');
    } finally {
      setStartingMockId(null);
    }
  };

  const handleStartMock = async (
    bp: MockBlueprint,
    options?: { forceReattempt?: boolean; mode?: 'exam' | 'solutions' }
  ) => {
    if (!firebaseUser) {
      await handleGoogleSignIn();
      return;
    }

    const currentUsername = (userProfile?.username || '').trim();
    if (!currentUsername) {
      setPendingMockAfterUsername(bp);
      setShowUsernameModal(true);
      return;
    }

    await startMockInternal(bp, currentUsername, options);
  };

  const handleExamAutosave = async (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number
  ) => {
    if (!activeExam) return;
    await autosaveExamAttemptProgress({
      attemptId: activeExam.attempt.attemptId,
      responses,
      markedForReview,
      timeTakenSeconds,
    });
  };

  const handleExamFinalSubmit = async (
    responses: Record<string, number>,
    markedForReview: string[],
    timeTakenSeconds: number,
    autoSubmitReason?: string
  ) => {
    if (!activeExam) return;

    try {
      const evaluation = await evaluateExamAttemptSafe({
        mockId: activeExam.mockId,
        dayNumber: activeExam.dayNumber,
        responses,
        timeTakenSeconds,
        correctMarks: activeExam.correctMarks,
        incorrectMarks: activeExam.incorrectMarks,
        sections: activeExam.sections,
        questions: activeExam.questions,
      });

      const completedAttempt: ExamAttempt = {
        ...activeExam.attempt,
        status: 'completed',
        submittedAt: new Date().toISOString().slice(0, 40),
        responses,
        markedForReview,
        score: evaluation.score,
        partAScore: evaluation.partAScore,
        partBScore: evaluation.partBScore,
        correctAnswers: evaluation.correctAnswers,
        incorrectAnswers: evaluation.incorrectAnswers,
        unattemptedQuestions: evaluation.unattemptedQuestions,
        accuracy: evaluation.accuracy,
        timeTakenSeconds: evaluation.timeTakenSeconds,
        sectionScores: evaluation.sectionScores,
      };

      if (userProfile) {
        const displayUsername = userProfile.username || userProfile.fullName || 'Aspirant';
        await finalizeExamSubmissionAndSyncLeaderboards({
          attempt: activeExam.attempt,
          candidateName: displayUsername,
          responses,
          markedForReview,
          evaluation,
          allCompletedUserAttempts: userAttempts,
        });
        await reloadUserData();
      }

      setActiveExam(null);
      if (autoSubmitReason) {
        setBannerMessage(autoSubmitReason);
      }
      openResultPage(completedAttempt);
    } catch (err) {
      setBannerMessage(err instanceof Error ? err.message : 'Submission error occurred.');
      setActiveExam(null);
    }
  };

  // Render CBT Terminal if an exam is active
  if (activeExam) {
    return (
      <ExamTerminalModal
        mockId={activeExam.mockId}
        dayNumber={activeExam.dayNumber}
        title={activeExam.title}
        candidateName={
          adminInspectedUser
            ? adminInspectedUser.candidateName
            : userProfile?.username || userProfile?.fullName || 'Candidate'
        }
        candidateEmail={
          adminInspectedUser
            ? adminInspectedUser.profile?.email || 'candidate@mockrank.in'
            : userProfile?.email || 'candidate@mockrank.in'
        }
        durationMinutes={activeExam.durationMinutes}
        correctMarks={activeExam.correctMarks}
        incorrectMarks={activeExam.incorrectMarks}
        sections={activeExam.sections}
        questions={activeExam.questions}
        attempt={activeExam.attempt}
        initialMode={activeExam.mode || 'exam'}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onReattemptMock={
          adminInspectedUser
            ? undefined
            : async () => {
                const bp =
                  activeExam.blueprint ||
                  blueprints.find((b) => b.mockId === activeExam.mockId);
                if (bp) {
                  await handleStartMock(bp, { forceReattempt: true, mode: 'exam' });
                }
              }
        }
        onAutosave={handleExamAutosave}
        onSubmitFinal={handleExamFinalSubmit}
        onExitWithoutSubmit={() => {
          setActiveExam(null);
          reloadUserData();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Bar — Responsive Single Row on Desktop, 2-Row with Segmented Nav on Mobile */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30 transition-colors">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-8">
          {/* Zone 1: Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setAdminInspectedUser(null);
              setActiveNav('dashboard');
            }}
            className="text-lg sm:text-xl font-bold tracking-tight text-slate-950 dark:text-white font-display whitespace-nowrap shrink-0"
          >
            MockRank
          </a>

          {/* Zone 2: Desktop Primary Full-Page Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <button
              type="button"
              onClick={() => {
                setAdminInspectedUser(null);
                setActiveNav('dashboard');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'dashboard'
                  ? 'text-slate-950 dark:text-white font-semibold border-b-2 border-slate-900 dark:border-white'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminInspectedUser(null);
                setActiveNav('mocks');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'mocks'
                  ? 'text-slate-950 dark:text-white font-semibold border-b-2 border-slate-900 dark:border-white'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Mocks ({blueprints.length})
            </button>
            <button
              type="button"
              onClick={() => openLeaderboardPage('overall')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'leaderboard'
                  ? 'text-slate-950 dark:text-white font-semibold border-b-2 border-slate-900 dark:border-white'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Leaderboard
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminInspectedUser(null);
                setActiveNav('mistake-vault');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'mistake-vault'
                  ? 'text-rose-600 dark:text-rose-400 font-semibold border-b-2 border-rose-600 dark:border-rose-400'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Mistake Vault
            </button>
          </nav>

          {/* Zone 3: Admin Rights Indicator, Dark Mode Toggle & Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAdminModal(true)}
                title="Admin Rights Active — Click to reopen Admin Console"
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin Active</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={
                darkMode
                  ? 'Switch to Light Mode'
                  : 'Switch to Dark Mode for late-night study sessions'
              }
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {darkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200" />
                  <span>Dark</span>
                </>
              )}
            </button>

            {firebaseUser ? (
              <button
                type="button"
                onClick={() => {
                  setAdminInspectedUser(null);
                  setActiveNav('mocks');
                }}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Attempt Mocks
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={authBusy}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Login with Gmail
              </button>
            )}
          </div>
        </div>

        {/* Mobile Segmented Navigation Bar (< md) */}
        <nav className="md:hidden grid grid-cols-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => {
              setAdminInspectedUser(null);
              setActiveNav('dashboard');
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              activeNav === 'dashboard'
                ? 'text-slate-950 dark:text-white font-bold border-b-2 border-slate-900 dark:border-white bg-white dark:bg-slate-900'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminInspectedUser(null);
              setActiveNav('mocks');
            }}
            className={`py-2.5 text-center transition-colors border-x border-slate-200/70 dark:border-slate-800/70 cursor-pointer ${
              activeNav === 'mocks'
                ? 'text-slate-950 dark:text-white font-bold border-b-2 border-b-slate-900 dark:border-b-white bg-white dark:bg-slate-900'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Mocks ({blueprints.length})
          </button>
          <button
            type="button"
            onClick={() => openLeaderboardPage('overall')}
            className={`py-2.5 text-center transition-colors border-r border-slate-200/70 dark:border-slate-800/70 cursor-pointer ${
              activeNav === 'leaderboard'
                ? 'text-slate-950 dark:text-white font-bold border-b-2 border-b-slate-900 dark:border-b-white bg-white dark:bg-slate-900'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Leaderboard
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminInspectedUser(null);
              setActiveNav('mistake-vault');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              activeNav === 'mistake-vault'
                ? 'text-rose-600 dark:text-rose-400 font-bold border-b-2 border-rose-600 dark:border-rose-400 bg-white dark:bg-slate-900'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Mistake Vault
          </button>
        </nav>
      </header>

      {/* Notification Banner */}
      {bannerMessage && (
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900 dark:bg-slate-800 text-white text-xs flex items-center justify-between gap-4 border-b border-slate-800 dark:border-slate-700">
          <span className="whitespace-pre-line">{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="underline text-slate-300 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-8">
        {!authReady ? (
          <div className="py-20 text-center text-sm text-slate-500 dark:text-slate-400">
            Initializing MockRank...
          </div>
        ) : !firebaseUser ? (
          /* Unauthenticated Portal: Clean Heading Without Extra Text Below */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 items-start py-2 sm:py-6">
            <div className="lg:col-span-7 space-y-5 sm:space-y-6">
              <h1
                className="text-2xl sm:text-4xl font-bold text-slate-950 dark:text-white tracking-tight leading-tight"
                style={{ textWrap: 'balance' }}
              >
                Real Aspirants. Real Mocks. Real Ranks.
              </h1>

              {/* Key Platform Specifications */}
              <div className="grid grid-cols-3 gap-2.5 sm:gap-4 pt-1">
                <div className="p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                    Platform Access
                  </div>
                  <div className="text-base sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                    100% Free
                  </div>
                </div>

                <div className="p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                    Exam Pattern
                  </div>
                  <div className="text-base sm:text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    DSSSB CBT
                  </div>
                </div>

                <div className="p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                    Cohort Ranking
                  </div>
                  <div className="text-base sm:text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    Equal Mocks
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Gmail Sign-In Card (Works seamlessly on mock.dsssbpyq.online & all domains) */}
            <div className="lg:col-span-5 p-5 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Candidate Gmail Login
              </h2>

              {authError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
                  {authError}
                </div>
              )}

              <form onSubmit={handleDirectGmailFormSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="candidate-gmail-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Gmail ID
                  </label>
                  <input
                    id="candidate-gmail-input"
                    type="email"
                    required
                    value={gmailLoginInput}
                    onChange={(e) => setGmailLoginInput(e.target.value)}
                    placeholder="yourname@gmail.com"
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono focus:outline-none focus:border-slate-900 dark:focus:border-slate-300"
                  />
                </div>

                <div>
                  <label
                    htmlFor="candidate-username-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Candidate Username
                  </label>
                  <input
                    id="candidate-username-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={40}
                    value={gmailUsernameInput}
                    onChange={(e) => setGmailUsernameInput(e.target.value)}
                    placeholder="e.g., Tanu_CS_Aspirant"
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono focus:outline-none focus:border-slate-900 dark:focus:border-slate-300"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 text-xs sm:text-sm font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  <span>{authBusy ? 'Signing In...' : 'Login with Gmail ID'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {!isCustomHostedDomain() && (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={authBusy}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  <span>Or One-Click Google Popup Login</span>
                </button>
              )}
            </div>
          </div>
        ) : activeNav === 'result' && viewingResultAttempt ? (
          /* Dedicated Full-Page View for Mock Score & Performance Analysis (Own or Admin-Inspected Candidate) */
          <div className="space-y-6">
            {adminInspectedUser && (
              <div className="p-4 sm:p-5 rounded-xl border-2 border-emerald-500/70 dark:border-emerald-600/80 bg-emerald-50/60 dark:bg-emerald-950/30 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-800 dark:text-emerald-300">
                      <Shield className="w-3.5 h-3.5" />
                      <span>ADMIN WHOLE SCORECARD INSPECTOR</span>
                    </div>
                    <h2 className="text-base sm:text-xl font-bold text-slate-950 dark:text-white">
                      {adminInspectedUser.candidateName}
                      {adminInspectedUser.profile?.email && (
                        <span className="ml-2 text-xs font-mono font-normal text-slate-600 dark:text-slate-400">
                          ({adminInspectedUser.profile.email})
                        </span>
                      )}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-700 dark:text-slate-300">
                      <span>
                        Overall Avg:{' '}
                        <strong>{adminInspectedUser.overallAverageScore.toFixed(2)}</strong>
                      </span>
                      <span>
                        Part A Avg:{' '}
                        <strong>
                          {(adminInspectedUser.profile?.partAAverageScore ?? 0).toFixed(2)}
                        </strong>
                      </span>
                      <span>
                        Part B Avg:{' '}
                        <strong>
                          {(adminInspectedUser.profile?.partBAverageScore ?? 0).toFixed(2)}
                        </strong>
                      </span>
                      <span>
                        Completed Mocks:{' '}
                        <strong>{adminInspectedUser.completedAttempts.length}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLeaderboardPage('overall')}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Back to Leaderboard
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAdminModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Admin Console</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdminInspectedUser(null);
                        setViewingResultAttempt(null);
                        setActiveNav('dashboard');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Exit Inspector</span>
                    </button>
                  </div>
                </div>

                {/* Switch between all Mocks attempted by this Candidate */}
                <div className="pt-3 border-t border-emerald-200/80 dark:border-emerald-900/60 space-y-2">
                  <div className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-300 uppercase tracking-wide">
                    Select Mock Attempt to Inspect Complete Scorecard (
                    {adminInspectedUser.completedAttempts.length} Attempted):
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {adminInspectedUser.completedAttempts.map((att) => {
                      const bpTitle =
                        blueprints.find((b) => b.mockId === att.mockId)?.title || att.mockId;
                      const isCurrent = att.attemptId === viewingResultAttempt.attemptId;
                      return (
                        <button
                          key={att.attemptId}
                          type="button"
                          onClick={() => setViewingResultAttempt(att)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-slate-900 dark:border-white'
                              : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {bpTitle} ·{' '}
                          <span className="font-mono font-bold">{att.score.toFixed(2)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <MockResultModal
              attempt={viewingResultAttempt}
              candidateName={
                adminInspectedUser
                  ? adminInspectedUser.candidateName
                  : userProfile?.username
                  ? `@${userProfile.username}`
                  : userProfile?.fullName
              }
              mockTitle={
                blueprints.find((b) => b.mockId === viewingResultAttempt.mockId)?.title ||
                `DSSSB Mock - ${viewingResultAttempt.mockId}`
              }
              maxMarks={
                blueprints.find((b) => b.mockId === viewingResultAttempt.mockId)?.maxMarks || 200
              }
              answerReleasePolicy={
                challengeConfig.delayedAnswerRelease
                  ? 'after-challenge'
                  : blueprints.find((b) => b.mockId === viewingResultAttempt.mockId)
                      ?.answerReleasePolicy || 'after-submission'
              }
              startDateIST={challengeConfig.startDateIST}
              isAdmin={isAdmin}
              mockLeaderboard={selectedMockLeaderboard}
              overallAverageScore={
                adminInspectedUser
                  ? adminInspectedUser.overallAverageScore
                  : userProfile?.averageScore || viewingResultAttempt.score
              }
              overallRank={
                adminInspectedUser ? adminInspectedUser.cohortRank : myEqualCohortRank
              }
              onBackToMocks={() => {
                setAdminInspectedUser(null);
                setActiveNav('mocks');
              }}
              onBackToDashboard={() => {
                setAdminInspectedUser(null);
                setActiveNav('dashboard');
              }}
              onOpenLeaderboard={(mockId) => openLeaderboardPage(mockId)}
              onReattemptMock={
                adminInspectedUser
                  ? undefined
                  : () => {
                      const bp = blueprints.find(
                        (b) => b.mockId === viewingResultAttempt.mockId
                      );
                      if (bp) {
                        handleStartMock(bp, { forceReattempt: true, mode: 'exam' });
                      }
                    }
              }
              onOpenMockSolutionsScreen={() => {
                if (adminInspectedUser) {
                  openInspectedAttemptSolutionsInMockScreen(viewingResultAttempt);
                } else {
                  const bp = blueprints.find((b) => b.mockId === viewingResultAttempt.mockId);
                  if (bp) {
                    handleStartMock(bp, { mode: 'solutions' });
                  }
                }
              }}
            />
          </div>
        ) : activeNav === 'leaderboard' ? (
          /* Dedicated Full-Page View for Leaderboard (Not Popup Mode) */
          <LeaderboardModal
            currentUid={userProfile?.uid || ''}
            currentUserMocksAttempted={completedAttemptsCount}
            initialScope={leaderboardScope}
            overallEntries={overallLeaderboard}
            blueprints={blueprints}
            isAdmin={isAdmin}
            inspectingUid={inspectingUid}
            onInspectUserScorecard={openAdminUserScorecard}
            onRefreshOverall={() => setLeaderboardRefreshNonce((n) => n + 1)}
            onBackToDashboard={() => {
              setAdminInspectedUser(null);
              setActiveNav('dashboard');
            }}
            onBackToMocks={() => {
              setAdminInspectedUser(null);
              setActiveNav('mocks');
            }}
          />
        ) : activeNav === 'mistake-vault' ? (
          /* Dedicated Full-Page View for Mistake Vault (Beside Leaderboard) */
          <MistakeVaultModal
            completedAttempts={completedAttempts}
            blueprints={blueprints}
            startDateIST={challengeConfig.startDateIST}
            onBackToDashboard={() => setActiveNav('dashboard')}
            onBackToMocks={() => setActiveNav('mocks')}
            onOpenMockSolutions={(bp) => handleStartMock(bp, { mode: 'solutions' })}
          />
        ) : (
          /* Authenticated Student Views: Dashboard | Mocks */
          <div className="space-y-6 sm:space-y-8">
            {/* Sub-header Context Strip (No Admin Login button here — Admin Login is aligned below in Footer) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
              <h1 className="text-lg sm:text-2xl font-bold text-slate-950 dark:text-white truncate max-w-[180px] sm:max-w-none">
                {userProfile?.username
                  ? `@${userProfile.username}`
                  : userProfile?.fullName || 'Candidate'}
              </h1>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUsernameInput(userProfile?.username || '');
                    setShowUsernameModal(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[130px] sm:max-w-none">
                    {userProfile?.username ? `${userProfile.username}` : 'Set Username'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">Sign Out</span>
                </button>
              </div>
            </div>

            {activeNav === 'dashboard' && (
              <div className="space-y-6 sm:space-y-8">
                {/* Top Row: Personal Rank (Equal-Mocks Cohort) + Average Score + Part A & Part B Average Scores (2x2 on Mobile!) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                  <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-tight">
                      Personal Rank (Equal Cohort)
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                      {completedAttemptsCount > 0 && myEqualCohortRank
                        ? `#${myEqualCohortRank}`
                        : 'Unranked'}
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {completedAttemptsCount > 0
                        ? `Peers (${completedAttemptsCount} mock${
                            completedAttemptsCount > 1 ? 's' : ''
                          }): ${Math.max(1, equalMocksCohortLeaderboard.length)}`
                        : 'Attempt 1 mock'}
                    </div>
                  </div>

                  <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-tight">
                      Overall Average Score
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                      {effectiveAverageScore.toFixed(2)}
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Mocks: {completedAttemptsCount} · Acc:{' '}
                      {effectiveAverageAccuracy.toFixed(1)}%
                    </div>
                  </div>

                  <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-tight">
                      Part A Average Score
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                      {partAAvg.toFixed(2)}
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                      GA · Reas · Maths · HI · EN
                    </div>
                  </div>

                  <div className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-tight">
                      Part B Avg (CS + Teaching)
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-slate-950 dark:text-white mt-1">
                      {partBAvg.toFixed(2)}
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                      Computer Science + Teaching
                    </div>
                  </div>
                </div>

                {/* Section-Wise Average Scores (All 7 Sections — 2-Column Grid on Mobile) */}
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Section-Wise Average Score Breakdown
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveNav('mocks')}
                      className="px-3 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                    >
                      Go to Mocks →
                    </button>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                    {SECTION_CARDS_META.map((sec) => {
                      const avgVal = sectionAvgMap[sec.subject] ?? 0;
                      return (
                        <div
                          key={sec.subject}
                          className="p-3.5 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-[11px] sm:text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                                {sec.part}
                              </span>
                              <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 dark:text-slate-500">
                                Avg
                              </span>
                            </div>
                            <h3 className="text-xs sm:text-base font-bold text-slate-950 dark:text-white mt-1 leading-snug">
                              {sec.label}
                            </h3>
                          </div>

                          <div className="pt-2.5 sm:pt-4 mt-2.5 sm:mt-4 border-t border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
                            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                              Score
                            </span>
                            <span className="text-lg sm:text-2xl font-bold font-mono text-slate-950 dark:text-white">
                              {avgVal.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Combined Part A + Part B Summary Card */}
                    <div className="p-3.5 sm:p-5 rounded-xl border border-slate-900 dark:border-slate-700 bg-slate-900 dark:bg-slate-800 text-white flex flex-col justify-between">
                      <div>
                        <div className="text-[10px] sm:text-xs font-mono text-slate-400">
                          Part-Wise Total
                        </div>
                        <h3 className="text-xs sm:text-base font-bold mt-1 leading-snug">
                          Part A + Part B
                        </h3>
                        <div className="mt-2 sm:mt-3 space-y-1 text-[11px] sm:text-xs font-mono">
                          <div className="flex items-center justify-between text-slate-300">
                            <span>Part A:</span>
                            <span className="font-bold text-white">{partAAvg.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-300">
                            <span>Part B:</span>
                            <span className="font-bold text-white">{partBAvg.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2.5 sm:pt-3 mt-2.5 sm:mt-3 border-t border-slate-800 dark:border-slate-700 flex items-baseline justify-between">
                        <span className="text-[11px] sm:text-xs text-slate-300">Total Avg</span>
                        <span className="text-lg sm:text-2xl font-bold font-mono text-white">
                          {effectiveAverageScore.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Equal-Mocks Cohort Leaderboard Preview Table */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Equal-Mocks Cohort Standings ({completedAttemptsCount} Mock
                      {completedAttemptsCount === 1 ? '' : 's'} Attempted)
                    </h2>
                    <button
                      type="button"
                      onClick={() => openLeaderboardPage('overall')}
                      className="text-xs font-semibold text-slate-900 dark:text-slate-200 hover:underline cursor-pointer"
                    >
                      Open Full-Page Leaderboard →
                    </button>
                  </div>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto bg-white dark:bg-slate-900">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold whitespace-nowrap">
                            Rank
                          </th>
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold whitespace-nowrap">
                            Candidate
                          </th>
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold text-right whitespace-nowrap">
                            Avg Score
                          </th>
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold text-right whitespace-nowrap">
                            Part A
                          </th>
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold text-right whitespace-nowrap">
                            Part B
                          </th>
                          <th className="py-2.5 sm:py-3 px-3 sm:px-4 font-semibold text-right whitespace-nowrap">
                            Mocks
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {equalMocksCohortLeaderboard.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="py-8 text-center text-slate-500 dark:text-slate-400"
                            >
                              Complete a mock test to appear in your equal-mock peer cohort ranking.
                            </td>
                          </tr>
                        ) : (
                          equalMocksCohortLeaderboard.slice(0, 10).map((entry) => {
                            const isMe = entry.uid === userProfile?.uid;
                            return (
                              <tr
                                key={entry.uid}
                                className={
                                  isMe
                                    ? 'bg-slate-900/5 dark:bg-slate-800 font-semibold text-slate-950 dark:text-white'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                }
                              >
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 font-mono font-bold whitespace-nowrap">
                                  #{entry.rank}
                                </td>
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 whitespace-nowrap">
                                  {isAdmin ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAdminUserScorecard(entry.uid, entry.candidateName)
                                      }
                                      className="font-semibold hover:underline text-left cursor-pointer"
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
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right font-mono font-bold whitespace-nowrap">
                                  {isAdmin ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAdminUserScorecard(entry.uid, entry.candidateName)
                                      }
                                      title="Click to inspect whole scorecard"
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 underline decoration-dotted cursor-pointer"
                                    >
                                      <span>
                                        {inspectingUid === entry.uid
                                          ? 'Loading...'
                                          : entry.averageScore.toFixed(2)}
                                      </span>
                                      <BarChart3 className="w-3 h-3" />
                                    </button>
                                  ) : (
                                    entry.averageScore.toFixed(2)
                                  )}
                                </td>
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right font-mono whitespace-nowrap">
                                  {(entry.partAAverageScore || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right font-mono whitespace-nowrap">
                                  {(entry.partBAverageScore || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right font-mono whitespace-nowrap">
                                  {entry.mocksAttempted}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeNav === 'mocks' && (
              <div className="space-y-6">
                {/* Clean Heading Bar (No Extra Text Below Heading) */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-xl font-bold text-slate-950 dark:text-white">
                    Mock Tests by Category
                  </h2>

                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
                    IST Date: <strong>{serverISTDate}</strong>
                  </div>
                </div>

                {/* Category Filter Tabs */}
                {blueprints.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {categoriesList.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                          selectedCategory === cat
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        <Folder className="w-3.5 h-3.5" />
                        <span>{cat}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Admin-Added Mocks Grid */}
                {filteredBlueprints.length === 0 ? (
                  <div className="p-12 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 text-center space-y-3">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      No Mock Tests Added in This Category Yet
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdminModal(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Add Mock in Admin Console</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredBlueprints.map((bp) => {
                      const attempt = attemptsByMockId[bp.mockId];
                      const isCompleted = attempt?.status === 'completed';
                      const isInProgress = attempt?.status === 'in-progress';
                      const isUnlocked = Boolean(bp.isUnlockedByServerTime || isAdmin);

                      let statusLabel = 'Locked';
                      if (isCompleted) statusLabel = 'Completed';
                      else if (isInProgress) statusLabel = 'In Progress';
                      else if (isUnlocked) statusLabel = 'Unlocked';

                      const mockShareKey = `mock_${bp.mockId}`;
                      const scoreShareKey = `score_${bp.mockId}`;

                      return (
                        <div
                          key={bp.mockId}
                          className={`p-5 rounded-xl border flex flex-col justify-between transition-all ${
                            isCompleted
                              ? 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/80'
                              : isUnlocked
                              ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 opacity-85'
                          }`}
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold truncate">
                                {bp.category || 'DSSSB TGT Computer Science'}
                              </span>
                              <span
                                className={`font-mono font-semibold shrink-0 ${
                                  isCompleted
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : isInProgress
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : isUnlocked
                                    ? 'text-slate-900 dark:text-slate-100'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            </div>

                            <h3 className="text-base font-bold text-slate-950 dark:text-white leading-snug">
                              {bp.title}
                            </h3>

                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                              <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                              <span>
                                {isUnlocked
                                  ? `Unlocked (${bp.unlockDateIST})`
                                  : `Unlocks on ${bp.unlockDateIST} (IST)`}
                              </span>
                            </div>

                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              {bp.totalQuestions} Qs · {bp.durationMinutes} Mins · +{bp.correctMarks}{' '}
                              / {bp.incorrectMarks}
                            </div>

                            {isCompleted && attempt && (
                              <div className="p-3 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-2 text-xs font-mono">
                                <div>
                                  <div className="text-[10px] text-slate-400">Total</div>
                                  <div className="font-bold text-slate-950 dark:text-white">
                                    {attempt.score.toFixed(2)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-slate-400">Part A</div>
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    {(attempt.partAScore ?? 0).toFixed(2)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-slate-400">Part B</div>
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    {(attempt.partBScore ?? 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              {isCompleted && attempt ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openResultPage(attempt)}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Scorecard</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={startingMockId === bp.mockId}
                                    onClick={() =>
                                      handleStartMock(bp, { forceReattempt: true, mode: 'exam' })
                                    }
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-900 dark:text-sky-200 bg-sky-50 dark:bg-sky-950/70 hover:bg-sky-100 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-700 rounded-lg cursor-pointer"
                                    title="Reattempt Question Paper"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>
                                      {startingMockId === bp.mockId ? 'Loading...' : 'Reattempt'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openLeaderboardPage(bp.mockId)}
                                    className="p-2 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                                    title="Open Full-Page Mock Leaderboard"
                                  >
                                    <Trophy className="w-4 h-4" />
                                  </button>
                                </>
                              ) : isUnlocked ? (
                                <button
                                  type="button"
                                  disabled={startingMockId === bp.mockId}
                                  onClick={() => handleStartMock(bp)}
                                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                  <span>
                                    {startingMockId === bp.mockId
                                      ? 'Loading Paper...'
                                      : isInProgress
                                      ? 'Resume Mock Attempt'
                                      : 'Start Mock Test'}
                                  </span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg cursor-not-allowed"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Unlocks on {bp.unlockDateIST}</span>
                                </button>
                              )}
                            </div>

                            {isCompleted && attempt && (
                              <button
                                type="button"
                                disabled={startingMockId === bp.mockId}
                                onClick={() => handleStartMock(bp, { mode: 'solutions' })}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 border border-emerald-200 dark:border-emerald-800 rounded-lg cursor-pointer"
                              >
                                <BookOpen className="w-3.5 h-3.5" />
                                <span>View Detailed Solutions in Mock Screen</span>
                              </button>
                            )}

                            {/* Share Mock Test / Share Mock Score in Text Format with Link Below */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleShareMockOrScoreText(bp)}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                              >
                                {copiedShareKey === mockShareKey ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>Mock + Link Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Share2 className="w-3 h-3" />
                                    <span>Share Mock + Link</span>
                                  </>
                                )}
                              </button>

                              {isCompleted && attempt && (
                                <button
                                  type="button"
                                  onClick={() => handleShareMockOrScoreText(bp, attempt)}
                                  className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                                >
                                  {copiedShareKey === scoreShareKey ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                      <span>Score Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Share2 className="w-3 h-3" />
                                      <span>Share Score + Link</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer with Beautiful Cards for dsssbpyq.online & Perfectly Aligned Admin Login Below */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 px-6 py-10 mt-16 transition-colors">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Beautiful Partner Cards Linking to dsssbpyq.online */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Official Previous Year Question Portal — dsssbpyq.online
              </h3>
              <a
                href="https://dsssbpyq.online"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-200 hover:underline"
              >
                <span>Visit dsssbpyq.online</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href="https://dsssbpyq.online"
                target="_blank"
                rel="noopener noreferrer"
                className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-900 dark:hover:border-slate-500 transition-all flex flex-col justify-between shadow-2xs"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                      <FileText className="w-4 h-4" />
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white flex items-center gap-1">
                      dsssbpyq.online <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-950 dark:text-white">
                    DSSSB Official PYQ Papers
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Access authentic shift-wise DSSSB Previous Year Question Papers with official
                    answer keys for Part A &amp; Part B.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                  <span>Practice PYQ Shifts</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </a>

              <a
                href="https://dsssbpyq.online"
                target="_blank"
                rel="noopener noreferrer"
                className="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-900 dark:hover:border-slate-500 transition-all flex flex-col justify-between shadow-2xs"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                      <Layers className="w-4 h-4" />
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white flex items-center gap-1">
                      dsssbpyq.online <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-950 dark:text-white">
                    Subject &amp; Topic-Wise PYQ Bank
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Master Hindi, English, Maths, Reasoning, General Awareness &amp; Computer
                    Science questions asked in real DSSSB exams.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                  <span>Explore Subject PYQs</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </a>

              <a
                href="https://dsssbpyq.online"
                target="_blank"
                rel="noopener noreferrer"
                className="group p-5 rounded-xl border border-slate-900 dark:border-slate-700 bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 transition-all flex flex-col justify-between shadow-2xs"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-slate-800 dark:bg-slate-900 text-white">
                      <BookOpen className="w-4 h-4" />
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-300 flex items-center gap-1">
                      dsssbpyq.online <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white">
                    DSSSB TGT/PGT Complete Archive
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Download and attempt verified DSSSB PYQ sets directly on dsssbpyq.online to
                    boost your exam accuracy.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-slate-800 dark:border-slate-700 text-xs font-semibold text-white flex items-center justify-between">
                  <span>Open dsssbpyq.online</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </a>
            </div>
          </div>

          {/* Perfectly Aligned Bottom Bar with Admin Login Below */}
          <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div>
              <strong className="text-slate-900 dark:text-white">MockRank</strong> · DSSSB Competitive
              Examination Platform · Partnered with{' '}
              <a
                href="https://dsssbpyq.online"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-slate-900 dark:text-white underline"
              >
                dsssbpyq.online
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setShowLegalModal(true)}
                className="hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
              >
                Terms, Privacy &amp; Examination Rules
              </button>

              <button
                type="button"
                onClick={() => setShowAdminModal(true)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer border ${
                  isAdmin
                    ? 'text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 border-emerald-300 dark:border-emerald-700'
                    : 'text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{isAdmin ? 'Admin Console (Rights Active)' : 'Admin Login'}</span>
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* Mandatory Username Setup Modal before attempting mocks */}
      {showUsernameModal && firebaseUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Set Your Candidate Username
            </h2>

            <form onSubmit={handleSaveUsername} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Public Username
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={40}
                  autoFocus
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="e.g., Tanu_CS_Aspirant"
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                {userProfile?.username && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUsernameModal(false);
                      setPendingMockAfterUsername(null);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={savingUsername || !usernameInput.trim()}
                  className="px-5 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  {savingUsername ? 'Saving...' : 'Save Username'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password-Protected Admin Console */}
      {showAdminModal && (
        <AdminPanel
          adminUid={firebaseUser?.uid || 'efekfmXxEpYHwikLupJcZZijDvx1'}
          adminEmail={firebaseUser?.email || 'ictlabgsssaidana@gmail.com'}
          isAdminActive={isAdmin}
          challengeConfig={challengeConfig}
          blueprints={blueprints}
          onAdminAuthenticated={() => {
            setIsAdmin(true);
            setBannerMessage(
              'Admin Rights Activated — Even after closing the Admin Console, you can click any candidate score on the Dashboard or Leaderboard to view their whole scorecard.'
            );
          }}
          onAdminRevoked={() => {
            setIsAdmin(false);
            setAdminInspectedUser(null);
          }}
          onInspectUserScorecard={openAdminUserScorecard}
          onConfigUpdated={reloadUserData}
          onClose={() => setShowAdminModal(false)}
        />
      )}

      {/* Legal & Fair Play Modal */}
      {showLegalModal && <LegalModal onClose={() => setShowLegalModal(false)} />}
    </div>
  );
}
