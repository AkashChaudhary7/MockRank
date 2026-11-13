import express, { Request, Response } from 'express';
import crypto from 'crypto';
import {
  calculateUnlockedDayIST,
  evaluateMockAttemptServerSide,
  getAllDefaultMockBlueprints,
  getDefaultChallengeStartDateIST,
  getDefaultMockBlueprint,
  getISTNow,
  getMockUnlockDateIST,
  isMockDateUnlockedIST,
  selectQuestionsForMock,
  TOTAL_MOCKS_COUNT,
  validateMasterQuestionBanks,
} from './mockEngine.js';

export const apiRouter = express.Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  const ist = getISTNow();
  res.json({
    status: 'ok',
    service: 'MockRank Examination Engine',
    timezone: 'Asia/Kolkata',
    serverTimeIST: ist.istTimeFormatted,
    istDate: ist.istDateString,
  });
});

apiRouter.get('/time-and-config', (req: Request, res: Response) => {
  const ist = getISTNow();
  const queryStart = typeof req.query.startDateIST === 'string' ? req.query.startDateIST : '';
  const startDateIST = /^\d{4}-\d{2}-\d{2}$/.test(queryStart)
    ? queryStart
    : getDefaultChallengeStartDateIST();

  const unlockInfo = calculateUnlockedDayIST(startDateIST, ist.istDateString);
  const blueprints = getAllDefaultMockBlueprints(startDateIST).map((bp) => {
    const unlockDateIST = bp.unlockDateIST || getMockUnlockDateIST(startDateIST, bp.dayNumber);
    return {
      ...bp,
      unlockDateIST,
      isUnlockedByServerTime: isMockDateUnlockedIST(unlockDateIST, ist.istDateString),
    };
  });

  res.json({
    serverTimeUTC: ist.nowUTC.toISOString(),
    istDateString: ist.istDateString,
    istTimeFormatted: ist.istTimeFormatted,
    nextMidnightISTUtcMs: ist.nextMidnightISTUtcMs,
    defaultStartDateIST: startDateIST,
    availableDay: unlockInfo.availableDay,
    blueprints,
  });
});

apiRouter.post('/exam/paper', (req: Request, res: Response) => {
  try {
    const {
      dayNumber,
      startDateIST: clientStartDate,
      isPaused,
      blueprintOverride,
      isAdminPreview,
    } = req.body || {};

    const day = Number(dayNumber);
    if (!Number.isInteger(day) || day < 1 || day > TOTAL_MOCKS_COUNT) {
      res.status(400).json({ error: `Invalid mock number. Must be between 1 and ${TOTAL_MOCKS_COUNT}.` });
      return;
    }

    const startDateIST =
      typeof clientStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientStartDate)
        ? clientStartDate
        : getDefaultChallengeStartDateIST();

    const ist = getISTNow();
    const baseBlueprint = getDefaultMockBlueprint(day, startDateIST);
    const mergedBlueprint = {
      ...baseBlueprint,
      ...(blueprintOverride || {}),
      sections: blueprintOverride?.sections || baseBlueprint.sections,
    };

    const unlockDateIST =
      mergedBlueprint.unlockDateIST && /^\d{4}-\d{2}-\d{2}$/.test(mergedBlueprint.unlockDateIST)
        ? mergedBlueprint.unlockDateIST
        : getMockUnlockDateIST(startDateIST, day);

    const isUnlocked = isMockDateUnlockedIST(unlockDateIST, ist.istDateString);

    if (!isAdminPreview) {
      if (isPaused) {
        res.status(403).json({
          error: 'Mock tests are temporarily paused by the administrator.',
        });
        return;
      }

      if (!isUnlocked) {
        res.status(403).json({
          error: `Mock ${day} is locked. It will unlock on ${unlockDateIST} at 12:00 AM IST and remain permanently available thereafter.`,
          unlockDateIST,
        });
        return;
      }
    }

    const paper = selectQuestionsForMock(mergedBlueprint);
    const startedAtUTC = ist.nowUTC.toISOString();
    const expiresAtUTC = new Date(
      ist.nowUTC.getTime() + mergedBlueprint.durationMinutes * 60 * 1000
    ).toISOString();

    res.json({
      mockId: mergedBlueprint.mockId,
      dayNumber: day,
      title: mergedBlueprint.title,
      unlockDateIST,
      durationMinutes: mergedBlueprint.durationMinutes,
      correctMarks: mergedBlueprint.correctMarks,
      incorrectMarks: mergedBlueprint.incorrectMarks,
      maxMarks: mergedBlueprint.maxMarks,
      questionBankVersion: paper.version,
      startedAtUTC,
      expiresAtUTC,
      serverTimeUTC: startedAtUTC,
      sections: mergedBlueprint.sections,
      questions: paper.questions,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load examination paper',
    });
  }
});

