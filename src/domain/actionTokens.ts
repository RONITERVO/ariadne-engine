export const ACTION_TOKEN = {
  REQUEST_BODY_VALIDATED: 'request:body-validated',
  REQUEST_BODY_INVALID: 'request:body-invalid',

  AUTH_FIREBASE_OPTIONAL: 'auth:firebase-optional',
  AUTH_FIREBASE_REQUIRED: 'auth:firebase-required',
  AUTH_FIREBASE_USER: 'auth:firebase-user',
  AUTH_FIREBASE_MISSING: 'auth:firebase-missing',

  PROVIDER_KEY_ALLOWED_ROUTE: 'provider:key-allowed-route',
  PROVIDER_KEY_UNEXPECTED: 'provider:key-unexpected',
  PROVIDER_KEY_INVALID: 'provider:key-invalid',
  PROVIDER_KEY_MISSING: 'provider:key-missing',
  PROVIDER_BYOK_KEY: 'provider:byok-key',
  PROVIDER_PAID_SERVER_KEY: 'provider:paid-server-key',
  PROVIDER_KEY_VALIDATED: 'provider:key-validated',

  BILLING_PAID_USAGE_ENABLED: 'billing:paid-usage-enabled',
  BILLING_PAID_USAGE_DISABLED: 'billing:paid-usage-disabled',
  BILLING_CREDITS_AVAILABLE: 'billing:credits-available',
  BILLING_CREDITS_INSUFFICIENT: 'billing:credits-insufficient',
  BILLING_CREDITS_RESERVED: 'billing:credits-reserved',

  LIVE_SESSION_AVAILABLE: 'live:session-available',
  LIVE_SESSION_RESERVED: 'live:session-reserved',
  LIVE_SESSION_ACTIVE: 'live:session-active',
  LIVE_SESSION_ENDED: 'live:session-ended',

  STORY_REPO_FOUND: 'story:repo-found',
  STORY_REPO_MISSING: 'story:repo-missing',
  STORY_BRANCH_FOUND: 'story:branch-found',
  STORY_BRANCH_MISSING: 'story:branch-missing',
  STORY_BRANCH_BELONGS_TO_REPO: 'story:branch-belongs-to-repo',
  STORY_BRANCH_REPO_MISMATCH: 'story:branch-repo-mismatch',
  STORY_REPO_OWNER: 'story:repo-owner',
  STORY_REPO_PUBLIC_DEV: 'story:repo-public-dev',
  STORY_REPO_OWNER_REQUIRED: 'story:repo-owner-required',
  STORY_REPO_ACCESS_DENIED: 'story:repo-access-denied',
  STORY_BRANCH_HEAD_CURRENT: 'story:branch-head-current',
  STORY_BRANCH_HEAD_STALE: 'story:branch-head-stale',
  STORY_BRANCH_STATE_FOUND: 'story:branch-state-found',
  STORY_BRANCH_STATE_MISSING: 'story:branch-state-missing',
  AUDIO_STORAGE_ENABLED: 'audio:storage-enabled',
  AUDIO_STORAGE_DISABLED: 'audio:storage-disabled',
  AUDIO_UPLOAD_URL_CREATED: 'audio:upload-url-created',
  AUDIO_OBJECT_VERIFIED: 'audio:object-verified',

  MUTATION_BRANCH_LEASE_ACQUIRED: 'mutation:branch-lease-acquired',
  MUTATION_BRANCH_LEASE_ACTIVE: 'mutation:branch-lease-active',

  CONTEXT_TRANSCRIPT_WITHIN_LIMIT: 'context:transcript-within-limit',
  CONTEXT_TRANSCRIPT_TOO_LONG: 'context:transcript-too-long',
  CONTEXT_BUDGET_STABLE: 'context:budget-stable',
  CONTEXT_BUDGET_CLOSURE: 'context:budget-closure',
  CONTEXT_BUDGET_HARD_STOP: 'context:budget-hard-stop'
} as const;

export type ActionToken = typeof ACTION_TOKEN[keyof typeof ACTION_TOKEN];

