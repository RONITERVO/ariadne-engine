import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  TurnCoverage,
  type LiveServerMessage,
  type Session
} from '@google/genai';
import {
  getFirebaseIdToken,
  isFirebaseConfigured,
  onFirebaseAuthStateChanged,
  signInWithGoogle,
  signOutFirebase,
  type FirebaseUser
} from './firebase';
import {
  CLIENT_TOKEN,
  clientTokenDisplay,
  fallbackTokenDisplay,
  sortTokenDisplays,
  type ClientToken,
  type TokenDisplay,
  type TokenSnapshot
} from './activityTokens';
import { startStoryAtlasApp } from './storyAtlas';

type PublicConfig = {
  defaultStoryTitle: string;
  defaultStoryStyle: string;
  webSpeechLanguage?: string;
  maxTranscriptChars: number;
  liveModel: string;
  paidUsageEnabled: boolean;
  firebaseAuthRequired: boolean;
  billingCurrency: string;
  defaultCheckoutAmountCents: number;
  minCheckoutAmountCents: number;
  liveBillableSeconds: number;
  audioStorageEnabled: boolean;
  audioMaxBytes: number;
  audioDefaultQualityProfile: string;
  audioAllowedQualityProfiles: string[];
  audioQualityProfiles: Record<string, AudioQualityPolicy>;
};

type AudioQualityPolicy = {
  profile: string;
  codec: string;
  containers: string[];
  contentTypes: string[];
  targetBitrateKbps: number;
  maxBitrateKbps: number;
  maxSampleRate: number;
  maxChannelCount: number;
};

type AdminDocument = {
  id: string;
  path: string;
  data: Record<string, unknown>;
};

type AdminUsageSummary = {
  count: number;
  usedCreditMicros: number;
  reservedCreditMicros: number;
  statuses: Record<string, number>;
  recent: AdminDocument[];
};

type AdminUserSummary = {
  uid: string;
  email: string;
  name: string;
  picture: string;
  stripeCustomerId: string;
  lastSeenAt: unknown;
  updatedAt: unknown;
  entitlement: Record<string, unknown>;
  usage: {
    liveSessions: AdminUsageSummary;
    storyTurns: AdminUsageSummary;
  };
  story: {
    repos: number;
  };
};

type AdminUsersResponse = {
  users: AdminUserSummary[];
};

type AdminUserDetailResponse = {
  user: AdminUserSummary;
  documents: Record<string, AdminDocument[]>;
};

type AdminMapTone = 'root' | 'story' | 'branch' | 'turn' | 'state' | 'billing' | 'warning' | 'doc';

type AdminMapNode = {
  id: string;
  title: string;
  kicker?: string;
  meta?: string;
  badges?: string[];
  details?: string[];
  raw?: unknown;
  children?: AdminMapNode[];
  open?: boolean;
  tone?: AdminMapTone;
};

type RepoState = {
  repoId: string | null;
  branchId: string | null;
  apiBase: string;
  key: string;
  config: PublicConfig | null;
  firebaseUser: FirebaseUser | null;
};

type LiveTokenResponse = {
  token: string;
  model: string;
  branchHeadTurnId: string | null;
  sessionId?: string | null;
  expiresAt?: string;
  billingMode?: 'byok' | 'paid';
};

type TimelineTurn = {
  id: string;
  turnIndex?: number;
  userTranscript?: string;
  assistantTranscript?: string;
  userAudioAssetId?: string | null;
  assistantAudioAssetId?: string | null;
  createdAt?: string;
  committedAt?: string | null;
};

type BranchTimelineResponse = {
  branchId: string;
  timeline: TimelineTurn[];
  state?: unknown;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type PcmChunk = {
  data: string;
  mimeType: string;
  startMs: number;
  endMs: number;
};

type CapturedAudioChunk = {
  data: string;
  mimeType: string;
};

type AudioUploadAsset = {
  repoId: string;
  branchId?: string | null;
  role: 'user' | 'assistant' | 'system';
  storageUri: string;
  contentType?: string | null;
  sha256: string;
  crc32c?: string | null;
  codec: string;
  container: string;
  qualityProfile?: string | null;
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength?: number;
  encryptionKeyRef?: string | null;
};

type AudioUploadResponse = {
  audioUpload: {
    method: 'PUT';
    uploadUrl: string;
    uploadId: string;
    expiresAt: string;
    headers: Record<string, string>;
    asset: AudioUploadAsset;
    maxBytes: number;
  };
};

type AudioAssetResponse = {
  audioAsset: {
    id: string;
  };
};

type AudioPlaybackResponse = {
  audioPlayback: {
    method: 'GET';
    playbackUrl: string;
    expiresAt: string;
    contentType?: string | null;
    byteLength?: number;
    durationMs?: number;
  };
};

type LiveTurnCommitResponse = {
  turn?: {
    id?: string;
    userAudioAssetId?: string | null;
    assistantAudioAssetId?: string | null;
  };
};

type AudioArchiveBlob = {
  blob: Blob;
  contentType: string;
  codec: string;
  container: string;
  qualityProfile: string;
  bitrateKbps: number;
  channelCount: number;
  sampleRate?: number;
  durationMs?: number;
};

type LiveTurn = {
  session: Session;
  sessionId: string | null;
  startedAtMs: number;
  sentThroughMs: number;
  tokens: Set<ClientToken>;
  tailTimer: number | null;
  closeTimer: number | null;
  emptyTurnTimer: number | null;
  expectedHeadTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  userAudioChunks: PcmChunk[];
  assistantAudioChunks: CapturedAudioChunk[];
  userLine: HTMLElement | null;
  assistantLine: HTMLElement | null;
};

type TranscriptRole = 'user' | 'model' | 'system';

type TranscriptLineOptions = {
  scroll?: boolean;
  audioAssetId?: string | null;
  turnId?: string;
  turnIndex?: number;
};

const STORAGE = {
  key: 'ariadne.geminiKey',
  repoId: 'ariadne.repoId',
  branchId: 'ariadne.branchId',
  apiBase: 'ariadne.apiBase',
  clientId: 'ariadne.clientId'
} as const;

const PRE_ROLL_MS = 2000;
const POST_ROLL_MS = 2000;
const SPEECH_IDLE_MS = 1500;
const PCM_BUFFER_MS = 10_000;
const EMPTY_LIVE_TURN_TIMEOUT_MS = 12_000;
const AUDIO_ARCHIVE_ENCODINGS = [
  { mimeType: 'audio/webm;codecs=opus', contentType: 'audio/webm;codecs=opus', codec: 'opus', container: 'webm', qualityProfile: 'voice-hifi' },
  { mimeType: 'audio/ogg;codecs=opus', contentType: 'audio/ogg;codecs=opus', codec: 'opus', container: 'ogg', qualityProfile: 'voice-hifi' },
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', contentType: 'audio/mp4;codecs=mp4a.40.2', codec: 'aac', container: 'mp4', qualityProfile: 'aac-hifi' }
] as const;

function initialStoryId(storageKey: typeof STORAGE.repoId | typeof STORAGE.branchId, queryKeys: string[]): string | null {
  const params = new URLSearchParams(window.location.search);
  for (const key of queryKeys) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    sessionStorage.setItem(storageKey, value);
    return value;
  }
  return sessionStorage.getItem(storageKey);
}

function resolveApiBase(): string {
  const params = new URLSearchParams(window.location.search);
  const queryApi = params.get('api');
  if (queryApi) localStorage.setItem(STORAGE.apiBase, queryApi.replace(/\/$/, ''));

  const configured = import.meta.env.VITE_ARIADNE_API_BASE?.replace(/\/$/, '') || import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const saved = localStorage.getItem(STORAGE.apiBase);
  if (saved) return saved.replace(/\/$/, '');
  if (window.location.hostname === 'localhost' && window.location.port === '5173') return 'http://localhost:3000';
  return window.location.origin;
}

const state: RepoState = {
  repoId: initialStoryId(STORAGE.repoId, ['repoId', 'repo']),
  branchId: initialStoryId(STORAGE.branchId, ['branchId', 'branch']),
  apiBase: resolveApiBase(),
  key: sessionStorage.getItem(STORAGE.key) ?? '',
  config: null,
  firebaseUser: null
};
const ADMIN_PATH = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
const STORY_ATLAS_PATH = window.location.pathname === '/map' || window.location.pathname.startsWith('/map/');

const els = {
  gate: byId<HTMLElement>('key-gate'),
  apiKey: byId<HTMLInputElement>('api-key'),
  signIn: byId<HTMLButtonElement>('sign-in'),
  signOut: byId<HTMLButtonElement>('sign-out'),
  buyCredits: byId<HTMLButtonElement>('buy-credits'),
  status: byId<HTMLElement>('gate-status'),
  transcript: byId<HTMLElement>('transcript')
};

let recognition: SpeechRecognitionLike | null = null;
let bootDebounce: number | undefined;
let audioContext: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let mediaStream: MediaStream | null = null;
let pcmChunks: PcmChunk[] = [];
let activeTurn: LiveTurn | null = null;
let liveStarting: Promise<void> | null = null;
let audioPlayhead = 0;
let tokenFlagOpen = false;
let latestBackendTokens: TokenSnapshot | null = null;
let transcriptPlaybackAudio: HTMLAudioElement | null = null;
let transcriptPlaybackLine: HTMLElement | null = null;
let transcriptPlaybackRequestId = 0;
let hydratedTranscriptBranchId: string | null = null;
const localActivityTokens = new Set<ClientToken>();
const tokenFlagEls: {
  root?: HTMLButtonElement;
  label?: HTMLElement;
  count?: HTMLElement;
  panel?: HTMLElement;
} = {};

if (ADMIN_PATH) {
  startAdminDashboard();
} else if (STORY_ATLAS_PATH) {
  startStoryAtlasApp({ apiBase: state.apiBase });
} else {
  startTranscriptApp();
}

function startTranscriptApp(): void {
  mountTokenFlag();
  mountStoryMapLink();
  addLocalToken(CLIENT_TOKEN.UI_GATE_OPEN);
  els.apiKey.value = state.key;
  updateProviderTokenFromKey();
  els.apiKey.addEventListener('input', () => {
    state.key = els.apiKey.value.trim();
    updateProviderTokenFromKey();
    sessionStorage.setItem(STORAGE.key, state.key);
    scheduleBoot();
  });
  els.apiKey.addEventListener('paste', () => window.setTimeout(scheduleBoot, 0));
  els.signIn.addEventListener('click', () => void signInWithGoogle().catch(error => setGateStatus(messageFrom(error))));
  els.signOut.addEventListener('click', () => void signOutFirebase().catch(error => setGateStatus(messageFrom(error))));
  els.buyCredits.addEventListener('click', () => void buyCredits());

  onFirebaseAuthStateChanged(user => {
    state.firebaseUser = user;
    updateGateActions();
    if (user && !hasLocalToken(CLIENT_TOKEN.APP_TRANSCRIPT_STARTED)) scheduleBoot();
  });

  if (state.key || !isFirebaseConfigured()) scheduleBoot();
}

function mountStoryMapLink(): void {
  if (document.getElementById('story-map-link')) return;
  const link = document.createElement('a');
  link.id = 'story-map-link';
  link.className = 'story-map-link';
  link.href = '/map';
  link.textContent = 'Atlas';
  link.setAttribute('aria-label', 'Open Ariadne story atlas');
  document.body.append(link);
}

