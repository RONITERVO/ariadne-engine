import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { getFirebaseAdminDb } from '../firebase/admin.js';
import { requireFirebaseUser } from './firebaseAuth.js';
import { HttpError } from './httpErrors.js';

type FirestoreQuery = Query<DocumentData, DocumentData>;
type FirestoreDoc = QueryDocumentSnapshot<DocumentData, DocumentData>;

interface AdminDocument {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

interface UsageSummary {
  count: number;
  usedCreditMicros: number;
  reservedCreditMicros: number;
  statuses: Record<string, number>;
  recent: AdminDocument[];
}

interface AdminUserSummary {
  uid: string;
  email: string;
  name: string;
  picture: string;
  stripeCustomerId: string;
  lastSeenAt: unknown;
  updatedAt: unknown;
  entitlement: Record<string, unknown>;
  usage: {
    liveSessions: UsageSummary;
    storyTurns: UsageSummary;
  };
  story: {
    repos: number;
  };
}

export function registerAdminRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get('/v1/admin/users', async request => {
    await requireAdminUser(request, config);
    const db = getFirebaseAdminDb();
    return { users: await listAdminUsers(db) };
  });

  app.get('/v1/admin/users/:uid', async request => {
    await requireAdminUser(request, config);
    const { uid } = request.params as { uid: string };
    const cleanUid = uid.trim();
    if (!cleanUid) throw new HttpError('uid is required.', 400, 'validation_error');
    return await getAdminUserDetail(getFirebaseAdminDb(), cleanUid);
  });
}

async function requireAdminUser(request: FastifyRequest, config: AppConfig): Promise<DecodedIdToken> {
  const user = await requireFirebaseUser(request);
  const allowed = new Set(config.adminEmails.map(email => email.toLowerCase()));
  const email = String(user.email || '').trim().toLowerCase();
  if (!allowed.size) {
    throw new HttpError('Admin access is not configured for this deployment.', 403, 'admin_not_configured');
  }
  if (!email || !allowed.has(email)) {
    throw new HttpError('This account is not allowed to use Ariadne admin.', 403, 'admin_access_denied');
  }
  return user;
}

async function listAdminUsers(db: Firestore): Promise<AdminUserSummary[]> {
  const [userDocs, entitlementDocs, repoDocs] = await Promise.all([
    docsFromQuery(db.collection('users')),
    docsFromQuery(db.collection('entitlements')),
    docsFromQuery(db.collection('storyRepos'))
  ]);
  const uids = new Set<string>();
  for (const doc of userDocs) uids.add(doc.id);
  for (const doc of entitlementDocs) uids.add(doc.id);
  for (const doc of repoDocs) {
    const ownerUserId = stringFrom(doc.data.ownerUserId);
    if (ownerUserId) uids.add(ownerUserId);
  }

  const summaries = await Promise.all([...uids].map(uid => loadUserSummary(db, uid, repoDocs)));
  return summaries.sort((a, b) => dateSortValue(b.lastSeenAt ?? b.updatedAt) - dateSortValue(a.lastSeenAt ?? a.updatedAt));
}

async function loadUserSummary(db: Firestore, uid: string, allRepoDocs?: AdminDocument[]): Promise<AdminUserSummary> {
  const [user, entitlement, liveSessions, storyTurns, repoDocs] = await Promise.all([
    docByPath(db, 'users', uid),
    docByPath(db, 'entitlements', uid),
    docsFromQuery(db.collection('usage').doc(uid).collection('liveSessions')),
    docsFromQuery(db.collection('usage').doc(uid).collection('storyTurns')),
    allRepoDocs
      ? Promise.resolve(allRepoDocs.filter(doc => stringFrom(doc.data.ownerUserId) === uid))
      : docsFromQuery(db.collection('storyRepos').where('ownerUserId', '==', uid))
  ]);
  const userData = user?.data ?? {};
  return {
    uid,
    email: stringFrom(userData.email),
    name: stringFrom(userData.name),
    picture: stringFrom(userData.picture),
    stripeCustomerId: stringFrom(userData.stripeCustomerId),
    lastSeenAt: userData.lastSeenAt ?? null,
    updatedAt: userData.updatedAt ?? null,
    entitlement: entitlement?.data ?? {},
    usage: {
      liveSessions: summarizeUsage(liveSessions),
      storyTurns: summarizeUsage(storyTurns)
    },
    story: {
      repos: repoDocs.length
    }
  };
}

