export const CLIENT_TOKEN = {
  APP_TRANSCRIPT_STARTED: 'app:transcript-started',
  PROVIDER_BYOK_KEY: 'provider:byok-key',
  UI_GATE_OPEN: 'ui:gate-open',
  UI_BOOTING: 'ui:booting',
  MEDIA_MICROPHONE_BUFFER: 'media:microphone-buffer',
  STT_LISTENING: 'stt:listening',
  STT_PAUSED_FOR_LIVE_TURN: 'stt:paused-for-live-turn',
  LIVE_TURN_STARTING: 'live:turn-starting',
  LIVE_TURN_ACTIVE: 'live:turn-active',
  LIVE_INPUT_OPEN: 'live:input-open',
  LIVE_INPUT_CLOSED: 'live:input-closed',
  LIVE_SESSION_OPEN: 'live:session-open',
  LIVE_SESSION_CLOSED: 'live:session-closed',
  LIVE_TURN_COMMITTING: 'live:turn-committing'
} as const;

export type ClientToken = typeof CLIENT_TOKEN[keyof typeof CLIENT_TOKEN];
export type TokenTone = 'state' | 'ready' | 'work' | 'blocked';

export type TokenDisplay = {
  token: string;
  category: string;
  label: string;
  description: string;
  tone: TokenTone;
  priority: number;
  source?: 'client' | 'backend';
};

export type TokenSnapshot = {
  action?: string;
  activeTokens?: string[];
  blockerTokens?: string[];
  allowed?: boolean;
  display?: TokenDisplay[];
};

const CLIENT_TOKEN_DISPLAY: Record<ClientToken, Omit<TokenDisplay, 'token' | 'source'>> = {
  [CLIENT_TOKEN.APP_TRANSCRIPT_STARTED]: {
    category: 'app',
    label: 'Transcript live',
    description: 'The setup gate is complete and the realtime transcript session is running.',
    tone: 'ready',
    priority: 95
  },
  [CLIENT_TOKEN.PROVIDER_BYOK_KEY]: {
    category: 'provider',
    label: 'BYOK provider',
    description: 'Requests will use the local Gemini provider key from this browser session.',
    tone: 'ready',
    priority: 45
  },
  [CLIENT_TOKEN.UI_GATE_OPEN]: {
    category: 'ui',
    label: 'Setup gate',
    description: 'Waiting for sign-in or a provider key.',
    tone: 'state',
    priority: 120
  },
  [CLIENT_TOKEN.UI_BOOTING]: {
    category: 'ui',
    label: 'Booting',
    description: 'Connecting, validating access, and preparing the voice session.',
    tone: 'work',
    priority: 30
  },
  [CLIENT_TOKEN.MEDIA_MICROPHONE_BUFFER]: {
    category: 'media',
    label: 'Mic buffer',
    description: 'Keeping a short local microphone buffer for live turn pre-roll.',
    tone: 'ready',
    priority: 80
  },
  [CLIENT_TOKEN.STT_LISTENING]: {
    category: 'stt',
    label: 'Listening',
    description: 'Browser speech recognition is active.',
    tone: 'ready',
    priority: 20
  },
  [CLIENT_TOKEN.STT_PAUSED_FOR_LIVE_TURN]: {
    category: 'stt',
    label: 'STT paused',
    description: 'Browser speech recognition is paused while Gemini Live owns the turn input.',
    tone: 'state',
    priority: 21
  },
  [CLIENT_TOKEN.LIVE_TURN_STARTING]: {
    category: 'live',
    label: 'Starting Live',
    description: 'Requesting a Live token and opening the Gemini Live session.',
    tone: 'work',
    priority: 10
  },
  [CLIENT_TOKEN.LIVE_TURN_ACTIVE]: {
    category: 'live',
    label: 'Live turn',
    description: 'Streaming turn audio and transcript through Gemini Live.',
    tone: 'work',
    priority: 11
  },
  [CLIENT_TOKEN.LIVE_INPUT_OPEN]: {
    category: 'live',
    label: 'Input open',
    description: 'The current Gemini Live turn is still accepting microphone audio.',
    tone: 'work',
    priority: 13
  },
  [CLIENT_TOKEN.LIVE_INPUT_CLOSED]: {
    category: 'live',
    label: 'Input closed',
    description: 'The current Gemini Live turn has stopped accepting microphone audio.',
    tone: 'state',
    priority: 14
  },
  [CLIENT_TOKEN.LIVE_SESSION_OPEN]: {
    category: 'live',
    label: 'Session open',
    description: 'The Gemini Live transport session is open.',
    tone: 'work',
    priority: 15
  },
  [CLIENT_TOKEN.LIVE_SESSION_CLOSED]: {
    category: 'live',
    label: 'Session closed',
    description: 'The Gemini Live transport session has closed.',
    tone: 'state',
    priority: 16
  },
  [CLIENT_TOKEN.LIVE_TURN_COMMITTING]: {
    category: 'live',
    label: 'Committing',
    description: 'Saving the Live transcript and canonizing the branch state.',
    tone: 'work',
    priority: 12
  }
};

export function clientTokenDisplay(token: ClientToken): TokenDisplay {
  return { token, source: 'client', ...CLIENT_TOKEN_DISPLAY[token] };
}

export function fallbackTokenDisplay(token: string, source: 'client' | 'backend' = 'backend'): TokenDisplay {
  const [category = 'token', rawSubtype = token] = token.split(':', 2);
  const label = rawSubtype
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || token;
  return {
    token,
    category,
    label,
    description: token,
    tone: token.includes('missing') || token.includes('denied') || token.includes('stale') || token.includes('invalid') ? 'blocked' : 'state',
    priority: 200,
    source
  };
}

export function sortTokenDisplays(tokens: TokenDisplay[]): TokenDisplay[] {
  return [...tokens].sort((a, b) => {
    const tone = toneRank(a.tone) - toneRank(b.tone);
    return tone || a.priority - b.priority || a.token.localeCompare(b.token);
  });
}

function toneRank(tone: TokenTone): number {
  switch (tone) {
    case 'blocked':
      return 0;
    case 'work':
      return 1;
    case 'ready':
      return 2;
    case 'state':
    default:
      return 3;
  }
}
