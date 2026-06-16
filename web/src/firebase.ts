import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type User
} from 'firebase/auth';

export type FirebaseUser = User;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''
};

export function isFirebaseConfigured(): boolean {
  if (import.meta.env.VITE_DISABLE_FIREBASE_AUTH === 'true') return false;
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  return getApps()[0] || initializeApp(firebaseConfig);
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

export function onFirebaseAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function signInFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error('Firebase auth is not configured.');
  await signInAnonymously(auth);
}

export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth) await signOut(auth);
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string> {
  const user = getFirebaseAuth()?.currentUser;
  return user ? user.getIdToken(forceRefresh) : '';
}
