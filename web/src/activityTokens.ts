export const CLIENT_TOKEN = {
  UI_GATE_OPEN: 'ui:gate-open',
  UI_BOOTING: 'ui:booting',
  MEDIA_MICROPHONE_BUFFER: 'media:microphone-buffer',
  STT_LISTENING: 'stt:listening',
  LIVE_TURN_STARTING: 'live:turn-starting',
  LIVE_TURN_ACTIVE: 'live:turn-active',
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
