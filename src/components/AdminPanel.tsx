import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Database,
  Eye,
  FileCode2,
  FileJson,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAuditEvent,
  ChallengeConfig,
  ExamAttempt,
  MockBlueprint,
  PublicQuestion,
  SubjectSlug,
  UserProfile,
} from '../types/mockrank';
import {
  adminResetAllUsersMarks,
  adminResetOrInvalidateAttempt,
  adminResetUserMarks,
  deleteMockAdmin,
  fetchAdminAuditEvents,
  fetchAllAttemptsAdmin,
  fetchAllCandidatesAdmin,
  fetchMockPaperSingleReadCached,
  publishAnswerKeyAndRecalculateMockScoresAdmin,
  registerAdminSessionInFirestore,
  saveChallengeConfigAdmin,
  saveMockConfigAdmin,
  saveMockPaperSingleWrite,
  saveMockToLocalMemoryOnly,
} from '../lib/firestoreService';
import {
  fetchQuestionBankHealthSafe,
  verifyAdminPasswordSafe,
} from '../lib/clientExamEngine';

interface AdminPanelProps {
  adminUid: string;
  adminEmail: string;
  challengeConfig: ChallengeConfig;
  blueprints: MockBlueprint[];
  onConfigUpdated: () => Promise<void>;
  onClose: () => void;
}

interface BankHealthResponse {
  valid: boolean;
  totalQuestionsAcrossSubjects: number;
  privateAnswerKeysCount: number;
  missingAnswerKeys: string[];
  duplicateIds: string[];
  invalidStructures: string[];
  subjects: {
    subject: string;
    label: string;
    version: number;
    questionCount: number;
    topics: string[];
    validOptionsCount: boolean;
  }[];
  previewMock: {
    mockId: string;
    dayNumber: number;
    title: string;
    totalSelected: number;
    questionIds: {
      id: string;
      subject: string;
      topic: string;
      difficulty: string;
      language: string;
    }[];
  };
}

const VALID_SUBJECTS: SubjectSlug[] = [
  'general-awareness',
  'reasoning',
  'mathematics',
  'hindi',
  'english',
  'computer-science',
  'teaching-methodology',
];

const SUBJECT_DISPLAY_LABELS: Record<SubjectSlug, string> = {
  'general-awareness': 'Part A · General Awareness',
  reasoning: 'Part A · Reasoning',
  mathematics: 'Part A · Mathematics',
  hindi: 'Part A · Hindi',
  english: 'Part A · English',
  'computer-science': 'Part B · Computer Science',
  'teaching-methodology': 'Part B · Teaching Methodology',
};

const PRESET_CATEGORIES = [
  'DSSSB TGT Computer Science',
  'Part A General Section',
  'Part B CS Core',
  'PYQ Full Mock',
  'Topic-Wise Mock',
];

const DEFAULT_SECTIONS = [
  { subject: 'general-awareness' as const, part: 'Part A' as const, label: 'Part A: General Awareness', questionCount: 20 },
  { subject: 'reasoning' as const, part: 'Part A' as const, label: 'Part A: Reasoning', questionCount: 20 },
  { subject: 'mathematics' as const, part: 'Part A' as const, label: 'Part A: Mathematics', questionCount: 20 },
  { subject: 'hindi' as const, part: 'Part A' as const, label: 'Part A: Hindi', questionCount: 20 },
  { subject: 'english' as const, part: 'Part A' as const, label: 'Part A: English', questionCount: 20 },
  { subject: 'computer-science' as const, part: 'Part B' as const, label: 'Part B: Computer Science', questionCount: 80 },
  { subject: 'teaching-methodology' as const, part: 'Part B' as const, label: 'Part B: Teaching Methodology', questionCount: 20 },
];

function inferPartFromSubject(subject: SubjectSlug): 'Part A' | 'Part B' {
  if (subject === 'computer-science' || subject === 'teaching-methodology') {
    return 'Part B';
  }
  return 'Part A';
}

function normalizeSubject(
  rawSubject?: string,
  index = 0,
  rawTopic?: string,
  questionNumber?: number
): SubjectSlug {
  const s = (rawSubject || '').toLowerCase().trim();
  const t = (rawTopic || '').toLowerCase().trim();
  const qNum = typeof questionNumber === 'number' && questionNumber > 0 ? questionNumber : index + 1;

  if (s.includes('hindi') || s === 'hi') return 'hindi';
  if (s.includes('english') || s === 'en') return 'english';
  if (s.includes('math') || s.includes('arith') || s.includes('num') || s.includes('quant'))
    return 'mathematics';
  if (s.includes('reason') || s.includes('intel')) return 'reasoning';
  if (s.includes('general') || s.includes('aware') || s === 'ga' || s === 'gk')
    return 'general-awareness';
  if (s.includes('teach') || s.includes('pedagog') || s === 'tm' || t.includes('pedagog'))
    return 'teaching-methodology';

  // In byteprep.mcq.v1 DSSSB 200-question papers, Q181-200 (Section 5 · Q181–200) is the 5th section of Part B (Teaching Methodology / Pedagogy & CS)
  if (s.includes('comp') || s === 'cs') {
    if (qNum >= 181 || t.includes('section 5') || t.includes('181')) {
      return 'teaching-methodology';
    }
    return 'computer-science';
  }

  const pos = (qNum - 1) % 200;
  if (pos < 20) return 'general-awareness';
  if (pos < 40) return 'reasoning';
  if (pos < 60) return 'mathematics';
  if (pos < 80) return 'hindi';
  if (pos < 100) return 'english';
  if (pos < 180) return 'computer-science';
  return 'teaching-methodology';
}

export interface ParsedJsonPaperResult {
  questions: PublicQuestion[];
  schemaName: string;
  detectedExamTitle?: string;
}

/**
 * Supports `byteprep.mcq.v1` JSON schema (with object options `{ index, label, text }`,
 * 1-based `correctAnswerIndex` + `correctAnswer`, array explanations `[{ heading, text }]`,
 * `questionNumber`, `exam`) as well as standard array/object question JSON formats.
 */