async function getAdminUserDetail(db: Firestore, uid: string) {
  const [summary, billingEvents, repos, branches, turns, branchStates, branchSnapshots, eventPatches, continuityWarnings, branchMutationLocks] =
    await Promise.all([
      loadUserSummary(db, uid),
      docsFromQuery(db.collection('billingEvents').where('uid', '==', uid)),
      docsFromQuery(db.collection('storyRepos').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('branches').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('turns').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('branchStates').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('branchSnapshots').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('eventPatches').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('continuityWarnings').where('ownerUserId', '==', uid)),
      docsFromQuery(db.collection('branchMutationLocks').where('ownerUserId', '==', uid))
    ]);

  return {
    user: summary,
    documents: {
      billingEvents,
      repos,
      branches,
      turns,
      branchStates,
      branchSnapshots,
      eventPatches,
      continuityWarnings,
      branchMutationLocks
    }
  };
}

async function docByPath(db: Firestore, collection: string, id: string): Promise<AdminDocument | null> {
  const snapshot = await db.collection(collection).doc(id).get();
  return snapshot.exists
    ? {
        id: snapshot.id,
        path: snapshot.ref.path,
        data: serializeDocumentData(snapshot.data() ?? {})
      }
    : null;
}

async function docsFromQuery(query: FirestoreQuery): Promise<AdminDocument[]> {
  const snapshot = await query.get();
  return snapshot.docs
    .sort((a, b) => dateSortValue(documentDate(b)) - dateSortValue(documentDate(a)))
    .map(docToAdminDocument);
}

function docToAdminDocument(doc: FirestoreDoc): AdminDocument {
  return {
    id: doc.id,
    path: doc.ref.path,
    data: serializeDocumentData(doc.data())
  };
}

function summarizeUsage(docs: AdminDocument[]): UsageSummary {
  const statuses: Record<string, number> = {};
  let usedCreditMicros = 0;
  let reservedCreditMicros = 0;
  for (const doc of docs) {
    const status = stringFrom(doc.data.status) || 'unknown';
    statuses[status] = (statuses[status] ?? 0) + 1;
    usedCreditMicros += numberFrom(doc.data.usedCreditMicros);
    reservedCreditMicros += numberFrom(doc.data.reservedCreditMicros);
  }
  return {
    count: docs.length,
    usedCreditMicros,
    reservedCreditMicros,
    statuses,
    recent: docs.slice(0, 5)
  };
}

function serializeDocumentData(data: DocumentData): Record<string, unknown> {
  return serializeValue(data) as Record<string, unknown>;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => serializeValue(item));
  if (typeof value === 'object') {
    const timestamp = timestampToIso(value);
    if (timestamp) return timestamp;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, serializeValue(child)])
    );
  }
  return value;
}

function documentDate(doc: FirestoreDoc): unknown {
  const data = doc.data();
  return data.updatedAt ?? data.lastSeenAt ?? data.createdAt ?? data.settledAt ?? data.endedAt ?? data.appliedAt ?? null;
}

function dateSortValue(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (typeof value === 'number') return value;
  const iso = timestampToIso(value);
  return iso ? Date.parse(iso) || 0 : 0;
}

function timestampToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const maybeTimestamp = value as { toDate?: () => Date; toMillis?: () => number; _seconds?: number; seconds?: number };
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().toISOString();
  if (typeof maybeTimestamp.toMillis === 'function') return new Date(maybeTimestamp.toMillis()).toISOString();
  const seconds = typeof maybeTimestamp.seconds === 'number' ? maybeTimestamp.seconds : maybeTimestamp._seconds;
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFrom(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
