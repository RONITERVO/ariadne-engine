import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import { ZodError, type ZodSchema } from 'zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { AppConfig } from '../config.js';
import { ProviderRegistry } from '../adapters/providerRegistry.js';
import { ProviderError } from '../adapters/storyProvider.js';
import type { StoryReasoningProvider } from '../adapters/storyProvider.js';
import { GeminiKeyPoolError, GeminiServerKeyPool, type GeminiKeyLease } from '../billing/geminiKeyPool.js';
import { calculateLiveSessionCharge, calculateTextUsageCharge, type UsageCharge } from '../billing/modelCatalog.js';
import { BillingError, UsageBillingService, type UsageReservation } from '../billing/usageBilling.js';
import {
  extractOptionalProviderKey,
  extractProviderKey,
  hasExplicitProviderKeyHeader,
  keyFingerprint,
  ProviderKeyError,
  rejectProviderSecretsInBody,
  rejectProviderSecretsInQuery
} from '../security/providerKeys.js';
import { FirestoreStoryStore } from '../storage/firestoreStoryStore.js';
import { InMemoryStoryStore } from '../storage/inMemoryStoryStore.js';
import type { StoryStore } from '../storage/storyStore.js';
import { StoreError } from '../storage/storyStore.js';
import { StoryService, type ContinueStoryStreamEvent } from '../application/storyService.js';
import {
  CreateRepoBodySchema,
  ForkBranchBodySchema,
  LiveTurnBodySchema,
  LiveTokenBodySchema,
  StoryTurnBodySchema
} from '../domain/validation.js';
import type { StoryRepo } from '../domain/types.js';
import { getBearerToken, looksLikeJwt, requireFirebaseUser } from './firebaseAuth.js';
import { HttpError } from './httpErrors.js';

export interface AppDeps {
  store?: StoryStore;
  providers?: ProviderRegistry;
  billing?: UsageBillingService;
  keyPool?: GeminiServerKeyPool;
}

const PROVIDER_KEY_ALLOWED_PATHS = new Set([
  '/v1/provider/gemini/validate-key',
  '/v1/provider/gemini/live-token',
  '/v1/provider/gemini/live-session/end',
  '/v1/story/turn',
  '/v1/story/turn/stream',
  '/v1/story/live-turn'
]);

