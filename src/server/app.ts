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
  ACTION_ID,
  ACTION_TOKEN,
  ActionGateError,
  type ActionId,
  type ActionTokenSnapshot,
  type ActionTokenSet,
  actionGatePayload,
  createActionTokenSet
} from '../domain/actionTokens.js';
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
import { AUDIO_QUALITY_PROFILES } from '../domain/audioQuality.js';
import { createAudioObjectStore, type AudioObjectStore } from '../storage/audioObjectStore.js';
import type { StoryStore } from '../storage/storyStore.js';
import { StoreError } from '../storage/storyStore.js';
import { StoryService, type ContinueStoryStreamEvent } from '../application/storyService.js';
import { buildStoryMap } from '../application/storyMapService.js';
import {
  archiveToMarkdown,
  buildCanonDebug,
  buildStoryArchive,
  compareBranches,
  searchStory
} from '../application/storyReleaseService.js';
import {
  AudioAssetBodySchema,
  AudioUploadUrlBodySchema,
  BranchCompareQuerySchema,
  CreateRepoBodySchema,
  ForkBranchBodySchema,
  LiveTurnBodySchema,
  LiveTokenBodySchema,
  RepoExportQuerySchema,
  StorySearchQuerySchema,
  StoryTurnBodySchema
} from '../domain/validation.js';
import type { AudioUploadIntent, BranchRef, RegisterAudioAssetInput, StoryRepo } from '../domain/types.js';
import { getBearerToken, looksLikeJwt, requireFirebaseUser } from './firebaseAuth.js';
import { HttpError } from './httpErrors.js';
import { registerAdminRoutes } from './adminRoutes.js';