function startAdminDashboard(): void {
  document.title = 'Ariadne Admin';
  document.body.innerHTML = `
    <main class="admin-shell" aria-label="Ariadne admin">
      <header class="admin-header">
        <div>
          <p class="eyebrow">Ariadne Engine</p>
          <h1>Admin</h1>
        </div>
        <div class="admin-actions">
          <button id="admin-sign-in" type="button">Sign in</button>
          <button id="admin-refresh" type="button" hidden>Refresh</button>
          <button id="admin-sign-out" type="button" hidden>Sign out</button>
        </div>
      </header>
      <p id="admin-status" class="status" role="status"></p>
      <section class="admin-layout">
        <section class="admin-panel" aria-labelledby="admin-users-title">
          <h2 id="admin-users-title">Users</h2>
          <div id="admin-users" class="admin-table-wrap"></div>
        </section>
        <section class="admin-panel admin-detail" aria-labelledby="admin-detail-title">
          <h2 id="admin-detail-title">Detail</h2>
          <div id="admin-detail"></div>
        </section>
      </section>
    </main>
  `;

  const adminEls = {
    signIn: byId<HTMLButtonElement>('admin-sign-in'),
    signOut: byId<HTMLButtonElement>('admin-sign-out'),
    refresh: byId<HTMLButtonElement>('admin-refresh'),
    status: byId<HTMLElement>('admin-status'),
    users: byId<HTMLElement>('admin-users'),
    detail: byId<HTMLElement>('admin-detail')
  };
  let selectedUid = '';

  adminEls.signIn.addEventListener('click', () => void signInWithGoogle().catch(error => setAdminStatus(adminEls, messageFrom(error))));
  adminEls.signOut.addEventListener('click', () => void signOutFirebase().catch(error => setAdminStatus(adminEls, messageFrom(error))));
  adminEls.refresh.addEventListener('click', () => void refreshAdminUsers(adminEls, selectedUid).then(uid => {
    selectedUid = uid;
  }));

  onFirebaseAuthStateChanged(user => {
    state.firebaseUser = user;
    adminEls.signIn.hidden = !isFirebaseConfigured() || Boolean(user);
    adminEls.signOut.hidden = !isFirebaseConfigured() || !user;
    adminEls.refresh.hidden = !isFirebaseConfigured() || !user;
    if (!isFirebaseConfigured()) {
      setAdminStatus(adminEls, 'Firebase auth is not configured.');
      return;
    }
    if (!user) {
      setAdminStatus(adminEls, 'Sign in with an admin account.');
      adminEls.users.replaceChildren();
      adminEls.detail.replaceChildren();
      return;
    }
    void refreshAdminUsers(adminEls, selectedUid).then(uid => {
      selectedUid = uid;
    });
  });
}

async function refreshAdminUsers(
  adminEls: { status: HTMLElement; users: HTMLElement; detail: HTMLElement },
  selectedUid: string
): Promise<string> {
  setAdminStatus(adminEls, 'Loading users...');
  const payload = await authorizedFetch<AdminUsersResponse>('/v1/admin/users', { method: 'GET' });
  renderAdminUsers(adminEls, payload.users, selectedUid);
  const nextUid = selectedUid || payload.users[0]?.uid || '';
  if (nextUid) await loadAdminUser(adminEls, nextUid);
  setAdminStatus(adminEls, `${payload.users.length} user${payload.users.length === 1 ? '' : 's'}.`);
  return nextUid;
}

function renderAdminUsers(
  adminEls: { users: HTMLElement; detail: HTMLElement; status: HTMLElement },
  users: AdminUserSummary[],
  selectedUid: string
): void {
  const table = document.createElement('table');
  table.className = 'admin-table';
  table.append(adminHeaderRow(['User', 'Credits', 'Live', 'Turns', 'Repos', 'Stripe']));
  const body = document.createElement('tbody');
  for (const user of users) {
    const row = document.createElement('tr');
    row.classList.toggle('is-selected', user.uid === selectedUid);

    const userCell = document.createElement('td');
    const open = document.createElement('button');
    open.className = 'admin-link-button';
    open.type = 'button';
    open.textContent = user.email || user.name || shortId(user.uid);
    open.addEventListener('click', () => void loadAdminUser(adminEls, user.uid));
    userCell.append(open, smallText(user.uid));
    row.append(userCell);

    appendCell(row, formatCredits(numberFrom(user.entitlement.remainingCreditMicros)));
    appendCell(row, `${user.usage.liveSessions.count}`);
    appendCell(row, `${user.usage.storyTurns.count}`);
    appendCell(row, `${user.story.repos}`);
    appendCell(row, user.stripeCustomerId || '-');
    body.append(row);
  }
  table.append(body);
  adminEls.users.replaceChildren(table);
}

async function loadAdminUser(
  adminEls: { status: HTMLElement; detail: HTMLElement },
  uid: string
): Promise<void> {
  setAdminStatus(adminEls, `Loading ${shortId(uid)}...`);
  const payload = await authorizedFetch<AdminUserDetailResponse>(`/v1/admin/users/${encodeURIComponent(uid)}`, { method: 'GET' });
  renderAdminDetail(adminEls.detail, payload);
  setAdminStatus(adminEls, `Loaded ${payload.user.email || shortId(uid)}.`);
}

function renderAdminDetail(container: HTMLElement, payload: AdminUserDetailResponse): void {
  const user = payload.user;
  const root = document.createDocumentFragment();
  const identity = document.createElement('section');
  identity.className = 'admin-summary';
  identity.append(
    metric('Email', user.email || '-'),
    metric('UID', user.uid),
    metric('Name', user.name || '-'),
    metric('Stripe customer', user.stripeCustomerId || '-'),
    metric('Remaining credits', formatCredits(numberFrom(user.entitlement.remainingCreditMicros))),
    metric('Used credits', formatCredits(numberFrom(user.entitlement.usedCreditMicros))),
    metric('Reserved credits', formatCredits(numberFrom(user.entitlement.reservedCreditMicros))),
    metric('Last seen', formatDate(user.lastSeenAt))
  );
  root.append(identity);
  root.append(renderAdminConnectionMap(payload));

  root.append(
    usagePanel('Live sessions', user.usage.liveSessions),
    usagePanel('Story turns', user.usage.storyTurns)
  );

  const order = [
    'repos',
    'branches',
    'turns',
    'branchStates',
    'branchSnapshots',
    'eventPatches',
    'continuityWarnings',
    'branchMutationLocks',
    'audioAssets',
    'liveSessions',
    'storyTurns',
    'billingEvents',
    'repoIndexes',
    'branchIndexes',
    'turnIndexes',
    'billingEventIndexes'
  ];
  for (const key of order) {
    root.append(documentSection(key, payload.documents[key] ?? []));
  }
  container.replaceChildren(root);
}


function renderAdminConnectionMap(payload: AdminUserDetailResponse): HTMLElement {
  const section = document.createElement('section');
  section.className = 'admin-doc-section admin-map-section';

  const header = document.createElement('div');
  header.className = 'admin-map-header';
  const heading = document.createElement('h3');
  heading.textContent = 'Connection tree';
  const help = document.createElement('p');
  help.className = 'admin-muted admin-map-help';
  help.textContent = 'Click any card to open the next layer: user → billing and story repos → branches → timeline turns → canon patches, warnings, state, entities, facts, and threads.';
  header.append(heading, help);

  const controls = document.createElement('div');
  controls.className = 'admin-map-controls';
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Filter by repo, branch, turn, entity, warning, status, or ID';
  filter.setAttribute('aria-label', 'Filter connection tree');
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.textContent = 'Expand all';
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.textContent = 'Collapse all';
  controls.append(filter, expand, collapse);

  const map = document.createElement('div');
  map.className = 'admin-map';
  map.append(adminMapList([buildAdminMap(payload)]));

  filter.addEventListener('input', () => applyAdminMapFilter(map, filter.value));
  expand.addEventListener('click', () => {
    map.querySelectorAll<HTMLDetailsElement>('.admin-map-node').forEach(details => {
      details.open = true;
    });
  });
  collapse.addEventListener('click', () => {
    map.querySelectorAll<HTMLDetailsElement>('.admin-map-node').forEach(details => {
      details.open = details.dataset.defaultOpen === 'true';
    });
    applyAdminMapFilter(map, filter.value);
  });

  section.append(header, controls, map);
  return section;
}

function buildAdminMap(payload: AdminUserDetailResponse): AdminMapNode {
  const user = payload.user;
  const repos = adminDocs(payload, 'repos');
  const branches = adminDocs(payload, 'branches');
  const turns = adminDocs(payload, 'turns');
  const warnings = adminDocs(payload, 'continuityWarnings');
  const billingEvents = adminDocs(payload, 'billingEvents');
  const liveSessions = adminDocs(payload, 'liveSessions');
  const storyTurnUsage = adminDocs(payload, 'storyTurns');
  const activeLiveSessionId = stringFrom(user.entitlement.activeLiveSessionId);

  return {
    id: `user:${user.uid}`,
    kicker: 'Selected user',
    title: user.email || user.name || shortId(user.uid),
    meta: user.name && user.email ? user.name : user.uid,
    badges: compactStrings([
      `${repos.length} repo${repos.length === 1 ? '' : 's'}`,
      `${branches.length} branch${branches.length === 1 ? '' : 'es'}`,
      `${turns.length} turn${turns.length === 1 ? '' : 's'}`,
      warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
      activeLiveSessionId ? 'live session active' : ''
    ]),
    details: compactStrings([
      `Last seen: ${formatDate(user.lastSeenAt)}`,
      `Credits: ${formatCredits(numberFrom(user.entitlement.remainingCreditMicros))} remaining, ${formatCredits(numberFrom(user.entitlement.reservedCreditMicros))} reserved`,
      user.stripeCustomerId ? `Stripe customer: ${user.stripeCustomerId}` : ''
    ]),
    open: true,
    tone: 'root',
    children: [
      buildStoriesMapNode(payload),
      buildBillingMapNode(user, billingEvents, liveSessions.length ? liveSessions : user.usage.liveSessions.recent, storyTurnUsage.length ? storyTurnUsage : user.usage.storyTurns.recent)
    ]
  };
}

function buildStoriesMapNode(payload: AdminUserDetailResponse): AdminMapNode {
  const repos = sortDocs(adminDocs(payload, 'repos'));
  const branches = adminDocs(payload, 'branches');
  const turns = adminDocs(payload, 'turns');
  const branchStates = adminDocs(payload, 'branchStates');
  const branchSnapshots = adminDocs(payload, 'branchSnapshots');
  const eventPatches = adminDocs(payload, 'eventPatches');
  const continuityWarnings = adminDocs(payload, 'continuityWarnings');
  const branchMutationLocks = adminDocs(payload, 'branchMutationLocks');
  const audioAssets = adminDocs(payload, 'audioAssets');
  const turnById = indexDocsByEntityId(turns);
  const repoChildren = repos.map(repo => buildRepoMapNode(repo, {
    branches,
    turns,
    branchStates,
    branchSnapshots,
    eventPatches,
    continuityWarnings,
    branchMutationLocks,
    turnById
  }));

  const branchRepoIds = new Set(branches.map(doc => stringFrom(doc.data.repoId)).filter(Boolean));
  const repoIds = new Set(repos.map(docEntityId));
  const orphanBranches = branches.filter(branch => !repoIds.has(stringFrom(branch.data.repoId)));
  if (orphanBranches.length) {
    repoChildren.push(docsGroupNode('story:orphan-branches', 'Unlinked branches', orphanBranches, branch => compactDocNode('Branch without loaded repo', branch, 'branch')));
  }
  const orphanRepoIds = [...branchRepoIds].filter(id => !repoIds.has(id));
  if (orphanRepoIds.length) {
    repoChildren.push({
      id: 'story:missing-repos',
      kicker: 'Data gap',
      title: 'Missing repo documents referenced by branches',
      meta: orphanRepoIds.map(shortId).join(', '),
      tone: 'warning',
      details: ['These branches point to repos that were not returned in this admin payload.']
    });
  }

  return {
    id: 'stories',
    kicker: 'Story graph',
    title: 'Stories',
    meta: repos.length ? 'Repos, branch DAGs, turns, patches, compiled state, and continuity checks.' : 'No story repos for this user.',
    badges: compactStrings([
      `${repos.length} repo${repos.length === 1 ? '' : 's'}`,
      `${branches.length} branch${branches.length === 1 ? '' : 'es'}`,
      `${turns.length} turn${turns.length === 1 ? '' : 's'}`,
      `${eventPatches.length} patch${eventPatches.length === 1 ? '' : 'es'}`,
      continuityWarnings.length ? `${continuityWarnings.length} continuity warning${continuityWarnings.length === 1 ? '' : 's'}` : ''
    ]),
    open: true,
    tone: 'story',
    children: repoChildren
  };
}

