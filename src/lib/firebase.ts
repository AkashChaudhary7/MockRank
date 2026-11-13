import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const resolvedConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId,
  storageBucket: firebaseAppletConfig.storageBucket,
  messagingSenderId: firebaseAppletConfig.messagingSenderId,
};

const app = initializeApp(resolvedConfig);
export const db = getFirestore(app, firebaseAppletConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const BOOTSTRAPPED_ADMIN_EMAIL = 'ictlabgsssaidana@gmail.com';
export const AUTHORIZED_BRIDGE_ORIGIN =
  'https://ais-pre-msik54kabq2udkjpbc4y64-68499964584.asia-southeast1.run.app';

export interface AppUserSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isCustomDomainSession?: boolean;
}

const CUSTOM_DOMAIN_USER_STORAGE_KEY = 'mockrank_custom_domain_user_v1';

/**
 * Checks whether the current hostname is outside Firebase Auth's default authorized domains
 * (e.g. when hosted on `mock.dsssbpyq.online` or another custom domain).
 */
export function isCustomHostedDomain(): boolean {
  if (typeof window === 'undefined') return false;
  const host = (window.location.hostname || '').toLowerCase();
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.run.app') ||
    host.endsWith('.firebaseapp.com') ||
    host.endsWith('.web.app')
  ) {
    return false;
  }
  return true;
}

export function deriveDeterministicUidFromEmail(email: string): string {
  const clean = (email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `gmail_${clean || 'candidate'}`.slice(0, 96);
}

export function getStoredCustomDomainUser(): AppUserSession | null {
  try {
    const raw = localStorage.getItem(CUSTOM_DOMAIN_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUserSession;
    if (parsed && typeof parsed.uid === 'string' && parsed.uid.length > 0 && parsed.email) {
      return {
        ...parsed,
        emailVerified: true,
        isCustomDomainSession: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCustomDomainUserSession(session: AppUserSession): AppUserSession {
  const normalized: AppUserSession = {
    uid: sanitizeId(session.uid || deriveDeterministicUidFromEmail(session.email || 'user')),
    email: (session.email || 'candidate@gmail.com').trim().toLowerCase(),
    displayName: (session.displayName || session.email?.split('@')[0] || 'Aspirant').trim(),
    photoURL: session.photoURL || '',
    emailVerified: true,
    isCustomDomainSession: true,
  };
  try {
    localStorage.setItem(CUSTOM_DOMAIN_USER_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota warnings
  }
  return normalized;
}

export function clearCustomDomainUserSession(): void {
  try {
    localStorage.removeItem(CUSTOM_DOMAIN_USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const customUser = getStoredCustomDomainUser();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || customUser?.uid || null,
      email: auth.currentUser?.email || customUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? customUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? false,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Blueprint-synchronized validation constants and sanitizers
export const BLUEPRINT_CONSTRAINTS = {
  ID_MAX_LEN: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  NAME_MAX_LEN: 100,
  EMAIL_MAX_LEN: 254,
  PHOTO_MAX_LEN: 500,
  MOCK_ID_MAX_LEN: 32,
  TITLE_MAX_LEN: 140,
  REASON_MAX_LEN: 500,
};

export function sanitizeString(val: string, maxLength: number, fallback = 'Candidate'): string {
  const trimmed = (val || '').trim();
  const nonEmpty = trimmed.length > 0 ? trimmed : fallback;
  return nonEmpty.slice(0, maxLength);
}

export function sanitizeId(id: string): string {
  const cleaned = (id || '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, BLUEPRINT_CONSTRAINTS.ID_MAX_LEN);
  return cleaned.length > 0 ? cleaned : 'default_id';
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();
