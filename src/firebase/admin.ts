import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export function ensureFirebaseAdmin(): void {
  if (!getApps().length) initializeApp();
}

export function getFirebaseAdminAuth() {
  ensureFirebaseAdmin();
  return getAuth();
}

export function getFirebaseAdminDb() {
  ensureFirebaseAdmin();
  return getFirestore();
}

export { FieldValue };