const WEB_DIST_DIR = join(process.cwd(), 'web', 'dist');
const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-ariadne-provider-key',
          'request.headers.authorization',
          'request.headers.x-ariadne-provider-key',
          '*.apiKey',
          '*.api_key',
          '*.providerKey',
          '*.provider_key',
          '*.geminiApiKey',
          '*.googleApiKey'
        ],
        censor: '[redacted]'
      }
    },
    bodyLimit: config.bodyLimitBytes
  });

  const store = deps.store ?? (config.storage === 'firestore'
    ? new FirestoreStoryStore()
    : new InMemoryStoryStore());
  const providers = deps.providers ?? new ProviderRegistry(config.allowMockProvider);
  const billing = deps.billing ?? new UsageBillingService(config.billing);
  const keyPool = deps.keyPool ?? new GeminiServerKeyPool(config.geminiServerKeys, config.geminiKeyPool);
  const service = new StoryService(store, config);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-ariadne-provider-key']
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow
  });
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true
  });
  app.addHook('preValidation', async request => {
    rejectProviderSecretsInQuery(request.query);
    rejectProviderSecretsInBody(request.body);

    const pathname = requestPathname(request);
    if (hasExplicitProviderKeyHeader(request.headers) && !PROVIDER_KEY_ALLOWED_PATHS.has(pathname)) {
      throw new ProviderKeyError(`Provider key headers are accepted only on provider routes and story turn routes, not ${pathname}.`, 'unexpected');
    }
  });

  app.addHook('onClose', async () => {
    await store.close?.();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error }, 'request failed');

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof BillingError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof GeminiKeyPoolError) {
      if (error.retryAfterSeconds) reply.header('retry-after', String(error.retryAfterSeconds));
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ProviderKeyError) {
      const status = error.code === 'missing' ? 401 : 400;
      return reply.code(status).send({ error: `provider_key_${error.code}`, message: error.message });
    }
    if (error instanceof ProviderError) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'rate_limited' ? 429 : error.code === 'bad_response' ? 502 : 503;
      return reply.code(status).send({ error: `provider_${error.code}`, message: error.message });
    }
    if (error instanceof StoreError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'unavailable' ? 503 : 400;
      return reply.code(status).send({ error: `store_${error.code}`, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', issues: error.issues });
    }

    return reply.code(500).send({ error: 'internal_error', message: 'Unexpected server error.' });
  });

  app.get('/health', async () => ({
    ok: true,
    name: 'ariadne-engine',
    version: '0.3.0',
    storage: config.storage,
    provider: config.defaultProvider
  }));

  app.get('/', async (_request, reply) => serveWebFile(reply, 'index.html'));
  app.get('/assets/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'];
    return serveWebFile(reply, `assets/${wildcard}`);
  });

  app.get('/v1/config', async () => ({
    defaultProvider: config.defaultProvider,
    actorModel: config.actorModel,
    canonizerModel: config.canonizerModel,
    liveModel: config.liveModel,
    defaultStoryTitle: config.defaultStoryTitle,
    defaultStoryStyle: config.defaultStoryStyle,
    webSpeechLanguage: config.webSpeechLanguage,
    maxTranscriptChars: config.maxTranscriptChars,
    paidUsageEnabled: config.paidUsageEnabled,
    firebaseAuthRequired: config.firebaseAuthRequired,
    billingCurrency: config.billing.currency,
    defaultCheckoutAmountCents: config.billing.defaultCheckoutAmountCents,
    minCheckoutAmountCents: config.billing.minCheckoutAmountCents,
    liveBillableSeconds: calculateLiveSessionCharge(config.modelCatalog, config.liveModel).billableSeconds
  }));

  app.post('/v1/provider/gemini/validate-key', async (request, reply) => {
    const providerKey = extractProviderKey(request.headers);
    const provider = providers.forApiKey(providerKey);
    const result = await provider.validateKey(providerKey, config.actorModel);
    request.log.info({ provider: provider.name, keyFingerprint: keyFingerprint(providerKey) }, 'provider key validated');
    return reply.send({ ...result, keyFingerprint: keyFingerprint(providerKey) });
  });

  app.post('/v1/provider/gemini/live-token', async (request, reply) => {
    const body = parseBody(LiveTokenBodySchema, request.body);
    const access = await resolveProviderExecution(request, config, providers, keyPool);
    let liveReservation: Awaited<ReturnType<UsageBillingService['reserveLiveSession']>> | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config);
      const branch = await store.getBranch(body.branchId);
      if (!branch) throw new StoreError(`branch not found: ${body.branchId}`, 'not_found');
      const branchHeadTurnId = branch.headTurnId ?? null;
      const charge = calculateLiveSessionCharge(config.modelCatalog, config.liveModel);
      liveReservation = access.firebaseUser && config.paidUsageEnabled
        ? await billing.reserveLiveSession(access.firebaseUser.uid, {
            ...charge,
            creditMicros: access.mode === 'paid' ? charge.creditMicros : 0
          })
        : null;
      const result = await access.provider.createLiveToken({
        apiKey: access.providerKey,
        model: config.liveModel,
        responseModalities: body.responseModalities ?? ['AUDIO'],
        systemInstruction: await service.buildLiveSystemInstruction({ repoId: body.repoId, branchId: body.branchId }),
        languageCodes: config.webSpeechLanguage ? [config.webSpeechLanguage] : undefined,
        voiceName: body.voiceName
      });
      await liveReservation?.settle(result.expiresAt);
      return reply.send({
        ...result,
        model: config.liveModel,
        branchHeadTurnId,
        sessionId: liveReservation?.id ?? result.sessionId ?? null,
        billingMode: access.mode,
        billing: liveReservation
          ? {
              provider: 'ariadne',
              billableSeconds: charge.billableSeconds,
              usedCreditMicros: charge.creditMicros
            }
          : undefined
      });
    } catch (error) {
      failure = error;
      await liveReservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'live reservation release failed'));
      throw error;
    } finally {
      access.lease?.release(failure);
    }
  });

  app.post('/v1/provider/gemini/live-session/end', async request => {
    const body = request.body as { sessionId?: unknown } | undefined;
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) throw new HttpError('sessionId is required.', 400, 'validation_error');
    const bearer = getBearerToken(request.headers.authorization);
    if (bearer && looksLikeJwt(bearer)) {
      const user = await requireFirebaseUser(request);
      await billing.endLiveSession(user.uid, sessionId);
    }
    return { ok: true };
  });

  app.get('/v1/repos', async request => {
    const user = await resolveStoryUser(request, config);
    return { repos: await store.listRepos(user?.uid) };
  });

  app.post('/v1/repos', async (request, reply) => {
    const user = await resolveStoryUser(request, config);
    const body = parseBody(CreateRepoBodySchema, request.body);
    const result = await service.createRepo({
      title: body.title,
      description: body.description,
      defaultStyle: body.defaultStyle ?? body.style,
      safetyProfile: body.safetyProfile,
      ownerUserId: user?.uid
    });
    return reply.code(201).send(result);
  });

  app.get('/v1/repos/:repoId', async request => {
    const user = await resolveStoryUser(request, config);
    const { repoId } = request.params as { repoId: string };
    const repo = await store.getRepo(repoId);
    if (!repo) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
    assertRepoAccess(repo, user, config);
    return { repo, branches: await store.listBranches(repoId) };
  });

  app.post('/v1/branches/fork', async (request, reply) => {
    const user = await resolveStoryUser(request, config);
    const body = parseBody(ForkBranchBodySchema, request.body);
    const repo = await store.getRepo(body.repoId);
    if (!repo) throw new StoreError(`repo not found: ${body.repoId}`, 'not_found');
    assertRepoAccess(repo, user, config);
    const result = await store.forkBranch(body);
    return reply.code(201).send(result);
  });

  app.get('/v1/branches/:branchId/timeline', async request => {
    const user = await resolveStoryUser(request, config);
    const { branchId } = request.params as { branchId: string };
    const branch = await store.getBranch(branchId);
    if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');
    const repo = await store.getRepo(branch.repoId);
    if (!repo) throw new StoreError(`repo not found: ${branch.repoId}`, 'not_found');
    assertRepoAccess(repo, user, config);
    return { branchId, timeline: await store.getTimeline(branchId), state: await store.getState(branchId) };
  });

  app.get('/v1/billing/me', async request => {
    const user = await requireFirebaseUser(request);
    return await billing.getEntitlement(user.uid);
  });

  app.post('/v1/billing/checkout-session', async request => {
    const user = await requireFirebaseUser(request);
    const body = request.body as { amountCents?: unknown } | undefined;
    return await billing.createCheckoutSession(user, body?.amountCents);
  });

  app.post('/v1/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    const signature = Array.isArray(request.headers['stripe-signature'])
      ? request.headers['stripe-signature'][0]
      : request.headers['stripe-signature'];
    const raw = (request as FastifyRequest & { rawBody?: string | Buffer }).rawBody;
    const result = await billing.handleStripeWebhook(raw, signature);
    return reply.send(result);
  });

  app.post('/v1/story/turn', async (request, reply) => {
    const body = parseBody(StoryTurnBodySchema, request.body);
    const access = await resolveProviderExecution(request, config, providers, keyPool);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config);
      reservation = access.mode === 'paid'
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/turn',
            actorModel: config.actorModel,
            canonizerModel: config.canonizerModel
          })
        : null;
      const result = await service.continueStory({
        repoId: body.repoId,
        branchId: body.branchId,
        expectedHeadTurnId: body.expectedHeadTurnId,
        userTranscript: body.userTranscript,
        providerKey: access.providerKey,
        provider: access.provider
      });
      await settleUsageReservation(reservation, calculateTextUsageCharge(config.modelCatalog, result.modelMetadata));
      return reply.code(201).send({ ...result, billingMode: access.mode });
    } catch (error) {
      failure = error;
      await reservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'story reservation release failed'));
      throw error;
    } finally {
      access.lease?.release(failure);
    }
  });

  app.post('/v1/story/turn/stream', async (request, reply) => {
    const body = parseBody(StoryTurnBodySchema, request.body);
    const access = await resolveProviderExecution(request, config, providers, keyPool);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config);
      reservation = access.mode === 'paid'
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/turn/stream',
            actorModel: config.actorModel,
            canonizerModel: config.canonizerModel
          })
        : null;
      const events = billStoryStream(
        service.continueStoryStream({
          repoId: body.repoId,
          branchId: body.branchId,
          expectedHeadTurnId: body.expectedHeadTurnId,
          userTranscript: body.userTranscript,
          providerKey: access.providerKey,
          provider: access.provider
        }),
        {
          reservation,
          access,
          config,
          logError: (error, message) => request.log.error({ err: error }, message)
        }
      );

      return reply
        .code(200)
        .header('cache-control', 'no-cache, no-transform')
        .header('x-accel-buffering', 'no')
        .type('application/x-ndjson; charset=utf-8')
        .send(Readable.from(toNdjson(events)));
    } catch (error) {
      failure = error;
      await reservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'stream reservation release failed'));
      throw error;
    } finally {
      if (failure) access.lease?.release(failure);
    }
  });

  app.post('/v1/story/live-turn', async (request, reply) => {
    const body = parseBody(LiveTurnBodySchema, request.body);
    const access = await resolveProviderExecution(request, config, providers, keyPool);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config);
      reservation = access.mode === 'paid'
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/live-turn',
            liveModel: config.liveModel,
            canonizerModel: config.canonizerModel,
            liveSessionId: body.liveSessionId ?? null
          })
        : null;
      const result = await service.commitLiveTurn({
        repoId: body.repoId,
        branchId: body.branchId,
        userTranscript: body.userTranscript,
        assistantTranscript: body.assistantTranscript,
        liveSessionId: body.liveSessionId,
        expectedHeadTurnId: body.expectedHeadTurnId,
        providerKey: access.providerKey,
        provider: access.provider
      });
      await settleUsageReservation(reservation, calculateTextUsageCharge(config.modelCatalog, result.modelMetadata));
      return reply.code(201).send({ ...result, billingMode: access.mode });
    } catch (error) {
      failure = error;
      await reservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'live-turn reservation release failed'));
      throw error;
    } finally {
      access.lease?.release(failure);
    }
  });

  return app;
}

