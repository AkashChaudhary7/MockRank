# MockRank — DSSSB TGT Computer Science 21-Day Mock Test Platform

**Tagline:** Real Aspirants. Real Mocks. Real Ranks.  
**Challenge:** 21 Days – 21 Full Mocks (₹49 · Free for Lifetime Premium members)

---

## 1. Architecture & Storage Principles

MockRank is engineered for high-concurrency competitive examinations while operating economically within Firebase's free Spark tier and Vercel Serverless limits:

1. **Master Subject Question Banks (`public/question-bank/*.json`)**:
   - Instead of 21 duplicated mock files or expensive Firestore question collections, all questions are stored in **5 Master Subject JSON files**:
     - `public/question-bank/general-awareness.json`
     - `public/question-bank/hindi.json`
     - `public/question-bank/english.json`
     - `public/question-bank/teaching-methodology.json`
     - `public/question-bank/computer-science.json`
   - Public JSON files contain **only question stems and options**—never correct answers or explanations.
2. **Deterministic Per-Mock Paper Selection (`server/mockEngine.ts`)**:
   - Every mock (`MOCK_01` to `MOCK_21`) selects a deterministic, fixed set of questions from the 5 master banks seeded by `dayNumber`.
   - Candidate A and Candidate B attempting `MOCK_01` always receive the **exact same fixed question paper** in the exact same order so scores and ranks are 100% comparable.
   - Refreshing the browser during an active attempt never reshuffles questions.
3. **Private Server-Side Answer Keys (`server/private-question-keys/master-answer-key.json`)**:
   - Official answer keys and explanations reside strictly on the server (or in a separate private GitHub repository accessed via `GITHUB_PRIVATE_TOKEN`).
   - Scoring (`Score = (Correct × Correct Marks) - (Incorrect × Negative Marks)`) is computed exclusively on the server via `/api/exam/evaluate`.
4. **Server-Authoritative IST Daily Unlocking (`Asia/Kolkata`)**:
   - Formula: `Available day = floor((current IST date - challenge start IST date)) + 1` (clamped to days 1–21).
   - Validated on the backend so modifying the browser/system clock cannot unlock future mocks early.

---

## 2. Firebase Spark Free-Tier Optimization & Quota Guidance

- **Firestore Collections**:
  - `/users/{uid}`: Private candidate profile, entitlements, and aggregate stats (PII-isolated to owner and admins).
  - `/attempts/{attemptId}`: Official attempt state, responses, server-anchored timestamps, and verified scores (locked once `status == 'completed'`).
  - `/leaderboard_overall/{uid}`: Precomputed candidate aggregate ranked by **Average Score** (`Sum of Valid Attempt Scores / Number of Valid Attempted Mocks`). Unattempted mocks are never counted as zero.
  - `/leaderboard_mocks/{mockId}/entries/{uid}`: Individual mock leaderboard entries with deterministic tie-breaking (`1. Higher Score -> 2. Higher Accuracy -> 3. Shorter Completion Time -> 4. Earlier Submission Time`).
  - `/challenge_config/active` & `/mock_configs/{mockId}`: Admin-managed schedule and per-mock marking schemes.
  - `/payments/{paymentId}` & `/admin_audit/{eventId}`: Verified Razorpay transactions and immutable admin audit records.
- **When to Upgrade to Blaze**:
  - Review current Firebase Spark free-tier limits at [https://firebase.google.com/pricing#cloud-firestore](https://firebase.google.com/pricing#cloud-firestore) (50,000 daily reads, 20,000 daily writes, 1 GiB storage on Standard/Enterprise free tier).
  - When concurrent active daily candidates exceed ~2,500–3,000 submitting mocks simultaneously, upgrade the project to the pay-as-you-go Blaze plan with budget alerts configured.

---

## 3. Environment Variables (`.env.example`)

Configure the following environment variables in Vercel Project Settings -> **Environment Variables**:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

GITHUB_PRIVATE_TOKEN=
GITHUB_PRIVATE_REPO=owner/private-question-keys
GITHUB_QUESTION_BANK_REPO=owner/mockrank-question-bank

ADMIN_UIDS=
CHALLENGE_START_DATE=2026-10-30
```

*Security Note:* Never prefix `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, or `GITHUB_PRIVATE_TOKEN` with `VITE_`.

---

## 4. Vercel Deployment & Custom Domain Instructions

### A. Deploying to Vercel via GitHub
1. Push this repository to GitHub.
2. In the [Vercel Dashboard](https://vercel.com/new), import the GitHub repository.
3. Vercel automatically detects `vercel.json`:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Serverless API**: `/api/*` routed to `api/index.ts`
   - **SPA Fallback**: All client routes rewrite to `/index.html`
   - **Static Caching**: `/question-bank/*.json` cached with `Cache-Control: public, max-age=3600, s-maxage=86400`.
4. Add the environment variables from `.env.example` and click **Deploy**.

### B. Connecting Your Custom Domain on Vercel
1. Open your deployed project in Vercel -> **Settings** -> **Domains**.
2. Enter your custom domain (e.g. `mockrank.in` and `www.mockrank.in`) and click **Add**.
3. Choose **Redirect `www.mockrank.in` to `mockrank.in`** (or vice versa) as your primary canonical domain.
4. Copy the exact **A Record** (for apex `@`) and **CNAME Record** (for `www`) or **TXT verification record** displayed by Vercel in your project's Domains panel. *(Always use the exact record values shown in your Vercel dashboard rather than generic placeholders.)*
5. Log in to your domain registrar's DNS management console and add those exact records.
6. Once DNS propagates, Vercel automatically provisions and renews the Let's Encrypt SSL/TLS certificate for HTTPS.
7. In the **Firebase Console** -> **Authentication** -> **Settings** -> **Authorized domains**, add your custom domain so Google Sign-In and email verification links work seamlessly.

---

## 5. Production Testing Checklist

- [x] **Authentication**: Google Sign-In (`signInWithPopup`), Email/Password registration, email verification gate, password reset, and protected student/admin views.
- [x] **Payment & Entitlements**: Razorpay order creation (`/api/payment/create-order`), cryptographic HMAC-SHA256 signature verification (`/api/payment/verify`), webhook signature verification (`/api/payment/webhook`), duplicate payment idempotency, and tampered signature rejection.
- [x] **21-Day Daily Unlocking**: Server-authoritative IST date calculation (`Asia/Kolkata`), future mock lock enforcement (`HTTP 403` on `/api/exam/paper`), and live countdown to 12:00 AM IST.
- [x] **Master Question Bank & Private Keys**: 5 subject master JSON files without answers, deterministic fixed paper per mock (`MOCK_01`–`MOCK_21`), zero duplicate question IDs, and server-only answer key evaluation.
- [x] **DSSSB CBT Terminal**: 5-state official question palette, section navigation, server-anchored countdown timer, 45-second inactivity auto-submission watchdog, fullscreen/focus monitoring, and autosave recovery.
- [x] **Dual Leaderboards**: Individual mock leaderboard and Overall Average-Score leaderboard with tie-breaking rules and real-time Firestore sync.
- [x] **Firestore Security Rules**: Verified with `@firebase/eslint-plugin-security-rules` (0 errors) and deployed via `DeployRules`.
