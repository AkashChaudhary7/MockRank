# MockRank Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **PII Isolation Invariant**: `/users/{uid}` contains `email` and entitlement status. Only the authenticated owner (`request.auth.uid == uid`) or a verified administrator (`isAdmin()`) may read or write `/users/{uid}`. Public leaderboards (`/leaderboard_overall/{uid}` and `/leaderboard_mocks/{mockId}/entries/{uid}`) must never contain `email` or `phone`.
2. **Attempt Ownership & Terminal State Invariant**: An `/attempts/{attemptId}` document must have `uid == request.auth.uid` on creation. Once `status` transitions to `'completed'` or `'invalidated'`, no non-admin user may update the attempt.
3. **Entitlement & Payment Integrity Invariant**: Regular users cannot self-grant `premiumEntitlement` or `challengeEntitlement` without a corresponding verified payment or admin action, and cannot modify `/challenge_config/{configId}` or `/mock_configs/{mockId}`.
4. **Strict Key & Size Enforcement Invariant**: Every string field is bounded by explicit `.size() <= MAX` checks, every array is bounded by `.size() <= 250`, and every write validates exact allowed keys via `hasAll` and `hasOnly`.
5. **Temporal Integrity Invariant**: `updatedAt` and `createdAt` server timestamp fields must equal `request.time`.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on User Profile**: Authenticated user `uid_attacker` creates `/users/uid_victim` with `uid: "uid_victim"`. -> `PERMISSION_DENIED`
2. **Shadow Field Injection on User Profile**: User creates `/users/uid_1` including unauthorized field `"isSuperAdmin": true`. -> `PERMISSION_DENIED`
3. **PII Blanket Read Attempt**: Authenticated user `uid_attacker` attempts `get` or `list` on `/users/uid_victim`. -> `PERMISSION_DENIED`
4. **Unverified Email Admin Spoof**: Attacker sets email to `ictlabgsssaidana@gmail.com` with `email_verified: false` and attempts to write `/challenge_config/active`. -> `PERMISSION_DENIED`
5. **Post-Submission Score Tampering (Terminal State Bypass)**: Candidate updates `/attempts/att_1` after `status == 'completed'` to raise `score` from `110` to `195`. -> `PERMISSION_DENIED`
6. **Cross-User Attempt Read/List Scraping**: Candidate runs unconstrained `list` query on `/attempts` without `where('uid', '==', request.auth.uid)`. -> `PERMISSION_DENIED`
7. **ID Poisoning Attack**: Attacker attempts to create a document with a 500-character ID or special characters `../admin`. -> `PERMISSION_DENIED`
8. **Value Poisoning on Leaderboard**: Candidate attempts to write a 10KB string into `candidateName` on `/leaderboard_overall/uid_1`. -> `PERMISSION_DENIED`
9. **Unauthorized Challenge Unlock Date Modification**: Student attempts to update `startDateIST` in `/challenge_config/active` to unlock all 21 mocks early. -> `PERMISSION_DENIED`
10. **Fake Payment Injection**: Student attempts to create `/payments/pay_fake` with `signatureVerified: false` or invalid schema keys. -> `PERMISSION_DENIED`
11. **Timestamp Forgery**: Client sends a past or future forged `updatedAt` timestamp (`request.time + 1000d`) on `/attempts/att_1`. -> `PERMISSION_DENIED`
12. **Admin Audit Deletion**: Attacker or admin attempts to delete an immutable `/admin_audit/{eventId}` record. -> `PERMISSION_DENIED`
