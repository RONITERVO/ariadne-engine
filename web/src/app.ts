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

type RepoState = {
  repoId: string | null;
  branchId: string | null;
  apiBase: string;
  key: string;
  config: PublicConfig | null;
  firebaseUser: FirebaseUser | null;
  started: boolean;
  booting: boolean;
  recognitionActive: boolean;
  usingByok: boolean;
};

type LiveTokenResponse = {
  token: string;
  model: string;
  branchHeadTurnId: string | null;
  sessionId?: string | null;
  expiresAt?: string;
  billingMode?: 'byok' | 'paid';
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

type LiveTurn = {
  session: Session;
  sessionId: string | null;
  startedAtMs: number;
  sentThroughMs: number;
  tailTimer: number | null;
  closeTimer: number | null;
  emptyTurnTimer: number | null;
  expectedHeadTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  userLine: HTMLElement | null;
  assistantLine: HTMLElement | null;
  closed: boolean;
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

const state: RepoState = {
  repoId: sessionStorage.getItem(STORAGE.repoId),
  branchId: sessionStorage.getItem(STORAGE.branchId),
  apiBase: resolveApiBase(),
  key: sessionStorage.getItem(STORAGE.key) ?? '',
  config: null,
  firebaseUser: null,
  started: false,
  booting: false,
  recognitionActive: false,
  usingByok: false
};
const ADMIN_PATH = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

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

if (ADMIN_PATH) {
  startAdminDashboard();
} else {
  startTranscriptApp();
}

function startTranscriptApp(): void {
  els.apiKey.value = state.key;
  els.apiKey.addEventListener('input', () => {
    state.key = els.apiKey.value.trim();
    state.usingByok = Boolean(state.key);
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
    if (user && !state.started) scheduleBoot();
  });

  if (state.key || !isFirebaseConfigured()) scheduleBoot();
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
    'billingEvents'
  ];
  for (const key of order) {
    root.append(documentSection(key, payload.documents[key] ?? []));
  }
  container.replaceChildren(root);
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
  if (state.booting || state.started) return;
  state.booting = true;
  state.key = els.apiKey.value.trim();
  state.usingByok = Boolean(state.key);
  setGateStatus('Connecting...');

  try {
    state.config = await publicFetch<PublicConfig>('/v1/config', { method: 'GET' });
    if (state.config.firebaseAuthRequired && !state.firebaseUser) {
      setGateStatus(state.usingByok ? 'Sign in to save your story with this key.' : 'Sign in or paste a Gemini key.');
      return;
    }
    if (state.usingByok) {
      await providerFetch('/v1/provider/gemini/validate-key', { method: 'POST', body: {} });
    }

    await ensureRepo();
    await startMicrophoneBuffer();
    startTranscriptOnlyMode();
    startRecognitionLoop();
  } catch (error) {
    setGateStatus(messageFrom(error));
  } finally {
    state.booting = false;
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
    liveBillableSeconds: 30
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
  state.started = true;
  els.gate.classList.add('is-hidden');
  els.transcript.classList.add('is-live');
}

async function startMicrophoneBuffer(): Promise<void> {
  if (audioContext && processor && mediaStream) return;
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
    state.recognitionActive = false;
    if (state.started) restartRecognitionSoon();
  };
  restartRecognitionSoon();
}

function onSpeechResult(event: SpeechRecognitionEventLike): void {
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
    scheduleTurnTail();
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
  try {
    const token = await authorizedFetch<LiveTokenResponse>('/v1/provider/gemini/live-token', {
      method: 'POST',
      body: {
        repoId: state.repoId,
        branchId: state.branchId,
        responseModalities: ['AUDIO']
      },
      providerKey: state.usingByok ? state.key : undefined
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
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT
          }
        },
        callbacks: {
          onmessage: message => onLiveMessage(message),
          onerror: event => addLine('system', messageFrom(event.error ?? event)),
          onclose: () => {
            if (activeTurn === turn) activeTurn.closed = true;
          }
        }
      }),
      sessionId: token.sessionId ?? null,
      startedAtMs,
      sentThroughMs: preRollFromMs,
      tailTimer: null,
      closeTimer: null,
      emptyTurnTimer: null,
      expectedHeadTurnId: token.branchHeadTurnId,
      userTranscript: '',
      assistantTranscript: '',
      userLine: null,
      assistantLine: null,
      closed: false
    };

    activeTurn = turn;
    turn.session.sendRealtimeInput({ activityStart: {} });
    sendLiveChunksThrough(Date.now());
  } catch (error) {
    addLine('system', messageFrom(error));
    activeTurn = null;
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
  if (!activeTurn || activeTurn.closed) return;
  const chunks = pcmChunks.filter(chunk => chunk.endMs > activeTurn!.sentThroughMs && chunk.startMs <= endMs);
  for (const chunk of chunks) {
    activeTurn.session.sendRealtimeInput({ audio: { data: chunk.data, mimeType: chunk.mimeType } });
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
  if (turn.tailTimer) window.clearTimeout(turn.tailTimer);
  if (turn.closeTimer) window.clearTimeout(turn.closeTimer);
  if (turn.emptyTurnTimer) window.clearTimeout(turn.emptyTurnTimer);

  try {
    turn.session.close();
  } catch {
    // Already closed.
  }

  const userTranscript = turn.userTranscript.trim();
  const assistantTranscript = turn.assistantTranscript.trim();
  if (turn.sessionId) {
    await authorizedFetch('/v1/provider/gemini/live-session/end', {
      method: 'POST',
      body: { sessionId: turn.sessionId }
    }).catch(() => {});
  }
  if (!state.repoId || !state.branchId || !userTranscript || !assistantTranscript) return;

  try {
    const result = await authorizedFetch<{ turn?: { id?: string } }>('/v1/story/live-turn', {
      method: 'POST',
      providerKey: state.usingByok ? state.key : undefined,
      body: {
        repoId: state.repoId,
        branchId: state.branchId,
        liveSessionId: turn.sessionId ?? undefined,
        expectedHeadTurnId: turn.expectedHeadTurnId,
        userTranscript,
        assistantTranscript
      }
    });
    if (result.turn?.id) {
      sessionStorage.setItem(STORAGE.branchId, state.branchId);
    }
  } catch (error) {
    addLine('system', messageFrom(error));
  }
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Request failed with ${response.status}`);
  return payload as T;
}

function restartRecognitionSoon(): void {
  window.setTimeout(() => {
    if (!recognition || state.recognitionActive) return;
    try {
      recognition.start();
      state.recognitionActive = true;
    } catch {
      // start() throws if the browser still considers the previous recognition session active.
    }
  }, 180);
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

function updateOrCreateLine(existing: HTMLElement | null, role: 'user' | 'model' | 'system', text: string, interim: boolean): HTMLElement {
  const line = existing ?? addLine(role, text);
  line.classList.toggle('interim', interim);
  setLineText(line, text);
  return line;
}

function addLine(role: 'user' | 'model' | 'system', text: string): HTMLElement {
  const line = document.createElement('article');
  line.className = `line ${role}`;
  line.innerHTML = '<span class="role"></span><span class="text"></span>';
  line.querySelector<HTMLElement>('.role')!.textContent = role === 'model' ? 'model' : role;
  setLineText(line, text);
  els.transcript.append(line);
  line.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return line;
}

function setLineText(line: HTMLElement, text: string): void {
  line.querySelector<HTMLElement>('.text')!.textContent = text;
  line.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