function parseUploadedJsonQuestions(rawText: string, mockId: string): ParsedJsonPaperResult {
  const parsed = JSON.parse(rawText);
  const rawList: Record<string, unknown>[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.questions)
    ? parsed.questions
    : [];

  if (rawList.length === 0) {
    throw new Error(
      'JSON file must contain an array of questions or a { "questions": [...] } object.'
    );
  }

  const schemaName =
    typeof parsed?.schema === 'string' && parsed.schema.trim()
      ? parsed.schema.trim()
      : 'standard.mcq.json';

  let detectedExamTitle: string | undefined;
  if (typeof parsed?.title === 'string' && parsed.title.trim()) {
    detectedExamTitle = parsed.title.trim();
  } else if (typeof rawList[0]?.exam === 'string' && String(rawList[0].exam).trim()) {
    detectedExamTitle = String(rawList[0].exam).trim();
  }

  const questions: PublicQuestion[] = rawList.slice(0, 200).map((item, idx) => {
    const qNum =
      typeof item.questionNumber === 'number' && item.questionNumber > 0
        ? item.questionNumber
        : idx + 1;

    const rawTopicStr = String(item.topic || '').trim();
    const subject = normalizeSubject(
      String(item.subject || item.section || ''),
      idx,
      rawTopicStr,
      qNum
    );

    const rawIdStr = String(
      item.id || `${mockId}_Q${String(qNum).padStart(3, '0')}`
    ).trim();

    let part: 'Part A' | 'Part B' = inferPartFromSubject(subject);
    if (rawIdStr.toLowerCase().includes('|parta|')) {
      part = 'Part A';
    } else if (rawIdStr.toLowerCase().includes('|partb|')) {
      part = 'Part B';
    }

    // Parse options: supports [{ index: 1, label: "a", text: "..." }] OR ["Option A", ...]
    const rawOptsArray = Array.isArray(item.options) ? item.options : [];
    const extractedOptions: string[] = rawOptsArray.slice(0, 4).map((opt, optIdx) => {
      if (typeof opt === 'object' && opt !== null) {
        const optObj = opt as Record<string, unknown>;
        return String(optObj.text ?? optObj.value ?? optObj.label ?? `Option ${optIdx + 1}`).trim();
      }
      return String(opt).trim();
    });

    const options =
      extractedOptions.length >= 4
        ? extractedOptions.slice(0, 4)
        : [
            extractedOptions[0] || 'Option A',
            extractedOptions[1] || 'Option B',
            extractedOptions[2] || 'Option C',
            extractedOptions[3] || 'Option D',
          ];

    // Resolve 0-based correctIndex (0..3) accurately
    let resolvedCorrectIndex = -1;

    // 1. Check 1-based `correctAnswerIndex` from `byteprep.mcq.v1`
    if (typeof item.correctAnswerIndex === 'number' && Number.isInteger(item.correctAnswerIndex)) {
      const caIdx = item.correctAnswerIndex;
      // Match against option object's `.index` if present
      const matchedByObjIndex = rawOptsArray.findIndex(
        (o) => typeof o === 'object' && o !== null && (o as Record<string, unknown>).index === caIdx
      );
      if (matchedByObjIndex >= 0 && matchedByObjIndex < 4) {
        resolvedCorrectIndex = matchedByObjIndex;
      } else if (caIdx >= 1 && caIdx <= 4) {
        resolvedCorrectIndex = caIdx - 1;
      } else if (caIdx === 0) {
        resolvedCorrectIndex = 0;
      }
    }

    // 2. Cross-check or resolve via `correctAnswer` text or label ("a", "b", "c", "d")
    if (typeof item.correctAnswer === 'string' && item.correctAnswer.trim()) {
      const caStr = item.correctAnswer.trim();
      const exactTextMatch = options.findIndex(
        (optText) => optText.toLowerCase() === caStr.toLowerCase()
      );
      if (exactTextMatch >= 0 && exactTextMatch < 4) {
        resolvedCorrectIndex = exactTextMatch;
      } else if (resolvedCorrectIndex === -1 && ['a', 'b', 'c', 'd'].includes(caStr.toLowerCase())) {
        resolvedCorrectIndex = ['a', 'b', 'c', 'd'].indexOf(caStr.toLowerCase());
      }
    }

    // 3. Fallback to 0-based `correctIndex` / `correctOptionIndex` / `answerIndex`
    if (resolvedCorrectIndex < 0 || resolvedCorrectIndex >= 4) {
      const legacyIdx = Number(
        item.correctIndex ?? item.correctOptionIndex ?? item.answerIndex ?? 0
      );
      resolvedCorrectIndex =
        Number.isInteger(legacyIdx) && legacyIdx >= 0 && legacyIdx < 4 ? legacyIdx : 0;
    }

    // Parse explanation: supports [{ heading: "Explanation", text: "..." }] OR string
    let explanationText = '';
    if (Array.isArray(item.explanation)) {
      explanationText = item.explanation
        .map((expItem) => {
          if (typeof expItem === 'object' && expItem !== null) {
            const expObj = expItem as Record<string, unknown>;
            return String(expObj.text ?? expObj.content ?? '').trim();
          }
          return String(expItem).trim();
        })
        .filter(Boolean)
        .join('\n\n');
    } else if (typeof item.explanation === 'object' && item.explanation !== null) {
      const expObj = item.explanation as Record<string, unknown>;
      explanationText = String(expObj.text ?? expObj.content ?? '').trim();
    } else if (typeof item.explanation === 'string') {
      explanationText = item.explanation.trim();
    }

    if (!explanationText) {
      explanationText = 'Verified against official MockRank answer key.';
    }

    const questionStem = String(item.question || item.questionText || `Question ${qNum}`).trim();
    const hasDevanagari = /[\u0900-\u097F]/.test(questionStem);

    return {
      id: rawIdStr,
      questionNumber: qNum,
      exam: typeof item.exam === 'string' ? item.exam : detectedExamTitle,
      topic: rawTopicStr || SUBJECT_DISPLAY_LABELS[subject],
      difficulty:
        item.difficulty === 'easy' || item.difficulty === 'hard' ? item.difficulty : 'medium',
      question: questionStem,
      options,
      language: item.language === 'hi' || subject === 'hindi' || hasDevanagari ? 'hi' : 'en',
      subject,
      part,
      sectionLabel: SUBJECT_DISPLAY_LABELS[subject] || `${part}: ${subject.toUpperCase()}`,
      correctIndex: resolvedCorrectIndex,
      explanation: explanationText,
    };
  });

  return {
    questions,
    schemaName,
    detectedExamTitle,
  };
}

function parseUploadedHtmlQuestions(rawHtml: string, mockId: string): PublicQuestion[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const results: PublicQuestion[] = [];

  const blocks = Array.from(
    doc.querySelectorAll('.question, .question-block, [data-question], article, tr')
  );

  blocks.forEach((el) => {
    if (results.length >= 200) return;
    const qTextEl =
      el.querySelector('.question-text, .stem, h3, h4, p, td:first-child') || el;
    const questionText = (qTextEl.textContent || '').trim();
    if (!questionText || questionText.length < 4) return;

    const liOpts = Array.from(el.querySelectorAll('li, .option, td')).map((n) =>
      (n.textContent || '').trim()
    );
    let options: string[] = [];
    if (liOpts.length >= 4) {
      options =
        el.tagName.toLowerCase() === 'tr' && liOpts.length >= 5
          ? liOpts.slice(1, 5)
          : liOpts.slice(0, 4);
    } else {
      return;
    }

    const idx = results.length;
    const subjAttr =
      el.getAttribute('data-subject') ||
      el.querySelector('[data-subject]')?.getAttribute('data-subject') ||
      '';
    const subject = normalizeSubject(subjAttr, idx);
    const part = inferPartFromSubject(subject);
    const correctAttr = Number(el.getAttribute('data-correct') ?? 0);
    const explanationAttr =
      el.getAttribute('data-explanation') ||
      (el.querySelector('.explanation')?.textContent || '').trim() ||
      'Official explanation synced from HTML mock paper.';

    results.push({
      id: `${mockId}_Q${String(idx + 1).padStart(3, '0')}`,
      questionNumber: idx + 1,
      topic: subject,
      difficulty: 'medium',
      question: questionText,
      options,
      language: subject === 'hindi' ? 'hi' : 'en',
      subject,
      part,
      sectionLabel: SUBJECT_DISPLAY_LABELS[subject] || `${part}: ${subject}`,
      correctIndex:
        Number.isInteger(correctAttr) && correctAttr >= 0 && correctAttr < 4 ? correctAttr : 0,
      explanation: explanationAttr,
    });
  });

  if (results.length === 0) {
    throw new Error(
      'Could not find valid 4-option question blocks in HTML. Use <div class="question" data-subject="computer-science" data-correct="0"><p>Question?</p><ul><li>A</li><li>B</li><li>C</li><li>D</li></ul></div> or JSON format.'
    );
  }

  return results.slice(0, 200);
}