export const ACTION_ID = {
  HTTP_REQUEST: 'http.request',
  PROVIDER_VALIDATE_KEY: 'provider.validate-key',
  PROVIDER_CREATE_LIVE_TOKEN: 'provider.create-live-token',
  PROVIDER_END_LIVE_SESSION: 'provider.end-live-session',
  STORY_CREATE_REPO: 'story.create-repo',
  STORY_LIST_REPOS: 'story.list-repos',
  STORY_GET_REPO: 'story.get-repo',
  STORY_GET_MAP: 'story.get-map',
  STORY_SEARCH: 'story.search',
  STORY_EXPORT_REPO: 'story.export-repo',
  STORY_DELETE_REPO: 'story.delete-repo',
  STORY_COMPARE_BRANCHES: 'story.compare-branches',
  STORY_CANON_DEBUG: 'story.canon-debug',
  STORY_CREATE_AUDIO_UPLOAD: 'story.create-audio-upload',
  STORY_REGISTER_AUDIO_ASSET: 'story.register-audio-asset',
  STORY_LIST_AUDIO_ASSETS: 'story.list-audio-assets',
  STORY_FORK_BRANCH: 'story.fork-branch',
  STORY_GET_TIMELINE: 'story.get-timeline',
  STORY_TURN: 'story.turn',
  STORY_TURN_STREAM: 'story.turn.stream',
  STORY_LIVE_TURN: 'story.live-turn',
  BILLING_GET_ENTITLEMENT: 'billing.get-entitlement',
  BILLING_CHECKOUT_SESSION: 'billing.checkout-session',
  BILLING_STRIPE_WEBHOOK: 'billing.stripe-webhook'
} as const;

export type ActionId = typeof ACTION_ID[keyof typeof ACTION_ID];

export type ActionTokenTone = 'state' | 'ready' | 'work' | 'blocked';

export interface ActionTokenMetadata {
  category: string;
  label: string;
  description: string;
  tone: ActionTokenTone;
  priority: number;
}

export interface ActionTokenDisplay extends ActionTokenMetadata {
  token: ActionToken;
}

export interface ActionTokenSnapshot {
  action: ActionId;
  activeTokens: ActionToken[];
  blockerTokens: ActionToken[];
  allowed: boolean;
  display: ActionTokenDisplay[];
}

export interface TokenRequirement {
  id: string;
  allOf?: ActionToken[];
  anyOf?: ActionToken[];
  blockerToken: ActionToken;
  message: string;
}

export interface ActionGateDecision extends ActionTokenSnapshot {
  missingRequirements: Array<{ id: string; message: string; blockerToken: ActionToken }>;
}

export class ActionTokenSet {
  private readonly active = new Set<ActionToken>();
  private readonly blockers = new Set<ActionToken>();

  constructor(readonly action: ActionId, tokens: Iterable<ActionToken> = []) {
    this.add(...tokens);
  }

  add(...tokens: ActionToken[]): this {
    for (const token of tokens) this.active.add(token);
    return this;
  }

  block(...tokens: ActionToken[]): this {
    this.add(...tokens);
    for (const token of tokens) this.blockers.add(token);
    return this;
  }

  merge(other: ActionTokenSet | ActionTokenSnapshot | Iterable<ActionToken>): this {
    if (other instanceof ActionTokenSet) {
      this.add(...other.activeTokens());
      this.block(...other.blockerTokens());
      return this;
    }
    if (isActionTokenSnapshot(other)) {
      this.add(...other.activeTokens);
      this.block(...other.blockerTokens);
      return this;
    }
    this.add(...other);
    return this;
  }

  has(token: ActionToken): boolean {
    return this.active.has(token);
  }

  hasAny(tokens: readonly ActionToken[]): boolean {
    return tokens.some(token => this.active.has(token));
  }

  hasAll(tokens: readonly ActionToken[]): boolean {
    return tokens.every(token => this.active.has(token));
  }

  activeTokens(): ActionToken[] {
    return sortTokens(this.active);
  }

  blockerTokens(): ActionToken[] {
    return sortTokens(this.blockers);
  }

  snapshot(): ActionTokenSnapshot {
    const activeTokens = this.activeTokens();
    const blockerTokens = this.blockerTokens();
    return {
      action: this.action,
      activeTokens,
      blockerTokens,
      allowed: blockerTokens.length === 0,
      display: tokenDisplay(activeTokens)
    };
  }

  fail(message: string, statusCode = 400, code = 'action_gate_blocked', ...blockerTokens: ActionToken[]): ActionGateError {
    this.block(...blockerTokens);
    return new ActionGateError(message, statusCode, code, this.snapshot());
  }
}

export class ActionGateError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly tokens: ActionTokenSnapshot
  ) {
    super(message);
    this.name = 'ActionGateError';
  }
}

