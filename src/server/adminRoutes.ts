import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, DocumentReference, Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { getFirebaseAdminDb } from '../firebase/admin.js';
import { requireFirebaseUser } from './firebaseAuth.js';
import { HttpError } from './httpErrors.js';

type FirestoreQuery = Query<DocumentData, DocumentData>;
type FirestoreDoc = QueryDocumentSnapshot<DocumentData, DocumentData>;
type FirestoreDocRef = DocumentReference<DocumentData, DocumentData>;

const RESERVED_OWNER_KEYS = new Set(['__unowned__', '_public']);

const COLLECTIONS = {
  users: 'users',
  repos: 'storyRepos',
  branches: 'branches',
  turns: 'turns',
  branchStates: 'branchState',
  branchSnapshots: 'stateSnapshots',
  eventPatches: 'canonPatches',
  continuityWarnings: 'continuityWarnings',
  branchMutationLocks: 'mutationLocks',
  billingAccounts: 'billingAccounts',
  defaultBillingAccount: 'default',
  liveSessions: 'liveSessions',
  storyTurns: 'storyTurns',
  billingEvents: 'billingEvents',
  repoIndex: 'storyRepoIndex',
  branchIndex: 'storyBranchIndex',
  turnIndex: 'storyTurnIndex',
  billingEventIndex: 'billingEventIndex'
} as const;

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

interface RepoAdminCollections {
  branches: AdminDocument[];
  turns: AdminDocument[];
  branchStates: AdminDocument[];
  branchSnapshots: AdminDocument[];
  eventPatches: AdminDocument[];
  continuityWarnings: AdminDocument[];
  branchMutationLocks: AdminDocument[];
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
  const [userDocs, repoDocs] = await Promise.all([
    docsFromQuery(db.collection(COLLECTIONS.users)),
    docsFromQuery(db.collectionGroup(COLLECTIONS.repos))
  ]);
  const uids = new Set<string>();
  for (const doc of userDocs) {
    if (!RESERVED_OWNER_KEYS.has(doc.id)) uids.add(doc.id);
  }
  for (const doc of repoDocs) {
    const ownerUserId = stringFrom(doc.data.ownerUserId);
    if (ownerUserId) uids.add(ownerUserId);
  }

  const summaries = await Promise.all([...uids].map(uid => loadUserSummary(db, uid, repoDocs)));
  return summaries.sort((a, b) => dateSortValue(b.lastSeenAt ?? b.updatedAt) - dateSortValue(a.lastSeenAt ?? a.updatedAt));
}

