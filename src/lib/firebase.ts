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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
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
  const cleaned = (id || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, BLUEPRINT_CONSTRAINTS.ID_MAX_LEN);
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
