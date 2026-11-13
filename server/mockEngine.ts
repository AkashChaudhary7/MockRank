import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type SubjectSlug =
  | 'general-awareness'
  | 'reasoning'
  | 'mathematics'
  | 'hindi'
  | 'english'
  | 'computer-science'
  | 'teaching-methodology';

export type ExamPart = 'Part A' | 'Part B';

export interface PublicQuestion {
  id: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: string[];
  language: 'en' | 'hi';
  subject?: SubjectSlug;
  part?: ExamPart;
  sectionLabel?: string;
  correctIndex?: number;
  explanation?: string;
}

export interface MasterSubjectBank {
  subject: SubjectSlug;
  version: number;
  questions: PublicQuestion[];
}

export interface AnswerKeyEntry {
  correctIndex: number;
  explanation: string;
}

export interface MasterAnswerKey {
  version: number;
  repository: string;
  keys: Record<string, AnswerKeyEntry>;
}

export interface SectionBlueprint {
  subject: SubjectSlug;
  part?: ExamPart;
  label: string;
  questionCount: number;
}

export interface MockBlueprint {
  mockId: string;
  dayNumber: number;
  title: string;
  category?: string;
  unlockDateIST?: string;
  enabled: boolean;
  totalQuestions: number;
  durationMinutes: number;
  correctMarks: number;
  incorrectMarks: number;
  unattemptedMarks: number;
  maxMarks: number;
  answerReleasePolicy: 'after-submission' | 'after-challenge' | 'manual';
  sections: SectionBlueprint[];
}

export const SUBJECT_LABELS: Record<SubjectSlug, string> = {
  'general-awareness': 'General Awareness',
  'reasoning': 'Reasoning',
  'mathematics': 'Mathematics',
  'hindi': 'Hindi',
  'english': 'English',
  'computer-science': 'Computer Science',
  'teaching-methodology': 'Teaching Methodology',
};

export const SUBJECT_PARTS: Record<SubjectSlug, ExamPart> = {
  'general-awareness': 'Part A',
  'reasoning': 'Part A',
  'mathematics': 'Part A',
  'hindi': 'Part A',
  'english': 'Part A',
  'computer-science': 'Part B',
  'teaching-methodology': 'Part B',
};

export const PART_A_SUBJECTS: SubjectSlug[] = [
  'general-awareness',
  'reasoning',
  'mathematics',
  'hindi',
  'english',
];

export const PART_B_SUBJECTS: SubjectSlug[] = [
  'computer-science',
  'teaching-methodology',
];

export const ALL_SUBJECTS: SubjectSlug[] = [
  'general-awareness',
  'reasoning',
  'mathematics',
  'hindi',
  'english',
  'computer-science',
  'teaching-methodology',
];

export const TOTAL_MOCKS_COUNT = 100;

// In-memory server cache to avoid repeated disk reads
let cachedSubjectBanks: Record<SubjectSlug, MasterSubjectBank> | null = null;
let cachedAnswerKeys: MasterAnswerKey | null = null;

export function getISTNow(overrideNow?: Date): {
  nowUTC: Date;
  istDateString: string;
  istTimeFormatted: string;
  nextMidnightISTUtcMs: number;
} {
  const now = overrideNow || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const istDateString = formatter.format(now); // YYYY-MM-DD in IST

  const timeFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
  const istTimeFormatted = timeFormatter.format(now);

  const [y, m, d] = istDateString.split('-').map(Number);
  const currentMidnightISTUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - (5 * 60 + 30) * 60 * 1000;
  const nextMidnightISTUtcMs = currentMidnightISTUtcMs + 24 * 60 * 60 * 1000;

  return {
    nowUTC: now,
    istDateString,
    istTimeFormatted,
    nextMidnightISTUtcMs,
  };
}

export function getDefaultChallengeStartDateIST(): string {
  if (process.env.CHALLENGE_START_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.CHALLENGE_START_DATE)) {
    return process.env.CHALLENGE_START_DATE;
  }
  // Default: 3 days ago in IST so Mocks 1-4 are unlocked today and Mocks 5-7 unlock on subsequent dates
  const { istDateString } = getISTNow();
  const [y, m, d] = istDateString.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 3);
  return dt.toISOString().slice(0, 10);
}

/**
 * Calculates unlocked mock count based on startDateIST.
 * Only mocks 1-7 are valid. Once a mock's unlock date arrives, it remains available permanently.
 */
