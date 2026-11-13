import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  AppUserSession,
  BLUEPRINT_CONSTRAINTS,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
  sanitizeId,
  sanitizeString,
  saveCustomDomainUserSession,
} from './firebase';
import {
  AdminAuditEvent,
  ChallengeConfig,
  ExamAttempt,
  LeaderboardMockEntry,
  LeaderboardOverallEntry,
  MockBlueprint,
  MockPaperDocument,
  PublicQuestion,
  SectionScoreBreakdown,
  SubjectSlug,
  UserProfile,
} from '../types/mockrank';

const ALL_7_SUBJECTS: SubjectSlug[] = [
  'general-awareness',
  'reasoning',
  'mathematics',
  'hindi',
  'english',
  'computer-science',
  'teaching-methodology',
];

const PART_A_SUBJECTS: SubjectSlug[] = [
  'general-awareness',
  'reasoning',
  'mathematics',
  'hindi',
  'english',
];

const PART_B_SUBJECTS: SubjectSlug[] = [
  'computer-science',
  'teaching-methodology',
];

export async function ensureUserProfile(
  user: User | AppUserSession,
  customName?: string
): Promise<UserProfile> {
  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existingData = snap.data() as UserProfile;
      if (customName && (!existingData.username || !existingData.username.trim())) {
        await saveCandidateUsername(uid, customName);
        return {
          ...existingData,
          username: sanitizeString(customName, 60, ''),
          fullName: sanitizeString(customName, BLUEPRINT_CONSTRAINTS.NAME_MAX_LEN),
        };
      }
      return existingData;
    }

    // If logging in from a custom domain (like mock.dsssbpyq.online), check if an account with the same Gmail already exists
    if (user.email) {
      const cleanEmail = user.email.trim().toLowerCase();
      const emailQuery = query(
        collection(db, 'users'),
        where('email', '==', cleanEmail),
        limit(1)
      );
      const emailSnap = await getDocs(emailQuery);
      if (!emailSnap.empty) {
        const matchedProfile = emailSnap.docs[0].data() as UserProfile;
        if ('isCustomDomainSession' in user && user.isCustomDomainSession) {
          saveCustomDomainUserSession({
            uid: matchedProfile.uid,
            email: matchedProfile.email,
            displayName: matchedProfile.username || matchedProfile.fullName,
            photoURL: matchedProfile.photoURL || null,
            emailVerified: true,
            isCustomDomainSession: true,
          });
        }
        return matchedProfile;
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const newProfile: UserProfile = {
    uid,
    username: customName ? sanitizeString(customName, 60, '') : '',
    fullName: sanitizeString(
      customName || user.displayName || user.email?.split('@')[0] || 'Aspirant',
      BLUEPRINT_CONSTRAINTS.NAME_MAX_LEN
    ),
    email: sanitizeString(
      (user.email || 'candidate@mockrank.in').toLowerCase(),
      BLUEPRINT_CONSTRAINTS.EMAIL_MAX_LEN
    ),
    photoURL: sanitizeString(user.photoURL || '', BLUEPRINT_CONSTRAINTS.PHOTO_MAX_LEN, ''),
    registrationDate: new Date().toISOString().slice(0, 10),
    accountStatus: 'active',
    premiumEntitlement: true,
    challengeEntitlement: true,
    mocksAttempted: 0,
    averageScore: 0,
    highestScore: 0,
    latestScore: 0,
    averageAccuracy: 0,
    partAAverageScore: 0,
    partBAverageScore: 0,
    sectionAverages: {
      'general-awareness': 0,
      'reasoning': 0,
      'mathematics': 0,
      'hindi': 0,
      'english': 0,
      'computer-science': 0,
      'teaching-methodology': 0,
    },
    lastAttemptedMock: '',
  };

  try {
    await setDoc(userRef, {
      ...newProfile,
      updatedAt: serverTimestamp(),
    });
    return newProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveCandidateUsername(uid: string, username: string): Promise<void> {
  const safeUid = sanitizeId(uid);
  const cleanUsername = sanitizeString(username, 60, 'Aspirant');
  const path = `users/${safeUid}`;
  try {
    await updateDoc(doc(db, 'users', safeUid), {
      username: cleanUsername,
      fullName: cleanUsername,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function checkIsAdminUser(user: User | AppUserSession | null): Promise<boolean> {
  if (!user) return false;
  if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', sanitizeId(user.uid)));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function registerAdminSessionInFirestore(uid: string, email: string): Promise<void> {
  const safeUid = sanitizeId(uid);
  const path = `admins/${safeUid}`;
  try {
    await setDoc(doc(db, 'admins', safeUid), {
      uid: safeUid,
      email: sanitizeString(email || 'admin@mockrank.in', 254, 'admin@mockrank.in'),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateCandidateProfileInfo(
  uid: string,
  fullName: string,
  photoURL: string
): Promise<void> {
  const safeUid = sanitizeId(uid);
  const cleanName = sanitizeString(fullName, 60);
  const path = `users/${safeUid}`;
  try {
    await updateDoc(doc(db, 'users', safeUid), {
      username: cleanName,
      fullName: cleanName,
      photoURL: (photoURL || '').trim().slice(0, BLUEPRINT_CONSTRAINTS.PHOTO_MAX_LEN),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const LOCAL_MOCK_CONFIGS_KEY = 'mockrank_local_mock_configs';

export function readLocalMemoryMockConfigs(): Record<string, MockBlueprint> {
  try {
    const raw = localStorage.getItem(LOCAL_MOCK_CONFIGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, MockBlueprint>) : {};
  } catch {
    return {};
  }
}

export function writeLocalMemoryMockConfigs(map: Record<string, MockBlueprint>): void {
  try {
    localStorage.setItem(LOCAL_MOCK_CONFIGS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota warnings
  }
}

/**
 * Local Memory Sync Only (0 Firestore Reads/Writes):
 * Saves the parsed mock blueprint & 200-question paper into localStorage first so the admin
 * can preview and test questions locally before syncing globally to Firestore across all devices.
 */
export function saveMockToLocalMemoryOnly(params: {
  mock: MockBlueprint;
  questions: PublicQuestion[];
  sourceFormat: 'json' | 'html';
}): MockPaperDocument {
  const safeMockId = sanitizeId(params.mock.mockId).slice(0, 32);
  const trimmedQuestions = params.questions.slice(0, 200);
  const questionsJson = JSON.stringify(trimmedQuestions);
  const nowIso = new Date().toISOString().slice(0, 40);
  const version = Math.floor(Date.now() / 1000);

  const localPaperDoc: MockPaperDocument = {
    mockId: safeMockId,
    dayNumber: Math.max(1, Math.min(100, Number(params.mock.dayNumber || 1))),
    title: sanitizeString(params.mock.title, BLUEPRINT_CONSTRAINTS.TITLE_MAX_LEN, safeMockId),
    category: sanitizeString(
      params.mock.category || 'DSSSB TGT Computer Science',
      80,
      'DSSSB TGT Computer Science'
    ),
    unlockDateIST: (params.mock.unlockDateIST || new Date().toISOString().slice(0, 10)).slice(
      0,
      20
    ),
    durationMinutes: Math.max(5, Math.min(300, Number(params.mock.durationMinutes || 120))),
    correctMarks: Number(params.mock.correctMarks || 1),
    incorrectMarks: Number(params.mock.incorrectMarks ?? -0.25),
    totalQuestions: trimmedQuestions.length,
    questionCount: trimmedQuestions.length,
    version,
    sourceFormat: params.sourceFormat,
    questionsJson,
    updatedAt: nowIso,
  };

  try {
    localStorage.setItem(`mockrank_paper_cache_${safeMockId}`, JSON.stringify(localPaperDoc));
  } catch {
    // Ignore storage quota warnings
  }

  const localConfigs = readLocalMemoryMockConfigs();
  localConfigs[safeMockId] = {
    ...params.mock,
    mockId: safeMockId,
    totalQuestions: trimmedQuestions.length,
    syncState: 'local-memory',
  };
  writeLocalMemoryMockConfigs(localConfigs);

  return localPaperDoc;
}

/**
 * 1-Write Operation: Saves up to 200 questions for a Mock in a single Firestore document
 * (/mock_papers/{mockId}) and caches it locally in localStorage so zero repeat writes/reads occur.
 */
export async function saveMockPaperSingleWrite(params: {
  mockId: string;
  dayNumber: number;
  title: string;
  category?: string;
  unlockDateIST: string;
  durationMinutes?: number;
  correctMarks?: number;
  incorrectMarks?: number;
  questions: PublicQuestion[];
  sourceFormat: 'json' | 'html';
}): Promise<MockPaperDocument> {
  const safeMockId = sanitizeId(params.mockId).slice(0, 32);
  const path = `mock_papers/${safeMockId}`;
  const trimmedQuestions = params.questions.slice(0, 200);
  const questionsJson = JSON.stringify(trimmedQuestions);
  const nowIso = new Date().toISOString().slice(0, 40);
  const version = Math.floor(Date.now() / 1000);

  const basePayload = {
    mockId: safeMockId,
    dayNumber: Math.max(1, Math.min(100, Number(params.dayNumber || 1))),
    title: sanitizeString(params.title, BLUEPRINT_CONSTRAINTS.TITLE_MAX_LEN, safeMockId),
    category: sanitizeString(params.category || 'DSSSB TGT Computer Science', 80, 'DSSSB TGT Computer Science'),
    unlockDateIST: (params.unlockDateIST || new Date().toISOString().slice(0, 10)).slice(0, 20),
    durationMinutes: Math.max(5, Math.min(300, Number(params.durationMinutes || 120))),
    correctMarks: Number(params.correctMarks || 1),
    incorrectMarks: Number(params.incorrectMarks ?? -0.25),
    totalQuestions: trimmedQuestions.length,
    questionCount: trimmedQuestions.length,
    version,
    sourceFormat: params.sourceFormat,
    questionsJson,
  };

  const localPaperDoc: MockPaperDocument = {
    ...basePayload,
    updatedAt: nowIso,
  };

  try {
    // 1 single Firestore write operation to /mock_papers/{mockId}
    await setDoc(doc(db, 'mock_papers', safeMockId), {
      ...basePayload,
      updatedAt: serverTimestamp(),
    });

    // Store immediately in localStorage cache so client needs 0 reads next time
    try {
      localStorage.setItem(`mockrank_paper_cache_${safeMockId}`, JSON.stringify(localPaperDoc));
      const localConfigs = readLocalMemoryMockConfigs();
      if (localConfigs[safeMockId]) {
        delete localConfigs[safeMockId];
        writeLocalMemoryMockConfigs(localConfigs);
      }
    } catch {
      // Ignore storage quota warnings
    }

    return localPaperDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * 1-Read Operation + LocalStorage Cache:
 * - First checks localStorage (`mockrank_paper_cache_${mockId}`).
 * - If present in cache and `!forceNetworkRead`, returns immediately with 0 Firestore reads & 0 writes.
 * - Otherwise fetches `/mock_papers/{mockId}` in 1 single Firestore read operation and caches it in localStorage.
 */
export async function fetchMockPaperSingleReadCached(
  mockId: string,
  forceNetworkRead = false
): Promise<{
  paperDoc: MockPaperDocument;
  questions: PublicQuestion[];
  fromCache: boolean;
} | null> {
  const safeMockId = sanitizeId(mockId).slice(0, 32);
  const cacheKey = `mockrank_paper_cache_${safeMockId}`;

  if (!forceNetworkRead) {
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const parsedDoc = JSON.parse(cachedRaw) as MockPaperDocument;
        const parsedQuestions = JSON.parse(parsedDoc.questionsJson || '[]') as PublicQuestion[];
        if (Array.isArray(parsedQuestions) && parsedQuestions.length > 0) {
          return {
            paperDoc: parsedDoc,
            questions: parsedQuestions,
            fromCache: true,
          };
        }
      }
    } catch {
      // Fall through to 1 Firestore read
    }
  }

  const path = `mock_papers/${safeMockId}`;
  try {
    const snap = await getDoc(doc(db, 'mock_papers', safeMockId));
    if (!snap.exists()) {
      return null;
    }
    const data = snap.data() as MockPaperDocument;
    const questions = JSON.parse(data.questionsJson || '[]') as PublicQuestion[];

    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // Ignore localStorage quota errors
    }

    return {
      paperDoc: data,
      questions: Array.isArray(questions) ? questions : [],
      fromCache: false,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchUserAttempts(uid: string): Promise<ExamAttempt[]> {
  const safeUid = sanitizeId(uid);
  const path = 'attempts';
  try {
    const q = query(collection(db, 'attempts'), where('uid', '==', safeUid));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as ExamAttempt);
    return list.sort((a, b) => a.dayNumber - b.dayNumber);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createOrResumeExamAttempt(params: {
  uid: string;
  mockId: string;
  dayNumber: number;
  startedAt: string;
  expiresAt: string;
  questionBankVersion: number;
}): Promise<ExamAttempt> {
  const safeUid = sanitizeId(params.uid);
  const safeMockId = sanitizeId(params.mockId).slice(0, BLUEPRINT_CONSTRAINTS.MOCK_ID_MAX_LEN);
  const attemptId = sanitizeId(`${safeUid}_${safeMockId}`);
  const path = `attempts/${attemptId}`;
  const attemptRef = doc(db, 'attempts', attemptId);

  try {
    const existingSnap = await getDoc(attemptRef);
    if (existingSnap.exists()) {
      const data = existingSnap.data() as ExamAttempt;
      return data;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const newAttempt: ExamAttempt = {
    attemptId,
    uid: safeUid,
    mockId: safeMockId,
    dayNumber: Math.max(1, Math.min(100, Math.round(params.dayNumber))),
    status: 'in-progress',
    startedAt: params.startedAt.slice(0, 40),
    expiresAt: params.expiresAt.slice(0, 40),
    lastHeartbeatAt: params.startedAt.slice(0, 40),
    responses: {},
    markedForReview: [],
    score: 0,
    partAScore: 0,
    partBScore: 0,
    correctAnswers: 0,
    incorrectAnswers: 0,
    unattemptedQuestions: 0,
    accuracy: 0,
    timeTakenSeconds: 0,
    questionBankVersion: Math.max(1, Math.round(params.questionBankVersion || 1)),
  };

  try {
    await setDoc(attemptRef, {
      ...newAttempt,
      updatedAt: serverTimestamp(),
    });
    return newAttempt;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function autosaveExamAttemptProgress(params: {
  attemptId: string;
  responses: Record<string, number>;
  markedForReview: string[];
  timeTakenSeconds: number;
}): Promise<void> {
  const safeAttemptId = sanitizeId(params.attemptId);
  const path = `attempts/${safeAttemptId}`;
  try {
    const cleanReview = (params.markedForReview || [])
      .slice(0, 250)
      .map((id) => String(id).slice(0, 32));

    await updateDoc(doc(db, 'attempts', safeAttemptId), {
      responses: params.responses || {},
      markedForReview: cleanReview,
      lastHeartbeatAt: new Date().toISOString().slice(0, 40),
      timeTakenSeconds: Math.max(0, Math.min(10800, Math.round(params.timeTakenSeconds || 0))),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function computePartAndSectionScoresFromAttempt(
  sectionScores?: Record<string, SectionScoreBreakdown>
): {
  partAScore: number;
  partBScore: number;
  sectionMap: Record<SubjectSlug, number>;
} {
  const sectionMap: Record<SubjectSlug, number> = {
    'general-awareness': 0,
    'reasoning': 0,
    'mathematics': 0,
    'hindi': 0,
    'english': 0,
    'computer-science': 0,
    'teaching-methodology': 0,
  };

  if (sectionScores) {
    for (const subj of ALL_7_SUBJECTS) {
      const sec = sectionScores[subj];
      if (sec && typeof sec.score === 'number') {
        sectionMap[subj] = Number(sec.score.toFixed(2));
      }
    }
  }

  const partAScore = Number(
    PART_A_SUBJECTS.reduce((sum, s) => sum + sectionMap[s], 0).toFixed(2)
  );
  const partBScore = Number(
    PART_B_SUBJECTS.reduce((sum, s) => sum + sectionMap[s], 0).toFixed(2)
  );

  return { partAScore, partBScore, sectionMap };
}

export async function finalizeExamSubmissionAndSyncLeaderboards(params: {
  attempt: ExamAttempt;
  candidateName: string;
  responses: Record<string, number>;
  markedForReview: string[];
  evaluation: {
    score: number;
    partAScore?: number;
    partBScore?: number;
    correctAnswers: number;
    incorrectAnswers: number;
    unattemptedQuestions: number;
    accuracy: number;
    timeTakenSeconds: number;
    sectionScores: Record<string, SectionScoreBreakdown>;
  };
  allCompletedUserAttempts: ExamAttempt[];
}): Promise<void> {
  const safeUid = sanitizeId(params.attempt.uid);
  const safeMockId = sanitizeId(params.attempt.mockId).slice(0, 32);
  const safeAttemptId = sanitizeId(params.attempt.attemptId);
  const submittedAt = new Date().toISOString().slice(0, 40);
  const cleanName = sanitizeString(params.candidateName, BLUEPRINT_CONSTRAINTS.NAME_MAX_LEN);

  const currentBreakdown = computePartAndSectionScoresFromAttempt(params.evaluation.sectionScores);
  const currentPartAScore =
    typeof params.evaluation.partAScore === 'number'
      ? Number(params.evaluation.partAScore.toFixed(2))
      : currentBreakdown.partAScore;
  const currentPartBScore =
    typeof params.evaluation.partBScore === 'number'
      ? Number(params.evaluation.partBScore.toFixed(2))
      : currentBreakdown.partBScore;

  // Compute updated candidate aggregate statistics across all valid completed attempts
  const otherValid = params.allCompletedUserAttempts.filter(
    (a) => a.status === 'completed' && a.mockId !== safeMockId
  );

  const validScores = [...otherValid.map((a) => a.score), params.evaluation.score];
  const validAccuracies = [...otherValid.map((a) => a.accuracy), params.evaluation.accuracy];

  const mocksAttempted = Math.min(100, validScores.length);
  const countForAvg = Math.max(1, validScores.length);
  const sumScores = validScores.reduce((acc, s) => acc + s, 0);
  const averageScore = Number((sumScores / countForAvg).toFixed(2));
  const highestScore = Number(Math.max(...validScores).toFixed(2));
  const latestScore = Number(params.evaluation.score.toFixed(2));
  const averageAccuracy = Number(
    (validAccuracies.reduce((acc, a) => acc + a, 0) / countForAvg).toFixed(2)
  );

  // Compute Section-Wise & Part-Wise Average Scores across all completed attempts
  const sectionSums: Record<SubjectSlug, number> = {
    'general-awareness': currentBreakdown.sectionMap['general-awareness'],
    'reasoning': currentBreakdown.sectionMap['reasoning'],
    'mathematics': currentBreakdown.sectionMap['mathematics'],
    'hindi': currentBreakdown.sectionMap['hindi'],
    'english': currentBreakdown.sectionMap['english'],
    'computer-science': currentBreakdown.sectionMap['computer-science'],
    'teaching-methodology': currentBreakdown.sectionMap['teaching-methodology'],
  };

  let sumPartA = currentPartAScore;
  let sumPartB = currentPartBScore;

  for (const prev of otherValid) {
    const prevBd = computePartAndSectionScoresFromAttempt(prev.sectionScores);
    sumPartA += typeof prev.partAScore === 'number' ? prev.partAScore : prevBd.partAScore;
    sumPartB += typeof prev.partBScore === 'number' ? prev.partBScore : prevBd.partBScore;
    for (const subj of ALL_7_SUBJECTS) {
      sectionSums[subj] += prevBd.sectionMap[subj];
    }
  }

  const sectionAverages: Record<string, number> = {};
  for (const subj of ALL_7_SUBJECTS) {
    sectionAverages[subj] = Number((sectionSums[subj] / countForAvg).toFixed(2));
  }

  const partAAverageScore = Number((sumPartA / countForAvg).toFixed(2));
  const partBAverageScore = Number((sumPartB / countForAvg).toFixed(2));

  const cleanReview = (params.markedForReview || [])
    .slice(0, 250)
    .map((id) => String(id).slice(0, 32));

  try {
    const batch = writeBatch(db);

    // 1. Update official attempt to terminal 'completed' state
    const attemptRef = doc(db, 'attempts', safeAttemptId);
    batch.update(attemptRef, {
      status: 'completed',
      submittedAt,
      lastHeartbeatAt: submittedAt,
      responses: params.responses || {},
      markedForReview: cleanReview,
      score: latestScore,
      partAScore: currentPartAScore,
      partBScore: currentPartBScore,
      correctAnswers: params.evaluation.correctAnswers,
      incorrectAnswers: params.evaluation.incorrectAnswers,
      unattemptedQuestions: params.evaluation.unattemptedQuestions,
      accuracy: params.evaluation.accuracy,
      timeTakenSeconds: Math.max(0, Math.min(10800, Math.round(params.evaluation.timeTakenSeconds))),
      sectionScores: params.evaluation.sectionScores || {},
      updatedAt: serverTimestamp(),
    });

    // 2. Write Individual Mock Leaderboard entry
    const mockLbRef = doc(db, 'leaderboard_mocks', safeMockId, 'entries', safeUid);
    const mockLbData: LeaderboardMockEntry = {
      uid: safeUid,
      mockId: safeMockId,
      candidateName: cleanName,
      score: latestScore,
      correctAnswers: params.evaluation.correctAnswers,
      incorrectAnswers: params.evaluation.incorrectAnswers,
      unattemptedQuestions: params.evaluation.unattemptedQuestions,
      accuracy: params.evaluation.accuracy,
      timeTakenSeconds: Math.max(0, Math.min(10800, Math.round(params.evaluation.timeTakenSeconds))),
      submittedAt,
    };
    batch.set(mockLbRef, {
      ...mockLbData,
      updatedAt: serverTimestamp(),
    });

    // 3. Write Overall Average-Score Leaderboard entry
    const overallLbRef = doc(db, 'leaderboard_overall', safeUid);
    const overallLbData: LeaderboardOverallEntry = {
      uid: safeUid,
      candidateName: cleanName,
      averageScore,
      mocksAttempted,
      bestScore: highestScore,
      latestScore,
      averageAccuracy,
      partAAverageScore,
      partBAverageScore,
      sectionAverages,
      lastSubmissionAt: submittedAt,
    };
    batch.set(overallLbRef, {
      ...overallLbData,
      updatedAt: serverTimestamp(),
    });

    // 4. Update candidate aggregate stats in /users/{uid}
    const userRef = doc(db, 'users', safeUid);
    batch.update(userRef, {
      mocksAttempted,
      averageScore,
      highestScore,
      latestScore,
      averageAccuracy,
      partAAverageScore,
      partBAverageScore,
      sectionAverages,
      lastAttemptedMock: safeMockId,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attempts/${safeAttemptId}`);
  }
}

export function sortAndRankMockLeaderboard(entries: LeaderboardMockEntry[]): LeaderboardMockEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
    return a.submittedAt.localeCompare(b.submittedAt);
  });

  let currentRank = 1;
  return sorted.map((entry, idx) => {
    if (idx > 0) {
      const prev = sorted[idx - 1];
      const isTied =
        prev.score === entry.score &&
        prev.accuracy === entry.accuracy &&
        prev.timeTakenSeconds === entry.timeTakenSeconds;
      if (!isTied) {
        currentRank = idx + 1;
      }
    }
    return { ...entry, rank: currentRank };
  });
}

export function sortAndRankOverallLeaderboard(
  entries: LeaderboardOverallEntry[],
  minEligibilityAttempts = 1
): LeaderboardOverallEntry[] {
  const eligible = entries.filter((e) => e.mocksAttempted >= minEligibilityAttempts);
  const sorted = [...eligible].sort((a, b) => {
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    if (b.averageAccuracy !== a.averageAccuracy) return b.averageAccuracy - a.averageAccuracy;
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return a.lastSubmissionAt.localeCompare(b.lastSubmissionAt);
  });

  let currentRank = 1;
  return sorted.map((entry, idx) => {
    if (idx > 0) {
      const prev = sorted[idx - 1];
      const isTied =
        prev.averageScore === entry.averageScore &&
        prev.averageAccuracy === entry.averageAccuracy &&
        prev.bestScore === entry.bestScore;
      if (!isTied) {
        currentRank = idx + 1;
      }
    }
    return { ...entry, rank: currentRank };
  });
}

/**
 * Ranks candidates who have given the EXACT SAME number of mocks (`mocksAttempted === targetMocksCount`)
 * based on Average Score.
 */
export function sortAndRankEqualMocksCohort(
  entries: LeaderboardOverallEntry[],
  targetMocksCount: number
): LeaderboardOverallEntry[] {
  if (targetMocksCount <= 0) return [];
  const sameCountPeers = entries.filter((e) => e.mocksAttempted === targetMocksCount);
  return sortAndRankOverallLeaderboard(sameCountPeers, 1);
}

export function subscribeToOverallLeaderboard(
  minEligibilityAttempts: number,
  onData: (entries: LeaderboardOverallEntry[]) => void
): () => void {
  const path = 'leaderboard_overall';
  const q = query(
    collection(db, 'leaderboard_overall'),
    where('mocksAttempted', '>=', Math.max(1, minEligibilityAttempts)),
    orderBy('mocksAttempted', 'desc'),
    limit(100)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const raw = snapshot.docs.map((d) => d.data() as LeaderboardOverallEntry);
      onData(sortAndRankOverallLeaderboard(raw, minEligibilityAttempts));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeToMockLeaderboard(
  mockId: string,
  onData: (entries: LeaderboardMockEntry[]) => void
): () => void {
  const safeMockId = sanitizeId(mockId).slice(0, 32);
  const path = `leaderboard_mocks/${safeMockId}/entries`;
  const q = query(
    collection(db, 'leaderboard_mocks', safeMockId, 'entries'),
    where('timeTakenSeconds', '>=', 0),
    orderBy('timeTakenSeconds', 'asc'),
    limit(100)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const raw = snapshot.docs.map((d) => d.data() as LeaderboardMockEntry);
      onData(sortAndRankMockLeaderboard(raw));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function fetchChallengeConfig(): Promise<ChallengeConfig | null> {
  const path = 'challenge_config/active';
  try {
    const snap = await getDoc(doc(db, 'challenge_config', 'active'));
    if (snap.exists()) {
      return snap.data() as ChallengeConfig;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveChallengeConfigAdmin(
  config: Omit<ChallengeConfig, 'updatedAt'>,
  adminUid: string,
  adminEmail: string,
  reason: string
): Promise<void> {
  const path = 'challenge_config/active';
  try {
    const batch = writeBatch(db);
    const configRef = doc(db, 'challenge_config', 'active');
    batch.set(configRef, {
      configId: 'active',
      startDateIST: config.startDateIST.slice(0, 20),
      endDateIST: config.endDateIST.slice(0, 20),
      isPaused: Boolean(config.isPaused),
      minEligibilityAttempts: Math.max(1, Math.min(7, Number(config.minEligibilityAttempts || 1))),
      lateAttemptPolicy: config.lateAttemptPolicy,
      defaultCorrectMarks: Number(config.defaultCorrectMarks || 1),
      defaultIncorrectMarks: Number(config.defaultIncorrectMarks ?? -0.25),
      delayedAnswerRelease: Boolean(config.delayedAnswerRelease),
      updatedAt: serverTimestamp(),
    });

    const eventId = sanitizeId(`evt_${Date.now()}`);
    const auditRef = doc(db, 'admin_audit', eventId);
    batch.set(auditRef, {
      eventId,
      adminUid: sanitizeId(adminUid),
      adminEmail: sanitizeString(adminEmail, 254, 'admin@mockrank.in'),
      action: 'UPDATE_CHALLENGE_CONFIG',
      reason: sanitizeString(reason || 'Updated mock schedule and rules', 500),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const DEFAULT_SECTIONS_BLUEPRINT = [
  { subject: 'general-awareness' as const, part: 'Part A' as const, label: 'Part A: General Awareness', questionCount: 20 },
  { subject: 'reasoning' as const, part: 'Part A' as const, label: 'Part A: Reasoning', questionCount: 20 },
  { subject: 'mathematics' as const, part: 'Part A' as const, label: 'Part A: Mathematics', questionCount: 20 },
  { subject: 'hindi' as const, part: 'Part A' as const, label: 'Part A: Hindi', questionCount: 20 },
  { subject: 'english' as const, part: 'Part A' as const, label: 'Part A: English', questionCount: 20 },
  { subject: 'computer-science' as const, part: 'Part B' as const, label: 'Part B: Computer Science', questionCount: 80 },
  { subject: 'teaching-methodology' as const, part: 'Part B' as const, label: 'Part B: Teaching Methodology', questionCount: 20 },
];

export async function fetchMockConfigOverrides(): Promise<Record<string, Partial<MockBlueprint>>> {
  const path = 'mock_configs';
  try {
    const q = query(collection(db, 'mock_configs'), where('dayNumber', '>=', 1));
    const snap = await getDocs(q);
    const map: Record<string, Partial<MockBlueprint>> = {};
    for (const d of snap.docs) {
      const data = d.data() as Partial<MockBlueprint> & { mockId: string };
      map[data.mockId] = data;
    }
    return map;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Fetches ONLY Mocks added by the Admin in /mock_configs (plus any staged in Local Memory),
 * organized with their Category, Mock Name (title), and Unlock Date (unlockDateIST).
 * Once unlocked, remains available permanently.
 */
export async function fetchAdminCreatedMocks(currentISTDate: string): Promise<MockBlueprint[]> {
  const path = 'mock_configs';
  try {
    const q = query(collection(db, 'mock_configs'), where('dayNumber', '>=', 1));
    const snap = await getDocs(q);
    const firestoreMap: Record<string, MockBlueprint> = {};

    for (const d of snap.docs) {
      const raw = d.data() as Partial<MockBlueprint> & { mockId: string };
      const mockId = raw.mockId || d.id;
      const unlockDateIST = raw.unlockDateIST || currentISTDate;
      const totalQ = Number(raw.totalQuestions || 200);
      const correctMarks = Number(raw.correctMarks ?? 1);
      firestoreMap[mockId] = {
        mockId,
        dayNumber: Number(raw.dayNumber || 1),
        title: raw.title || raw.mockId || 'DSSSB Mock Test',
        category: raw.category || 'DSSSB TGT Computer Science',
        unlockDateIST,
        enabled: raw.enabled ?? true,
        totalQuestions: totalQ,
        durationMinutes: Number(raw.durationMinutes || 120),
        correctMarks,
        incorrectMarks: Number(raw.incorrectMarks ?? -0.25),
        unattemptedMarks: 0,
        maxMarks: Number(raw.maxMarks || totalQ * correctMarks),
        answerReleasePolicy: raw.answerReleasePolicy || 'after-submission',
        sections: DEFAULT_SECTIONS_BLUEPRINT,
        isUnlockedByServerTime: currentISTDate >= unlockDateIST,
        syncState: 'global-firestore',
      };
    }

    const localConfigs = readLocalMemoryMockConfigs();
    for (const [localId, localBp] of Object.entries(localConfigs)) {
      if (!firestoreMap[localId]) {
        const unlockDateIST = localBp.unlockDateIST || currentISTDate;
        const totalQ = Number(localBp.totalQuestions || 200);
        const correctMarks = Number(localBp.correctMarks ?? 1);
        firestoreMap[localId] = {
          ...localBp,
          mockId: localId,
          dayNumber: Number(localBp.dayNumber || 1),
          title: localBp.title || localId,
          category: localBp.category || 'DSSSB TGT Computer Science',
          unlockDateIST,
          enabled: localBp.enabled ?? true,
          totalQuestions: totalQ,
          durationMinutes: Number(localBp.durationMinutes || 120),
          correctMarks,
          incorrectMarks: Number(localBp.incorrectMarks ?? -0.25),
          unattemptedMarks: 0,
          maxMarks: Number(localBp.maxMarks || totalQ * correctMarks),
          answerReleasePolicy: localBp.answerReleasePolicy || 'after-submission',
          sections: DEFAULT_SECTIONS_BLUEPRINT,
          isUnlockedByServerTime: currentISTDate >= unlockDateIST,
          syncState: 'local-memory',
        };
      }
    }

    return Object.values(firestoreMap).sort((a, b) => a.dayNumber - b.dayNumber);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveMockConfigAdmin(
  mock: MockBlueprint,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  const safeMockId = sanitizeId(mock.mockId).slice(0, 32);
  const path = `mock_configs/${safeMockId}`;
  try {
    const batch = writeBatch(db);
    const mockRef = doc(db, 'mock_configs', safeMockId);
    batch.set(mockRef, {
      mockId: safeMockId,
      dayNumber: Math.max(1, Math.min(100, Number(mock.dayNumber))),
      title: sanitizeString(mock.title, BLUEPRINT_CONSTRAINTS.TITLE_MAX_LEN),
      category: sanitizeString(
        mock.category || 'DSSSB TGT Computer Science',
        80,
        'DSSSB TGT Computer Science'
      ),
      unlockDateIST: (mock.unlockDateIST || new Date().toISOString().slice(0, 10)).slice(0, 20),
      enabled: Boolean(mock.enabled),
      durationMinutes: Math.max(10, Math.min(300, Number(mock.durationMinutes))),
      totalQuestions: Math.max(5, Math.min(200, Number(mock.totalQuestions))),
      correctMarks: Number(mock.correctMarks),
      incorrectMarks: Number(mock.incorrectMarks),
      maxMarks: Number(mock.maxMarks),
      answerReleasePolicy: mock.answerReleasePolicy,
      updatedAt: serverTimestamp(),
    });

    const eventId = sanitizeId(`evt_mock_${Date.now()}`);
    const auditRef = doc(db, 'admin_audit', eventId);
    batch.set(auditRef, {
      eventId,
      adminUid: sanitizeId(adminUid),
      adminEmail: sanitizeString(adminEmail, 254, 'admin@mockrank.in'),
      action: 'UPDATE_MOCK_CONFIG',
      targetMockId: safeMockId,
      reason: `Saved mock "${mock.title}" in category "${mock.category || 'DSSSB TGT Computer Science'}"`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMockAdmin(
  mockId: string,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  const safeMockId = sanitizeId(mockId).slice(0, 32);
  const path = `mock_configs/${safeMockId}`;
  try {
    try {
      localStorage.removeItem(`mockrank_paper_cache_${safeMockId}`);
      const localConfigs = readLocalMemoryMockConfigs();
      if (localConfigs[safeMockId]) {
        delete localConfigs[safeMockId];
        writeLocalMemoryMockConfigs(localConfigs);
      }
    } catch {
      // Ignore storage errors
    }

    const batch = writeBatch(db);
    batch.delete(doc(db, 'mock_configs', safeMockId));
    const eventId = sanitizeId(`evt_delmock_${Date.now()}`);
    batch.set(doc(db, 'admin_audit', eventId), {
      eventId,
      adminUid: sanitizeId(adminUid),
      adminEmail: sanitizeString(adminEmail, 254, 'admin@mockrank.in'),
      action: 'UPDATE_MOCK_CONFIG',
      targetMockId: safeMockId,
      reason: `Deleted mock ${safeMockId}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Admin Candidate & Attempt Management
export async function fetchAllCandidatesAdmin(): Promise<UserProfile[]> {
  const path = 'users';
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(100)));
    return snap.docs.map((d) => d.data() as UserProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchAllAttemptsAdmin(): Promise<ExamAttempt[]> {
  const path = 'attempts';
  try {
    const snap = await getDocs(query(collection(db, 'attempts'), limit(200)));
    return snap.docs.map((d) => d.data() as ExamAttempt);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchAdminAuditEvents(): Promise<AdminAuditEvent[]> {
  const path = 'admin_audit';
  try {
    const q = query(collection(db, 'admin_audit'), where('adminUid', '!=', ''), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AdminAuditEvent);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function adminToggleUserEntitlement(params: {
  targetUser: UserProfile;
  grantPremium: boolean;
  grantChallenge: boolean;
  adminUid: string;
  adminEmail: string;
  reason: string;
}): Promise<void> {
  const safeTargetUid = sanitizeId(params.targetUser.uid);
  const path = `users/${safeTargetUid}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', safeTargetUid), {
      premiumEntitlement: params.grantPremium,
      challengeEntitlement: params.grantChallenge,
      updatedAt: serverTimestamp(),
    });

    const eventId = sanitizeId(`evt_ent_${Date.now()}`);
    batch.set(doc(db, 'admin_audit', eventId), {
      eventId,
      adminUid: sanitizeId(params.adminUid),
      adminEmail: sanitizeString(params.adminEmail, 254, 'admin@mockrank.in'),
      action: params.grantPremium ? 'GRANT_LIFETIME_PREMIUM' : 'UPDATE_ENTITLEMENT',
      targetUid: safeTargetUid,
      reason: sanitizeString(params.reason || 'Admin entitlement update', 500),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminResetOrInvalidateAttempt(params: {
  attempt: ExamAttempt;
  mode: 'reset' | 'invalidate';
  adminUid: string;
  adminEmail: string;
  reason: string;
}): Promise<void> {
  const safeAttemptId = sanitizeId(params.attempt.attemptId);
  const safeUid = sanitizeId(params.attempt.uid);
  const safeMockId = sanitizeId(params.attempt.mockId).slice(0, 32);
  const path = `attempts/${safeAttemptId}`;

  try {
    const batch = writeBatch(db);
    const attemptRef = doc(db, 'attempts', safeAttemptId);

    if (params.mode === 'reset') {
      batch.delete(attemptRef);
    } else {
      batch.update(attemptRef, {
        status: 'invalidated',
        updatedAt: serverTimestamp(),
      });
    }

    batch.delete(doc(db, 'leaderboard_mocks', safeMockId, 'entries', safeUid));

    const eventId = sanitizeId(`evt_att_${Date.now()}`);
    batch.set(doc(db, 'admin_audit', eventId), {
      eventId,
      adminUid: sanitizeId(params.adminUid),
      adminEmail: sanitizeString(params.adminEmail, 254, 'admin@mockrank.in'),
      action: params.mode === 'reset' ? 'RESET_ATTEMPT' : 'INVALIDATE_ATTEMPT',
      targetUid: safeUid,
      targetMockId: safeMockId,
      reason: sanitizeString(params.reason || `Admin ${params.mode} attempt`, 500),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCandidateAccountData(uid: string): Promise<void> {
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