const TOKEN_METADATA: Record<ActionToken, ActionTokenMetadata> = {
  [ACTION_TOKEN.REQUEST_BODY_VALIDATED]: {
    category: 'request',
    label: 'Request validated',
    description: 'The request body passed the route schema.',
    tone: 'ready',
    priority: 110
  },
  [ACTION_TOKEN.REQUEST_BODY_INVALID]: {
    category: 'request',
    label: 'Request invalid',
    description: 'The request body did not satisfy the action schema.',
    tone: 'blocked',
    priority: 0
  },

  [ACTION_TOKEN.AUTH_FIREBASE_OPTIONAL]: {
    category: 'auth',
    label: 'Firebase optional',
    description: 'This deployment accepts anonymous local story actions.',
    tone: 'state',
    priority: 20
  },
  [ACTION_TOKEN.AUTH_FIREBASE_REQUIRED]: {
    category: 'auth',
    label: 'Firebase required',
    description: 'This deployment requires a signed-in Firebase user.',
    tone: 'state',
    priority: 10
  },
  [ACTION_TOKEN.AUTH_FIREBASE_USER]: {
    category: 'auth',
    label: 'Signed in',
    description: 'A Firebase user token was accepted for this action.',
    tone: 'ready',
    priority: 11
  },
  [ACTION_TOKEN.AUTH_FIREBASE_MISSING]: {
    category: 'auth',
    label: 'Sign-in required',
    description: 'The action needs a Firebase user token.',
    tone: 'blocked',
    priority: 1
  },

  [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]: {
    category: 'provider',
    label: 'Provider key route',
    description: 'This route is allowed to receive a provider API key header.',
    tone: 'ready',
    priority: 40
  },
  [ACTION_TOKEN.PROVIDER_KEY_UNEXPECTED]: {
    category: 'provider',
    label: 'Provider key blocked',
    description: 'A provider key appeared where this action does not accept one.',
    tone: 'blocked',
    priority: 2
  },
  [ACTION_TOKEN.PROVIDER_KEY_INVALID]: {
    category: 'provider',
    label: 'Provider key invalid',
    description: 'The provider key shape failed validation.',
    tone: 'blocked',
    priority: 3
  },
  [ACTION_TOKEN.PROVIDER_KEY_MISSING]: {
    category: 'provider',
    label: 'Provider key missing',
    description: 'No BYOK provider key or paid server key path is available.',
    tone: 'blocked',
    priority: 4
  },
  [ACTION_TOKEN.PROVIDER_BYOK_KEY]: {
    category: 'provider',
    label: 'BYOK provider',
    description: 'The action is using a user-supplied provider key.',
    tone: 'ready',
    priority: 41
  },
  [ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY]: {
    category: 'provider',
    label: 'Paid provider',
    description: 'The action is using a server-managed provider key and Ariadne credits.',
    tone: 'ready',
    priority: 42
  },
  [ACTION_TOKEN.PROVIDER_KEY_VALIDATED]: {
    category: 'provider',
    label: 'Provider validated',
    description: 'The provider accepted the selected key and model.',
    tone: 'ready',
    priority: 43
  },

  [ACTION_TOKEN.BILLING_PAID_USAGE_ENABLED]: {
    category: 'billing',
    label: 'Paid usage enabled',
    description: 'Ariadne credit billing is enabled for server-key usage.',
    tone: 'state',
    priority: 50
  },
  [ACTION_TOKEN.BILLING_PAID_USAGE_DISABLED]: {
    category: 'billing',
    label: 'Paid usage disabled',
    description: 'Server-key paid execution is unavailable on this deployment.',
    tone: 'blocked',
    priority: 5
  },
  [ACTION_TOKEN.BILLING_CREDITS_AVAILABLE]: {
    category: 'billing',
    label: 'Credits available',
    description: 'The account has enough Ariadne credits for the reservation.',
    tone: 'ready',
    priority: 51
  },
  [ACTION_TOKEN.BILLING_CREDITS_INSUFFICIENT]: {
    category: 'billing',
    label: 'Credits needed',
    description: 'The account needs more Ariadne credits for this action.',
    tone: 'blocked',
    priority: 6
  },
  [ACTION_TOKEN.BILLING_CREDITS_RESERVED]: {
    category: 'billing',
    label: 'Credits reserved',
    description: 'Credits were reserved for provider work.',
    tone: 'work',
    priority: 52
  },

  [ACTION_TOKEN.LIVE_SESSION_AVAILABLE]: {
    category: 'live',
    label: 'Live slot available',
    description: 'No active paid Gemini Live session blocks this account.',
    tone: 'ready',
    priority: 60
  },
  [ACTION_TOKEN.LIVE_SESSION_RESERVED]: {
    category: 'live',
    label: 'Live reserved',
    description: 'A Gemini Live session reservation is active.',
    tone: 'work',
    priority: 61
  },
  [ACTION_TOKEN.LIVE_SESSION_ACTIVE]: {
    category: 'live',
    label: 'Live already active',
    description: 'An existing Gemini Live session blocks another paid Live token.',
    tone: 'blocked',
    priority: 7
  },
  [ACTION_TOKEN.LIVE_SESSION_ENDED]: {
    category: 'live',
    label: 'Live ended',
    description: 'The Live session has been ended for billing/account state.',
    tone: 'ready',
    priority: 62
  },

  [ACTION_TOKEN.STORY_REPO_FOUND]: {
    category: 'story',
    label: 'Repo found',
    description: 'The requested story repo exists.',
    tone: 'ready',
    priority: 70
  },
  [ACTION_TOKEN.STORY_REPO_MISSING]: {
    category: 'story',
    label: 'Repo missing',
    description: 'The requested story repo does not exist.',
    tone: 'blocked',
    priority: 8
  },
  [ACTION_TOKEN.STORY_BRANCH_FOUND]: {
    category: 'story',
    label: 'Branch found',
    description: 'The requested story branch exists.',
    tone: 'ready',
    priority: 71
  },
  [ACTION_TOKEN.STORY_BRANCH_MISSING]: {
    category: 'story',
    label: 'Branch missing',
    description: 'The requested story branch does not exist.',
    tone: 'blocked',
    priority: 9
  },
  [ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO]: {
    category: 'story',
    label: 'Branch matches repo',
    description: 'The branch belongs to the requested repo.',
    tone: 'ready',
    priority: 72
  },
  [ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH]: {
    category: 'story',
    label: 'Branch mismatch',
    description: 'The branch does not belong to the requested repo.',
    tone: 'blocked',
    priority: 10
  },
  [ACTION_TOKEN.STORY_REPO_OWNER]: {
    category: 'story',
    label: 'Repo owner',
    description: 'The signed-in user owns this story repo.',
    tone: 'ready',
    priority: 73
  },
  [ACTION_TOKEN.STORY_REPO_PUBLIC_DEV]: {
    category: 'story',
    label: 'Local repo access',
    description: 'The repo is unowned and allowed on this non-hosted path.',
    tone: 'ready',
    priority: 74
  },
  [ACTION_TOKEN.STORY_REPO_OWNER_REQUIRED]: {
    category: 'story',
    label: 'Repo owner required',
    description: 'Hosted story access requires an owned repo.',
    tone: 'blocked',
    priority: 11
  },
  [ACTION_TOKEN.STORY_REPO_ACCESS_DENIED]: {
    category: 'story',
    label: 'Repo access denied',
    description: 'The signed-in user does not own this story repo.',
    tone: 'blocked',
    priority: 12
  },
  [ACTION_TOKEN.STORY_BRANCH_HEAD_CURRENT]: {
    category: 'story',
    label: 'Branch head current',
    description: 'The prepared branch head still matches the current branch head.',
    tone: 'ready',
    priority: 75
  },
  [ACTION_TOKEN.STORY_BRANCH_HEAD_STALE]: {
    category: 'story',
    label: 'Branch head stale',
    description: 'The branch advanced after this action was prepared.',
    tone: 'blocked',
    priority: 13
  },
  [ACTION_TOKEN.STORY_BRANCH_STATE_FOUND]: {
    category: 'story',
    label: 'Branch state found',
    description: 'The compiled branch state is available.',
    tone: 'ready',
    priority: 76
  },
  [ACTION_TOKEN.STORY_BRANCH_STATE_MISSING]: {
    category: 'story',
    label: 'Branch state missing',
    description: 'The compiled branch state is missing.',
    tone: 'blocked',
    priority: 14
  },
  [ACTION_TOKEN.AUDIO_STORAGE_ENABLED]: {
    category: 'audio',
    label: 'Audio storage',
    description: 'GCS audio object storage is configured for this deployment.',
    tone: 'ready',
    priority: 77
  },
  [ACTION_TOKEN.AUDIO_STORAGE_DISABLED]: {
    category: 'audio',
    label: 'Audio storage disabled',
    description: 'Audio object storage is not configured for this deployment.',
    tone: 'blocked',
    priority: 15
  },
  [ACTION_TOKEN.AUDIO_UPLOAD_URL_CREATED]: {
    category: 'audio',
    label: 'Upload URL ready',
    description: 'A short-lived GCS upload URL was created for this audio object.',
    tone: 'ready',
    priority: 78
  },
  [ACTION_TOKEN.AUDIO_OBJECT_VERIFIED]: {
    category: 'audio',
    label: 'Audio verified',
    description: 'The GCS object exists and matches the audio manifest.',
    tone: 'ready',
    priority: 79
  },

  [ACTION_TOKEN.MUTATION_BRANCH_LEASE_ACQUIRED]: {
    category: 'mutation',
    label: 'Branch lease',
    description: 'This action owns the branch mutation lease.',
    tone: 'work',
    priority: 80
  },
  [ACTION_TOKEN.MUTATION_BRANCH_LEASE_ACTIVE]: {
    category: 'mutation',
    label: 'Turn in progress',
    description: 'Another turn already owns the branch mutation lease.',
    tone: 'blocked',
    priority: 16
  },

  [ACTION_TOKEN.CONTEXT_TRANSCRIPT_WITHIN_LIMIT]: {
    category: 'context',
    label: 'Transcript within limit',
    description: 'The user transcript fits the configured request limit.',
    tone: 'ready',
    priority: 90
  },
  [ACTION_TOKEN.CONTEXT_TRANSCRIPT_TOO_LONG]: {
    category: 'context',
    label: 'Transcript too long',
    description: 'The user transcript exceeds the configured request limit.',
    tone: 'blocked',
    priority: 17
  },
  [ACTION_TOKEN.CONTEXT_BUDGET_STABLE]: {
    category: 'context',
    label: 'Context stable',
    description: 'The branch context is within the safe budget.',
    tone: 'ready',
    priority: 91
  },
  [ACTION_TOKEN.CONTEXT_BUDGET_CLOSURE]: {
    category: 'context',
    label: 'Closure mode',
    description: 'The branch is approaching the context budget and should converge.',
    tone: 'state',
    priority: 92
  },
  [ACTION_TOKEN.CONTEXT_BUDGET_HARD_STOP]: {
    category: 'context',
    label: 'Context hard stop',
    description: 'The branch context exceeds the hard budget.',
    tone: 'blocked',
    priority: 18
  }
};