function generateFull200QuestionsTemplate(mockId: string, mockTitle: string): PublicQuestion[] {
  const questions: PublicQuestion[] = [];
  const sectionPlan: {
    subject: SubjectSlug;
    part: 'Part A' | 'Part B';
    label: string;
    count: number;
    sampleStem: string;
    sampleOptions: string[];
    correctIndex: number;
  }[] = [
    {
      subject: 'general-awareness',
      part: 'Part A',
      label: 'Part A: General Awareness',
      count: 20,
      sampleStem: 'Which Constitutional Article or National Policy provision is highlighted in',
      sampleOptions: [
        'Article 32 (Constitutional Remedies)',
        'Article 21A (Right to Education)',
        'Article 51A (Fundamental Duties)',
        'Article 239AA (NCT of Delhi)',
      ],
      correctIndex: 0,
    },
    {
      subject: 'reasoning',
      part: 'Part A',
      label: 'Part A: Reasoning',
      count: 20,
      sampleStem: 'Determine the logical pattern and next term in the analytical sequence for',
      sampleOptions: [
        '255 (Pattern ×2 + 1)',
        '253 (Pattern ×2 - 1)',
        '248 (Prime Offset)',
        '260 (Square Series)',
      ],
      correctIndex: 0,
    },
    {
      subject: 'mathematics',
      part: 'Part A',
      label: 'Part A: Mathematics',
      count: 20,
      sampleStem: 'Calculate the exact quantitative value for the numerical problem in',
      sampleOptions: [
        '7.2 units (Combined Rate)',
        '8.4 units',
        '6.5 units',
        '9.0 units',
      ],
      correctIndex: 0,
    },
    {
      subject: 'hindi',
      part: 'Part A',
      label: 'Part A: Hindi',
      count: 20,
      sampleStem: 'निम्नलिखित हिंदी व्याकरण एवं भाषा प्रश्न का सही विकल्प चुनिए —',
      sampleOptions: [
        'आशीर्वाद (शुद्ध वर्तनी एवं संधि)',
        'आशिर्वाद',
        'आर्शीवाद',
        'आशीरवाद',
      ],
      correctIndex: 0,
    },
    {
      subject: 'english',
      part: 'Part A',
      label: 'Part A: English',
      count: 20,
      sampleStem: 'Choose the grammatically accurate option for the English Language item in',
      sampleOptions: [
        'Neither the principal nor the teachers were present',
        'Neither the principal nor the teachers was present',
        'Neither the principal or teachers is present',
        'Neither principal nor teachers are present yesterday',
      ],
      correctIndex: 0,
    },
    {
      subject: 'computer-science',
      part: 'Part B',
      label: 'Part B: Computer Science',
      count: 80,
      sampleStem: 'In DSSSB TGT Computer Science architecture, DBMS, OS & networking, evaluate',
      sampleOptions: [
        'O(log n) / BCNF Superkey / Layer 3 Router',
        'O(n²) Worst Case',
        'FIFO Belady Anomaly Only',
        'Layer 2 Data Link Bridge',
      ],
      correctIndex: 0,
    },
    {
      subject: 'teaching-methodology',
      part: 'Part B',
      label: 'Part B: Teaching Methodology',
      count: 20,
      sampleStem: 'According to NEP 2020 and constructivist CS classroom pedagogy, identify',
      sampleOptions: [
        '5+3+3+4 Curricular Structure & Formative Scaffolding',
        '10+2 Traditional Structure',
        'Rote Memorization Drill Only',
        'Summative Year-End Exam Only',
      ],
      correctIndex: 0,
    },
  ];

  let qCounter = 1;
  for (const sec of sectionPlan) {
    for (let i = 1; i <= sec.count; i++) {
      const qId = `${mockId}_Q${String(qCounter).padStart(3, '0')}`;
      questions.push({
        id: qId,
        questionNumber: qCounter,
        topic: sec.label,
        difficulty: i % 3 === 0 ? 'hard' : i % 2 === 0 ? 'medium' : 'easy',
        question: `[${mockTitle} · Q${qCounter}] ${sec.sampleStem} (${sec.label} #${i})?`,
        options: sec.sampleOptions,
        language: sec.subject === 'hindi' ? 'hi' : 'en',
        subject: sec.subject,
        part: sec.part,
        sectionLabel: sec.label,
        correctIndex: sec.correctIndex,
        explanation: `Official solution for ${qId} (${sec.label}). Verified +1.00 / -0.25 marking key.`,
      });
      qCounter++;
    }
  }

  return questions;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  adminUid,
  adminEmail,
  challengeConfig,
  blueprints,
  onConfigUpdated,
  onClose,
}) => {
  const [isPasswordVerified, setIsPasswordVerified] = useState<boolean>(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<
    'mocks' | 'challenge' | 'question-bank' | 'candidates' | 'analytics'
  >('mocks');

  // Challenge Config state
  const [startDateIST, setStartDateIST] = useState<string>(challengeConfig.startDateIST);
  const [endDateIST, setEndDateIST] = useState<string>(challengeConfig.endDateIST);
  const [isPaused, setIsPaused] = useState<boolean>(challengeConfig.isPaused);
  const [minEligibility] = useState<number>(challengeConfig.minEligibilityAttempts);
  const [latePolicy] = useState<'allow-unlocked' | 'strict-daily'>(
    challengeConfig.lateAttemptPolicy
  );
  const [delayedRelease, setDelayedRelease] = useState<boolean>(
    challengeConfig.delayedAnswerRelease
  );
  const [auditReason] = useState<string>('Administrative update');
  const [savingChallenge, setSavingChallenge] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Admin Mock Creation / Selection State
  const nextMockNumber =
    blueprints.length > 0 ? Math.max(...blueprints.map((b) => b.dayNumber)) + 1 : 1;
  const defaultNewMockId = `MOCK_${String(nextMockNumber).padStart(2, '0')}`;

  const [selectedMockId, setSelectedMockId] = useState<string>(
    blueprints[0]?.mockId || defaultNewMockId
  );
  const [isCreatingNewMock, setIsCreatingNewMock] = useState<boolean>(blueprints.length === 0);

  const currentMock = blueprints.find((b) => b.mockId === selectedMockId);

  const [editMockId, setEditMockId] = useState<string>(
    currentMock?.mockId || defaultNewMockId
  );
  const [editDayNumber, setEditDayNumber] = useState<number>(
    currentMock?.dayNumber || nextMockNumber
  );
  const [editCategory, setEditCategory] = useState<string>(
    currentMock?.category || 'DSSSB TGT Computer Science'
  );
  const [editTitle, setEditTitle] = useState<string>(
    currentMock?.title || `DSSSB TGT CS Full Mock ${String(nextMockNumber).padStart(2, '0')}`
  );
  const [editUnlockDateIST, setEditUnlockDateIST] = useState<string>(
    currentMock?.unlockDateIST || new Date().toISOString().slice(0, 10)
  );
  const [editEnabled, setEditEnabled] = useState<boolean>(currentMock?.enabled ?? true);
  const [editDuration, setEditDuration] = useState<number>(currentMock?.durationMinutes || 120);
  const [editCorrectMarks, setEditCorrectMarks] = useState<number>(
    currentMock?.correctMarks || 1
  );
  const [editIncorrectMarks, setEditIncorrectMarks] = useState<number>(
    currentMock?.incorrectMarks ?? -0.25
  );
  const [editReleasePolicy, setEditReleasePolicy] = useState<
    'after-submission' | 'after-challenge' | 'manual'
  >(currentMock?.answerReleasePolicy || 'after-submission');

  // Uploaded / Parsed Mock Questions State (Local Memory Preview first -> 1 Write Firestore Global Sync)
  const [uploadedQuestions, setUploadedQuestions] = useState<PublicQuestion[]>([]);
  const [uploadSourceFormat, setUploadSourceFormat] = useState<'json' | 'html'>('json');
  const [detectedSchema, setDetectedSchema] = useState<string>('byteprep.mcq.v1');
  const [syncStage, setSyncStage] = useState<'none' | 'local-memory' | 'global-firestore'>('none');
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);
  const [uploadErrorMsg, setUploadErrorMsg] = useState<string | null>(null);
  const [syncingPaper, setSyncingPaper] = useState<boolean>(false);
  const [loadingBundledJson, setLoadingBundledJson] = useState<boolean>(false);

  // Interactive Question Preview State
  const [showQuestionPreview, setShowQuestionPreview] = useState<boolean>(true);
  const [previewSubjectFilter, setPreviewSubjectFilter] = useState<'ALL' | SubjectSlug>('ALL');
  const [previewSearchText, setPreviewSearchText] = useState<string>('');
  const [previewPage, setPreviewPage] = useState<number>(1);
  const PREVIEW_PAGE_SIZE = 10;

  const buildCurrentMockBlueprint = (
    overrideMockId?: string,
    overrideTitle?: string,
    questionCount = uploadedQuestions.length || 200
  ): MockBlueprint => {
    const cleanMockId = (
      overrideMockId ||
      editMockId ||
      `MOCK_${String(editDayNumber).padStart(2, '0')}`
    )
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');

    const titleToUse = (overrideTitle || editTitle || cleanMockId).trim();
    return {
      mockId: cleanMockId,
      dayNumber: Math.max(1, Math.min(100, Number(editDayNumber || 1))),
      title: titleToUse,
      category: editCategory.trim() || 'DSSSB TGT Computer Science',
      unlockDateIST: editUnlockDateIST,
      enabled: editEnabled,
      totalQuestions: questionCount,
      durationMinutes: editDuration,
      correctMarks: editCorrectMarks,
      incorrectMarks: editIncorrectMarks,
      unattemptedMarks: 0,
      maxMarks: Number((questionCount * editCorrectMarks).toFixed(2)),
      answerReleasePolicy: editReleasePolicy,
      sections: DEFAULT_SECTIONS,
    };
  };

  const syncQuestionsToLocalMemoryImmediate = async (
    questions: PublicQuestion[],
    format: 'json' | 'html',
    schemaLabel: string,
    sourceLabel: string,
    overrideTitle?: string
  ) => {
    const mockBp = buildCurrentMockBlueprint(editMockId, overrideTitle, questions.length);
    saveMockToLocalMemoryOnly({
      mock: mockBp,
      questions,
      sourceFormat: format,
    });
    setUploadedQuestions(questions);
    setUploadSourceFormat(format);
    setDetectedSchema(schemaLabel);
    setSyncStage('local-memory');
    setPreviewSubjectFilter('ALL');
    setPreviewSearchText('');
    setPreviewPage(1);
    setShowQuestionPreview(true);
    setUploadStatusMsg(
      `Step 1 Complete — Synced ${questions.length} questions from ${sourceLabel} (${schemaLabel}) into Local Memory (0 Firestore writes). Preview questions below, then click "Sync to Firestore (Global Sync in All Devices)" when ready.`
    );
    await onConfigUpdated();
  };

  const handleStartCreatingNewMock = () => {
    const nextNum =
      blueprints.length > 0 ? Math.max(...blueprints.map((b) => b.dayNumber)) + 1 : 1;
    const newId = `MOCK_${String(nextNum).padStart(2, '0')}`;
    setIsCreatingNewMock(true);
    setSelectedMockId(newId);
    setEditMockId(newId);
    setEditDayNumber(nextNum);
    setEditCategory('DSSSB TGT Computer Science');
    setEditTitle(`DSSSB TGT CS Full Mock ${String(nextNum).padStart(2, '0')}`);
    setEditUnlockDateIST(new Date().toISOString().slice(0, 10));
    setEditEnabled(true);
    setEditDuration(120);
    setEditCorrectMarks(1);
    setEditIncorrectMarks(-0.25);
    setEditReleasePolicy('after-submission');
    setUploadedQuestions([]);
    setSyncStage('none');
    setUploadStatusMsg(null);
    setUploadErrorMsg(null);
  };

  useEffect(() => {
    if (!isCreatingNewMock && currentMock) {
      setEditMockId(currentMock.mockId);
      setEditDayNumber(currentMock.dayNumber);
      setEditCategory(currentMock.category || 'DSSSB TGT Computer Science');
      setEditTitle(currentMock.title);
      setEditUnlockDateIST(
        currentMock.unlockDateIST || new Date().toISOString().slice(0, 10)
      );
      setEditEnabled(currentMock.enabled);
      setEditDuration(currentMock.durationMinutes);
      setEditCorrectMarks(currentMock.correctMarks);
      setEditIncorrectMarks(currentMock.incorrectMarks);
      setEditReleasePolicy(currentMock.answerReleasePolicy);
      setUploadErrorMsg(null);

      fetchMockPaperSingleReadCached(currentMock.mockId, false)
        .then((res) => {
          if (res && res.questions.length > 0) {
            setUploadedQuestions(res.questions);
            setUploadSourceFormat(res.paperDoc.sourceFormat || 'json');
            setSyncStage(
              currentMock.syncState === 'local-memory' ? 'local-memory' : 'global-firestore'
            );
            setPreviewPage(1);
            setUploadStatusMsg(
              currentMock.syncState === 'local-memory'
                ? `Loaded ${res.questions.length} questions from Local Memory for ${currentMock.mockId}. Click "Sync to Firestore (Global Sync in All Devices)" to publish globally.`
                : `Loaded ${res.questions.length} globally synced questions for ${currentMock.mockId} (${
                    res.fromCache ? '0-read Local Cache hit' : '1-read Firestore fetch'
                  }).`
            );
          } else {
            setUploadedQuestions([]);
            setSyncStage('none');
            setUploadStatusMsg(null);
          }
        })
        .catch(() => {
          setUploadedQuestions([]);
          setSyncStage('none');
        });
    }
  }, [currentMock, isCreatingNewMock]);

  // Question Bank Health state
  const [bankHealth, setBankHealth] = useState<BankHealthResponse | null>(null);
  const [previewDay] = useState<number>(1);
  const [loadingBank, setLoadingBank] = useState<boolean>(false);

  // Candidates & Analytics state
  const [candidates, setCandidates] = useState<UserProfile[]>([]);
  const [allAttempts, setAllAttempts] = useState<ExamAttempt[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingAdminData, setLoadingAdminData] = useState<boolean>(false);
  const [resettingAllMarks, setResettingAllMarks] = useState<boolean>(false);
  const [confirmResetAllMarks, setConfirmResetAllMarks] = useState<boolean>(false);
  const [resettingUserUid, setResettingUserUid] = useState<string | null>(null);

  const loadQuestionBankHealth = async (day = previewDay) => {
    setLoadingBank(true);
    try {
      const data = await fetchQuestionBankHealthSafe(day);
      setBankHealth(data);
    } finally {
      setLoadingBank(false);
    }
  };

  const loadCandidatesAndAnalytics = async () => {
    setLoadingAdminData(true);
    try {
      const [usersList, attemptsList, logsList] = await Promise.all([
        fetchAllCandidatesAdmin(),
        fetchAllAttemptsAdmin(),
        fetchAdminAuditEvents(),
      ]);
      setCandidates(usersList);
      setAllAttempts(attemptsList);
      setAuditLogs(logsList);
    } finally {
      setLoadingAdminData(false);
    }
  };

  useEffect(() => {
    if (!isPasswordVerified) return;
    if (activeTab === 'question-bank') {
      loadQuestionBankHealth(previewDay);
    } else if (activeTab === 'candidates' || activeTab === 'analytics') {
      loadCandidatesAndAnalytics();
    }
  }, [activeTab, isPasswordVerified, previewDay]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetMockId = editMockId.trim() || 'MOCK_01';
    setUploadErrorMsg(null);
    setUploadStatusMsg(null);

    try {
      const rawText = await file.text();
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
        const parsed = parseUploadedHtmlQuestions(rawText, targetMockId);
        await syncQuestionsToLocalMemoryImmediate(
          parsed,
          'html',
          'html.mcq.v1',
          `"${file.name}"`
        );
      } else {
        const { questions, schemaName, detectedExamTitle } = parseUploadedJsonQuestions(
          rawText,
          targetMockId
        );
        const nextTitle =
          detectedExamTitle && (isCreatingNewMock || editTitle.startsWith('DSSSB TGT CS Full Mock'))
            ? detectedExamTitle
            : editTitle;
        if (nextTitle !== editTitle) {
          setEditTitle(nextTitle);
        }
        await syncQuestionsToLocalMemoryImmediate(
          questions,
          'json',
          schemaName,
          `"${file.name}"`,
          nextTitle
        );
      }
    } catch (err) {
      setUploadErrorMsg(
        err instanceof Error ? err.message : 'Failed to parse uploaded question file.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleLoadBundledMock01Json = async () => {
    const targetMockId = editMockId.trim() || 'MOCK_01';
    setLoadingBundledJson(true);
    setUploadErrorMsg(null);
    setUploadStatusMsg(null);
    try {
      const res = await fetch('/assets/aistudio/dsssb-tgt-cs-full-mock-01_bd63b762.json');
      if (!res.ok) {
        throw new Error('Could not fetch bundled DSSSB TGT CS Full Mock 01 JSON file.');
      }
      const rawText = await res.text();
      const { questions, schemaName, detectedExamTitle } = parseUploadedJsonQuestions(
        rawText,
        targetMockId
      );
      const nextTitle = detectedExamTitle || editTitle;
      if (detectedExamTitle) {
        setEditTitle(detectedExamTitle);
      }
      await syncQuestionsToLocalMemoryImmediate(
        questions,
        'json',
        schemaName,
        'dsssb-tgt-cs-full-mock-01.json',
        nextTitle
      );
    } catch (err) {
      setUploadErrorMsg(
        err instanceof Error ? err.message : 'Failed to load bundled JSON paper.'
      );
    } finally {
      setLoadingBundledJson(false);
    }
  };

  const handleGenerate200Questions = async () => {
    const targetMockId = editMockId.trim() || 'MOCK_01';
    setUploadErrorMsg(null);
    const generated = generateFull200QuestionsTemplate(
      targetMockId,
      editTitle || targetMockId
    );
    await syncQuestionsToLocalMemoryImmediate(
      generated,
      'json',
      'mockrank.template.v1',
      '200-Question Generator'
    );
  };

  const handleManualLocalMemorySync = async () => {
    const cleanMockId = (editMockId || `MOCK_${String(editDayNumber).padStart(2, '0')}`)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const questionsToSync =
      uploadedQuestions.length > 0
        ? uploadedQuestions
        : generateFull200QuestionsTemplate(cleanMockId, editTitle.trim() || cleanMockId);
    await syncQuestionsToLocalMemoryImmediate(
      questionsToSync,
      uploadSourceFormat,
      detectedSchema,
      'Local Admin Editor'
    );
    setFeedbackMessage(
      `Synced "${editTitle}" (${questionsToSync.length} questions) in Local Memory (0 Firestore writes).`
    );
  };

  const handleChangeQuestionCorrectAnswer = (questionId: string, newCorrectIndex: number) => {
    setUploadedQuestions((prev) => {
      const updated = prev.map((q) =>
        q.id === questionId ? { ...q, correctIndex: newCorrectIndex } : q
      );
      const cleanMockId = (editMockId || `MOCK_${String(editDayNumber).padStart(2, '0')}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const localMock: MockBlueprint = {
        ...buildCurrentMockBlueprint(cleanMockId, editTitle, updated.length),
        syncState: 'local-memory',
      };
      saveMockToLocalMemoryOnly({
        mock: localMock,
        questions: updated,
        sourceFormat: uploadSourceFormat,
      });
      return updated;
    });
    setSyncStage('local-memory');
    setFeedbackMessage(
      `Updated answer key for question ${questionId} to Option ${['A', 'B', 'C', 'D'][newCorrectIndex]}. Click "Publish Corrected Answer Key & Recalculate All Scores" to update all mock givers' marks.`
    );
  };

  const handleChangeQuestionExplanation = (questionId: string, newExplanation: string) => {
    setUploadedQuestions((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, explanation: newExplanation } : q))
    );
  };

  const handleSaveMockAndSyncQuestions = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSyncingPaper(true);
    setFeedbackMessage(null);
    setUploadErrorMsg(null);

    try {
      const cleanMockId = (editMockId || `MOCK_${String(editDayNumber).padStart(2, '0')}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_');

      const questionsToSave =
        uploadedQuestions.length > 0
          ? uploadedQuestions
          : generateFull200QuestionsTemplate(cleanMockId, editTitle.trim() || cleanMockId);

      const updatedMock: MockBlueprint = {
        ...buildCurrentMockBlueprint(cleanMockId, editTitle, questionsToSave.length),
        syncState: 'global-firestore',
      };

      const recalcResult = await publishAnswerKeyAndRecalculateMockScoresAdmin({
        blueprint: updatedMock,
        questions: questionsToSave,
        sourceFormat: uploadSourceFormat,
        adminUid,
        adminEmail,
      });

      await onConfigUpdated();
      await loadCandidatesAndAnalytics();
      setIsCreatingNewMock(false);
      setSelectedMockId(cleanMockId);
      setUploadedQuestions(questionsToSave);
      setSyncStage('global-firestore');
      setUploadStatusMsg(
        `Published ${questionsToSave.length} questions & answer key for "${updatedMock.title}" to Firestore and recalculated ${recalcResult.attemptsRecalculated} mock attempts across ${recalcResult.usersUpdated} candidates!`
      );
      setFeedbackMessage(
        `Published "${updatedMock.title}" (${questionsToSave.length} questions) & recalculated scores for ${recalcResult.attemptsRecalculated} mock attempts (${recalcResult.usersUpdated} candidates)!`
      );
    } catch (err) {
      setUploadErrorMsg(
        err instanceof Error ? err.message : 'Failed to sync mock paper to Firestore.'
      );
    } finally {
      setSyncingPaper(false);
    }
  };

  const handleDeleteMock = async (mockIdToDelete: string) => {
    setSyncingPaper(true);
    try {
      await deleteMockAdmin(mockIdToDelete, adminUid, adminEmail);
      await onConfigUpdated();
      await loadCandidatesAndAnalytics();
      setFeedbackMessage(
        `Deleted mock ${mockIdToDelete} and reset/recalculated all attempted scores, averages, and leaderboard entries.`
      );
      handleStartCreatingNewMock();
    } catch (err) {
      setUploadErrorMsg(err instanceof Error ? err.message : 'Failed to delete mock.');
    } finally {
      setSyncingPaper(false);
    }
  };

  const handleSaveChallengeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingChallenge(true);
    setFeedbackMessage(null);
    try {
      await saveChallengeConfigAdmin(
        {
          configId: 'active',
          startDateIST,
          endDateIST,
          isPaused,
          minEligibilityAttempts: minEligibility,
          lateAttemptPolicy: latePolicy,
          defaultCorrectMarks: 1,
          defaultIncorrectMarks: -0.25,
          delayedAnswerRelease: delayedRelease,
        },
        adminUid,
        adminEmail,
        auditReason
      );
      await onConfigUpdated();
      setFeedbackMessage('Platform schedule configuration saved.');
    } finally {
      setSavingChallenge(false);
    }
  };

  const handleResetOrInvalidate = async (
    attempt: ExamAttempt,
    mode: 'reset' | 'invalidate'
  ) => {
    await adminResetOrInvalidateAttempt({
      attempt,
      mode,
      adminUid,
      adminEmail,
      reason: `Admin ${mode} of ${attempt.mockId} for UID ${attempt.uid}`,
    });
    await onConfigUpdated();
    await loadCandidatesAndAnalytics();
    setFeedbackMessage(
      `Attempt ${attempt.attemptId} ${
        mode === 'reset' ? 'reset' : 'invalidated'
      } and candidate scores recalculated.`
    );
  };

  const handleResetSingleUserMarks = async (user: UserProfile) => {
    setResettingUserUid(user.uid);
    try {
      await adminResetUserMarks({
        targetUser: user,
        adminUid,
        adminEmail,
        knownMockIds: blueprints.map((b) => b.mockId),
      });
      await onConfigUpdated();
      await loadCandidatesAndAnalytics();
      setFeedbackMessage(
        `Reset all marks, attempts, and leaderboard scores for ${user.username || user.fullName}.`
      );
    } finally {
      setResettingUserUid(null);
    }
  };

  const handleResetAllUsersMarksGlobal = async () => {
    setResettingAllMarks(true);
    try {
      const res = await adminResetAllUsersMarks({
        adminUid,
        adminEmail,
        knownMockIds: blueprints.map((b) => b.mockId),
      });
      setConfirmResetAllMarks(false);
      await onConfigUpdated();
      await loadCandidatesAndAnalytics();
      setFeedbackMessage(
        `Reset all marks and leaderboards across ${res.usersReset} users (${res.attemptsDeleted} attempts cleared).`
      );
    } finally {
      setResettingAllMarks(false);
    }
  };

  const filteredCandidates = candidates.filter(
    (c) =>
      c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.uid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleVerifyAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyingPassword(true);
    setPasswordError(null);
    try {
      const verified = await verifyAdminPasswordSafe(adminPasswordInput);
      if (!verified) {
        setPasswordError('Invalid administrator password. Access denied.');
      } else {
        await registerAdminSessionInFirestore(adminUid, adminEmail);
        setIsPasswordVerified(true);
      }
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Password verification failed.');
    } finally {
      setVerifyingPassword(false);
    }
  };

  if (!isPasswordVerified) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              Administrator Authentication
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleVerifyAdminPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Administrator Password
              </label>
              <input
                type="password"
                required
                autoFocus
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>

            {passwordError && (
              <div className="p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-800">
                {passwordError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifyingPassword}
                className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                {verifyingPassword ? 'Verifying...' : 'Unlock Admin Console'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-900 text-white shrink-0">
          <div>
            <div className="text-xs text-slate-400 font-mono">
              Authorized Administrator · {adminEmail}
            </div>
            <h2 className="text-lg font-bold">
              MockRank Admin Console — Category Mocks &amp; Live Question Sync
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white border border-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-50 border-b border-slate-200 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('mocks')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'mocks'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Add / Manage Mocks by Category ({blueprints.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('challenge')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'challenge'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Global Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('question-bank')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'question-bank'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Master Question Banks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('candidates')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'candidates'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Candidates &amp; Attempts</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Audit Log</span>
          </button>
        </div>

        {feedbackMessage && (
          <div className="px-6 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between">
            <span>{feedbackMessage}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="underline text-emerald-800 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'mocks' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Create New Mock or Select Admin-Added Mock */}
              <div className="lg:col-span-4 border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50 h-fit">
                <button
                  type="button"
                  onClick={handleStartCreatingNewMock}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Add New Mock in Category</span>
                </button>

                <div className="text-xs font-bold text-slate-900 pt-1">
                  Admin-Added Mocks ({blueprints.length})
                </div>

                {blueprints.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500 text-center">
                    No mocks published yet. Use the form on the right to add your first mock in its
                    category.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {blueprints.map((bp) => {
                      const isSelected = !isCreatingNewMock && selectedMockId === bp.mockId;
                      const isLocalOnly = bp.syncState === 'local-memory';
                      return (
                        <button
                          key={bp.mockId}
                          type="button"
                          onClick={() => {
                            setIsCreatingNewMock(false);
                            setSelectedMockId(bp.mockId);
                          }}
                          className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs flex flex-col gap-1 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-slate-900 text-white font-semibold'
                              : 'bg-white border border-slate-200 hover:bg-slate-100 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full gap-1">
                            <span className="font-mono font-bold">
                              #{bp.dayNumber} · {bp.mockId}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                isLocalOnly
                                  ? isSelected
                                    ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : isSelected
                                  ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/40'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {isLocalOnly ? 'LOCAL MEMORY' : 'GLOBAL FIRESTORE'}
                            </span>
                          </div>
                          <span className="truncate font-semibold">{bp.title}</span>
                          <div className="flex items-center justify-between text-[10px] opacity-75">
                            <span className="truncate">
                              {bp.category || 'DSSSB TGT Computer Science'}
                            </span>
                            <span className="font-mono shrink-0">{bp.unlockDateIST}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Column: Configure Category, Mock Name, Unlock Date & Upload 200 Questions */}
              <form
                onSubmit={handleSaveMockAndSyncQuestions}
                className="lg:col-span-8 space-y-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-slate-900">
                      {isCreatingNewMock
                        ? `Add New Mock Test (${editMockId})`
                        : `Edit Mock Test: ${editTitle} (${editMockId})`}
                    </h3>
                    {syncStage === 'local-memory' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300">
                        <HardDrive className="w-3 h-3" />
                        <span>Synced in Local Memory (Ready for Preview)</span>
                      </span>
                    )}
                    {syncStage === 'global-firestore' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-50 text-emerald-900 border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Synced Globally in Firestore (All Devices)</span>
                      </span>
                    )}
                  </div>

                  {!isCreatingNewMock && currentMock && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMock(currentMock.mockId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Mock</span>
                    </button>
                  )}
                </div>

                {/* Category Input + Quick Category Chips */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Mock Category (Mocks are grouped under this category for students)
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {PRESET_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditCategory(cat)}
                        className={`px-2.5 py-1 rounded text-xs font-medium border cursor-pointer ${
                          editCategory === cat
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <FolderPlus className="w-3 h-3 inline mr-1" />
                        {cat}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    required
                    placeholder="Enter Category Name (e.g., DSSSB TGT Computer Science)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mock Name
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      required
                      placeholder="e.g., DSSSB TGT CS Full Mock 01"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mock Number
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={editDayNumber}
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        setEditDayNumber(num);
                        if (isCreatingNewMock) {
                          setEditMockId(`MOCK_${String(num).padStart(2, '0')}`);
                        }
                      }}
                      required
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Unlock Date (IST)
                    </label>
                    <input
                      type="date"
                      value={editUnlockDateIST}
                      onChange={(e) => setEditUnlockDateIST(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Duration (Minutes)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={editDuration}
                      onChange={(e) => setEditDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Correct Answer Marks
                    </label>
                    <input
                      type="number"
                      step="0.25"
                      value={editCorrectMarks}
                      onChange={(e) => setEditCorrectMarks(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Negative Marking
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      max={0}
                      value={editIncorrectMarks}
                      onChange={(e) => setEditIncorrectMarks(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>

                {/* STEP 1 & STEP 2: Question Upload, Local Memory Sync, Interactive Preview & Global Firestore Sync */}
                <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        Step 1: Upload JSON (`byteprep.mcq.v1`) / HTML → Preview &amp; Sync in Local Memory First
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Questions are parsed &amp; cached in Local Memory immediately (0 Firestore writes) so you can verify every question, option, and answer key before Global Firestore Sync.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 text-xs font-mono font-bold bg-white border border-slate-200 rounded text-slate-900">
                        Schema: {detectedSchema}
                      </span>
                      <span className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-900 text-white rounded">
                        Loaded: {uploadedQuestions.length} Qs
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer">
                      <FileJson className="w-3.5 h-3.5" />
                      <span>Upload .JSON (`byteprep.mcq.v1`) or .HTML File</span>
                      <input
                        type="file"
                        accept=".json,.html,.htm,application/json,text/html"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={loadingBundledJson}
                      onClick={handleLoadBundledMock01Json}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                      <span>
                        {loadingBundledJson
                          ? 'Loading Attached Mock 01 JSON...'
                          : 'Load Attached dsssb-tgt-cs-full-mock-01.json (200 Qs)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerate200Questions}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      <span>Generate 200-Q Template</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleManualLocalMemorySync}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>Sync to Local Memory Only (0 Writes)</span>
                    </button>
                  </div>

                  {uploadStatusMsg && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
                      {uploadStatusMsg}
                    </div>
                  )}

                  {uploadErrorMsg && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                      {uploadErrorMsg}
                    </div>
                  )}

                  {uploadedQuestions.length > 0 && (
                    <div className="space-y-4 pt-1">
                      {/* Section Distribution Summary */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">
                            Section Distribution ({uploadedQuestions.length} Total Questions — Click a Section to Filter Preview):
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowQuestionPreview((prev) => !prev)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>
                              {showQuestionPreview ? 'Hide Question Preview' : 'Show Question Preview'}
                            </span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewSubjectFilter('ALL');
                              setPreviewPage(1);
                              setShowQuestionPreview(true);
                            }}
                            className={`p-2 rounded border flex items-center justify-between cursor-pointer text-left ${
                              previewSubjectFilter === 'ALL'
                                ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span className="truncate">All Sections</span>
                            <span className="font-mono font-bold">
                              {uploadedQuestions.length} Qs
                            </span>
                          </button>

                          {VALID_SUBJECTS.map((subj) => {
                            const count = uploadedQuestions.filter(
                              (q) => q.subject === subj
                            ).length;
                            const isSelectedSubj = previewSubjectFilter === subj;
                            return (
                              <button
                                key={subj}
                                type="button"
                                onClick={() => {
                                  setPreviewSubjectFilter(subj);
                                  setPreviewPage(1);
                                  setShowQuestionPreview(true);
                                }}
                                className={`p-2 rounded border flex items-center justify-between cursor-pointer text-left ${
                                  isSelectedSubj
                                    ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                <span className="truncate">{subj}</span>
                                <span className="font-mono font-bold">{count} Qs</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Interactive Question Preview Panel */}
                      {showQuestionPreview && (() => {
                        const filteredPreviewQuestions = uploadedQuestions.filter((q, idx) => {
                          if (previewSubjectFilter !== 'ALL' && q.subject !== previewSubjectFilter) {
                            return false;
                          }
                          if (!previewSearchText.trim()) return true;
                          const queryStr = previewSearchText.toLowerCase().trim();
                          const qNumStr = String(q.questionNumber || idx + 1);
                          return (
                            qNumStr === queryStr ||
                            `q${qNumStr}` === queryStr ||
                            q.id.toLowerCase().includes(queryStr) ||
                            q.question.toLowerCase().includes(queryStr) ||
                            q.topic.toLowerCase().includes(queryStr) ||
                            q.options.some((o) => o.toLowerCase().includes(queryStr))
                          );
                        });

                        const totalPages = Math.max(
                          1,
                          Math.ceil(filteredPreviewQuestions.length / PREVIEW_PAGE_SIZE)
                        );
                        const safePage = Math.min(previewPage, totalPages);
                        const pageSlice = filteredPreviewQuestions.slice(
                          (safePage - 1) * PREVIEW_PAGE_SIZE,
                          safePage * PREVIEW_PAGE_SIZE
                        );

                        return (
                          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                              <div>
                                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                  <Eye className="w-3.5 h-3.5 text-slate-700" />
                                  <span>
                                    Local Memory Question Preview ({filteredPreviewQuestions.length} matching questions)
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Showing options (a, b, c, d), verified 0-based/1-based answer key, and explanation from JSON
                                </div>
                              </div>

                              <div className="relative w-full sm:w-64">
                                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                                <input
                                  type="text"
                                  value={previewSearchText}
                                  onChange={(e) => {
                                    setPreviewSearchText(e.target.value);
                                    setPreviewPage(1);
                                  }}
                                  placeholder="Search Q#, stem, option, topic..."
                                  className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                                />
                              </div>
                            </div>

                            {pageSlice.length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-500">
                                No questions match your current filter/search.
                              </div>
                            ) : (
                              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                                {pageSlice.map((q) => {
                                  const displayNum = q.questionNumber || 1;
                                  const optionLabels = ['a', 'b', 'c', 'd'];
                                  return (
                                    <div
                                      key={q.id}
                                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2.5"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs font-bold">
                                            Q{displayNum}
                                          </span>
                                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-700">
                                            {q.part || inferPartFromSubject(q.subject)} · {q.subject}
                                          </span>
                                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-600">
                                            {q.topic}
                                          </span>
                                        </div>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          ID: {q.id}
                                        </span>
                                      </div>

                                      <div className="text-xs sm:text-sm font-semibold text-slate-900 whitespace-pre-line leading-relaxed">
                                        {q.question}
                                      </div>

                                        <div className="text-[11px] font-semibold text-emerald-800">
                                          Click any option (a / b / c / d) below to change the official correct answer for Q{displayNum}:
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {q.options.map((optText, optIdx) => {
                                            const isCorrect = q.correctIndex === optIdx;
                                            return (
                                              <button
                                                key={optIdx}
                                                type="button"
                                                onClick={() =>
                                                  handleChangeQuestionCorrectAnswer(q.id, optIdx)
                                                }
                                                className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 text-left transition-colors cursor-pointer ${
                                                  isCorrect
                                                    ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold ring-1 ring-emerald-400'
                                                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                                                }`}
                                              >
                                                <span
                                                  className={`font-mono uppercase px-1.5 py-0.2 rounded text-[11px] shrink-0 ${
                                                    isCorrect
                                                      ? 'bg-emerald-700 text-white font-bold'
                                                      : 'bg-slate-100 text-slate-600'
                                                  }`}
                                                >
                                                  {optionLabels[optIdx] || optIdx + 1}
                                                </span>
                                                <span className="flex-1 break-words">{optText}</span>
                                                <span
                                                  className={`text-[10px] font-mono font-bold shrink-0 ${
                                                    isCorrect
                                                      ? 'text-emerald-700'
                                                      : 'text-slate-400'
                                                  }`}
                                                >
                                                  {isCorrect ? '✓ CORRECT KEY' : 'Set Correct'}
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>

                                        <div className="pt-1">
                                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                            Official Explanation (Optional Edit):
                                          </label>
                                          <input
                                            type="text"
                                            value={q.explanation || ''}
                                            onChange={(e) =>
                                              handleChangeQuestionExplanation(q.id, e.target.value)
                                            }
                                            placeholder="Enter or update official explanation..."
                                            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                            )}

                            {/* Pagination Controls */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                              <span className="text-slate-600 font-mono">
                                Page {safePage} of {totalPages} ({filteredPreviewQuestions.length}{' '}
                                questions)
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={safePage <= 1}
                                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                                >
                                  <ChevronLeft className="w-3.5 h-3.5" />
                                  <span>Prev</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={safePage >= totalPages}
                                  onClick={() =>
                                    setPreviewPage((p) => Math.min(totalPages, p + 1))
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                                >
                                  <span>Next</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* STEP 2: Global Sync to Firestore Action Bar */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editEnabled}
                        onChange={(e) => setEditEnabled(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Enable Mock once Unlock Date is reached</span>
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Step 2 pushes the locally previewed Mock &amp; all {uploadedQuestions.length || 200} questions to Firestore in 1 write operation for global sync across all devices.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleManualLocalMemorySync}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>Save in Local Memory First</span>
                    </button>

                    <button
                      type="submit"
                      disabled={syncingPaper}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      <CloudUpload className="w-4 h-4" />
                      <span>
                        {syncingPaper
                          ? 'Syncing Globally to Firestore (1 Write)...'
                          : 'Sync to Firestore (Global Sync in All Devices — 1 Write)'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'challenge' && (
            <form onSubmit={handleSaveChallengeConfig} className="max-w-2xl space-y-5">
              <h3 className="text-base font-bold text-slate-900">
                Global Unlock Date &amp; Platform Settings (Asia/Kolkata)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Series Base Start Date (IST YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    value={startDateIST}
                    onChange={(e) => setStartDateIST(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Series End Date (IST YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    value={endDateIST}
                    onChange={(e) => setEndDateIST(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPaused}
                    onChange={(e) => setIsPaused(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Pause New Mock Attempts Temporarily</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={delayedRelease}
                    onChange={(e) => setDelayedRelease(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Hold Detailed Solutions Release</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={savingChallenge}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingChallenge ? 'Saving...' : 'Save Global Settings'}</span>
              </button>

              {/* Danger Zone: Reset All User Marks & Attempts */}
              <div className="pt-6 mt-6 border-t border-slate-200 space-y-3">
                <h4 className="text-sm font-bold text-red-800">
                  Reset All User Marks, Attempts &amp; Leaderboards
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Clears all attempted mock scores, Part A / Part B averages, section-wise
                  averages, and leaderboard rankings for every registered candidate so everyone
                  starts fresh at 0.00.
                </p>

                {!confirmResetAllMarks ? (
                  <button
                    type="button"
                    onClick={() => setConfirmResetAllMarks(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-300 rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All User Marks &amp; Scores</span>
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200">
                    <span className="text-xs font-bold text-red-900">
                      Confirm resetting ALL user marks, attempts, and leaderboards?
                    </span>
                    <button
                      type="button"
                      disabled={resettingAllMarks}
                      onClick={handleResetAllUsersMarksGlobal}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 rounded-md cursor-pointer"
                    >
                      {resettingAllMarks ? 'Resetting All Marks...' : 'Yes, Reset All User Marks'}
                    </button>
                    <button
                      type="button"
                      disabled={resettingAllMarks}
                      onClick={() => setConfirmResetAllMarks(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </form>
          )}

          {activeTab === 'question-bank' && (
            <div className="space-y-6">
              {/* Interactive Mock Question Bank & Answer Key Editor with Live Score Recalculation */}
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Mock Question Bank &amp; Official Answer Key Editor
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Select any Mock below to inspect all its questions, click any option (A / B /
                      C / D) to correct a wrong answer key, and publish to automatically recalculate
                      all mock givers&apos; scores and leaderboards.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={syncingPaper || uploadedQuestions.length === 0}
                    onClick={() => handleSaveMockAndSyncQuestions()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg cursor-pointer shadow-2xs"
                  >
                    <CloudUpload className="w-4 h-4" />
                    <span>
                      {syncingPaper
                        ? 'Publishing Answer Key & Recalculating Scores...'
                        : 'Publish Corrected Answer Key & Recalculate All Scores'}
                    </span>
                  </button>
                </div>

                {/* Mock Selector Pills */}
                <div className="flex flex-wrap items-center gap-2">
                  {blueprints.map((bp) => {
                    const isSelected = !isCreatingNewMock && selectedMockId === bp.mockId;
                    return (
                      <button
                        key={bp.mockId}
                        type="button"
                        onClick={() => {
                          setIsCreatingNewMock(false);
                          setSelectedMockId(bp.mockId);
                        }}
                        className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {bp.title} ({bp.totalQuestions} Qs)
                      </button>
                    );
                  })}
                </div>

                {/* Section & Search Filter inside Question Bank */}
                {uploadedQuestions.length > 0 && (() => {
                  const qbFiltered = uploadedQuestions.filter((q, idx) => {
                    if (previewSubjectFilter !== 'ALL' && q.subject !== previewSubjectFilter) {
                      return false;
                    }
                    if (!previewSearchText.trim()) return true;
                    const queryStr = previewSearchText.toLowerCase().trim();
                    const qNumStr = String(q.questionNumber || idx + 1);
                    return (
                      qNumStr === queryStr ||
                      `q${qNumStr}` === queryStr ||
                      q.id.toLowerCase().includes(queryStr) ||
                      q.question.toLowerCase().includes(queryStr) ||
                      q.topic.toLowerCase().includes(queryStr) ||
                      q.options.some((o) => o.toLowerCase().includes(queryStr))
                    );
                  });

                  const totalPages = Math.max(
                    1,
                    Math.ceil(qbFiltered.length / PREVIEW_PAGE_SIZE)
                  );
                  const safePage = Math.min(previewPage, totalPages);
                  const pageSlice = qbFiltered.slice(
                    (safePage - 1) * PREVIEW_PAGE_SIZE,
                    safePage * PREVIEW_PAGE_SIZE
                  );

                  return (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewSubjectFilter('ALL');
                              setPreviewPage(1);
                            }}
                            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                              previewSubjectFilter === 'ALL'
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            All ({uploadedQuestions.length})
                          </button>
                          {VALID_SUBJECTS.map((subj) => {
                            const count = uploadedQuestions.filter(
                              (q) => q.subject === subj
                            ).length;
                            return (
                              <button
                                key={subj}
                                type="button"
                                onClick={() => {
                                  setPreviewSubjectFilter(subj);
                                  setPreviewPage(1);
                                }}
                                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                                  previewSubjectFilter === subj
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                {subj} ({count})
                              </button>
                            );
                          })}
                        </div>

                        <div className="relative w-full sm:w-64">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                          <input
                            type="text"
                            value={previewSearchText}
                            onChange={(e) => {
                              setPreviewSearchText(e.target.value);
                              setPreviewPage(1);
                            }}
                            placeholder="Search Q#, stem, option..."
                            className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                          />
                        </div>
                      </div>

                      <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                        {pageSlice.map((q) => {
                          const displayNum = q.questionNumber || 1;
                          const optionLabels = ['A', 'B', 'C', 'D'];
                          return (
                            <div
                              key={q.id}
                              className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs font-bold">
                                    Q{displayNum}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-700">
                                    {q.part || inferPartFromSubject(q.subject)} · {q.subject}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[11px] font-bold">
                                    Current Key: Option {optionLabels[q.correctIndex ?? 0] || 'A'}
                                  </span>
                                </div>
                                <span className="font-mono text-[10px] text-slate-400">
                                  ID: {q.id}
                                </span>
                              </div>

                              <div className="text-xs sm:text-sm font-semibold text-slate-900 whitespace-pre-line leading-relaxed">
                                {q.question}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {q.options.map((optText, optIdx) => {
                                  const isCorrect = q.correctIndex === optIdx;
                                  return (
                                    <button
                                      key={optIdx}
                                      type="button"
                                      onClick={() =>
                                        handleChangeQuestionCorrectAnswer(q.id, optIdx)
                                      }
                                      className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 text-left transition-colors cursor-pointer ${
                                        isCorrect
                                          ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold ring-1 ring-emerald-500'
                                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                                      }`}
                                    >
                                      <span
                                        className={`font-mono uppercase px-1.5 py-0.5 rounded text-[11px] shrink-0 ${
                                          isCorrect
                                            ? 'bg-emerald-700 text-white font-bold'
                                            : 'bg-slate-100 text-slate-600'
                                        }`}
                                      >
                                        {optionLabels[optIdx]}
                                      </span>
                                      <span className="flex-1 break-words">{optText}</span>
                                      <span
                                        className={`text-[10px] font-mono font-bold shrink-0 ${
                                          isCorrect ? 'text-emerald-700' : 'text-slate-400'
                                        }`}
                                      >
                                        {isCorrect ? '✓ CORRECT' : 'Click to Set'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="pt-1">
                                <input
                                  type="text"
                                  value={q.explanation || ''}
                                  onChange={(e) =>
                                    handleChangeQuestionExplanation(q.id, e.target.value)
                                  }
                                  placeholder="Official explanation for this question..."
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                        <span className="text-slate-600 font-mono">
                          Page {safePage} of {totalPages} ({qbFiltered.length} questions)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={safePage <= 1}
                            onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>Prev</span>
                          </button>
                          <button
                            type="button"
                            disabled={safePage >= totalPages}
                            onClick={() => setPreviewPage((p) => Math.min(totalPages, p + 1))}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  Master Subject Question Bank Validator (7 Subjects)
                </h3>
                <button
                  type="button"
                  onClick={() => loadQuestionBankHealth(previewDay)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-validate</span>
                </button>
              </div>

              {loadingBank || !bankHealth ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  Validating master subject JSON schemas...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Schema &amp; Key Integrity</div>
                      <div className="text-lg font-bold text-emerald-700 flex items-center gap-1.5 mt-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{bankHealth.valid ? '100% Verified' : 'Issues Found'}</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Master Subject Questions</div>
                      <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                        {bankHealth.totalQuestionsAcrossSubjects}
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Private Answer Keys</div>
                      <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                        {bankHealth.privateAnswerKeysCount}
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Duplicate Question IDs</div>
                      <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                        {bankHealth.duplicateIds.length}
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <th className="py-2.5 px-4 font-semibold">Master JSON File</th>
                          <th className="py-2.5 px-3 font-semibold">Subject</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Version</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Questions</th>
                          <th className="py-2.5 px-4 font-semibold">4-Option Check</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {bankHealth.subjects.map((s) => (
                          <tr key={s.subject}>
                            <td className="py-2.5 px-4 font-mono text-xs">
                              public/question-bank/{s.subject}.json
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{s.label}</td>
                            <td className="py-2.5 px-3 text-right font-mono">v{s.version}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{s.questionCount}</td>
                            <td className="py-2.5 px-4 text-emerald-700 font-medium">
                              {s.validOptionsCount ? 'Valid (4 options each)' : 'Invalid'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'candidates' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search candidates by username, email, or UID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!confirmResetAllMarks ? (
                    <button
                      type="button"
                      onClick={() => setConfirmResetAllMarks(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-300 rounded-lg cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset All User Marks</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 p-1.5 rounded-lg bg-red-50 border border-red-300">
                      <button
                        type="button"
                        disabled={resettingAllMarks}
                        onClick={handleResetAllUsersMarksGlobal}
                        className="px-3 py-1 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 rounded cursor-pointer"
                      >
                        {resettingAllMarks ? 'Resetting...' : 'Confirm Reset All Marks'}
                      </button>
                      <button
                        type="button"
                        disabled={resettingAllMarks}
                        onClick={() => setConfirmResetAllMarks(false)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={loadCandidatesAndAnalytics}
                    className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Refresh Roster
                  </button>
                </div>
              </div>

              {loadingAdminData ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  Loading registered candidates and official attempts...
                </div>
              ) : (
                <>
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <th className="py-2.5 px-4 font-semibold">Username / Name</th>
                          <th className="py-2.5 px-3 font-semibold">Gmail ID</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Mocks Attempted</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Avg Score</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Part A Avg</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Part B Avg</th>
                          <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredCandidates.map((c) => (
                          <tr key={c.uid}>
                            <td className="py-2.5 px-4 font-medium text-slate-900">
                              {c.username || c.fullName}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs text-slate-600">
                              {c.email}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {c.mocksAttempted}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold">
                              {c.averageScore.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {(c.partAAverageScore || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {(c.partBAverageScore || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                disabled={resettingUserUid === c.uid}
                                onClick={() => handleResetSingleUserMarks(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 rounded cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>
                                  {resettingUserUid === c.uid ? 'Resetting...' : 'Reset Marks'}
                                </span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900 mb-2">
                      Recent Official Attempts (Reset or Invalidate Attempts)
                    </h4>
                    <div className="border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                            <th className="py-2.5 px-3 font-semibold">Attempt ID</th>
                            <th className="py-2.5 px-3 font-semibold">Mock</th>
                            <th className="py-2.5 px-3 font-semibold">Status</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Score</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Accuracy</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {allAttempts.map((att) => (
                            <tr key={att.attemptId}>
                              <td className="py-2.5 px-3 font-mono">{att.attemptId}</td>
                              <td className="py-2.5 px-3 font-mono">{att.mockId}</td>
                              <td className="py-2.5 px-3">{att.status}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold">
                                {att.score.toFixed(2)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                {att.accuracy.toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3 text-right space-x-2">
                                <button
                                  type="button"
                                  onClick={() => handleResetOrInvalidate(att, 'reset')}
                                  className="px-2 py-1 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded cursor-pointer"
                                >
                                  Reset Attempt
                                </button>
                                {att.status !== 'invalidated' && (
                                  <button
                                    type="button"
                                    onClick={() => handleResetOrInvalidate(att, 'invalidate')}
                                    className="px-2 py-1 text-red-700 hover:bg-red-50 border border-red-200 rounded cursor-pointer"
                                  >
                                    Invalidate
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border border-slate-200">
                  <div className="text-xs text-slate-500">Registered Candidates</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                    {candidates.length}
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-slate-200">
                  <div className="text-xs text-slate-500">Total Official Attempts</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                    {allAttempts.length}
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-slate-200">
                  <div className="text-xs text-slate-500">Published Mocks</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                    {blueprints.length} Mocks
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-2">
                  Administrator Audit Trail
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="py-2.5 px-3 font-semibold">Event ID</th>
                        <th className="py-2.5 px-3 font-semibold">Admin</th>
                        <th className="py-2.5 px-3 font-semibold">Action</th>
                        <th className="py-2.5 px-3 font-semibold">Reason / Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {auditLogs.map((log) => (
                        <tr key={log.eventId}>
                          <td className="py-2.5 px-3 font-mono">{log.eventId}</td>
                          <td className="py-2.5 px-3 font-mono">{log.adminEmail}</td>
                          <td className="py-2.5 px-3 font-semibold">{log.action}</td>
                          <td className="py-2.5 px-3 text-slate-600">{log.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