export function calculateUnlockedDayIST(startDateIST: string, currentISTDateString?: string): {
  availableDay: number;
  rawDayDiff: number;
  currentISTDate: string;
} {
  const currentIST = currentISTDateString || getISTNow().istDateString;
  const [cy, cm, cd] = currentIST.split('-').map(Number);
  const [sy, sm, sd] = startDateIST.split('-').map(Number);

  const currentMidnightUTC = Date.UTC(cy, cm - 1, cd);
  const startMidnightUTC = Date.UTC(sy, sm - 1, sd);

  const diffDays = Math.floor((currentMidnightUTC - startMidnightUTC) / (1000 * 60 * 60 * 24));
  const rawAvailable = diffDays + 1;
  const clampedAvailable = Math.max(0, Math.min(TOTAL_MOCKS_COUNT, rawAvailable));

  return {
    availableDay: clampedAvailable,
    rawDayDiff: diffDays,
    currentISTDate: currentIST,
  };
}

export function getMockUnlockDateIST(startDateIST: string, dayNumber: number): string {
  const [sy, sm, sd] = startDateIST.split('-').map(Number);
  const dt = new Date(Date.UTC(sy, sm - 1, sd));
  dt.setUTCDate(dt.getUTCDate() + (dayNumber - 1));
  return dt.toISOString().slice(0, 10);
}

export function isMockDateUnlockedIST(unlockDateIST: string, currentISTDateString?: string): boolean {
  const currentIST = currentISTDateString || getISTNow().istDateString;
  return currentIST >= unlockDateIST;
}