function buildRepoMapNode(repo: AdminDocument, graph: {
  branches: AdminDocument[];
  turns: AdminDocument[];
  branchStates: AdminDocument[];
  branchSnapshots: AdminDocument[];
  eventPatches: AdminDocument[];
  continuityWarnings: AdminDocument[];
  branchMutationLocks: AdminDocument[];
  turnById: Map<string, AdminDocument>;
}): AdminMapNode {
  const repoId = docEntityId(repo);
  const branches = sortDocs(graph.branches.filter(doc => stringFrom(doc.data.repoId) === repoId));
  const repoTurns = graph.turns.filter(doc => stringFrom(doc.data.repoId) === repoId);
  const patches = graph.eventPatches.filter(doc => stringFrom(doc.data.repoId) === repoId);
  const warnings = graph.continuityWarnings.filter(doc => stringFrom(doc.data.repoId) === repoId);
  const branchIds = new Set(branches.map(docEntityId));
  const branchChildren = branches.map(branch => buildBranchMapNode(branch, graph));
  const unlinkedTurns = repoTurns.filter(turn => !branchIds.has(stringFrom(turn.data.branchId)));
  if (unlinkedTurns.length) {
    branchChildren.push(docsGroupNode(
      `repo:${repoId}:unlinked-turns`,
      'Turns without a loaded branch',
      sortTurnDocs(unlinkedTurns),
      turn => buildTurnMapNode(turn, graph.eventPatches, graph.branchSnapshots, graph.continuityWarnings, false)
    ));
  }

  return {
    id: `repo:${repoId}`,
    kicker: 'Repo',
    title: stringFrom(repo.data.title) || shortId(repoId),
    meta: compactStrings([stringFrom(repo.data.description), stringFrom(repo.data.defaultStyle)]).join(' · ') || `Updated ${formatDate(repo.data.updatedAt)}`,
    badges: compactStrings([
      `${branches.length} branch${branches.length === 1 ? '' : 'es'}`,
      `${repoTurns.length} turn${repoTurns.length === 1 ? '' : 's'}`,
      `${patches.length} patch${patches.length === 1 ? '' : 'es'}`,
      warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''
    ]),
    details: compactStrings([
      `Created: ${formatDate(repo.data.createdAt)}`,
      `Updated: ${formatDate(repo.data.updatedAt)}`,
      `Safety profile: ${stringFrom(repo.data.safetyProfile) || '-'}`,
      `Repo ID: ${repoId}`
    ]),
    raw: repo.data,
    open: branches.length === 1,
    tone: 'story',
    children: branchChildren
  };
}

function buildBranchMapNode(branch: AdminDocument, graph: {
  branches: AdminDocument[];
  turns: AdminDocument[];
  branchStates: AdminDocument[];
  branchSnapshots: AdminDocument[];
  eventPatches: AdminDocument[];
  continuityWarnings: AdminDocument[];
  branchMutationLocks: AdminDocument[];
  turnById: Map<string, AdminDocument>;
}): AdminMapNode {
  const branchId = docEntityId(branch);
  const headTurnId = stringFrom(branch.data.headTurnId);
  const timeline = branchTimeline(branch, graph.turnById);
  const directTurns = sortTurnDocs(graph.turns.filter(doc => stringFrom(doc.data.branchId) === branchId));
  const timelineIds = new Set(timeline.map(docEntityId));
  const directOnlyTurns = directTurns.filter(turn => !timelineIds.has(docEntityId(turn)));
  const branchState = graph.branchStates.find(doc => docEntityId(doc) === branchId || stringFrom(doc.data.branchId) === branchId) ?? null;
  const snapshots = sortDocs(graph.branchSnapshots.filter(doc => stringFrom(doc.data.branchId) === branchId));
  const patches = sortDocs(graph.eventPatches.filter(doc => stringFrom(doc.data.branchId) === branchId));
  const warnings = sortDocs(graph.continuityWarnings.filter(doc => stringFrom(doc.data.branchId) === branchId));
  const locks = sortDocs(graph.branchMutationLocks.filter(doc => docEntityId(doc) === branchId || stringFrom(doc.data.branchId) === branchId));
  const forkedFromTurnId = stringFrom(branch.data.forkedFromTurnId);
  const forkedFromTurn = forkedFromTurnId ? graph.turnById.get(forkedFromTurnId) ?? null : null;
  const children: AdminMapNode[] = [];

  if (forkedFromTurnId) {
    children.push({
      id: `branch:${branchId}:fork`,
      kicker: 'Fork point',
      title: forkedFromTurn ? turnTitle(forkedFromTurn) : shortId(forkedFromTurnId),
      meta: forkedFromTurn ? clip(stringFrom(forkedFromTurn.data.userTranscript) || stringFrom(forkedFromTurn.data.assistantTranscript), 140) : 'Referenced turn is not in this payload.',
      badges: forkedFromTurn ? ['ancestor turn'] : ['missing turn'],
      raw: forkedFromTurn?.data ?? { forkedFromTurnId },
      tone: forkedFromTurn ? 'turn' : 'warning'
    });
  }

  children.push({
    id: `branch:${branchId}:timeline`,
    kicker: 'Branch path',
    title: 'Timeline',
    meta: timeline.length ? `${timeline.length} turn${timeline.length === 1 ? '' : 's'} from root to head.` : 'No committed turns yet.',
    badges: compactStrings([headTurnId ? `head ${shortId(headTurnId)}` : 'empty branch']),
    open: timeline.length > 0 && timeline.length <= 4,
    tone: 'turn',
    children: timeline.map(turn => buildTurnMapNode(turn, graph.eventPatches, graph.branchSnapshots, graph.continuityWarnings, docEntityId(turn) === headTurnId))
  });

  if (directOnlyTurns.length) {
    children.push(docsGroupNode(
      `branch:${branchId}:direct-only`,
      'Direct turns not on current head path',
      directOnlyTurns,
      turn => buildTurnMapNode(turn, graph.eventPatches, graph.branchSnapshots, graph.continuityWarnings, false)
    ));
  }
  if (branchState) children.push(buildWorldStateMapNode(branchState));
  children.push(docsGroupNode(`branch:${branchId}:patches`, 'Event patches', patches, buildPatchMapNode));
  children.push(docsGroupNode(`branch:${branchId}:warnings`, 'Continuity warnings', warnings, buildContinuityWarningMapNode, 'No continuity warnings recorded for this branch.'));
  if (locks.length) children.push(docsGroupNode(`branch:${branchId}:locks`, 'Mutation locks', locks, doc => compactDocNode('Lock', doc, 'warning')));
  if (snapshots.length) children.push(docsGroupNode(`branch:${branchId}:snapshots`, 'Compiled snapshots', snapshots, doc => compactDocNode('Snapshot', doc, 'state')));

  return {
    id: `branch:${branchId}`,
    kicker: 'Branch',
    title: stringFrom(branch.data.name) || shortId(branchId),
    meta: forkedFromTurnId ? `Forked from ${shortId(forkedFromTurnId)}` : 'Main/root branch',
    badges: compactStrings([
      `${timeline.length} path turn${timeline.length === 1 ? '' : 's'}`,
      headTurnId ? `head ${shortId(headTurnId)}` : 'no head',
      warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
      locks.length ? 'locked' : ''
    ]),
    details: compactStrings([
      `Branch ID: ${branchId}`,
      `Created: ${formatDate(branch.data.createdAt)}`,
      `Updated: ${formatDate(branch.data.updatedAt)}`,
      forkedFromTurnId ? `Forked from turn: ${forkedFromTurnId}` : ''
    ]),
    raw: branch.data,
    open: false,
    tone: 'branch',
    children
  };
}

function buildTurnMapNode(
  turn: AdminDocument,
  allPatches: AdminDocument[],
  allSnapshots: AdminDocument[],
  allWarnings: AdminDocument[],
  isHead: boolean
): AdminMapNode {
  const turnId = docEntityId(turn);
  const patches = sortDocs(allPatches.filter(doc => stringFrom(doc.data.turnId) === turnId));
  const snapshots = sortDocs(allSnapshots.filter(doc => stringFrom(doc.data.turnId) === turnId || docEntityId(doc) === turnId));
  const warnings = sortDocs(allWarnings.filter(doc => stringFrom(doc.data.turnId) === turnId));
  const modelMetadata = arrayFrom(turn.data.modelMetadata);
  const transcriptChildren: AdminMapNode[] = [
    transcriptNode(`turn:${turnId}:user`, 'User transcript', stringFrom(turn.data.userTranscript)),
    transcriptNode(`turn:${turnId}:assistant`, 'Assistant transcript', stringFrom(turn.data.assistantTranscript))
  ];
  if (modelMetadata.length) {
    transcriptChildren.push({
      id: `turn:${turnId}:models`,
      kicker: 'Model calls',
      title: `${modelMetadata.length} invocation${modelMetadata.length === 1 ? '' : 's'}`,
      badges: compactStrings(modelMetadata.map(item => stringFrom(recordFrom(item)?.purpose)).filter(Boolean)),
      tone: 'doc',
      children: modelMetadata.map((item, index) => {
        const record = recordFrom(item) ?? {};
        return {
          id: `turn:${turnId}:model:${index}`,
          kicker: stringFrom(record.purpose) || 'Model invocation',
          title: compactStrings([stringFrom(record.provider), stringFrom(record.model)]).join(' · ') || `Invocation ${index + 1}`,
          meta: compactStrings([formatDate(record.startedAt), formatDate(record.completedAt)]).filter(text => text !== '-').join(' → '),
          raw: record,
          tone: 'doc'
        };
      })
    });
  }

  return {
    id: `turn:${turnId}`,
    kicker: isHead ? 'Head turn' : 'Turn',
    title: turnTitle(turn),
    meta: clip(stringFrom(turn.data.userTranscript) || stringFrom(turn.data.assistantTranscript), 160),
    badges: compactStrings([
      stringFrom(turn.data.stateStatus) || 'unknown state',
      `index ${numberFrom(turn.data.turnIndex) || '?'}`,
      patches.length ? `${patches.length} patch${patches.length === 1 ? '' : 'es'}` : '',
      warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
      isHead ? 'branch head' : ''
    ]),
    details: compactStrings([
      `Turn ID: ${turnId}`,
      `Parent: ${stringFrom(turn.data.parentTurnId) || 'root'}`,
      `Committed: ${formatDate(turn.data.committedAt ?? turn.data.createdAt)}`
    ]),
    raw: turn.data,
    open: false,
    tone: 'turn',
    children: [
      ...transcriptChildren,
      docsGroupNode(`turn:${turnId}:patches`, 'Canon patches', patches, buildPatchMapNode, 'No canon patch document linked to this turn.'),
      docsGroupNode(`turn:${turnId}:warnings`, 'Warnings', warnings, buildContinuityWarningMapNode, 'No continuity warnings linked to this turn.'),
      docsGroupNode(`turn:${turnId}:snapshots`, 'Snapshots', snapshots, doc => compactDocNode('Compiled state snapshot', doc, 'state'), 'No compiled snapshot linked to this turn.')
    ]
  };
}