async function* toNdjson(events: AsyncIterable<ContinueStoryStreamEvent>): AsyncIterable<string> {
  try {
    for await (const event of events) {
      yield `${JSON.stringify(event)}\n`;
    }
  } catch (error) {
    yield `${JSON.stringify(streamErrorPayload(error))}\n`;
  }
}

function streamErrorPayload(error: unknown): { type: 'error'; error: string; message: string } {
  if (error instanceof ProviderError) return { type: 'error', error: `provider_${error.code}`, message: error.message };
  if (error instanceof BillingError) return { type: 'error', error: error.code, message: error.message };
  if (error instanceof GeminiKeyPoolError) return { type: 'error', error: error.code, message: error.message };
  if (error instanceof StoreError) return { type: 'error', error: `store_${error.code}`, message: error.message };
  if (error instanceof ProviderKeyError) return { type: 'error', error: `provider_key_${error.code}`, message: error.message };
  if (error instanceof ZodError) return { type: 'error', error: 'validation_error', message: 'Invalid request body.' };
  return { type: 'error', error: 'internal_error', message: 'Unexpected server error.' };
}

function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  return schema.parse(body);
}

function requestPathname(request: FastifyRequest): string {
  return new URL(request.url, 'http://ariadne.local').pathname;
}

async function resolveStoryUser(request: FastifyRequest, config: AppConfig): Promise<DecodedIdToken | null> {
  if (config.firebaseAuthRequired) return requireFirebaseUser(request);

  const bearer = getBearerToken(request.headers.authorization);
  if (bearer && looksLikeJwt(bearer)) return requireFirebaseUser(request);
  return null;
}