export function loadMasterSubjectBanks(forceReload = false): Record<SubjectSlug, MasterSubjectBank> {
  if (cachedSubjectBanks && !forceReload) {
    return cachedSubjectBanks;
  }

  const baseDir = path.resolve(process.cwd(), 'public', 'question-bank');
  const result = {} as Record<SubjectSlug, MasterSubjectBank>;

  for (const subject of ALL_SUBJECTS) {
    const filePath = path.join(baseDir, `${subject}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as MasterSubjectBank;
    result[subject] = parsed;
  }

  cachedSubjectBanks = result;
  return result;
}

export function loadPrivateAnswerKeys(forceReload = false): MasterAnswerKey {
  if (cachedAnswerKeys && !forceReload) {
    return cachedAnswerKeys;
  }

  const filePath = path.resolve(
    process.cwd(),
    'server',
    'private-question-keys',
    'master-answer-key.json'
  );
  const raw = fs.readFileSync(filePath, 'utf-8');
  cachedAnswerKeys = JSON.parse(raw) as MasterAnswerKey;
  return cachedAnswerKeys;
}

const MOCK_TITLES: string[] = [
  'DSSSB TGT CS - Mock 01: Core Computer Architecture & Part A Foundation',
  'DSSSB TGT CS - Mock 02: Data Structures, Algorithms & Pedagogy',
  'DSSSB TGT CS - Mock 03: Operating Systems, DBMS & SQL Mastery',
  'DSSSB TGT CS - Mock 04: Computer Networks, Digital Logic & Reasoning',
  'DSSSB TGT CS - Mock 05: Python, C++, OOP & Teaching Methodology',
  'DSSSB TGT CS - Mock 06: Full-Length Previous Year Pattern Replica',
  'DSSSB TGT CS - Mock 07: All-India Grand Championship Mock',
];

export function getDefaultMockBlueprint(dayNumber: number, baseStartDateIST?: string): MockBlueprint {
  const clampedDay = Math.max(1, Math.min(TOTAL_MOCKS_COUNT, dayNumber));
  const padded = String(clampedDay).padStart(2, '0');
  const mockId = `MOCK_${padded}`;
  const startDate = baseStartDateIST || getDefaultChallengeStartDateIST();
  const unlockDateIST = getMockUnlockDateIST(startDate, clampedDay);

  const sections: SectionBlueprint[] = [
    { subject: 'general-awareness', part: 'Part A', label: 'Part A: General Awareness', questionCount: 5 },
    { subject: 'reasoning', part: 'Part A', label: 'Part A: Reasoning', questionCount: 5 },
    { subject: 'mathematics', part: 'Part A', label: 'Part A: Mathematics', questionCount: 5 },
    { subject: 'hindi', part: 'Part A', label: 'Part A: Hindi', questionCount: 5 },
    { subject: 'english', part: 'Part A', label: 'Part A: English', questionCount: 5 },
    { subject: 'computer-science', part: 'Part B', label: 'Part B: Computer Science', questionCount: 15 },
    { subject: 'teaching-methodology', part: 'Part B', label: 'Part B: Teaching Methodology', questionCount: 5 },
  ];
  const totalQuestions = sections.reduce((sum, s) => sum + s.questionCount, 0);

  return {
    mockId,
    dayNumber: clampedDay,
    title: MOCK_TITLES[clampedDay - 1] || `DSSSB TGT CS - Mock ${padded}`,
    unlockDateIST,
    enabled: true,
    totalQuestions,
    durationMinutes: 120,
    correctMarks: 1,
    incorrectMarks: -0.25,
    unattemptedMarks: 0,
    maxMarks: totalQuestions * 1,
    answerReleasePolicy: 'after-submission',
    sections,
  };
}

export function getAllDefaultMockBlueprints(baseStartDateIST?: string): MockBlueprint[] {
  return Array.from({ length: 7 }, (_, idx) =>
    getDefaultMockBlueprint(idx + 1, baseStartDateIST)
  );
}

/**
 * Generates a full 200-question DSSSB TGT CS mock paper (100 Part A + 100 Part B)
 * for Admin 1-write Firestore seeding or testing when needed.
 */
export function selectQuestionsForMock(blueprint: MockBlueprint): {
  mockId: string;
  version: number;
  questions: PublicQuestion[];
} {
  const banks = loadMasterSubjectBanks();
  const selectedQuestions: PublicQuestion[] = [];
  const seenIds = new Set<string>();
  let versionSum = 0;

  const dayIndex = Math.max(0, blueprint.dayNumber - 1);

  for (const section of blueprint.sections) {
    const bank = banks[section.subject];
    if (!bank || !Array.isArray(bank.questions) || bank.questions.length === 0) {
      continue;
    }
    versionSum = Math.max(versionSum, bank.version || 1);
    const pool = bank.questions;
    const n = pool.length;
    const count = Math.min(section.questionCount, n);

    const startOffset = (dayIndex * count) % n;
    const candidateSteps = [1, 3, 7, 11, 13];
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const step = candidateSteps[dayIndex % candidateSteps.length];
    const effectiveStep = gcd(step, n) === 1 ? step : 1;

    let picked = 0;
    let cursor = 0;
    while (picked < count && cursor < n * 2) {
      const idx = (startOffset + cursor * effectiveStep) % n;
      const q = pool[idx];
      cursor++;
      if (!seenIds.has(q.id)) {
        seenIds.add(q.id);
        const part = section.part || SUBJECT_PARTS[section.subject] || 'Part B';
        selectedQuestions.push({
          id: q.id,
          topic: q.topic,
          difficulty: q.difficulty,
          question: q.question,
          options: q.options,
          language: q.language,
          subject: section.subject,
          part,
          sectionLabel: section.label,
        });
        picked++;
      }
    }
  }

  return {
    mockId: blueprint.mockId,
    version: versionSum || 1,
    questions: selectedQuestions,
  };
}

export interface EvaluationRequest {
  mockId: string;
  dayNumber: number;
  responses: Record<string, number>;
  timeTakenSeconds: number;
  blueprintOverride?: Partial<MockBlueprint>;
  customQuestions?: PublicQuestion[];
  allowAnswerReview?: boolean;
}

export interface SectionScoreBreakdown {
  subject: SubjectSlug;
  part: ExamPart;
  label: string;
  totalQuestions: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  score: number;
  maxMarks: number;
  accuracy: number;
}

export interface QuestionReviewItem {
  id: string;
  subject: SubjectSlug;
  part: ExamPart;
  sectionLabel: string;
  topic: string;
  question: string;
  options: string[];
  userOptionIndex: number | null;
  correctOptionIndex: number;
  isCorrect: boolean;
  explanation: string;
}

export interface EvaluationResult {
  mockId: string;
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unattemptedQuestions: number;
  score: number;
  maxMarks: number;
  partAScore: number;
  partBScore: number;
  partAMaxMarks: number;
  partBMaxMarks: number;
  percentage: number;
  accuracy: number;
  timeTakenSeconds: number;
  sectionScores: Record<string, SectionScoreBreakdown>;
  evaluationSignature: string;
  reviewItems?: QuestionReviewItem[];
}

export function evaluateMockAttemptServerSide(req: EvaluationRequest): EvaluationResult {
  const baseBlueprint = getDefaultMockBlueprint(req.dayNumber);
  const blueprint: MockBlueprint = {
    ...baseBlueprint,
    ...req.blueprintOverride,
    sections: req.blueprintOverride?.sections || baseBlueprint.sections,
  };

  const questions: PublicQuestion[] =
    Array.isArray(req.customQuestions) && req.customQuestions.length > 0
      ? req.customQuestions
      : selectQuestionsForMock(blueprint).questions;

  const privateKeys = loadPrivateAnswerKeys().keys;

  const correctMarks = Number(blueprint.correctMarks ?? 1);
  const incorrectMarks = Number(blueprint.incorrectMarks ?? -0.25);
  const negativeMagnitude = Math.abs(incorrectMarks);

  let correctAnswers = 0;
  let incorrectAnswers = 0;
  let unattemptedQuestions = 0;

  const sectionScores: Record<string, SectionScoreBreakdown> = {};
  for (const subj of ALL_SUBJECTS) {
    const part = SUBJECT_PARTS[subj];
    sectionScores[subj] = {
      subject: subj,
      part,
      label: `${part}: ${SUBJECT_LABELS[subj]}`,
      totalQuestions: 0,
      correct: 0,
      incorrect: 0,
      unattempted: 0,
      score: 0,
      maxMarks: 0,
      accuracy: 0,
    };
  }

  const reviewItems: QuestionReviewItem[] = [];

  for (const q of questions) {
    const subj: SubjectSlug =
      q.subject && ALL_SUBJECTS.includes(q.subject) ? q.subject : 'computer-science';
    const part: ExamPart = q.part || SUBJECT_PARTS[subj] || 'Part B';

    if (!sectionScores[subj]) {
      sectionScores[subj] = {
        subject: subj,
        part,
        label: q.sectionLabel || `${part}: ${SUBJECT_LABELS[subj]}`,
        totalQuestions: 0,
        correct: 0,
        incorrect: 0,
        unattempted: 0,
        score: 0,
        maxMarks: 0,
        accuracy: 0,
      };
    }

    const secStat = sectionScores[subj];
    secStat.totalQuestions += 1;
    secStat.maxMarks = Number((secStat.totalQuestions * correctMarks).toFixed(2));

    const keyEntry = privateKeys[q.id];
    const officialIndex =
      typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < 4
        ? q.correctIndex
        : keyEntry
        ? keyEntry.correctIndex
        : 0;
    const officialExplanation =
      q.explanation ||
      keyEntry?.explanation ||
      'Official answer verified against the MockRank master key.';

    const rawUserPick = req.responses?.[q.id];
    const hasAnswered =
      typeof rawUserPick === 'number' &&
      Number.isInteger(rawUserPick) &&
      rawUserPick >= 0 &&
      rawUserPick < q.options.length;

    if (!hasAnswered) {
      unattemptedQuestions += 1;
      secStat.unattempted += 1;
    } else if (rawUserPick === officialIndex) {
      correctAnswers += 1;
      secStat.correct += 1;
    } else {
      incorrectAnswers += 1;
      secStat.incorrect += 1;
    }

    if (req.allowAnswerReview) {
      reviewItems.push({
        id: q.id,
        subject: subj,
        part,
        sectionLabel: q.sectionLabel || `${part}: ${SUBJECT_LABELS[subj]}`,
        topic: q.topic || SUBJECT_LABELS[subj],
        question: q.question,
        options: q.options,
        userOptionIndex: hasAnswered ? rawUserPick : null,
        correctOptionIndex: officialIndex,
        isCorrect: hasAnswered && rawUserPick === officialIndex,
        explanation: officialExplanation,
      });
    }
  }

  let partAScore = 0;
  let partBScore = 0;
  let partAMaxMarks = 0;
  let partBMaxMarks = 0;

  for (const subj of Object.keys(sectionScores) as SubjectSlug[]) {
    const sec = sectionScores[subj];
    const rawSecScore = sec.correct * correctMarks - sec.incorrect * negativeMagnitude;
    sec.score = Number(rawSecScore.toFixed(2));
    const secAttempted = sec.correct + sec.incorrect;
    sec.accuracy = secAttempted > 0 ? Number(((sec.correct / secAttempted) * 100).toFixed(2)) : 0;

    if (sec.part === 'Part A') {
      partAScore += sec.score;
      partAMaxMarks += sec.maxMarks;
    } else {
      partBScore += sec.score;
      partBMaxMarks += sec.maxMarks;
    }
  }

  partAScore = Number(partAScore.toFixed(2));
  partBScore = Number(partBScore.toFixed(2));
  partAMaxMarks = Number(partAMaxMarks.toFixed(2));
  partBMaxMarks = Number(partBMaxMarks.toFixed(2));

  const totalScore = Number(
    (correctAnswers * correctMarks - incorrectAnswers * negativeMagnitude).toFixed(2)
  );
  const maxMarks = Number((questions.length * correctMarks).toFixed(2));
  const attemptedCount = correctAnswers + incorrectAnswers;
  const accuracy =
    attemptedCount > 0 ? Number(((correctAnswers / attemptedCount) * 100).toFixed(2)) : 0;
  const percentage = maxMarks > 0 ? Number(Math.max(0, (totalScore / maxMarks) * 100).toFixed(2)) : 0;

  const secret = process.env.ADMIN_PASSWORD || 'mockrank-server-evaluation-secret';
  const evaluationSignature = crypto
    .createHmac('sha256', secret)
    .update(`${req.mockId}:${totalScore}:${correctAnswers}:${incorrectAnswers}`)
    .digest('hex');

  return {
    mockId: req.mockId,
    totalQuestions: questions.length,
    correctAnswers,
    incorrectAnswers,
    unattemptedQuestions,
    score: totalScore,
    maxMarks,
    partAScore,
    partBScore,
    partAMaxMarks,
    partBMaxMarks,
    percentage,
    accuracy,
    timeTakenSeconds: Math.max(0, Math.min(10800, Math.round(req.timeTakenSeconds || 0))),
    sectionScores,
    evaluationSignature,
    reviewItems: req.allowAnswerReview ? reviewItems : undefined,
  };
}

export interface QuestionBankHealthReport {
  valid: boolean;
  totalQuestionsAcrossSubjects: number;
  privateAnswerKeysCount: number;
  missingAnswerKeys: string[];
  duplicateIds: string[];
  invalidStructures: string[];
  subjects: {
    subject: SubjectSlug;
    label: string;
    version: number;
    questionCount: number;
    topics: string[];
    validOptionsCount: boolean;
  }[];
}

export function validateMasterQuestionBanks(): QuestionBankHealthReport {
  const banks = loadMasterSubjectBanks(true);
  const answerKey = loadPrivateAnswerKeys(true);

  const globalSeen = new Set<string>();
  const duplicateIds: string[] = [];
  const missingAnswerKeys: string[] = [];
  const invalidStructures: string[] = [];
  let totalQuestionsAcrossSubjects = 0;

  const subjectsReport = ALL_SUBJECTS.map((subject) => {
    const bank = banks[subject];
    const topicsSet = new Set<string>();
    let validOptionsCount = true;

    for (const q of bank.questions) {
      totalQuestionsAcrossSubjects += 1;
      topicsSet.add(q.topic);

      if (globalSeen.has(q.id)) {
        duplicateIds.push(q.id);
      }
      globalSeen.add(q.id);

      if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => !o || !o.trim())) {
        validOptionsCount = false;
        invalidStructures.push(`${q.id}: Must have exactly 4 non-empty options`);
      }

      if (!q.question || !q.question.trim()) {
        invalidStructures.push(`${q.id}: Missing question stem`);
      }

      if (!(q.id in answerKey.keys)) {
        missingAnswerKeys.push(q.id);
      }
    }

    return {
      subject,
      label: SUBJECT_LABELS[subject],
      version: bank.version,
      questionCount: bank.questions.length,
      topics: Array.from(topicsSet),
      validOptionsCount,
    };
  });

  return {
    valid:
      duplicateIds.length === 0 &&
      missingAnswerKeys.length === 0 &&
      invalidStructures.length === 0,
    totalQuestionsAcrossSubjects,
    privateAnswerKeysCount: Object.keys(answerKey.keys).length,
    missingAnswerKeys,
    duplicateIds,
    invalidStructures,
    subjects: subjectsReport,
  };
}