function buildWorldStateMapNode(stateDoc: AdminDocument): AdminMapNode {
  const branchId = stringFrom(stateDoc.data.branchId) || docEntityId(stateDoc);
  const state = recordFrom(stateDoc.data.state) ?? {};
  const scene = recordFrom(state.scene) ?? {};
  const entities = recordFrom(state.entities) ?? {};
  const entityNodes = Object.values(entities)
    .map(value => recordFrom(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .sort((a, b) => stringFrom(a.name).localeCompare(stringFrom(b.name)));
  const entityGroups = groupEntityNodes(entityNodes);
  const facts = arrayFrom(state.facts);
  const threads = arrayFrom(state.threads);
  const presentEntityIds = arrayFrom(scene.presentEntityIds).map(String);
  const contextBudget = recordFrom(state.contextBudget);

  const children: AdminMapNode[] = [
    {
      id: `state:${branchId}:scene`,
      kicker: 'Current scene',
      title: stringFrom(scene.summary) || 'Scene',
      meta: stringFrom(scene.locationId) ? `Location ${shortId(stringFrom(scene.locationId))}` : '',
      badges: compactStrings([
        presentEntityIds.length ? `${presentEntityIds.length} present` : '',
        stringFrom(scene.tone)
      ]),
      raw: scene,
      tone: 'state'
    },
    {
      id: `state:${branchId}:entities`,
      kicker: 'World state',
      title: 'Entities',
      meta: `${entityNodes.length} tracked entity${entityNodes.length === 1 ? '' : 'ies'}.`,
      badges: entityGroups.map(group => `${group.children?.length ?? 0} ${group.title}`),
      tone: 'state',
      children: entityGroups
    },
    {
      id: `state:${branchId}:threads`,
      kicker: 'World state',
      title: 'Threads',
      meta: threads.length ? `${threads.length} narrative thread${threads.length === 1 ? '' : 's'}.` : 'No active or historical threads.',
      badges: statusBadges(threads),
      tone: 'state',
      children: threads.map((item, index) => threadPatchNode(`state:${branchId}:thread:${index}`, item))
    },
    {
      id: `state:${branchId}:facts`,
      kicker: 'World state',
      title: 'Facts',
      meta: facts.length ? `${facts.length} known fact${facts.length === 1 ? '' : 's'}.` : 'No explicit facts recorded.',
      badges: certaintyBadges(facts),
      tone: 'state',
      children: facts.map((item, index) => factPatchNode(`state:${branchId}:fact:${index}`, item))
    }
  ];

  if (contextBudget) {
    children.push({
      id: `state:${branchId}:budget`,
      kicker: 'Runtime budget',
      title: 'Context budget',
      meta: compactStrings([
        `estimated ${numberFrom(contextBudget.estimatedTokens)} tokens`,
        `remaining ${numberFrom(contextBudget.remainingTurnBudget)} turns`
      ]).join(' · '),
      badges: compactStrings([
        stringFrom(contextBudget.mode) ? `mode ${stringFrom(contextBudget.mode)}` : ''
      ]),
      raw: contextBudget,
      tone: 'state'
    });
  }

  return {
    id: `state:${branchId}`,
    kicker: 'Compiled branch state',
    title: `World state for ${shortId(branchId)}`,
    meta: `Head ${shortId(stringFrom(stateDoc.data.headTurnId) || stringFrom(state.headTurnId) || 'root')} · Updated ${formatDate(stateDoc.data.updatedAt)}`,
    badges: compactStrings([
      `${entityNodes.length} entities`,
      `${threads.length} threads`,
      `${facts.length} facts`,
      stringFrom(stateDoc.data.stateHash) ? `hash ${shortId(stringFrom(stateDoc.data.stateHash))}` : ''
    ]),
    raw: stateDoc.data,
    open: false,
    tone: 'state',
    children
  };
}

function groupEntityNodes(entities: Array<Record<string, unknown>>): AdminMapNode[] {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const entity of entities) {
    const kind = stringFrom(entity.kind) || 'entity';
    groups.set(kind, [...(groups.get(kind) ?? []), entity]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, records]) => ({
    id: `entities:${kind}`,
    kicker: 'Entity kind',
    title: kind,
    meta: `${records.length} ${kind}${records.length === 1 ? '' : 's'}`,
    tone: 'state' as AdminMapTone,
    children: records.map(entity => ({
      id: `entity:${stringFrom(entity.id) || stringFrom(entity.name)}`,
      kicker: stringFrom(entity.kind) || 'Entity',
      title: stringFrom(entity.name) || shortId(stringFrom(entity.id) || 'entity'),
      meta: stringFrom(entity.status) || '',
      badges: Object.keys(recordFrom(entity.attributes) ?? {}).slice(0, 4),
      raw: entity,
      tone: 'state' as AdminMapTone
    }))
  }));
}

function buildPatchMapNode(doc: AdminDocument): AdminMapNode {
  const patch = recordFrom(doc.data.patch) ?? {};
  const events = arrayFrom(patch.events);
  const facts = arrayFrom(patch.facts);
  const threads = arrayFrom(patch.threads);
  const warnings = arrayFrom(patch.warnings);
  const turnId = stringFrom(doc.data.turnId);
  return {
    id: `patch:${docEntityId(doc)}`,
    kicker: 'Canon patch',
    title: turnId ? `Patch for ${shortId(turnId)}` : shortId(docEntityId(doc)),
    meta: `${formatDate(doc.data.appliedAt ?? doc.data.createdAt)} · ${stringFrom(doc.data.status) || 'unknown status'}`,
    badges: compactStrings([
      `${events.length} event${events.length === 1 ? '' : 's'}`,
      `${facts.length} fact${facts.length === 1 ? '' : 's'}`,
      `${threads.length} thread${threads.length === 1 ? '' : 's'}`,
      warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''
    ]),
    raw: doc.data,
    tone: warnings.length ? 'warning' : 'doc',
    children: [
      patchItemsGroup(`patch:${docEntityId(doc)}:events`, 'Events', events, eventPatchNode),
      patchItemsGroup(`patch:${docEntityId(doc)}:facts`, 'Facts', facts, factPatchNode),
      patchItemsGroup(`patch:${docEntityId(doc)}:threads`, 'Threads', threads, threadPatchNode),
      patchItemsGroup(`patch:${docEntityId(doc)}:warnings`, 'Patch warnings', warnings, patchWarningNode)
    ]
  };
}

function buildContinuityWarningMapNode(doc: AdminDocument): AdminMapNode {
  const severity = stringFrom(doc.data.severity) || 'warning';
  return {
    id: `warning:${docEntityId(doc)}`,
    kicker: `Continuity ${severity}`,
    title: stringFrom(doc.data.message) || stringFrom(doc.data.warningType) || shortId(docEntityId(doc)),
    meta: compactStrings([
      stringFrom(doc.data.warningType),
      stringFrom(doc.data.turnId) ? `turn ${shortId(stringFrom(doc.data.turnId))}` : '',
      formatDate(doc.data.createdAt)
    ]).join(' · '),
    badges: compactStrings([severity, stringFrom(doc.data.resolvedAt) ? 'resolved' : 'open']),
    details: compactStrings([stringFrom(doc.data.repairStrategy) ? `Repair: ${stringFrom(doc.data.repairStrategy)}` : '']),
    raw: doc.data,
    tone: 'warning'
  };
}

function buildBillingMapNode(
  user: AdminUserSummary,
  billingEvents: AdminDocument[],
  liveSessions: AdminDocument[],
  storyTurnUsage: AdminDocument[]
): AdminMapNode {
  const entitlement = user.entitlement;
  const children: AdminMapNode[] = [
    {
      id: `billing:${user.uid}:entitlement`,
      kicker: 'Entitlement',
      title: `${formatCredits(numberFrom(entitlement.remainingCreditMicros))} remaining`,
      meta: `${formatCredits(numberFrom(entitlement.usedCreditMicros))} used · ${formatCredits(numberFrom(entitlement.reservedCreditMicros))} reserved`,
      badges: compactStrings([
        numberFrom(entitlement.reservedCreditMicros) > 0 ? 'reservation open' : '',
        stringFrom(entitlement.activeLiveSessionId) ? 'active live session' : ''
      ]),
      raw: entitlement,
      tone: 'billing'
    },
    docsGroupNode('billing:live-sessions', 'Live session usage', liveSessions, doc => usageDocNode('Live session', doc), 'No live session usage documents returned.'),
    docsGroupNode('billing:story-turns', 'Story turn usage', storyTurnUsage, doc => usageDocNode('Story turn usage', doc), 'No story-turn usage documents returned.'),
    docsGroupNode('billing:events', 'Billing events', sortDocs(billingEvents), doc => compactDocNode('Billing event', doc, 'billing'), 'No billing events returned.')
  ];

  return {
    id: `billing:${user.uid}`,
    kicker: 'Money and usage',
    title: 'Billing',
    meta: compactStrings([
      `${formatCredits(numberFrom(entitlement.remainingCreditMicros))} remaining`,
      `${user.usage.liveSessions.count} live sessions`,
      `${user.usage.storyTurns.count} story usage turns`
    ]).join(' · '),
    badges: compactStrings([
      `${billingEvents.length} billing event${billingEvents.length === 1 ? '' : 's'}`,
      user.stripeCustomerId ? 'Stripe linked' : '',
      stringFrom(entitlement.activeLiveSessionId) ? 'live active' : ''
    ]),
    open: false,
    tone: 'billing',
    children
  };
}

function usageDocNode(kicker: string, doc: AdminDocument): AdminMapNode {
  return {
    id: `usage:${doc.path}`,
    kicker,
    title: stringFrom(doc.data.status) || shortId(docEntityId(doc)),
    meta: compactStrings([
      stringFrom(doc.data.model),
      formatDate(primaryDate(doc.data)),
      numberFrom(doc.data.billableSeconds) ? `${numberFrom(doc.data.billableSeconds)} billable sec` : ''
    ]).join(' · '),
    badges: compactStrings([
      formatCredits(numberFrom(doc.data.usedCreditMicros || doc.data.reservedCreditMicros)),
      numberFrom(doc.data.inputTokens) ? `${numberFrom(doc.data.inputTokens)} in` : '',
      numberFrom(doc.data.outputTokens) ? `${numberFrom(doc.data.outputTokens)} out` : ''
    ]),
    raw: doc.data,
    tone: 'billing'
  };
}

function docsGroupNode(
  id: string,
  title: string,
  docs: AdminDocument[],
  child: (doc: AdminDocument) => AdminMapNode,
  emptyText = 'No documents.'
): AdminMapNode {
  return {
    id,
    kicker: 'Collection',
    title,
    meta: docs.length ? `${docs.length} document${docs.length === 1 ? '' : 's'}.` : emptyText,
    badges: docs.length ? [`${docs.length}`] : [],
    tone: 'doc',
    children: docs.map(child)
  };
}

function compactDocNode(kicker: string, doc: AdminDocument, tone: AdminMapTone = 'doc'): AdminMapNode {
  return {
    id: `doc:${doc.path}`,
    kicker,
    title: compactStrings([
      stringFrom(doc.data.name),
      stringFrom(doc.data.title),
      stringFrom(doc.data.kind),
      stringFrom(doc.data.status),
      shortId(docEntityId(doc))
    ])[0] || shortId(docEntityId(doc)),
    meta: compactStrings([doc.path, formatDate(primaryDate(doc.data))]).join(' · '),
    badges: compactStrings([
      stringFrom(doc.data.status),
      stringFrom(doc.data.severity),
      stringFrom(doc.data.turnId) ? `turn ${shortId(stringFrom(doc.data.turnId))}` : ''
    ]),
    raw: doc.data,
    tone
  };
}

function patchItemsGroup(
  id: string,
  title: string,
  items: unknown[],
  child: (id: string, item: unknown) => AdminMapNode
): AdminMapNode {
  return {
    id,
    kicker: 'Patch list',
    title,
    meta: items.length ? `${items.length} item${items.length === 1 ? '' : 's'}.` : `No ${title.toLowerCase()}.`,
    badges: items.length ? [`${items.length}`] : [],
    tone: 'doc',
    children: items.map((item, index) => child(`${id}:${index}`, item))
  };
}

function eventPatchNode(id: string, item: unknown): AdminMapNode {
  const record = recordFrom(item) ?? {};
  return {
    id,
    kicker: stringFrom(record.eventType) || 'Story event',
    title: stringFrom(record.summary) || 'Event',
    meta: compactStrings([
      stringFrom(record.locationId) ? `location ${shortId(stringFrom(record.locationId))}` : '',
      stringFrom(record.certainty)
    ]).join(' · '),
    badges: arrayFrom(record.participants).map(value => shortId(String(value))).slice(0, 6),
    raw: record,
    tone: 'doc'
  };
}

function factPatchNode(id: string, item: unknown): AdminMapNode {
  const record = recordFrom(item) ?? {};
  return {
    id,
    kicker: 'Fact',
    title: compactStrings([stringFrom(record.subjectId), stringFrom(record.predicate)]).join(' · ') || 'Fact',
    meta: clip(valueToHumanText(record.value), 160),
    badges: compactStrings([stringFrom(record.certainty)]),
    raw: record,
    tone: 'state'
  };
}

function threadPatchNode(id: string, item: unknown): AdminMapNode {
  const record = recordFrom(item) ?? {};
  return {
    id,
    kicker: 'Thread',
    title: stringFrom(record.summary) || stringFrom(record.threadId) || 'Thread',
    meta: compactStrings([
      stringFrom(record.threadId),
      numberFrom(record.priority) ? `priority ${numberFrom(record.priority)}` : ''
    ]).join(' · '),
    badges: compactStrings([stringFrom(record.status)]),
    raw: record,
    tone: 'state'
  };
}

function patchWarningNode(id: string, item: unknown): AdminMapNode {
  const record = recordFrom(item) ?? {};
  return {
    id,
    kicker: `Patch warning ${stringFrom(record.severity)}`.trim(),
    title: stringFrom(record.message) || stringFrom(record.type) || 'Warning',
    meta: stringFrom(record.repairStrategy),
    badges: compactStrings([stringFrom(record.severity), stringFrom(record.type)]),
    raw: record,
    tone: 'warning'
  };
}