export interface AppDeps {
  store?: StoryStore;
  providers?: ProviderRegistry;
  billing?: UsageBillingService;
  keyPool?: GeminiServerKeyPool;
  audioObjects?: AudioObjectStore;
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
  const audioObjects = deps.audioObjects ?? createAudioObjectStore(config.audioStorage);
  const service = new StoryService(store, config);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-ariadne-provider-key', 'x-client-id']
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
      throw new ProviderKeyError(
        `Provider key headers are accepted only on provider routes and story turn routes, not ${pathname}.`,
        'unexpected',
        [ACTION_TOKEN.PROVIDER_KEY_UNEXPECTED]
      );
    }
  });

  app.addHook('onClose', async () => {
    await store.close?.();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error }, 'request failed');

    if (error instanceof ActionGateError) {
      return sendErrorWithTokens(reply, error.statusCode, error.code, error.message, error.tokens);
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof BillingError) {
      return sendErrorWithTokens(
        reply,
        error.statusCode,
        error.code,
        error.message,
        actionGatePayload(actionIdFromRequest(request), [], error.blockerTokens)
      );
    }
    if (error instanceof GeminiKeyPoolError) {
      if (error.retryAfterSeconds) reply.header('retry-after', String(error.retryAfterSeconds));
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ProviderKeyError) {
      const status = error.code === 'missing' ? 401 : 400;
      return sendErrorWithTokens(
        reply,
        status,
        `provider_key_${error.code}`,
        error.message,
        actionGatePayload(actionIdFromRequest(request), [], error.blockerTokens)
      );
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
    version: '1.0.0',
    storage: config.storage,
    provider: config.defaultProvider
  }));

  app.get('/', async (_request, reply) => serveWebFile(reply, 'index.html'));
  app.get('/map', async (_request, reply) => serveWebFile(reply, 'index.html'));
  app.get('/map/*', async (_request, reply) => serveWebFile(reply, 'index.html'));
  app.get('/admin', async (_request, reply) => serveWebFile(reply, 'index.html'));
  app.get('/admin/*', async (_request, reply) => serveWebFile(reply, 'index.html'));
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
    liveBillableSeconds: calculateLiveSessionCharge(config.modelCatalog, config.liveModel).billableSeconds,
    audioStorageEnabled: audioObjects.isEnabled(),
    audioMaxBytes: config.audioStorage.maxBytes,
    audioDefaultQualityProfile: config.audioStorage.defaultQualityProfile,
    audioAllowedQualityProfiles: config.audioStorage.allowedQualityProfiles,
    audioQualityProfiles: Object.fromEntries(config.audioStorage.allowedQualityProfiles.map(profile => [profile, AUDIO_QUALITY_PROFILES[profile]]))
  }));
  registerAdminRoutes(app, config);

  app.post('/v1/provider/gemini/validate-key', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.PROVIDER_VALIDATE_KEY, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const providerKey = extractProviderKey(request.headers);
    tokens.add(ACTION_TOKEN.PROVIDER_BYOK_KEY);
    const provider = providers.forApiKey(providerKey);
    const result = await provider.validateKey(providerKey, config.actorModel);
    tokens.add(ACTION_TOKEN.PROVIDER_KEY_VALIDATED);
    request.log.info({ provider: provider.name, keyFingerprint: keyFingerprint(providerKey) }, 'provider key validated');
    return sendWithTokens(reply, { ...result, keyFingerprint: keyFingerprint(providerKey) }, tokens);
  });

  app.post('/v1/provider/gemini/live-token', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.PROVIDER_CREATE_LIVE_TOKEN, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const body = parseBody(LiveTokenBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const access = await resolveProviderExecution(request, config, providers, keyPool, tokens);
    let liveReservation: Awaited<ReturnType<UsageBillingService['reserveLiveSession']>> | null = null;
    let failure: unknown;

    try {
      const { branch } = await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config, tokens);
      const branchHeadTurnId = branch.headTurnId ?? null;
      const charge = calculateLiveSessionCharge(config.modelCatalog, config.liveModel);
      liveReservation = access.firebaseUser && config.paidUsageEnabled
        ? await billing.reserveLiveSession(access.firebaseUser.uid, {
            ...charge,
            creditMicros: hasPaidProviderAccess(access) ? charge.creditMicros : 0
          })
        : null;
      if (liveReservation) {
        tokens.add(ACTION_TOKEN.LIVE_SESSION_AVAILABLE, ACTION_TOKEN.LIVE_SESSION_RESERVED, ACTION_TOKEN.BILLING_CREDITS_RESERVED);
      }
      const result = await access.provider.createLiveToken({
        apiKey: access.providerKey,
        model: config.liveModel,
        responseModalities: body.responseModalities ?? ['AUDIO'],
        systemInstruction: await service.buildLiveSystemInstruction({ repoId: body.repoId, branchId: body.branchId, tokens }),
        languageCodes: config.webSpeechLanguage ? [config.webSpeechLanguage] : undefined,
        voiceName: body.voiceName
      });
      await liveReservation?.settle(result.expiresAt);
      return sendWithTokens(reply, {
        ...result,
        model: config.liveModel,
        branchHeadTurnId,
        sessionId: liveReservation?.id ?? result.sessionId ?? null,
        billingMode: billingModeFromAccess(access),
        billing: liveReservation
          ? {
              provider: 'ariadne',
              billableSeconds: charge.billableSeconds,
              usedCreditMicros: charge.creditMicros
            }
          : undefined
      }, tokens);
    } catch (error) {
      failure = error;
      await liveReservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'live reservation release failed'));
      throwTokenizedGateError(error, tokens);
      throw error;
    } finally {
      access.lease?.release(failure);
    }
  });

  app.post('/v1/provider/gemini/live-session/end', async request => {
    const tokens = createActionTokenSet(ACTION_ID.PROVIDER_END_LIVE_SESSION, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const body = request.body as { sessionId?: unknown } | undefined;
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) throw tokens.fail('sessionId is required.', 400, 'validation_error', ACTION_TOKEN.REQUEST_BODY_INVALID);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const bearer = getBearerToken(request.headers.authorization);
    if (bearer && looksLikeJwt(bearer)) {
      const user = await requireFirebaseUserWithTokens(request, tokens);
      await billing.endLiveSession(user.uid, sessionId);
      tokens.add(ACTION_TOKEN.LIVE_SESSION_ENDED);
    }
    return { ok: true, tokens: tokens.snapshot() };
  });

  app.get('/v1/repos', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_LIST_REPOS);
    const user = await resolveStoryUser(request, config, tokens);
    return { repos: await store.listRepos(user?.uid), tokens: tokens.snapshot() };
  });

  app.get('/v1/story/latest', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_GET_LATEST);
    const user = await resolveStoryUser(request, config, tokens);
    return { story: await findLatestStoryCursor(store, user?.uid), tokens: tokens.snapshot() };
  });

  app.get('/v1/story-map', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_GET_MAP);
    const user = await resolveStoryUser(request, config, tokens);
    const map = await buildStoryMap(store, user?.uid);
    return { ...map, tokens: tokens.snapshot() };
  });

  app.get('/v1/story-search', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_SEARCH);
    const user = await resolveStoryUser(request, config, tokens);
    const query = parseBody(StorySearchQuerySchema, request.query);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);

    let repoIds: string[];
    let branchId = query.branchId;
    if (branchId) {
      const branch = await store.getBranch(branchId);
      if (!branch) throw tokens.fail(`branch not found: ${branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
      tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
      if (query.repoId && query.repoId !== branch.repoId) {
        throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
      }
      const repo = await store.getRepo(branch.repoId);
      if (!repo) throw tokens.fail(`repo not found: ${branch.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
      tokens.add(ACTION_TOKEN.STORY_REPO_FOUND, ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
      assertRepoAccess(repo, user, config, tokens);
      repoIds = [repo.id];
    } else if (query.repoId) {
      const repo = await store.getRepo(query.repoId);
      if (!repo) throw tokens.fail(`repo not found: ${query.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
      tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
      assertRepoAccess(repo, user, config, tokens);
      repoIds = [repo.id];
    } else {
      repoIds = (await store.listRepos(user?.uid)).map(repo => repo.id);
      branchId = undefined;
    }

    return { ...(await searchStory(store, { query: query.q, repoIds, branchId, limit: query.limit })), tokens: tokens.snapshot() };
  });

  app.get('/v1/repos/:repoId/export', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_EXPORT_REPO);
    const user = await resolveStoryUser(request, config, tokens);
    const { repoId } = request.params as { repoId: string };
    const query = parseBody(RepoExportQuerySchema, request.query);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const repo = await store.getRepo(repoId);
    if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    const archive = await buildStoryArchive(store, repoId);
    const filename = `${downloadName(repo.title || repo.id)}-ariadne-archive.${query.format === 'markdown' ? 'md' : 'json'}`;
    if (query.format === 'markdown') {
      const snapshot = tokens.snapshot();
      return reply
        .code(200)
        .header('x-ariadne-active-tokens', snapshot.activeTokens.join(','))
        .header('content-disposition', `attachment; filename="${filename}"`)
        .type('text/markdown; charset=utf-8')
        .send(archiveToMarkdown(archive));
    }
    const snapshot = tokens.snapshot();
    return reply
      .header('x-ariadne-active-tokens', snapshot.activeTokens.join(','))
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send({ archive, tokens: snapshot });
  });

  app.delete('/v1/repos/:repoId', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_DELETE_REPO);
    const user = await resolveStoryUser(request, config, tokens);
    const { repoId } = request.params as { repoId: string };
    const repo = await store.getRepo(repoId);
    if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    await audioObjects.deleteRepoObjects(repoId);
    await store.deleteRepo(repoId);
    return sendWithTokens(reply, { ok: true, deletedRepoId: repoId }, tokens);
  });

  app.post('/v1/audio-assets/upload-url', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_CREATE_AUDIO_UPLOAD);
    const user = await resolveStoryUser(request, config, tokens);
    const body = parseBody(AudioUploadUrlBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    if (!audioObjects.isEnabled()) {
      throw tokens.fail('Audio object storage is not configured for this deployment.', 503, 'audio_storage_disabled', ACTION_TOKEN.AUDIO_STORAGE_DISABLED);
    }
    tokens.add(ACTION_TOKEN.AUDIO_STORAGE_ENABLED);
    const repo = await store.getRepo(body.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${body.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    if (body.branchId) {
      const branch = await store.getBranch(body.branchId);
      if (!branch) throw tokens.fail(`branch not found: ${body.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
      tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
      if (branch.repoId !== repo.id) {
        throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
      }
      tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    }
    const audioUpload = await audioObjects.prepareUpload(body);
    await store.createAudioUploadIntent({
      uploadId: audioUpload.uploadId,
      repoId: body.repoId,
      branchId: body.branchId ?? null,
      ownerUserId: repo.ownerUserId ?? user?.uid ?? null,
      role: body.role,
      storageProvider: 'gcs',
      storageUri: audioUpload.asset.storageUri,
      contentType: audioUpload.asset.contentType ?? body.contentType,
      sha256: audioUpload.asset.sha256,
      crc32c: audioUpload.asset.crc32c ?? null,
      codec: audioUpload.asset.codec,
      container: audioUpload.asset.container,
      qualityProfile: audioUpload.asset.qualityProfile ?? null,
      bitrateKbps: audioUpload.asset.bitrateKbps,
      channelCount: audioUpload.asset.channelCount,
      sampleRate: audioUpload.asset.sampleRate,
      durationMs: audioUpload.asset.durationMs,
      byteLength: audioUpload.asset.byteLength ?? body.byteLength,
      encryptionKeyRef: audioUpload.asset.encryptionKeyRef ?? null,
      expiresAt: audioUpload.expiresAt
    });
    tokens.add(ACTION_TOKEN.AUDIO_UPLOAD_URL_CREATED);
    return sendWithTokens(reply, { audioUpload }, tokens, 201);
  });

  app.post('/v1/audio-assets', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_REGISTER_AUDIO_ASSET);
    const user = await resolveStoryUser(request, config, tokens);
    const body = parseBody(AudioAssetBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);

    if (body.uploadId) {
      if (!audioObjects.isEnabled()) {
        throw tokens.fail('Audio upload tickets require configured object storage.', 503, 'audio_storage_disabled', ACTION_TOKEN.AUDIO_STORAGE_DISABLED);
      }
      tokens.add(ACTION_TOKEN.AUDIO_STORAGE_ENABLED);
      const intent = await store.getAudioUploadIntent(body.repoId, body.uploadId);
      if (!intent) throw tokens.fail(`audio upload not found: ${body.uploadId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
      const repo = await store.getRepo(intent.repoId);
      if (!repo) throw tokens.fail(`repo not found: ${intent.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
      tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
      assertRepoAccess(repo, user, config, tokens);
      if (intent.branchId) {
        const branch = await store.getBranch(intent.branchId);
        if (!branch) throw tokens.fail(`branch not found: ${intent.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
        tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
        if (branch.repoId !== repo.id) {
          throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
        }
        tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
      }
      const verification = await audioObjects.verifyUploadedAsset(audioManifestFromIntent(intent), intent);
      tokens.add(ACTION_TOKEN.AUDIO_OBJECT_VERIFIED);
      const audioAsset = await store.completeAudioUploadIntent({ repoId: intent.repoId, uploadId: intent.id, verification });
      return sendWithTokens(reply, { audioAsset }, tokens, 201);
    }

    if (audioObjects.isEnabled()) {
      throw tokens.fail('GCS audio registration requires a server-issued uploadId.', 400, 'audio_upload_id_required', ACTION_TOKEN.AUDIO_STORAGE_ENABLED);
    }
    if (!('storageUri' in body)) {
      throw tokens.fail('Audio manifest registration requires audio metadata.', 400, 'audio_manifest_required', ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    }

    const repo = await store.getRepo(body.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${body.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    if (body.branchId) {
      const branch = await store.getBranch(body.branchId);
      if (!branch) throw tokens.fail(`branch not found: ${body.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
      tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
      if (branch.repoId !== repo.id) {
        throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
      }
      tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    }
    const audioAsset = await store.saveAudioAsset(body);
    return sendWithTokens(reply, { audioAsset }, tokens, 201);
  });

  app.get('/v1/repos/:repoId/audio-assets', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_LIST_AUDIO_ASSETS);
    const user = await resolveStoryUser(request, config, tokens);
    const { repoId } = request.params as { repoId: string };
    const query = request.query as { branchId?: string };
    const repo = await store.getRepo(repoId);
    if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    return { audioAssets: await store.listAudioAssets(repoId, typeof query.branchId === 'string' ? query.branchId : undefined), tokens: tokens.snapshot() };
  });

  app.get('/v1/repos/:repoId/audio-assets/:assetId/playback-url', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_CREATE_AUDIO_PLAYBACK_URL);
    const user = await resolveStoryUser(request, config, tokens);
    const { repoId, assetId } = request.params as { repoId: string; assetId: string };
    if (!audioObjects.isEnabled()) {
      throw tokens.fail('Audio object storage is not configured for this deployment.', 503, 'audio_storage_disabled', ACTION_TOKEN.AUDIO_STORAGE_DISABLED);
    }
    tokens.add(ACTION_TOKEN.AUDIO_STORAGE_ENABLED);
    const repo = await store.getRepo(repoId);
    if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    const audioAsset = await store.getAudioAsset(repoId, assetId);
    if (!audioAsset) throw tokens.fail(`audio asset not found: ${assetId}`, 404, 'store_not_found', ACTION_TOKEN.AUDIO_ASSET_MISSING);
    tokens.add(ACTION_TOKEN.AUDIO_ASSET_FOUND);
    const audioPlayback = await audioObjects.createPlaybackUrl(audioAsset);
    tokens.add(ACTION_TOKEN.AUDIO_PLAYBACK_URL_CREATED);
    return sendWithTokens(reply, { audioPlayback }, tokens);
  });

  app.get('/v1/branches/compare', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_COMPARE_BRANCHES);
    const user = await resolveStoryUser(request, config, tokens);
    const query = parseBody(BranchCompareQuerySchema, request.query);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const [left, right] = await Promise.all([store.getBranch(query.leftBranchId), store.getBranch(query.rightBranchId)]);
    if (!left) throw tokens.fail(`branch not found: ${query.leftBranchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    if (!right) throw tokens.fail(`branch not found: ${query.rightBranchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
    if (left.repoId !== right.repoId) throw tokens.fail('branches must belong to the same repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
    tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    const repo = await store.getRepo(left.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${left.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    return { ...(await compareBranches(store, left.id, right.id)), tokens: tokens.snapshot() };
  });

  app.get('/v1/branches/:branchId/canon', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_CANON_DEBUG);
    const user = await resolveStoryUser(request, config, tokens);
    const { branchId } = request.params as { branchId: string };
    const branch = await store.getBranch(branchId);
    if (!branch) throw tokens.fail(`branch not found: ${branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
    const repo = await store.getRepo(branch.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${branch.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND, ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    assertRepoAccess(repo, user, config, tokens);
    return { ...(await buildCanonDebug(store, branch.id)), tokens: tokens.snapshot() };
  });

  app.post('/v1/repos', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_CREATE_REPO);
    const user = await resolveStoryUser(request, config, tokens);
    const body = parseBody(CreateRepoBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const result = await service.createRepo({
      title: body.title,
      description: body.description,
      defaultStyle: body.defaultStyle ?? body.style,
      safetyProfile: body.safetyProfile,
      ownerUserId: user?.uid
    });
    return sendWithTokens(reply, result, tokens, 201);
  });

  app.get('/v1/repos/:repoId', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_GET_REPO);
    const user = await resolveStoryUser(request, config, tokens);
    const { repoId } = request.params as { repoId: string };
    const repo = await store.getRepo(repoId);
    if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    return { repo, branches: await store.listBranches(repoId), tokens: tokens.snapshot() };
  });

  app.post('/v1/branches/fork', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_FORK_BRANCH);
    const user = await resolveStoryUser(request, config, tokens);
    const body = parseBody(ForkBranchBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const repo = await store.getRepo(body.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${body.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    assertRepoAccess(repo, user, config, tokens);
    const result = await store.forkBranch(body);
    return sendWithTokens(reply, result, tokens, 201);
  });

  app.get('/v1/branches/:branchId/timeline', async request => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_GET_TIMELINE);
    const user = await resolveStoryUser(request, config, tokens);
    const { branchId } = request.params as { branchId: string };
    const branch = await store.getBranch(branchId);
    if (!branch) throw tokens.fail(`branch not found: ${branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
    const repo = await store.getRepo(branch.repoId);
    if (!repo) throw tokens.fail(`repo not found: ${branch.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND, ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    assertRepoAccess(repo, user, config, tokens);
    return { branchId, timeline: await store.getTimeline(branchId), state: await store.getState(branchId), tokens: tokens.snapshot() };
  });

  app.get('/v1/billing/me', async request => {
    const tokens = createActionTokenSet(ACTION_ID.BILLING_GET_ENTITLEMENT, [ACTION_TOKEN.AUTH_FIREBASE_REQUIRED]);
    const user = await requireFirebaseUserWithTokens(request, tokens);
    const entitlement = await billing.getEntitlement(user.uid);
    return { ...entitlement, tokens: tokens.snapshot() };
  });

  app.post('/v1/billing/checkout-session', async request => {
    const tokens = createActionTokenSet(ACTION_ID.BILLING_CHECKOUT_SESSION, [ACTION_TOKEN.AUTH_FIREBASE_REQUIRED]);
    const user = await requireFirebaseUserWithTokens(request, tokens);
    const body = request.body as { amountCents?: unknown } | undefined;
    const result = await billing.createCheckoutSession(user, body?.amountCents);
    return { ...result, tokens: tokens.snapshot() };
  });

  app.post('/v1/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.BILLING_STRIPE_WEBHOOK);
    const signature = Array.isArray(request.headers['stripe-signature'])
      ? request.headers['stripe-signature'][0]
      : request.headers['stripe-signature'];
    const raw = (request as FastifyRequest & { rawBody?: string | Buffer }).rawBody;
    const result = await billing.handleStripeWebhook(raw, signature);
    return sendWithTokens(reply, result, tokens);
  });

  app.post('/v1/story/turn', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_TURN, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const body = parseBody(StoryTurnBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const access = await resolveProviderExecution(request, config, providers, keyPool, tokens);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config, tokens);
      reservation = hasPaidProviderAccess(access)
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/turn',
            actorModel: config.actorModel,
            canonizerModel: config.canonizerModel
          })
        : null;
      if (reservation) tokens.add(ACTION_TOKEN.BILLING_CREDITS_RESERVED);
      const result = await service.continueStory({
        repoId: body.repoId,
        branchId: body.branchId,
        expectedHeadTurnId: body.expectedHeadTurnId,
        userTranscript: body.userTranscript,
        providerKey: access.providerKey,
        provider: access.provider,
        tokens
      });
      await settleUsageReservation(reservation, calculateTextUsageCharge(config.modelCatalog, result.modelMetadata));
      return sendWithTokens(reply, { ...result, billingMode: billingModeFromAccess(access) }, tokens, 201);
    } catch (error) {
      failure = error;
      await reservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'story reservation release failed'));
      throwTokenizedGateError(error, tokens);
      throw error;
    } finally {
      access.lease?.release(failure);
    }
  });

  app.post('/v1/story/turn/stream', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_TURN_STREAM, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const body = parseBody(StoryTurnBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const access = await resolveProviderExecution(request, config, providers, keyPool, tokens);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config, tokens);
      reservation = hasPaidProviderAccess(access)
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/turn/stream',
            actorModel: config.actorModel,
            canonizerModel: config.canonizerModel
          })
        : null;
      if (reservation) tokens.add(ACTION_TOKEN.BILLING_CREDITS_RESERVED);
      const events = billStoryStream(
        service.continueStoryStream({
          repoId: body.repoId,
          branchId: body.branchId,
          expectedHeadTurnId: body.expectedHeadTurnId,
          userTranscript: body.userTranscript,
          providerKey: access.providerKey,
          provider: access.provider,
          tokens
        }),
        {
          reservation,
          access,
          config,
          tokens,
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
      throwTokenizedGateError(error, tokens);
      throw error;
    } finally {
      if (failure) access.lease?.release(failure);
    }
  });

  app.post('/v1/story/live-turn', async (request, reply) => {
    const tokens = createActionTokenSet(ACTION_ID.STORY_LIVE_TURN, [ACTION_TOKEN.PROVIDER_KEY_ALLOWED_ROUTE]);
    const body = parseBody(LiveTurnBodySchema, request.body);
    tokens.add(ACTION_TOKEN.REQUEST_BODY_VALIDATED);
    const access = await resolveProviderExecution(request, config, providers, keyPool, tokens);
    let reservation: UsageReservation | null = null;
    let failure: unknown;

    try {
      await assertStoryAccess(store, body.repoId, body.branchId, access.firebaseUser ?? null, config, tokens);
      reservation = hasPaidProviderAccess(access)
        ? await billing.reserveStoryTurn(access.firebaseUser.uid, config.turnReservationCreditMicros, {
            route: '/v1/story/live-turn',
            liveModel: config.liveModel,
            canonizerModel: config.canonizerModel,
            liveSessionId: body.liveSessionId ?? null
          })
        : null;
      if (reservation) tokens.add(ACTION_TOKEN.BILLING_CREDITS_RESERVED);
      const result = await service.commitLiveTurn({
        repoId: body.repoId,
        branchId: body.branchId,
        userTranscript: body.userTranscript,
        assistantTranscript: body.assistantTranscript,
        liveSessionId: body.liveSessionId,
        expectedHeadTurnId: body.expectedHeadTurnId,
        userAudioAssetId: body.userAudioAssetId ?? null,
        assistantAudioAssetId: body.assistantAudioAssetId ?? null,
        providerKey: access.providerKey,
        provider: access.provider,
        tokens
      });
      await settleUsageReservation(reservation, calculateTextUsageCharge(config.modelCatalog, result.modelMetadata));
      return sendWithTokens(reply, { ...result, billingMode: billingModeFromAccess(access) }, tokens, 201);
    } catch (error) {
      failure = error;
      await reservation?.release('failed').catch(releaseError => request.log.error({ err: releaseError }, 'live-turn reservation release failed'));
      throwTokenizedGateError(error, tokens);
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

function streamErrorPayload(error: unknown): { type: 'error'; error: string; message: string; tokens?: ActionTokenSnapshot } {
  if (error instanceof ActionGateError) return { type: 'error', error: error.code, message: error.message, tokens: error.tokens };
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

function sendWithTokens<T extends object>(
  reply: FastifyReply,
  payload: T,
  tokens: ActionTokenSet,
  statusCode = 200
): FastifyReply {
  const snapshot = tokens.snapshot();
  return reply
    .code(statusCode)
    .header('x-ariadne-active-tokens', snapshot.activeTokens.join(','))
    .send({ ...payload, tokens: snapshot });
}

async function findLatestStoryCursor(
  store: StoryStore,
  ownerUserId?: string
): Promise<{ repo: StoryRepo; branch: BranchRef } | null> {
  const repos = await store.listRepos(ownerUserId);
  let latest: { repo: StoryRepo; branch: BranchRef; branchTime: number; repoTime: number; headRank: number } | null = null;

  for (const repo of repos) {
    const repoTime = Math.max(dateValue(repo.updatedAt), dateValue(repo.createdAt));
    const branches = await store.listBranches(repo.id);
    for (const branch of branches) {
      const branchTime = Math.max(dateValue(branch.updatedAt), dateValue(branch.createdAt));
      const headRank = branch.headTurnId ? 1 : 0;
      if (
        !latest ||
        branchTime > latest.branchTime ||
        (branchTime === latest.branchTime && headRank > latest.headRank) ||
        (branchTime === latest.branchTime && headRank === latest.headRank && repoTime > latest.repoTime) ||
        (
          branchTime === latest.branchTime &&
          headRank === latest.headRank &&
          repoTime === latest.repoTime &&
          `${repo.id}:${branch.id}` > `${latest.repo.id}:${latest.branch.id}`
        )
      ) {
        latest = { repo, branch, branchTime, repoTime, headRank };
      }
    }
  }

  return latest ? { repo: latest.repo, branch: latest.branch } : null;
}

function dateValue(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sendErrorWithTokens(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  tokens: ReturnType<ActionTokenSet['snapshot']>
): FastifyReply {
  return reply
    .code(statusCode)
    .header('x-ariadne-active-tokens', tokens.activeTokens.join(','))
    .send({ error: code, message, tokens });
}

function audioManifestFromIntent(intent: AudioUploadIntent): RegisterAudioAssetInput {
  return {
    uploadId: intent.id,
    repoId: intent.repoId,
    branchId: intent.branchId ?? null,
    role: intent.role,
    storageProvider: intent.storageProvider,
    storageUri: intent.storageUri,
    contentType: intent.contentType,
    sha256: intent.sha256,
    crc32c: intent.crc32c ?? null,
    codec: intent.codec,
    container: intent.container,
    qualityProfile: intent.qualityProfile ?? null,
    bitrateKbps: intent.bitrateKbps,
    channelCount: intent.channelCount,
    sampleRate: intent.sampleRate,
    durationMs: intent.durationMs,
    byteLength: intent.byteLength,
    encryptionKeyRef: intent.encryptionKeyRef ?? null
  };
}

function downloadName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'ariadne-story';
}

function requestPathname(request: FastifyRequest): string {
  return new URL(request.url, 'http://ariadne.local').pathname;
}

function actionIdFromRequest(request: FastifyRequest): ActionId {
  const pathname = requestPathname(request);
  const method = request.method.toUpperCase();
  if (method === 'POST' && pathname === '/v1/provider/gemini/validate-key') return ACTION_ID.PROVIDER_VALIDATE_KEY;
  if (method === 'POST' && pathname === '/v1/provider/gemini/live-token') return ACTION_ID.PROVIDER_CREATE_LIVE_TOKEN;
  if (method === 'POST' && pathname === '/v1/provider/gemini/live-session/end') return ACTION_ID.PROVIDER_END_LIVE_SESSION;
  if (method === 'GET' && pathname === '/v1/repos') return ACTION_ID.STORY_LIST_REPOS;
  if (method === 'GET' && pathname === '/v1/story/latest') return ACTION_ID.STORY_GET_LATEST;
  if (method === 'GET' && pathname === '/v1/story-map') return ACTION_ID.STORY_GET_MAP;
  if (method === 'GET' && pathname === '/v1/story-search') return ACTION_ID.STORY_SEARCH;
  if (method === 'GET' && pathname === '/v1/branches/compare') return ACTION_ID.STORY_COMPARE_BRANCHES;
  if (method === 'POST' && pathname === '/v1/audio-assets/upload-url') return ACTION_ID.STORY_CREATE_AUDIO_UPLOAD;
  if (method === 'POST' && pathname === '/v1/audio-assets') return ACTION_ID.STORY_REGISTER_AUDIO_ASSET;
  if (method === 'GET' && /^\/v1\/repos\/[^/]+\/audio-assets\/[^/]+\/playback-url$/.test(pathname)) return ACTION_ID.STORY_CREATE_AUDIO_PLAYBACK_URL;
  if (method === 'POST' && pathname === '/v1/repos') return ACTION_ID.STORY_CREATE_REPO;
  if (method === 'POST' && pathname === '/v1/branches/fork') return ACTION_ID.STORY_FORK_BRANCH;
  if (method === 'GET' && pathname === '/v1/billing/me') return ACTION_ID.BILLING_GET_ENTITLEMENT;
  if (method === 'POST' && pathname === '/v1/billing/checkout-session') return ACTION_ID.BILLING_CHECKOUT_SESSION;
  if (method === 'POST' && pathname === '/v1/webhooks/stripe') return ACTION_ID.BILLING_STRIPE_WEBHOOK;
  if (method === 'POST' && pathname === '/v1/story/turn') return ACTION_ID.STORY_TURN;
  if (method === 'POST' && pathname === '/v1/story/turn/stream') return ACTION_ID.STORY_TURN_STREAM;
  if (method === 'POST' && pathname === '/v1/story/live-turn') return ACTION_ID.STORY_LIVE_TURN;
  if (method === 'GET' && /^\/v1\/repos\/[^/]+\/export$/.test(pathname)) return ACTION_ID.STORY_EXPORT_REPO;
  if (method === 'DELETE' && /^\/v1\/repos\/[^/]+$/.test(pathname)) return ACTION_ID.STORY_DELETE_REPO;
  if (method === 'GET' && /^\/v1\/repos\/[^/]+\/audio-assets$/.test(pathname)) return ACTION_ID.STORY_LIST_AUDIO_ASSETS;
  if (method === 'GET' && /^\/v1\/repos\/[^/]+$/.test(pathname)) return ACTION_ID.STORY_GET_REPO;
  if (method === 'GET' && /^\/v1\/branches\/[^/]+\/timeline$/.test(pathname)) return ACTION_ID.STORY_GET_TIMELINE;
  if (method === 'GET' && /^\/v1\/branches\/[^/]+\/canon$/.test(pathname)) return ACTION_ID.STORY_CANON_DEBUG;
  return ACTION_ID.HTTP_REQUEST;
}

async function resolveStoryUser(
  request: FastifyRequest,
  config: AppConfig,
  tokens: ActionTokenSet
): Promise<DecodedIdToken | null> {
  if (config.firebaseAuthRequired) {
    tokens.add(ACTION_TOKEN.AUTH_FIREBASE_REQUIRED);
    return requireFirebaseUserWithTokens(request, tokens);
  }

  tokens.add(ACTION_TOKEN.AUTH_FIREBASE_OPTIONAL);
  const bearer = getBearerToken(request.headers.authorization);
  if (bearer && looksLikeJwt(bearer)) return requireFirebaseUserWithTokens(request, tokens);
  return null;
}

async function requireFirebaseUserWithTokens(request: FastifyRequest, tokens: ActionTokenSet): Promise<DecodedIdToken> {
  try {
    const user = await requireFirebaseUser(request);
    tokens.add(ACTION_TOKEN.AUTH_FIREBASE_USER);
    return user;
  } catch (error) {
    if (error instanceof HttpError) {
      throw tokens.fail(error.message, error.statusCode, error.code, ACTION_TOKEN.AUTH_FIREBASE_MISSING);
    }
    throw error;
  }
}

function assertRepoAccess(repo: StoryRepo, user: DecodedIdToken | null, config: AppConfig, tokens: ActionTokenSet): void {
  if (!repo.ownerUserId) {
    if (config.firebaseAuthRequired) {
      throw tokens.fail(
        'This story repo has no owner and cannot be opened on the hosted deployment.',
        403,
        'repo_owner_required',
        ACTION_TOKEN.STORY_REPO_OWNER_REQUIRED
      );
    }
    tokens.add(ACTION_TOKEN.STORY_REPO_PUBLIC_DEV);
    return;
  }
  if (!user || repo.ownerUserId !== user.uid) {
    throw tokens.fail('You do not have access to this story repo.', 403, 'repo_access_denied', ACTION_TOKEN.STORY_REPO_ACCESS_DENIED);
  }
  tokens.add(ACTION_TOKEN.STORY_REPO_OWNER);
}

async function assertStoryAccess(
  store: StoryStore,
  repoId: string,
  branchId: string,
  user: DecodedIdToken | null,
  config: AppConfig,
  tokens: ActionTokenSet
): Promise<{ repo: StoryRepo; branch: BranchRef }> {
  const repo = await store.getRepo(repoId);
  if (!repo) throw tokens.fail(`repo not found: ${repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
  tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
  const branch = await store.getBranch(branchId);
  if (!branch) throw tokens.fail(`branch not found: ${branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
  tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
  if (branch.repoId !== repo.id) {
    throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
  }
  tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
  assertRepoAccess(repo, user, config, tokens);
  return { repo, branch };
}

type ProviderExecution =
  | {
      executionToken: typeof ACTION_TOKEN.PROVIDER_BYOK_KEY;
      providerKey: string;
      provider: StoryReasoningProvider;
      firebaseUser?: DecodedIdToken;
      lease?: undefined;
    }
  | {
      executionToken: typeof ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY;
      providerKey: string;
      provider: StoryReasoningProvider;
      firebaseUser: DecodedIdToken;
      lease: GeminiKeyLease;
    };

async function resolveProviderExecution(
  request: FastifyRequest,
  config: AppConfig,
  providers: ProviderRegistry,
  keyPool: GeminiServerKeyPool,
  tokens: ActionTokenSet
): Promise<ProviderExecution> {
  const byokKey = extractByokProviderKey(request, tokens);
  if (byokKey) {
    tokens.add(ACTION_TOKEN.PROVIDER_BYOK_KEY);
    const firebaseUser = await resolveStoryUser(request, config, tokens);
    return {
      executionToken: ACTION_TOKEN.PROVIDER_BYOK_KEY,
      providerKey: byokKey,
      provider: providers.forApiKey(byokKey),
      firebaseUser: firebaseUser ?? undefined
    };
  }

  if (!config.paidUsageEnabled) {
    throw tokens.fail(
      'Missing provider API key. Send x-ariadne-provider-key or sign in on a paid Ariadne deployment.',
      401,
      'provider_key_missing',
      ACTION_TOKEN.PROVIDER_KEY_MISSING,
      ACTION_TOKEN.BILLING_PAID_USAGE_DISABLED
    );
  }
  tokens.add(ACTION_TOKEN.BILLING_PAID_USAGE_ENABLED);

  const firebaseUser = await requireFirebaseUserWithTokens(request, tokens);
  const lease = keyPool.lease(firebaseUser.uid);
  tokens.add(ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY);
  return {
    executionToken: ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY,
    providerKey: lease.apiKey,
    provider: providers.forApiKey(lease.apiKey),
    firebaseUser,
    lease
  };
}

function extractByokProviderKey(request: FastifyRequest, tokens: ActionTokenSet): string | undefined {
  try {
    return extractOptionalProviderKey(request.headers);
  } catch (error) {
    if (error instanceof ProviderKeyError) {
      throw tokens.fail(error.message, error.code === 'missing' ? 401 : 400, `provider_key_${error.code}`, ...error.blockerTokens);
    }
    throw error;
  }
}

function hasPaidProviderAccess(
  access: ProviderExecution
): access is Extract<ProviderExecution, { executionToken: typeof ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY }> {
  return access.executionToken === ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY;
}

function billingModeFromAccess(access: ProviderExecution): 'byok' | 'paid' {
  return access.executionToken === ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY ? 'paid' : 'byok';
}

function throwTokenizedGateError(error: unknown, tokens: ActionTokenSet): void {
  if (error instanceof BillingError && error.blockerTokens.length) {
    throw tokens.fail(error.message, error.statusCode, error.code, ...error.blockerTokens);
  }
  if (error instanceof ProviderKeyError && error.blockerTokens.length) {
    throw tokens.fail(error.message, error.code === 'missing' ? 401 : 400, `provider_key_${error.code}`, ...error.blockerTokens);
  }
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
    tokens: ActionTokenSet;
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
        yield { ...event, tokens: options.tokens.snapshot() };
        continue;
      }
      yield event;
    }
  } catch (error) {
    failure = error;
    throwTokenizedGateError(error, options.tokens);
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