const TOKEN_VALUES = new Set<ActionToken>(Object.values(ACTION_TOKEN));

export function createActionTokenSet(action: ActionId, tokens: Iterable<ActionToken> = []): ActionTokenSet {
  return new ActionTokenSet(action, tokens);
}

export function actionTokenMetadata(token: ActionToken): ActionTokenMetadata {
  return TOKEN_METADATA[token];
}

export function tokenDisplay(tokens: Iterable<ActionToken>): ActionTokenDisplay[] {
  return sortTokens(tokens).map(token => ({ token, ...TOKEN_METADATA[token] }));
}

export function sortTokens(tokens: Iterable<ActionToken>): ActionToken[] {
  return [...new Set(tokens)].sort((a, b) => {
    const priority = TOKEN_METADATA[a].priority - TOKEN_METADATA[b].priority;
    return priority || a.localeCompare(b);
  });
}

export function isActionToken(value: unknown): value is ActionToken {
  return typeof value === 'string' && TOKEN_VALUES.has(value as ActionToken);
}

export function actionTokenCategory(token: ActionToken): string {
  return TOKEN_METADATA[token].category;
}

export function evaluateActionGate(
  action: ActionId,
  tokens: Iterable<ActionToken>,
  requirements: TokenRequirement[]
): ActionGateDecision {
  const set = createActionTokenSet(action, tokens);
  const missingRequirements: ActionGateDecision['missingRequirements'] = [];

  for (const requirement of requirements) {
    const allPass = requirement.allOf ? set.hasAll(requirement.allOf) : true;
    const anyPass = requirement.anyOf ? set.hasAny(requirement.anyOf) : true;
    if (allPass && anyPass) continue;
    set.block(requirement.blockerToken);
    missingRequirements.push({
      id: requirement.id,
      message: requirement.message,
      blockerToken: requirement.blockerToken
    });
  }

  return {
    ...set.snapshot(),
    missingRequirements
  };
}

export function actionGatePayload(
  action: ActionId,
  activeTokens: Iterable<ActionToken>,
  blockerTokens: Iterable<ActionToken> = []
): ActionTokenSnapshot {
  const set = createActionTokenSet(action, activeTokens);
  set.block(...sortTokens(blockerTokens));
  return set.snapshot();
}

function isActionTokenSnapshot(value: unknown): value is ActionTokenSnapshot {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'action' in value &&
      'activeTokens' in value &&
      'blockerTokens' in value &&
      Array.isArray((value as ActionTokenSnapshot).activeTokens) &&
      Array.isArray((value as ActionTokenSnapshot).blockerTokens)
  );
}
