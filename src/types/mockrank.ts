export type SubjectSlug =
  | 'general-awareness'
  | 'reasoning'
  | 'mathematics'
  | 'hindi'
  | 'english'
  | 'computer-science'
  | 'teaching-methodology';

export interface SectionBlueprint {
  subject: SubjectSlug;
  label: string;
  part: 'Part A' | 'Part B';
  questionCount: number;
}

export interface MockBlueprint {
  mockId: string;
  dayNumber: number;
  title: string;
  category?: string;
  enabled: boolean;
  totalQuestions: number;
  durationMinutes: number;
  correctMarks: number;
  incorrectMarks: number;
  unattemptedMarks: number;
  maxMarks: number;
  answerReleasePolicy: 'after-submission' | 'after-challenge' | 'manual';
  sections: SectionBlueprint[];
  unlockDateIST: string;
  isUnlockedByServerTime?: boolean;
  customPaperVersion?: number;
}

export interface PublicQuestion {
  id: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: string[];
  language: 'en' | 'hi';
  subject: SubjectSlug;
  sectionLabel: string;
  part?: 'Part A' | 'Part B';
  correctIndex?: number;
  explanation?: string;
}

export interface MockPaperDocument {
  mockId: string;
  dayNumber: number;
  title: string;
  category?: string;
  unlockDateIST: string;
  durationMinutes?: number;
  correctMarks?: number;
  incorrectMarks?: number;
  totalQuestions: number;
  questionCount?: number;
  version: number;
  sourceFormat?: 'json' | 'html';
  questionsJson: string; // Compact JSON string of up to 200 questions for 1-read / 1-write efficiency
  updatedAt?: unknown;
}

export interface SectionAverageMap {
  'general-awareness'?: number;
  reasoning?: number;
  mathematics?: number;
  hindi?: number;
  english?: number;
  'computer-science'?: number;
  'teaching-methodology'?: number;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  username?: string;
  email: string;
  photoURL?: string;
  registrationDate: string;
  accountStatus: 'active' | 'suspended';
  premiumEntitlement: boolean;
  challengeEntitlement: boolean;
  mocksAttempted: number;
  averageScore: number;
  highestScore: number;
  latestScore: number;
  averageAccuracy: number;
  partAAverageScore?: number;
  partBAverageScore?: number;
  sectionAverages?: SectionAverageMap;
  lastAttemptedMock?: string;
  updatedAt?: unknown;
}

export interface LeaderboardOverallEntry {
  uid: string;
  candidateName: string;
  averageScore: number;
  mocksAttempted: number;
  bestScore: number;
  latestScore: number;
  averageAccuracy: number;
  partAAverageScore?: number;
  partBAverageScore?: number;
  sectionAverages?: SectionAverageMap;
  lastSubmissionAt: string;
  updatedAt?: unknown;
  rank?: number;
}

export interface LeaderboardMockEntry {
  uid: string;
  mockId: string;
  candidateName: string;
  score: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unattemptedQuestions: number;
  accuracy: number;
  timeTakenSeconds: number;
  submittedAt: string;
  updatedAt?: unknown;
  rank?: number;
}

export interface SectionScoreBreakdown {
  subject: SubjectSlug;
  label: string;
  part?: 'Part A' | 'Part B';
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
  sectionLabel: string;
  topic: string;
  question: string;
  options: string[];
  userOptionIndex: number | null;
  correctOptionIndex: number;
  isCorrect: boolean;
  explanation: string;
}

export interface ExamAttempt {
  attemptId: string;
  uid: string;
  mockId: string;
  dayNumber: number;
  status: 'in-progress' | 'completed' | 'invalidated';
  startedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  submittedAt?: string;
  responses: Record<string, number>;
  markedForReview: string[];
  score: number;
  partAScore?: number;
  partBScore?: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unattemptedQuestions: number;
  accuracy: number;
  timeTakenSeconds: number;
  sectionScores?: Record<string, SectionScoreBreakdown>;
  questionBankVersion: number;
  updatedAt?: unknown;
}

export interface ChallengeConfig {
  configId: string;
  startDateIST: string;
  endDateIST: string;
  isPaused: boolean;
  minEligibilityAttempts: number;
  lateAttemptPolicy: 'allow-unlocked' | 'strict-daily';
  defaultCorrectMarks: number;
  defaultIncorrectMarks: number;
  delayedAnswerRelease: boolean;
  updatedAt?: unknown;
}

export interface AdminAuditEvent {
  eventId: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  targetUid?: string;
  targetMockId?: string;
  reason: string;
  createdAt?: unknown;
}