function transcriptNode(id: string, title: string, transcript: string): AdminMapNode {
  return {
    id,
    kicker: 'Transcript',
    title,
    meta: transcript ? clip(transcript, 220) : 'Empty transcript.',
    raw: transcript || null,
    tone: 'doc'
  };
}

function adminMapList(nodes: AdminMapNode[]): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'admin-map-tree';
  for (const node of nodes) list.append(adminMapItem(node));
  return list;
}

function adminMapItem(node: AdminMapNode): HTMLLIElement {
  const item = document.createElement('li');
  item.className = `admin-map-item admin-map-tone-${node.tone ?? 'doc'}`;
  item.dataset.filterText = adminMapFilterText(node).toLowerCase();

  const details = document.createElement('details');
  details.className = 'admin-map-node';
  details.dataset.defaultOpen = node.open ? 'true' : 'false';
  details.open = Boolean(node.open);

  const summary = document.createElement('summary');
  summary.className = 'admin-map-card';
  const top = document.createElement('span');
  top.className = 'admin-map-card-top';
  const chevron = document.createElement('span');
  chevron.className = 'admin-map-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  const kicker = document.createElement('span');
  kicker.className = 'admin-map-kicker';
  kicker.textContent = node.kicker ?? 'Node';
  top.append(chevron, kicker);
  const title = document.createElement('strong');
  title.textContent = node.title;
  summary.append(top, title);
  if (node.meta) {
    const meta = document.createElement('span');
    meta.className = 'admin-map-meta';
    meta.textContent = node.meta;
    summary.append(meta);
  }
  if (node.badges?.length) summary.append(adminMapBadges(node.badges));
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'admin-map-body';
  if (node.details?.length) {
    const detailsList = document.createElement('ul');
    detailsList.className = 'admin-map-details';
    for (const text of node.details) {
      const detail = document.createElement('li');
      detail.textContent = text;
      detailsList.append(detail);
    }
    body.append(detailsList);
  }
  if (node.raw !== undefined) body.append(adminMapRaw(node.raw));
  if (node.children?.length) body.append(adminMapList(node.children));
  if (!body.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'admin-muted admin-map-empty';
    empty.textContent = 'No deeper connections recorded here.';
    body.append(empty);
  }
  details.append(body);
  item.append(details);
  return item;
}

function adminMapBadges(badges: string[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'admin-map-badges';
  for (const badge of badges.filter(Boolean).slice(0, 8)) {
    const item = document.createElement('span');
    item.textContent = badge;
    wrap.append(item);
  }
  return wrap;
}

function adminMapRaw(raw: unknown): HTMLElement {
  const details = document.createElement('details');
  details.className = 'admin-map-raw';
  const summary = document.createElement('summary');
  summary.textContent = 'Raw data';
  const pre = document.createElement('pre');
  pre.textContent = valueToPrettyJson(raw);
  details.append(summary, pre);
  return details;
}

function applyAdminMapFilter(map: HTMLElement, query: string): void {
  const normalized = query.trim().toLowerCase();
  const items = [...map.querySelectorAll<HTMLElement>('.admin-map-item')];
  map.classList.toggle('is-filtered', Boolean(normalized));
  if (!normalized) {
    for (const item of items) {
      item.hidden = false;
      item.classList.remove('is-search-hit');
    }
    return;
  }

  for (const item of items) {
    item.hidden = true;
    item.classList.remove('is-search-hit');
  }

  for (const item of items) {
    if (!(item.dataset.filterText ?? '').includes(normalized)) continue;
    item.classList.add('is-search-hit');
    revealAdminMapItem(item, true);
  }
}

function revealAdminMapItem(item: HTMLElement, includeDescendants: boolean): void {
  item.hidden = false;
  item.querySelector<HTMLDetailsElement>(':scope > details.admin-map-node')!.open = true;
  if (includeDescendants) {
    item.querySelectorAll<HTMLElement>(':scope .admin-map-item').forEach(child => {
      child.hidden = false;
    });
  }
  let parent = item.parentElement?.closest<HTMLElement>('.admin-map-item') ?? null;
  while (parent) {
    parent.hidden = false;
    const details = parent.querySelector<HTMLDetailsElement>(':scope > details.admin-map-node');
    if (details) details.open = true;
    parent = parent.parentElement?.closest<HTMLElement>('.admin-map-item') ?? null;
  }
}

function adminDocs(payload: AdminUserDetailResponse, key: string): AdminDocument[] {
  return payload.documents[key] ?? [];
}

function indexDocsByEntityId(docs: AdminDocument[]): Map<string, AdminDocument> {
  const map = new Map<string, AdminDocument>();
  for (const doc of docs) {
    const id = docEntityId(doc);
    if (id) map.set(id, doc);
    if (doc.id) map.set(doc.id, doc);
  }
  return map;
}

function branchTimeline(branch: AdminDocument, turnById: Map<string, AdminDocument>): AdminDocument[] {
  const timeline: AdminDocument[] = [];
  const seen = new Set<string>();
  let currentId = stringFrom(branch.data.headTurnId);
  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const turn = turnById.get(currentId);
    if (!turn) break;
    timeline.push(turn);
    currentId = stringFrom(turn.data.parentTurnId);
  }
  return timeline.reverse();
}

function docEntityId(doc: AdminDocument): string {
  return stringFrom(doc.data.id) || doc.id;
}

function turnTitle(turn: AdminDocument): string {
  const index = numberFrom(turn.data.turnIndex);
  return `${index ? `#${index} ` : ''}${shortId(docEntityId(turn))}`;
}

function sortDocs(docs: AdminDocument[]): AdminDocument[] {
  return [...docs].sort((a, b) => dateValue(primaryDate(b.data)) - dateValue(primaryDate(a.data)) || docEntityId(a).localeCompare(docEntityId(b)));
}

function sortTurnDocs(docs: AdminDocument[]): AdminDocument[] {
  return [...docs].sort((a, b) => numberFrom(a.data.turnIndex) - numberFrom(b.data.turnIndex) || dateValue(primaryDate(a.data)) - dateValue(primaryDate(b.data)));
}

function dateValue(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function statusBadges(items: unknown[]): string[] {
  return countedBadges(items, 'status');
}

function certaintyBadges(items: unknown[]): string[] {
  return countedBadges(items, 'certainty');
}

function countedBadges(items: unknown[], key: string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const record = recordFrom(item);
    const value = record ? stringFrom(record[key]) : '';
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => `${value} ${count}`);
}

function compactStrings(values: Array<string | null | undefined | false>): string[] {
  return values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean);
}

function clip(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function valueToHumanText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return valueToPrettyJson(value);
}

function valueToPrettyJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function adminMapFilterText(node: AdminMapNode): string {
  return compactStrings([
    node.id,
    node.kicker,
    node.title,
    node.meta,
    ...(node.badges ?? []),
    ...(node.details ?? []),
    node.raw === undefined ? '' : valueToPrettyJson(node.raw).slice(0, 4000)
  ]).join(' ');
}

function usagePanel(title: string, usage: AdminUsageSummary): HTMLElement {
  const section = document.createElement('section');
  section.className = 'admin-doc-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const summary = document.createElement('p');
  summary.className = 'admin-muted';
  summary.textContent = `${usage.count} total, ${formatCredits(usage.usedCreditMicros)} used, statuses: ${statusesText(usage.statuses)}`;
  section.append(heading, summary);
  if (usage.recent.length) section.append(documentTable(usage.recent));
  return section;
}