async function loadUserSummary(db: Firestore, uid: string, allRepoDocs?: AdminDocument[]): Promise<AdminUserSummary> {
  const userRef = userDoc(db, uid);
  const billingRef = billingAccountDoc(db, uid);
  const [user, entitlement, liveSessions, storyTurns, repoDocs] = await Promise.all([
    docAtRef(userRef),
    docAtRef(billingRef),
    docsFromQuery(billingRef.collection(COLLECTIONS.liveSessions)),
    docsFromQuery(billingRef.collection(COLLECTIONS.storyTurns)),
    allRepoDocs
      ? Promise.resolve(allRepoDocs.filter(doc => repoBelongsToUid(doc, uid)))
      : docsFromQuery(userRef.collection(COLLECTIONS.repos))
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
    entitlement: entitlementForAdmin(uid, entitlement?.data ?? {}),
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
  const userRef = userDoc(db, uid);
  const billingRef = billingAccountDoc(db, uid);
  const [summary, billingEvents, liveSessions, storyTurns, repos, repoIndexes, branchIndexes, turnIndexes, billingEventIndexes] = await Promise.all([
    loadUserSummary(db, uid),
    docsFromQuery(billingRef.collection(COLLECTIONS.billingEvents)),
    docsFromQuery(billingRef.collection(COLLECTIONS.liveSessions)),
    docsFromQuery(billingRef.collection(COLLECTIONS.storyTurns)),
    docsFromQuery(userRef.collection(COLLECTIONS.repos)),
    docsFromQuery(db.collection(COLLECTIONS.repoIndex).where('ownerUserId', '==', uid)),
    docsFromQuery(db.collection(COLLECTIONS.branchIndex).where('ownerUserId', '==', uid)),
    docsFromQuery(db.collection(COLLECTIONS.turnIndex).where('ownerUserId', '==', uid)),
    docsFromQuery(db.collection(COLLECTIONS.billingEventIndex).where('uid', '==', uid))
  ]);
  const repoCollections = await Promise.all(repos.map(repo => loadRepoAdminCollections(db, repo)));

  return {
    user: summary,
    documents: {
      billingEvents,
      liveSessions,
      storyTurns,
      repos,
      branches: flatten(repoCollections.map(item => item.branches)),
      turns: flatten(repoCollections.map(item => item.turns)),
      branchStates: flatten(repoCollections.map(item => item.branchStates)),
      branchSnapshots: flatten(repoCollections.map(item => item.branchSnapshots)),
      eventPatches: flatten(repoCollections.map(item => item.eventPatches)),
      continuityWarnings: flatten(repoCollections.map(item => item.continuityWarnings)),
      branchMutationLocks: flatten(repoCollections.map(item => item.branchMutationLocks)),
      repoIndexes,
      branchIndexes,
      turnIndexes,
      billingEventIndexes
    }
  };
}

async function loadRepoAdminCollections(db: Firestore, repo: AdminDocument): Promise<RepoAdminCollections> {
  const repoRef = db.doc(repo.path);
  const [branches, turns, branchStates, branchSnapshots, eventPatches, continuityWarnings, branchMutationLocks] = await Promise.all([
    docsFromQuery(repoRef.collection(COLLECTIONS.branches)),
    docsFromQuery(repoRef.collection(COLLECTIONS.turns)),
    docsFromQuery(repoRef.collection(COLLECTIONS.branchStates)),
    docsFromQuery(repoRef.collection(COLLECTIONS.branchSnapshots)),
    docsFromQuery(repoRef.collection(COLLECTIONS.eventPatches)),
    docsFromQuery(repoRef.collection(COLLECTIONS.continuityWarnings)),
    docsFromQuery(repoRef.collection(COLLECTIONS.branchMutationLocks))
  ]);
  return { branches, turns, branchStates, branchSnapshots, eventPatches, continuityWarnings, branchMutationLocks };
}

function userDoc(db: Firestore, uid: string): FirestoreDocRef {
  return db.collection(COLLECTIONS.users).doc(uid);
}

function billingAccountDoc(db: Firestore, uid: string): FirestoreDocRef {
  return userDoc(db, uid).collection(COLLECTIONS.billingAccounts).doc(COLLECTIONS.defaultBillingAccount);
}

async function docAtRef(ref: FirestoreDocRef): Promise<AdminDocument | null> {
  const snapshot = await ref.get();
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

function entitlementForAdmin(uid: string, data: Record<string, unknown>): Record<string, unknown> {
  const paidCreditMicros = Math.max(0, Math.floor(Number(data.paidCreditMicros) || 0));
  const usedCreditMicros = Math.max(0, Math.floor(Number(data.usedCreditMicros) || 0));
  const reservedCreditMicros = Math.max(0, Math.floor(Number(data.reservedCreditMicros) || 0));
  return {
    ...data,
    uid,
    paidCreditMicros,
    usedCreditMicros,
    reservedCreditMicros,
    remainingCreditMicros: Math.max(0, paidCreditMicros - usedCreditMicros - reservedCreditMicros)
  };
}

function repoBelongsToUid(doc: AdminDocument, uid: string): boolean {
  return stringFrom(doc.data.ownerUserId) === uid || doc.path.startsWith(`${COLLECTIONS.users}/${uid}/${COLLECTIONS.repos}/`);
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
  return primaryDate(doc.data());
}

function primaryDate(data: DocumentData | Record<string, unknown>): unknown {
  return data.updatedAt ?? data.lastSeenAt ?? data.createdAt ?? data.settledAt ?? data.endedAt ?? data.appliedAt ?? data.acquiredAt ?? null;
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

function flatten<T>(items: T[][]): T[] {
  return items.flat();
}