function assertRepoAccess(repo: StoryRepo, user: DecodedIdToken | null, config: AppConfig): void {
  if (!repo.ownerUserId) {
    if (config.firebaseAuthRequired) {
      throw new HttpError('This story repo has no owner and cannot be opened on the hosted deployment.', 403, 'repo_owner_required');
    }
    return;
  }
  if (!user || repo.ownerUserId !== user.uid) {
    throw new HttpError('You do not have access to this story repo.', 403, 'repo_access_denied');
  }
}

async function assertStoryAccess(
  store: StoryStore,
  repoId: string,
  branchId: string,
  user: DecodedIdToken | null,
  config: AppConfig
): Promise<void> {
  const repo = await store.getRepo(repoId);
  if (!repo) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
  const branch = await store.getBranch(branchId);
  if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');
  if (branch.repoId !== repo.id) throw new StoreError('branch does not belong to repo', 'invalid');
  assertRepoAccess(repo, user, config);
}

type ProviderExecution =
  | {
      mode: 'byok';
      providerKey: string;
      provider: StoryReasoningProvider;
      firebaseUser?: DecodedIdToken;
      lease?: undefined;
    }
  | {
      mode: 'paid';
      providerKey: string;
      provider: StoryReasoningProvider;
      firebaseUser: DecodedIdToken;
      lease: GeminiKeyLease;
    };

