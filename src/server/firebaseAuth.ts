import type { FastifyRequest } from 'fastify';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue, getFirebaseAdminAuth, getFirebaseAdminDb } from '../firebase/admin.js';
import { HttpError } from './httpErrors.js';

export function getBearerToken(header: unknown): string {
  const value = Array.isArray(header) ? header[0] : String(header || '');
  return value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

export function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}

export async function requireFirebaseUser(request: FastifyRequest): Promise<DecodedIdToken> {
  const token = getBearerToken(request.headers.authorization);
  if (!token) throw new HttpError('Sign in with Google before using paid Ariadne credits.', 401, 'firebase_auth_required');

  try {
    const user = await getFirebaseAdminAuth().verifyIdToken(token);
    await getFirebaseAdminDb().collection('users').doc(user.uid).set({
      email: user.email || '',
      name: user.name || '',
      picture: user.picture || '',
      lastSeenAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return user;
  } catch {
    throw new HttpError('Your sign-in session could not be verified.', 401, 'firebase_auth_invalid');
  }
}
