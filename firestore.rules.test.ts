/**
 * Security Rules Verification Suite (Phase 0 TDD — Dirty Dozen Payloads)
 * Verifies all 12 adversarial payloads defined in security_spec.md are rejected.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on User Profile',
    collectionPath: '/users/uid_victim',
    operation: 'create',
    authUid: 'uid_attacker',
    emailVerified: true,
    payload: { uid: 'uid_victim', fullName: 'Spoofed' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Field Injection on User Profile',
    collectionPath: '/users/uid_1',
    operation: 'create',
    authUid: 'uid_1',
    emailVerified: true,
    payload: { uid: 'uid_1', fullName: 'User', isSuperAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'PII Blanket Read Attempt',
    collectionPath: '/users/uid_victim',
    operation: 'get',
    authUid: 'uid_attacker',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified Email Admin Spoof',
    collectionPath: '/challenge_config/active',
    operation: 'update',
    authUid: 'uid_spoof',
    emailVerified: false,
    payload: { startDateIST: '2020-01-01' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Post-Submission Score Tampering (Terminal State Bypass)',
    collectionPath: '/attempts/att_completed',
    operation: 'update',
    authUid: 'uid_1',
    emailVerified: true,
    payload: { status: 'completed', score: 199.0 },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-User Attempt Read/List Scraping',
    collectionPath: '/attempts/att_other_user',
    operation: 'get',
    authUid: 'uid_attacker',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'ID Poisoning Attack',
    collectionPath: '/attempts/invalid$id!@#',
    operation: 'create',
    authUid: 'uid_1',
    emailVerified: true,
    payload: { attemptId: 'invalid$id!@#', uid: 'uid_1' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value Poisoning on Leaderboard',
    collectionPath: '/leaderboard_overall/uid_1',
    operation: 'create',
    authUid: 'uid_1',
    emailVerified: true,
    payload: { uid: 'uid_1', candidateName: 'A'.repeat(1000) },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Unauthorized Challenge Unlock Date Modification',
    collectionPath: '/challenge_config/active',
    operation: 'update',
    authUid: 'uid_student',
    emailVerified: true,
    payload: { startDateIST: '2026-01-01' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Fake Payment Injection',
    collectionPath: '/payments/pay_fake',
    operation: 'create',
    authUid: 'uid_student',
    emailVerified: true,
    payload: { paymentId: 'pay_fake', uid: 'uid_student', signatureVerified: false },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Timestamp Forgery',
    collectionPath: '/users/uid_1',
    operation: 'update',
    authUid: 'uid_1',
    emailVerified: true,
    payload: { fullName: 'Updated Name', updatedAt: '2099-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Admin Audit Deletion',
    collectionPath: '/admin_audit/evt_1',
    operation: 'delete',
    authUid: 'uid_admin',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