async function resolveProviderExecution(
  request: FastifyRequest,
  config: AppConfig,
  providers: ProviderRegistry,
  keyPool: GeminiServerKeyPool
): Promise<ProviderExecution> {
  const byokKey = extractByokProviderKey(request);
  if (byokKey) {
    const firebaseUser = config.firebaseAuthRequired ? await requireFirebaseUser(request) : undefined;
    return {
      mode: 'byok',
      providerKey: byokKey,
      provider: providers.forApiKey(byokKey),
      firebaseUser
    };
  }

  if (!config.paidUsageEnabled) {
    throw new ProviderKeyError(
      'Missing provider API key. Send x-ariadne-provider-key or sign in on a paid Ariadne deployment.',
      'missing'
    );
  }

  const firebaseUser = await requireFirebaseUser(request);
  const lease = keyPool.lease(firebaseUser.uid);
  return {
    mode: 'paid',
    providerKey: lease.apiKey,
    provider: providers.forApiKey(lease.apiKey),
    firebaseUser,
    lease
  };
}

function extractByokProviderKey(request: FastifyRequest): string | undefined {
  return extractOptionalProviderKey(request.headers);
}

async function settleUsageReservation(reservation: UsageReservation | null, charge: UsageCharge): Promise<void> {
  if (!reservation) return;
  await reservation.settle(charge);
}

async function* billStoryStream(
  events: AsyncIterable<ContinueStoryStreamEvent>,
  options: {
    reservation: UsageReservation | null;
    access: ProviderExecution;
    config: AppConfig;
    logError(error: unknown, message: string): void;
  }
): AsyncIterable<ContinueStoryStreamEvent> {
  let completed = false;
  let failure: unknown;
  try {
    for await (const event of events) {
      if (event.type === 'done') {
        const charge = calculateTextUsageCharge(options.config.modelCatalog, event.modelMetadata);
        await settleUsageReservation(options.reservation, charge);
        completed = true;
      }
      yield event;
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!completed) {
      await options.reservation?.release('failed').catch(error => options.logError(error, 'stream reservation release failed'));
    }
    options.access.lease?.release(failure);
  }
}


async function serveWebFile(reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
  const normalized = normalize(relativePath).replace(/^([/\\])+/, '');
  if (normalized.startsWith(`..${sep}`) || normalized === '..') {
    return reply.code(400).send({ error: 'bad_static_path', message: 'Invalid static file path.' });
  }

  const filePath = join(WEB_DIST_DIR, normalized);
  try {
    const body = await readFile(filePath);
    return reply
      .header('cache-control', normalized === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
      .type(STATIC_CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream')
      .send(body);
  } catch {
    return reply.code(404).send({ error: 'web_asset_not_found', message: 'Build the web app with npm run build:web.' });
  }
}

export function providerKeyFromRequest(request: FastifyRequest): string {
  return extractProviderKey(request.headers);
}
