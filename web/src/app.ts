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
  signInFirebase,
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

els.apiKey.value = state.key;
els.apiKey.addEventListener('input', () => {
  state.key = els.apiKey.value.trim();
  state.usingByok = Boolean(state.key);
  sessionStorage.setItem(STORAGE.key, state.key);
  scheduleBoot();
});
els.apiKey.addEventListener('paste', () => window.setTimeout(scheduleBoot, 0));
els.signIn.addEventListener('click', () => void signInFirebase().catch(error => setGateStatus(messageFrom(error))));
els.signOut.addEventListener('click', () => void signOutFirebase().catch(error => setGateStatus(messageFrom(error))));
els.buyCredits.addEventListener('click', () => void buyCredits());

onFirebaseAuthStateChanged(user => {
  state.firebaseUser = user;
  updateGateActions();
  if (user && !state.started) scheduleBoot();
});

if (state.key || !isFirebaseConfigured()) scheduleBoot();

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
    addLine('system', 'listening');
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
  void ensureLiveTurnStarted().then(() => {
    if (activeTurn && finalText) {
      activeTurn.userTranscript = appendTranscript(activeTurn.userTranscript, finalText);
    }
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
          },
          explicitVadSignal: true
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
  if (!activeTurn) return;
  if (activeTurn.tailTimer) window.clearTimeout(activeTurn.tailTimer);
  activeTurn.tailTimer = window.setTimeout(() => {
    if (!activeTurn) return;
    activeTurn.closeTimer = window.setTimeout(() => {
      if (!activeTurn) return;
      sendLiveChunksThrough(Date.now());
      activeTurn.session.sendRealtimeInput({ activityEnd: {} });
      activeTurn.session.sendRealtimeInput({ audioStreamEnd: true });
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