function documentSection(title: string, docs: AdminDocument[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'admin-doc-section';
  const heading = document.createElement('h3');
  heading.textContent = `${title} (${docs.length})`;
  section.append(heading);
  section.append(docs.length ? documentTable(docs) : smallText('No documents.'));
  return section;
}

function documentTable(docs: AdminDocument[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'admin-table admin-doc-table';
  table.append(adminHeaderRow(['Path', 'Time', 'Status', 'Refs', 'Raw']));
  const body = document.createElement('tbody');
  for (const doc of docs) {
    const row = document.createElement('tr');
    appendCell(row, doc.path);
    appendCell(row, formatDate(primaryDate(doc.data)));
    appendCell(row, stringFrom(doc.data.status) || stringFrom(doc.data.severity) || '-');
    appendCell(row, refsText(doc.data));
    const rawCell = document.createElement('td');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = doc.id;
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify(doc.data, null, 2);
    details.append(summary, raw);
    rawCell.append(details);
    row.append(rawCell);
    body.append(row);
  }
  table.append(body);
  return table;
}

function adminHeaderRow(labels: string[]): HTMLTableSectionElement {
  const row = document.createElement('tr');
  for (const label of labels) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    row.append(cell);
  }
  const head = document.createElement('thead');
  head.append(row);
  return head;
}

function metric(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'admin-metric';
  const name = document.createElement('span');
  name.textContent = label;
  const text = document.createElement('strong');
  text.textContent = value;
  item.append(name, text);
  return item;
}

function appendCell(row: HTMLTableRowElement, text: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.append(cell);
}

function smallText(text: string): HTMLElement {
  const node = document.createElement('small');
  node.textContent = text;
  return node;
}

function setAdminStatus(adminEls: { status: HTMLElement }, text: string): void {
  adminEls.status.textContent = text;
}

function primaryDate(data: Record<string, unknown>): unknown {
  return data.updatedAt ?? data.lastSeenAt ?? data.createdAt ?? data.settledAt ?? data.endedAt ?? data.appliedAt ?? null;
}

function refsText(data: Record<string, unknown>): string {
  const refs = [
    ['repo', data.repoId],
    ['branch', data.branchId],
    ['turn', data.turnId],
    ['uid', data.ownerUserId ?? data.uid]
  ]
    .map(([label, value]) => {
      const text = stringFrom(value);
      return text ? `${label}:${shortId(text)}` : '';
    })
    .filter(Boolean);
  return refs.length ? refs.join(' ') : '-';
}

function statusesText(statuses: Record<string, number>): string {
  const entries = Object.entries(statuses);
  return entries.length ? entries.map(([status, count]) => `${status} ${count}`).join(', ') : '-';
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFrom(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCredits(micros: number): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(4)}`;
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
  }
  return String(value);
}

function scheduleBoot(): void {
  window.clearTimeout(bootDebounce);
  bootDebounce = window.setTimeout(() => void boot(), 350);
}

async function boot(): Promise<void> {
  if (hasLocalToken(CLIENT_TOKEN.UI_BOOTING) || hasLocalToken(CLIENT_TOKEN.APP_TRANSCRIPT_STARTED)) return;
  addLocalToken(CLIENT_TOKEN.UI_BOOTING);
  state.key = els.apiKey.value.trim();
  updateProviderTokenFromKey();
  setGateStatus('Connecting...');

  try {
    state.config = await publicFetch<PublicConfig>('/v1/config', { method: 'GET' });
    if (state.config.firebaseAuthRequired && !state.firebaseUser) {
      setGateStatus(hasLocalToken(CLIENT_TOKEN.PROVIDER_BYOK_KEY) ? 'Sign in to save your story with this key.' : 'Sign in or paste a Gemini key.');
      return;
    }
    if (hasLocalToken(CLIENT_TOKEN.PROVIDER_BYOK_KEY)) {
      await providerFetch('/v1/provider/gemini/validate-key', { method: 'POST', body: {} });
    }

    await ensureRepo();
    startTranscriptOnlyMode();
    await hydrateBranchTranscript();
    try {
      await startMicrophoneBuffer();
      startRecognitionLoop();
    } catch (error) {
      addLine('system', `microphone unavailable: ${messageFrom(error)}`);
    }
  } catch (error) {
    setGateStatus(messageFrom(error));
  } finally {
    removeLocalToken(CLIENT_TOKEN.UI_BOOTING);
  }
}

async function ensureRepo(): Promise<void> {
  if (state.repoId && state.branchId) {
    try {
      const result = await publicFetch<{ branches: Array<{ id: string }> }>(`/v1/repos/${encodeURIComponent(state.repoId)}`, { method: 'GET' });
      if (result.branches.some(branch => branch.id === state.branchId)) return;
    } catch {
      // Fall through and create a fresh session.
    }
  }

  const config = state.config ?? {
    defaultStoryTitle: 'Ariadne Voice Session',
    defaultStoryStyle: 'voice-first interactive fiction',
    maxTranscriptChars: 12_000,
    liveModel: 'gemini-3.1-flash-live-preview',
    paidUsageEnabled: false,
    firebaseAuthRequired: false,
    billingCurrency: 'usd',
    defaultCheckoutAmountCents: 1000,
    minCheckoutAmountCents: 500,
    liveBillableSeconds: 30,
    audioStorageEnabled: false,
    audioMaxBytes: 0,
    audioDefaultQualityProfile: 'voice-hifi',
    audioAllowedQualityProfiles: ['voice-hifi'],
    audioQualityProfiles: {}
  };
  const result = await authorizedFetch<{ repo: { id: string }; branch: { id: string } }>('/v1/repos', {
    method: 'POST',
    body: {
      title: config.defaultStoryTitle,
      defaultStyle: config.defaultStoryStyle,
      safetyProfile: 'general'
    }
  });

  state.repoId = result.repo.id;
  state.branchId = result.branch.id;
  sessionStorage.setItem(STORAGE.repoId, state.repoId);
  sessionStorage.setItem(STORAGE.branchId, state.branchId);
}

function startTranscriptOnlyMode(): void {
  addLocalToken(CLIENT_TOKEN.APP_TRANSCRIPT_STARTED);
  removeLocalToken(CLIENT_TOKEN.UI_GATE_OPEN);
  els.gate.classList.add('is-hidden');
  els.transcript.classList.add('is-live');
}

async function hydrateBranchTranscript(): Promise<void> {
  const branchId = state.branchId;
  if (!branchId || hydratedTranscriptBranchId === branchId) return;
  els.transcript.setAttribute('aria-busy', 'true');
  try {
    const payload = await authorizedFetch<BranchTimelineResponse>(
      `/v1/branches/${encodeURIComponent(branchId)}/timeline`,
      { method: 'GET' }
    );
    if (state.branchId !== branchId) return;
    renderTimelineTranscript(payload.timeline);
    hydratedTranscriptBranchId = branchId;
  } catch (error) {
    els.transcript.replaceChildren();
    addLine('system', `transcript unavailable: ${messageFrom(error)}`);
  } finally {
    els.transcript.removeAttribute('aria-busy');
  }
}

function renderTimelineTranscript(timeline: TimelineTurn[]): void {
  stopTranscriptPlayback();
  const fragment = document.createDocumentFragment();
  for (const turn of timeline) {
    const userTranscript = turn.userTranscript?.trim();
    const assistantTranscript = turn.assistantTranscript?.trim();
    if (userTranscript) {
      fragment.append(createLine('user', userTranscript, {
        scroll: false,
        audioAssetId: turn.userAudioAssetId ?? null,
        turnId: turn.id,
        turnIndex: turn.turnIndex
      }));
    }
    if (assistantTranscript) {
      fragment.append(createLine('model', assistantTranscript, {
        scroll: false,
        audioAssetId: turn.assistantAudioAssetId ?? null,
        turnId: turn.id,
        turnIndex: turn.turnIndex
      }));
    }
  }
  els.transcript.replaceChildren(fragment);
  window.requestAnimationFrame(() => {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  });
}

async function startMicrophoneBuffer(): Promise<void> {
  if (audioContext && processor && mediaStream) return;
  addLocalToken(CLIENT_TOKEN.MEDIA_MICROPHONE_BUFFER);
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioContext = new AudioContext();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const now = Date.now();
      const durationMs = Math.round((input.length / event.inputBuffer.sampleRate) * 1000);
      const chunk: PcmChunk = {
        data: float32ToBase64Pcm16(input),
        mimeType: `audio/pcm;rate=${event.inputBuffer.sampleRate}`,
        startMs: now - durationMs,
        endMs: now
      };
      pcmChunks.push(chunk);
      prunePcmChunks(now);
      sendLiveChunksThrough(now);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  } catch (error) {
    removeLocalToken(CLIENT_TOKEN.MEDIA_MICROPHONE_BUFFER);
    throw error;
  }
}

function startRecognitionLoop(): void {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) {
    addLine('system', 'speech recognition unavailable');
    return;
  }

  recognition = new Ctor();
  recognition.lang = state.config?.webSpeechLanguage || navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = onSpeechResult;
  recognition.onerror = event => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    const label = event.error ? `speech recognition: ${event.error}` : 'speech recognition interrupted';
    addLine('system', event.message ? `${label} ${event.message}` : label);
  };
  recognition.onend = () => {
    removeLocalToken(CLIENT_TOKEN.STT_LISTENING);
    if (hasLocalToken(CLIENT_TOKEN.APP_TRANSCRIPT_STARTED) && !hasLocalToken(CLIENT_TOKEN.STT_PAUSED_FOR_LIVE_TURN)) {
      restartRecognitionSoon();
    }
  };
  restartRecognitionSoon();
}

function onSpeechResult(event: SpeechRecognitionEventLike): void {
  if (activeTurn && turnHasToken(activeTurn, CLIENT_TOKEN.LIVE_INPUT_CLOSED)) return;
  let heardText = '';
  let finalText = '';

  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = result?.[0]?.transcript?.trim() ?? '';
    if (!transcript) continue;
    heardText = `${heardText} ${transcript}`.trim();
    if (result.isFinal) finalText = `${finalText} ${transcript}`.trim();
  }

  if (!heardText) return;
  const triggerText = finalText || heardText;
  if (!shouldStartLiveTurn(triggerText, Boolean(finalText))) return;

  void ensureLiveTurnStarted().then(() => {
    if (activeTurn && !turnHasToken(activeTurn, CLIENT_TOKEN.LIVE_INPUT_CLOSED)) scheduleTurnTail();
  });
}

async function ensureLiveTurnStarted(): Promise<void> {
  if (activeTurn || !state.repoId || !state.branchId) return;
  if (liveStarting) return liveStarting;
  liveStarting = startLiveTurn();
  try {
    await liveStarting;
  } finally {
    liveStarting = null;
  }
}

async function startLiveTurn(): Promise<void> {
  const startedAtMs = Date.now();
  const preRollFromMs = startedAtMs - PRE_ROLL_MS;
  addLocalToken(CLIENT_TOKEN.LIVE_TURN_STARTING);
  try {
    const token = await authorizedFetch<LiveTokenResponse>('/v1/provider/gemini/live-token', {
      method: 'POST',
      body: {
        repoId: state.repoId,
        branchId: state.branchId,
        responseModalities: ['AUDIO']
      },
      providerKey: providerKeyForRequests()
    });

    const ai = new GoogleGenAI({ apiKey: token.token, apiVersion: 'v1alpha' });
    const turn: LiveTurn = {
      session: await ai.live.connect({
        model: token.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
            activityHandling: ActivityHandling.NO_INTERRUPTION,
            turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT
          }
        },
        callbacks: {
          onmessage: message => onLiveMessage(message),
          onerror: event => addLine('system', messageFrom(event.error ?? event)),
          onclose: () => {
            closeLiveSession(turn);
          }
        }
      }),
      sessionId: token.sessionId ?? null,
      startedAtMs,
      sentThroughMs: preRollFromMs,
      tokens: new Set<ClientToken>([CLIENT_TOKEN.LIVE_INPUT_OPEN, CLIENT_TOKEN.LIVE_SESSION_OPEN]),
      tailTimer: null,
      closeTimer: null,
      emptyTurnTimer: null,
      expectedHeadTurnId: token.branchHeadTurnId,
      userTranscript: '',
      assistantTranscript: '',
      userAudioChunks: [],
      assistantAudioChunks: [],
      userLine: null,
      assistantLine: null
    };

    activeTurn = turn;
    removeLocalToken(CLIENT_TOKEN.LIVE_TURN_STARTING);
    addLocalToken(CLIENT_TOKEN.LIVE_TURN_ACTIVE);
    mirrorTurnTokens(turn);
    turn.session.sendRealtimeInput({ activityStart: {} });
    sendLiveChunksThrough(Date.now());
  } catch (error) {
    addLine('system', messageFrom(error));
    activeTurn = null;
    removeLocalToken(CLIENT_TOKEN.LIVE_TURN_STARTING);
    removeLocalToken(CLIENT_TOKEN.LIVE_TURN_ACTIVE);
  }
}

function scheduleTurnTail(): void {
  const turn = activeTurn;
  if (!turn) return;
  if (turn.tailTimer) window.clearTimeout(turn.tailTimer);
  turn.tailTimer = window.setTimeout(() => {
    if (activeTurn !== turn) return;
    turn.closeTimer = window.setTimeout(() => {
      if (activeTurn !== turn) return;
      sendLiveChunksThrough(Date.now());
      closeLiveInput(turn);
      pauseRecognitionForLiveTurn();
      turn.session.sendRealtimeInput({ activityEnd: {} });
      turn.session.sendRealtimeInput({ audioStreamEnd: true });
      turn.emptyTurnTimer = window.setTimeout(() => {
        if (activeTurn === turn && (!turn.userTranscript.trim() || !turn.assistantTranscript.trim())) {
          void finalizeLiveTurn(turn);
        }
      }, EMPTY_LIVE_TURN_TIMEOUT_MS);
    }, POST_ROLL_MS);
  }, SPEECH_IDLE_MS);
}

function sendLiveChunksThrough(endMs: number): void {
  if (
    !activeTurn ||
    turnHasToken(activeTurn, CLIENT_TOKEN.LIVE_SESSION_CLOSED) ||
    turnHasToken(activeTurn, CLIENT_TOKEN.LIVE_INPUT_CLOSED)
  ) {
    return;
  }
  const chunks = pcmChunks.filter(chunk => chunk.endMs > activeTurn!.sentThroughMs && chunk.startMs <= endMs);
  for (const chunk of chunks) {
    activeTurn.session.sendRealtimeInput({ audio: { data: chunk.data, mimeType: chunk.mimeType } });
    activeTurn.userAudioChunks.push({ ...chunk });
    activeTurn.sentThroughMs = Math.max(activeTurn.sentThroughMs, chunk.endMs);
  }
}

function onLiveMessage(message: LiveServerMessage): void {
  const turn = activeTurn;
  if (!turn) return;

  const serverContent = message.serverContent;
  const inputText = serverContent?.inputTranscription?.text?.trim();
  const outputText = serverContent?.outputTranscription?.text?.trim();

  if (inputText) {
    turn.userTranscript = appendTranscript(turn.userTranscript, inputText);
    turn.userLine = updateOrCreateLine(turn.userLine, 'user', turn.userTranscript, !serverContent?.inputTranscription?.finished);
  }
  if (outputText) {
    turn.assistantTranscript = appendTranscript(turn.assistantTranscript, outputText);
    turn.assistantLine = updateOrCreateLine(turn.assistantLine, 'model', turn.assistantTranscript, !serverContent?.outputTranscription?.finished);
  }

  for (const part of serverContent?.modelTurn?.parts ?? []) {
    const inlineData = part.inlineData;
    if (inlineData?.data && inlineData.mimeType?.startsWith('audio/')) {
      turn.assistantAudioChunks.push({ data: inlineData.data, mimeType: inlineData.mimeType });
      void playAudioChunk(inlineData.data, inlineData.mimeType);
    }
  }

  if (serverContent?.turnComplete) {
    void finalizeLiveTurn(turn);
  }
}

async function finalizeLiveTurn(turn: LiveTurn): Promise<void> {
  if (activeTurn !== turn) return;
  activeTurn = null;
  closeLiveInput(turn);
  removeLocalToken(CLIENT_TOKEN.LIVE_TURN_ACTIVE);
  addLocalToken(CLIENT_TOKEN.LIVE_TURN_COMMITTING);
  if (turn.tailTimer) window.clearTimeout(turn.tailTimer);
  if (turn.closeTimer) window.clearTimeout(turn.closeTimer);
  if (turn.emptyTurnTimer) window.clearTimeout(turn.emptyTurnTimer);

  try {
    turn.session.close();
    closeLiveSession(turn);
  } catch {
    // Session close can race with provider callbacks.
    closeLiveSession(turn);
  }

  const userTranscript = turn.userTranscript.trim();
  const assistantTranscript = turn.assistantTranscript.trim();
  if (turn.sessionId) {
    await authorizedFetch('/v1/provider/gemini/live-session/end', {
      method: 'POST',
      body: { sessionId: turn.sessionId }
    }).catch(() => {});
  }
  try {
    if (!state.repoId || !state.branchId || !userTranscript || !assistantTranscript) return;
    const audioAssetIds = await uploadLiveTurnAudioAssets(turn).catch(error => {
      addLine('system', `audio archive skipped: ${messageFrom(error)}`);
      return {} as { userAudioAssetId?: string; assistantAudioAssetId?: string };
    });

    const result = await authorizedFetch<LiveTurnCommitResponse>('/v1/story/live-turn', {
      method: 'POST',
      providerKey: providerKeyForRequests(),
      body: {
        repoId: state.repoId,
        branchId: state.branchId,
        liveSessionId: turn.sessionId ?? undefined,
        expectedHeadTurnId: turn.expectedHeadTurnId,
        userTranscript,
        assistantTranscript,
        userAudioAssetId: audioAssetIds.userAudioAssetId,
        assistantAudioAssetId: audioAssetIds.assistantAudioAssetId
      }
    });
    if (result.turn?.id) {
      setLineAudioAsset(turn.userLine, result.turn.userAudioAssetId ?? audioAssetIds.userAudioAssetId);
      setLineAudioAsset(turn.assistantLine, result.turn.assistantAudioAssetId ?? audioAssetIds.assistantAudioAssetId);
      sessionStorage.setItem(STORAGE.branchId, state.branchId);
    }
  } catch (error) {
    addLine('system', messageFrom(error));
  } finally {
    removeLocalToken(CLIENT_TOKEN.LIVE_TURN_COMMITTING);
    clearTurnTokens(turn);
    resumeRecognitionAfterLiveTurn();
  }
}

async function uploadLiveTurnAudioAssets(turn: LiveTurn): Promise<{ userAudioAssetId?: string; assistantAudioAssetId?: string }> {
  if (!state.config?.audioStorageEnabled || !state.repoId || !state.branchId) return {};

  const result: { userAudioAssetId?: string; assistantAudioAssetId?: string } = {};
  const userAssetId = await uploadCapturedAudio('user', turn.userAudioChunks);
  if (userAssetId) result.userAudioAssetId = userAssetId;
  const assistantAssetId = await uploadCapturedAudio('assistant', turn.assistantAudioChunks);
  if (assistantAssetId) result.assistantAudioAssetId = assistantAssetId;
  return result;
}

async function uploadCapturedAudio(role: 'user' | 'assistant', chunks: CapturedAudioChunk[]): Promise<string | undefined> {
  if (!state.repoId || !state.branchId || !chunks.length) return undefined;
  const archive = await audioChunksToArchive(chunks);
  if (!archive || archive.blob.size <= 0) return undefined;
  const maxBytes = state.config?.audioMaxBytes ?? 0;
  if (maxBytes > 0 && archive.blob.size > maxBytes) {
    throw new Error(`${role} audio is too large to archive.`);
  }

  const checksums = await audioChecksums(archive.blob);
  const audioUpload = await authorizedFetch<AudioUploadResponse>('/v1/audio-assets/upload-url', {
    method: 'POST',
    body: {
      repoId: state.repoId,
      branchId: state.branchId,
      role,
      contentType: archive.contentType,
      sha256: checksums.sha256,
      crc32c: checksums.crc32c,
      codec: archive.codec,
      container: archive.container,
      sampleRate: archive.sampleRate,
      durationMs: archive.durationMs,
      byteLength: archive.blob.size,
      qualityProfile: archive.qualityProfile,
      bitrateKbps: archive.bitrateKbps,
      channelCount: archive.channelCount
    }
  });

  const upload = audioUpload.audioUpload;
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: archive.blob
  });
  if (!response.ok) {
    throw new Error(`GCS audio upload failed with ${response.status}.`);
  }

  const registered = await authorizedFetch<AudioAssetResponse>('/v1/audio-assets', {
    method: 'POST',
    body: {
      repoId: state.repoId,
      uploadId: upload.uploadId
    }
  });
  return registered.audioAsset.id;
}

async function audioChunksToArchive(chunks: CapturedAudioChunk[]): Promise<AudioArchiveBlob | null> {
  if (!chunks.length) return null;
  const pcmSampleRate = parsePcmSampleRate(chunks[0].mimeType);
  const allPcm = pcmSampleRate !== null && chunks.every(chunk => parsePcmSampleRate(chunk.mimeType) === pcmSampleRate);
  if (!allPcm) return null;

  const pcmBytes = concatUint8Arrays(chunks.map(chunk => base64ToUint8Array(chunk.data)));
  const durationMs = Math.round((pcmBytes.byteLength / 2 / pcmSampleRate) * 1000);
  return compressedArchiveFromPcm16(pcmBytes, pcmSampleRate, durationMs);
}

type BrowserAudioArchiveEncoding = {
  mimeType: string;
  contentType: string;
  codec: string;
  container: string;
  qualityProfile: string;
  bitrateKbps: number;
  channelCount: number;
};

async function compressedArchiveFromPcm16(pcmBytes: Uint8Array, sampleRate: number, durationMs: number): Promise<AudioArchiveBlob | null> {
  const encoding = preferredAudioArchiveEncoding();
  if (!encoding) return null;
  try {
    const blob = await encodePcm16WithMediaRecorder(pcmBytes, sampleRate, encoding.mimeType, encoding.bitrateKbps, durationMs);
    if (blob.size <= 0) return null;
    return {
      blob,
      contentType: blob.type || encoding.contentType,
      codec: encoding.codec,
      container: encoding.container,
      qualityProfile: encoding.qualityProfile,
      bitrateKbps: encoding.bitrateKbps,
      channelCount: encoding.channelCount,
      sampleRate,
      durationMs
    };
  } catch {
    return null;
  }
}

function preferredAudioArchiveEncoding(): BrowserAudioArchiveEncoding | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const allowedProfiles = new Set(state.config?.audioAllowedQualityProfiles ?? ['voice-hifi']);
  for (const candidate of AUDIO_ARCHIVE_ENCODINGS) {
    if (!MediaRecorder.isTypeSupported(candidate.mimeType)) continue;
    const qualityProfile = resolveEncodingProfile(candidate.codec, candidate.qualityProfile, allowedProfiles);
    if (!qualityProfile) continue;
    const policy = state.config?.audioQualityProfiles?.[qualityProfile];
    return {
      mimeType: candidate.mimeType,
      contentType: candidate.contentType,
      codec: candidate.codec,
      container: candidate.container,
      qualityProfile,
      bitrateKbps: policy?.targetBitrateKbps ?? (candidate.codec === 'aac' ? 128 : 96),
      channelCount: Math.min(1, policy?.maxChannelCount ?? 1)
    };
  }
  return null;
}

function resolveEncodingProfile(codec: string, fallbackProfile: string, allowedProfiles: Set<string>): string | null {
  const defaultProfile = state.config?.audioDefaultQualityProfile;
  const profiles = state.config?.audioQualityProfiles ?? {};
  if (defaultProfile && allowedProfiles.has(defaultProfile) && profiles[defaultProfile]?.codec === codec) return defaultProfile;
  if (allowedProfiles.has(fallbackProfile) && (!profiles[fallbackProfile] || profiles[fallbackProfile].codec === codec)) return fallbackProfile;
  for (const profile of allowedProfiles) {
    if (profiles[profile]?.codec === codec) return profile;
  }
  return null;
}

function parsePcmSampleRate(mimeType: string): number | null {
  if (!mimeType.includes('audio/pcm')) return null;
  const sampleRate = Number(mimeType.match(/rate=(\d+)/)?.[1] || 0);
  return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null;
}

async function encodePcm16WithMediaRecorder(
  pcmBytes: Uint8Array,
  sampleRate: number,
  mimeType: string,
  bitrateKbps: number,
  durationMs: number
): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable');
  const context = new AudioContext({ sampleRate });
  await context.resume();
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  const buffer = context.createBuffer(1, sampleCount, sampleRate);
  copyPcm16ToAudioChannel(pcmBytes, buffer.getChannelData(0));
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(destination);

  try {
    return await new Promise<Blob>((resolve, reject) => {
      const encodedChunks: Blob[] = [];
      const recorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: bitrateKbps * 1000
      });
      let settled = false;
      const timeoutMs = Math.max(durationMs + 5_000, 10_000);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        source.disconnect();
        destination.stream.getTracks().forEach(track => track.stop());
        callback();
      };
      const timeout = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
        finish(() => reject(new Error('audio archive encoder timed out')));
      }, timeoutMs);

      recorder.ondataavailable = event => {
        if (event.data.size > 0) encodedChunks.push(event.data);
      };
      recorder.onerror = event => {
        const error = (event as ErrorEvent & { error?: DOMException }).error;
        finish(() => reject(new Error(error?.message || 'audio archive encoder failed')));
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType;
        finish(() => resolve(new Blob(encodedChunks, { type })));
      };
      source.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };

      recorder.start();
      source.start();
    });
  } finally {
    await context.close().catch(() => {});
  }
}

function copyPcm16ToAudioChannel(pcmBytes: Uint8Array, channel: Float32Array): void {
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = view.getInt16(i * 2, true) / 32768;
  }
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function audioChecksums(blob: Blob): Promise<{ sha256: string; crc32c: string }> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
  return {
    sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    crc32c: crc32cBase64(bytes)
  };
}

const CRC32C_TABLE = buildCrc32cTable();

function buildCrc32cTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0x82f63b78 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function crc32cBase64(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32C_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = new Uint8Array([
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff
  ]);
  return btoa(String.fromCharCode(...out));
}

async function buyCredits(): Promise<void> {
  try {
    const config = state.config ?? await publicFetch<PublicConfig>('/v1/config', { method: 'GET' });
    const result = await authorizedFetch<{ url: string }>('/v1/billing/checkout-session', {
      method: 'POST',
      body: { amountCents: config.defaultCheckoutAmountCents }
    });
    if (result.url) window.location.href = result.url;
  } catch (error) {
    setGateStatus(messageFrom(error));
  }
}

async function playAudioChunk(base64: string, mimeType: string): Promise<void> {
  const context = audioContext ?? new AudioContext();
  audioContext = context;
  if (context.state === 'suspended') await context.resume();

  if (mimeType.includes('audio/pcm')) {
    const sampleRate = Number(mimeType.match(/rate=(\d+)/)?.[1]) || 24_000;
    const bytes = base64ToUint8Array(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Math.floor(bytes.byteLength / 2);
    const audioBuffer = context.createBuffer(1, samples, sampleRate);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    queueAudioBuffer(context, audioBuffer);
    return;
  }

  const bytes = base64ToUint8Array(base64);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType });
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context.decodeAudioData(arrayBuffer);
  queueAudioBuffer(context, decoded);
}

function queueAudioBuffer(context: AudioContext, buffer: AudioBuffer): void {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const startAt = Math.max(context.currentTime, audioPlayhead);
  source.start(startAt);
  audioPlayhead = startAt + buffer.duration;
}

async function publicFetch<T>(path: string, options: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  return authorizedFetch<T>(path, options);
}

async function providerFetch<T>(path: string, options: { method: 'POST'; body?: unknown }): Promise<T> {
  return authorizedFetch<T>(path, { ...options, providerKey: state.key });
}

async function authorizedFetch<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown; providerKey?: string }
): Promise<T> {
  const headers: Record<string, string> = {
    ...getApiRequestHeaders(options.body === undefined ? {} : { 'content-type': 'application/json' })
  };
  if (options.providerKey) {
    headers['x-ariadne-provider-key'] = options.providerKey;
  } else {
    const token = await getFirebaseIdToken().catch(() => '');
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({})) as { tokens?: TokenSnapshot; message?: unknown; error?: unknown };
  ingestBackendTokens(payload.tokens, response.headers.get('x-ariadne-active-tokens'));
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `Request failed with ${response.status}`));
  return payload as T;
}

function restartRecognitionSoon(): void {
  window.setTimeout(() => {
    if (
      !recognition ||
      hasLocalToken(CLIENT_TOKEN.STT_LISTENING) ||
      hasLocalToken(CLIENT_TOKEN.STT_PAUSED_FOR_LIVE_TURN) ||
      (activeTurn ? turnHasToken(activeTurn, CLIENT_TOKEN.LIVE_INPUT_CLOSED) : false)
    ) {
      return;
    }
    try {
      recognition.start();
      addLocalToken(CLIENT_TOKEN.STT_LISTENING);
    } catch {
      // start() throws if the browser still considers the previous recognition session active.
    }
  }, 180);
}

function pauseRecognitionForLiveTurn(): void {
  addLocalToken(CLIENT_TOKEN.STT_PAUSED_FOR_LIVE_TURN);
  if (!recognition) return;
  try {
    recognition.abort();
  } catch {
    // Some browsers throw if recognition has already stopped.
  }
  removeLocalToken(CLIENT_TOKEN.STT_LISTENING);
}

function resumeRecognitionAfterLiveTurn(): void {
  removeLocalToken(CLIENT_TOKEN.STT_PAUSED_FOR_LIVE_TURN);
  if (hasLocalToken(CLIENT_TOKEN.APP_TRANSCRIPT_STARTED)) restartRecognitionSoon();
}

function prunePcmChunks(now: number): void {
  const cutoff = now - PCM_BUFFER_MS;
  while (pcmChunks.length && pcmChunks[0].endMs < cutoff) pcmChunks.shift();
}

function appendTranscript(existing: string, delta: string): string {
  const clean = delta.trim();
  if (!clean) return existing;
  if (!existing) return clean;
  if (existing.endsWith(clean)) return existing;
  return `${existing} ${clean}`.replace(/\s+/g, ' ').trim();
}

function shouldStartLiveTurn(text: string, isFinal: boolean): boolean {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z0-9]/.test(clean)) return false;
  if (isFinal) return clean.length >= 2;
  return clean.length >= 12 && clean.split(' ').length >= 2;
}

function updateOrCreateLine(existing: HTMLElement | null, role: TranscriptRole, text: string, interim: boolean): HTMLElement {
  const line = existing ?? addLine(role, text);
  line.classList.toggle('interim', interim);
  setLineText(line, text);
  return line;
}

function addLine(role: TranscriptRole, text: string, options: TranscriptLineOptions = {}): HTMLElement {
  const line = createLine(role, text, options);
  els.transcript.append(line);
  if (options.scroll !== false) line.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return line;
}

function createLine(role: TranscriptRole, text: string, options: TranscriptLineOptions = {}): HTMLElement {
  const line = document.createElement('article');
  line.className = `line ${role}`;
  line.innerHTML = '<span class="role"></span><span class="text"></span>';
  line.querySelector<HTMLElement>('.role')!.textContent = role === 'model' ? 'model' : role;
  if (options.turnId) line.dataset.turnId = options.turnId;
  if (options.turnIndex !== undefined) line.dataset.turnIndex = String(options.turnIndex);
  setLineText(line, text, { scroll: false });
  setLineAudioAsset(line, options.audioAssetId);
  return line;
}

function setLineAudioAsset(line: HTMLElement | null, assetId: string | null | undefined): void {
  if (!line || !assetId) return;
  line.dataset.audioAssetId = assetId;
  line.classList.add('playable');
  line.tabIndex = 0;
  line.setAttribute('role', 'button');
  line.setAttribute('aria-label', `${line.classList.contains('model') ? 'model' : 'user'} transcript audio`);
  if (line.dataset.audioPlaybackBound === 'true') return;
  line.dataset.audioPlaybackBound = 'true';
  line.addEventListener('click', event => {
    if (window.getSelection()?.toString()) return;
    void playTranscriptLineAudio(event.currentTarget as HTMLElement);
  });
  line.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void playTranscriptLineAudio(event.currentTarget as HTMLElement);
  });
}

async function playTranscriptLineAudio(line: HTMLElement): Promise<void> {
  const assetId = line.dataset.audioAssetId;
  const repoId = state.repoId;
  if (!assetId || !repoId) return;
  if (line.classList.contains('is-loading-audio')) return;
  if (transcriptPlaybackLine === line && transcriptPlaybackAudio && !transcriptPlaybackAudio.paused) {
    stopTranscriptPlayback();
    return;
  }

  const requestId = ++transcriptPlaybackRequestId;
  line.classList.add('is-loading-audio');
  try {
    const playback = await authorizedFetch<AudioPlaybackResponse>(
      `/v1/repos/${encodeURIComponent(repoId)}/audio-assets/${encodeURIComponent(assetId)}/playback-url`,
      { method: 'GET' }
    );
    if (requestId !== transcriptPlaybackRequestId) return;
    await playTranscriptPlaybackUrl(line, playback.audioPlayback.playbackUrl);
  } catch (error) {
    if (requestId === transcriptPlaybackRequestId) addLine('system', `audio playback unavailable: ${messageFrom(error)}`);
  } finally {
    line.classList.remove('is-loading-audio');
  }
}

async function playTranscriptPlaybackUrl(line: HTMLElement, url: string): Promise<void> {
  stopTranscriptPlayback();
  const audio = new Audio(url);
  transcriptPlaybackAudio = audio;
  transcriptPlaybackLine = line;
  line.classList.add('is-playing-audio');

  const cleanup = () => {
    if (transcriptPlaybackAudio !== audio) return;
    line.classList.remove('is-playing-audio');
    transcriptPlaybackAudio = null;
    transcriptPlaybackLine = null;
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', () => {
    cleanup();
    addLine('system', 'audio playback unavailable');
  }, { once: true });

  try {
    await audio.play();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function stopTranscriptPlayback(): void {
  const audio = transcriptPlaybackAudio;
  transcriptPlaybackLine?.classList.remove('is-playing-audio');
  transcriptPlaybackAudio = null;
  transcriptPlaybackLine = null;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function setLineText(line: HTMLElement, text: string, options: { scroll?: boolean } = {}): void {
  line.querySelector<HTMLElement>('.text')!.textContent = text;
  if (options.scroll !== false) line.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateGateActions(): void {
  const configured = isFirebaseConfigured();
  els.signIn.hidden = !configured || Boolean(state.firebaseUser);
  els.signOut.hidden = !configured || !state.firebaseUser;
  els.buyCredits.hidden = !configured || !state.firebaseUser;
}

function setGateStatus(text: string): void {
  els.status.textContent = text;
}

function hasLocalToken(token: ClientToken): boolean {
  return localActivityTokens.has(token);
}

function updateProviderTokenFromKey(): void {
  if (state.key.trim()) {
    addLocalToken(CLIENT_TOKEN.PROVIDER_BYOK_KEY);
  } else {
    removeLocalToken(CLIENT_TOKEN.PROVIDER_BYOK_KEY);
  }
}

function providerKeyForRequests(): string | undefined {
  return hasLocalToken(CLIENT_TOKEN.PROVIDER_BYOK_KEY) ? state.key : undefined;
}

function turnHasToken(turn: LiveTurn, token: ClientToken): boolean {
  return turn.tokens.has(token);
}

function addTurnToken(turn: LiveTurn, token: ClientToken): void {
  if (turn.tokens.has(token)) return;
  turn.tokens.add(token);
  addLocalToken(token);
}

function removeTurnToken(turn: LiveTurn, token: ClientToken): void {
  if (!turn.tokens.delete(token)) return;
  removeLocalToken(token);
}

function mirrorTurnTokens(turn: LiveTurn): void {
  for (const token of turn.tokens) addLocalToken(token);
}

function closeLiveInput(turn: LiveTurn): void {
  if (!turnHasToken(turn, CLIENT_TOKEN.LIVE_INPUT_OPEN) && !turnHasToken(turn, CLIENT_TOKEN.LIVE_INPUT_CLOSED)) return;
  removeTurnToken(turn, CLIENT_TOKEN.LIVE_INPUT_OPEN);
  addTurnToken(turn, CLIENT_TOKEN.LIVE_INPUT_CLOSED);
}

function closeLiveSession(turn: LiveTurn): void {
  if (!turnHasToken(turn, CLIENT_TOKEN.LIVE_SESSION_OPEN) && !turnHasToken(turn, CLIENT_TOKEN.LIVE_SESSION_CLOSED)) return;
  removeTurnToken(turn, CLIENT_TOKEN.LIVE_SESSION_OPEN);
  addTurnToken(turn, CLIENT_TOKEN.LIVE_SESSION_CLOSED);
}

function clearTurnTokens(turn: LiveTurn): void {
  for (const token of [...turn.tokens]) removeTurnToken(turn, token);
}

function mountTokenFlag(): void {
  if (tokenFlagEls.root) return;

  const root = document.createElement('button');
  root.id = 'token-flag';
  root.className = 'token-flag';
  root.type = 'button';
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-expanded', 'false');
  root.innerHTML = '<span class="token-flag-dot"></span><span id="token-flag-label"></span><span id="token-flag-count"></span>';

  const panel = document.createElement('div');
  panel.id = 'token-panel';
  panel.className = 'token-panel';
  panel.hidden = true;

  root.addEventListener('click', () => {
    tokenFlagOpen = !tokenFlagOpen;
    renderTokenFlag();
  });

  document.body.append(root, panel);
  tokenFlagEls.root = root;
  tokenFlagEls.label = root.querySelector<HTMLElement>('#token-flag-label') ?? undefined;
  tokenFlagEls.count = root.querySelector<HTMLElement>('#token-flag-count') ?? undefined;
  tokenFlagEls.panel = panel;
  renderTokenFlag();
}

function addLocalToken(token: ClientToken): void {
  if (localActivityTokens.has(token)) return;
  localActivityTokens.add(token);
  renderTokenFlag();
}

function removeLocalToken(token: ClientToken): void {
  if (!localActivityTokens.delete(token)) return;
  renderTokenFlag();
}

function ingestBackendTokens(snapshot: TokenSnapshot | undefined, headerTokens: string | null): void {
  if (snapshot?.activeTokens?.length || snapshot?.display?.length || snapshot?.blockerTokens?.length) {
    latestBackendTokens = snapshot;
    renderTokenFlag();
    return;
  }
  const activeTokens = (headerTokens ?? '')
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);
  if (activeTokens.length) {
    latestBackendTokens = { activeTokens, display: activeTokens.map(token => fallbackTokenDisplay(token, 'backend')) };
    renderTokenFlag();
  }
}

function renderTokenFlag(): void {
  if (!tokenFlagEls.root || !tokenFlagEls.label || !tokenFlagEls.count || !tokenFlagEls.panel) return;

  const displays = currentTokenDisplays();
  const primary = displays[0];
  const tone = primary?.tone ?? 'state';
  tokenFlagEls.root.dataset.tone = tone;
  tokenFlagEls.root.setAttribute('aria-expanded', String(tokenFlagOpen));
  tokenFlagEls.label.textContent = primary?.label ?? 'Idle';
  tokenFlagEls.count.textContent = displays.length > 1 ? `+${displays.length - 1}` : '';
  tokenFlagEls.root.title = primary ? `${primary.token} - ${primary.description}` : 'No active tokens';

  tokenFlagEls.panel.hidden = !tokenFlagOpen;
  if (!tokenFlagOpen) return;

  const list = document.createElement('div');
  list.className = 'token-panel-list';
  const action = latestBackendTokens?.action ? tokenSmall(`Backend: ${latestBackendTokens.action}`) : null;
  for (const display of displays) {
    const row = document.createElement('div');
    row.className = 'token-panel-row';
    row.dataset.tone = display.tone;

    const label = document.createElement('strong');
    label.textContent = display.label;
    const code = document.createElement('code');
    code.textContent = display.token;
    const description = tokenSmall(display.description);
    const source = tokenSmall(display.source === 'client' ? 'Client token' : 'Backend token');
    row.append(label, code, description, source);
    list.append(row);
  }

  if (!displays.length) {
    list.append(tokenSmall('Idle'));
  }

  tokenFlagEls.panel.replaceChildren(...(action ? [action, list] : [list]));
}

function currentTokenDisplays(): TokenDisplay[] {
  const byToken = new Map<string, TokenDisplay>();
  for (const token of localActivityTokens) {
    const display = clientTokenDisplay(token);
    byToken.set(display.token, display);
  }
  for (const display of latestBackendTokens?.display ?? []) {
    byToken.set(display.token, { ...display, source: 'backend' });
  }
  for (const token of latestBackendTokens?.activeTokens ?? []) {
    if (!byToken.has(token)) byToken.set(token, fallbackTokenDisplay(token, 'backend'));
  }
  return sortTokenDisplays([...byToken.values()]);
}

function tokenSmall(text: string): HTMLElement {
  const small = document.createElement('small');
  small.textContent = text;
  return small;
}

function getApiRequestHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const clientId = getClientId();
  return clientId ? { ...headers, 'x-client-id': clientId } : headers;
}

function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE.clientId);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(STORAGE.clientId, next);
    return next;
  } catch {
    return '';
  }
}

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const global = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return global.SpeechRecognition ?? global.webkitSpeechRecognition ?? null;
}

function float32ToBase64Pcm16(input: Float32Array): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return uint8ArrayToBase64(bytes);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return 'Unexpected error.';
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