apiRouter.post('/exam/evaluate', (req: Request, res: Response) => {
  try {
    const {
      mockId,
      dayNumber,
      responses,
      timeTakenSeconds,
      blueprintOverride,
      customQuestions,
      allowAnswerReview,
    } = req.body || {};

    const day = Number(dayNumber || 1);
    if (!mockId || !Number.isInteger(day) || day < 1 || day > TOTAL_MOCKS_COUNT) {
      res.status(400).json({ error: 'Invalid mock evaluation request parameters.' });
      return;
    }

    const evaluation = evaluateMockAttemptServerSide({
      mockId: String(mockId),
      dayNumber: day,
      responses: responses && typeof responses === 'object' ? responses : {},
      timeTakenSeconds: Number(timeTakenSeconds || 0),
      blueprintOverride,
      customQuestions: Array.isArray(customQuestions) ? customQuestions : undefined,
      allowAnswerReview: Boolean(allowAnswerReview),
    });

    res.json(evaluation);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Server-side scoring evaluation failed',
    });
  }
});

apiRouter.post('/exam/review', (req: Request, res: Response) => {
  try {
    const {
      mockId,
      dayNumber,
      responses,
      answerReleasePolicy,
      customQuestions,
      isAdmin,
    } = req.body || {};

    const day = Number(dayNumber || 1);
    const policy = answerReleasePolicy || 'after-submission';

    if (!isAdmin && policy === 'manual') {
      res.status(403).json({
        error: 'Answer key and explanations have been held by the administrator for delayed release.',
      });
      return;
    }

    const evaluation = evaluateMockAttemptServerSide({
      mockId: String(mockId || `MOCK_${String(day).padStart(2, '0')}`),
      dayNumber: day,
      responses: responses && typeof responses === 'object' ? responses : {},
      timeTakenSeconds: 0,
      customQuestions: Array.isArray(customQuestions) ? customQuestions : undefined,
      allowAnswerReview: true,
    });

    res.json({
      mockId: evaluation.mockId,
      reviewItems: evaluation.reviewItems || [],
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load answer review',
    });
  }
});

// Server-Side Admin Password Verification (Secret password never exposed in UI)
apiRouter.post('/admin/verify-password', (req: Request, res: Response) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      res.status(400).json({ verified: false, error: 'Admin password is required.' });
      return;
    }

    const configuredPassword = process.env.ADMIN_PASSWORD || 'Tanu77@@';
    const inputBuf = Buffer.from(password.trim(), 'utf8');
    const expectedBuf = Buffer.from(configuredPassword, 'utf8');

    const matches =
      inputBuf.length === expectedBuf.length && crypto.timingSafeEqual(inputBuf, expectedBuf);

    if (!matches) {
      res.status(401).json({
        verified: false,
        error: 'Invalid administrator password. Access denied.',
      });
      return;
    }

    res.json({
      verified: true,
      token: crypto
        .createHmac('sha256', configuredPassword)
        .update(`admin_verified_${Date.now()}`)
        .digest('hex'),
    });
  } catch (error) {
    res.status(500).json({
      verified: false,
      error: error instanceof Error ? error.message : 'Admin authentication error',
    });
  }
});

apiRouter.get('/admin/question-bank-health', (req: Request, res: Response) => {
  try {
    const health = validateMasterQuestionBanks();
    const previewDay = Number(req.query.dayNumber || 1);
    const blueprint = getDefaultMockBlueprint(
      Number.isInteger(previewDay) && previewDay >= 1 && previewDay <= TOTAL_MOCKS_COUNT ? previewDay : 1
    );
    const previewSelection = selectQuestionsForMock(blueprint);

    res.json({
      ...health,
      previewMock: {
        mockId: blueprint.mockId,
        dayNumber: blueprint.dayNumber,
        title: blueprint.title,
        totalSelected: previewSelection.questions.length,
        questionIds: previewSelection.questions.map((q) => ({
          id: q.id,
          subject: q.subject,
          topic: q.topic,
          difficulty: q.difficulty,
          language: q.language,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to validate question banks',
    });
  }
});
