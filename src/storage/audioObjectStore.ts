import { createHash, randomUUID } from 'node:crypto';
import { Storage, type GetSignedUrlConfig } from '@google-cloud/storage';
import type { AudioStorageConfig } from '../config.js';
import {
  AUDIO_QUALITY_PROFILES,
  compatibleAudioProfile,
  maxBytesForAudioProfile,
  normalizeCodecName,
  normalizeContainerName,
  type AudioQualityProfile,
  type AudioQualityProfilePolicy
} from '../domain/audioQuality.js';
import type { AudioAsset, AudioObjectVerification, AudioRole, AudioUploadIntent, RegisterAudioAssetInput } from '../domain/types.js';
import { StoreError } from './storyStore.js';

const ONE_WRITE_PRECONDITION = '0';
const AUDIO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export interface PrepareAudioUploadInput {
  repoId: string;
  branchId?: string | null;
  turnId?: string | null;
  role: AudioRole;
  contentType: string;
  sha256: string;
  crc32c?: string | null;
  codec: string;
  container: string;
  qualityProfile?: AudioQualityProfile | null;
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength: number;
}

export interface PreparedAudioUpload {
  method: 'PUT';
  uploadUrl: string;
  uploadId: string;
  expiresAt: string;
  headers: Record<string, string>;
  asset: RegisterAudioAssetInput;
  maxBytes: number;
  qualityPolicy: PreparedAudioQualityPolicy;
}

export interface PreparedAudioPlayback {
  method: 'GET';
  playbackUrl: string;
  expiresAt: string;
  contentType?: string | null;
  byteLength?: number;
  durationMs?: number;
}

export interface PreparedAudioQualityPolicy {
  profile: AudioQualityProfile;
  codec: string;
  containers: readonly string[];
  contentTypes: readonly string[];
  targetBitrateKbps: number;
  maxBitrateKbps: number;
  maxSampleRate: number;
  maxChannelCount: number;
}

export interface AudioObjectStore {
  isEnabled(): boolean;
  prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload>;
  createPlaybackUrl(asset: AudioAsset): Promise<PreparedAudioPlayback>;
  verifyUploadedAsset(input: RegisterAudioAssetInput, intent?: AudioUploadIntent): Promise<AudioObjectVerification>;
  deleteRepoObjects(repoId: string): Promise<void>;
}

export class DisabledAudioObjectStore implements AudioObjectStore {
  isEnabled(): boolean {
    return false;
  }

  async prepareUpload(_input: PrepareAudioUploadInput): Promise<PreparedAudioUpload> {
    throw new StoreError('audio object storage is not configured', 'unavailable');
  }

  async createPlaybackUrl(_asset: AudioAsset): Promise<PreparedAudioPlayback> {
    throw new StoreError('audio object storage is not configured', 'unavailable');
  }

  async verifyUploadedAsset(input: RegisterAudioAssetInput): Promise<AudioObjectVerification> {
    return {
      byteLength: input.byteLength ?? 0,
      contentType: input.contentType ?? null,
      crc32c: input.crc32c ?? null,
      md5Hash: input.md5Hash ?? null,
      generation: input.gcsGeneration ?? null,
      metageneration: input.gcsMetageneration ?? null,
      etag: input.gcsEtag ?? null,
      encryptionKeyRef: input.encryptionKeyRef ?? null,
      updatedAt: input.uploadedAt ?? null
    };
  }

  async deleteRepoObjects(_repoId: string): Promise<void> {
    // No-op for local/dev deployments that only keep external manifests.
  }
}

export interface GcsStorageClient {
  bucket(name: string): GcsBucketClient;
}

export interface GcsBucketClient {
  file(name: string): GcsFileClient;
  deleteFiles(options: { prefix: string; force?: boolean }): Promise<void>;
}

export interface GcsFileClient {
  getSignedUrl(config: GetSignedUrlConfig): Promise<[string]>;
  getMetadata(): Promise<[GcsObjectMetadata, unknown?]>;
  createReadStream(options?: { decompress?: boolean; validation?: false }): NodeJS.ReadableStream;
}

export interface GcsObjectMetadata {
  contentType?: string;
  cacheControl?: string;
  size?: string | number;
  metadata?: Record<string, unknown>;
  generation?: string | number;
  metageneration?: string | number;
  crc32c?: string;
  md5Hash?: string;
  etag?: string;
  kmsKeyName?: string;
  updated?: string;
  timeCreated?: string;
}

export class GcsAudioObjectStore implements AudioObjectStore {
  private readonly storage: GcsStorageClient;
  private readonly bucketName: string | undefined;
  private readonly objectPrefix: string;

  constructor(
    private readonly config: AudioStorageConfig,
    storage: GcsStorageClient = new Storage()
  ) {
    this.storage = storage;
    this.bucketName = config.gcsBucket;
    this.objectPrefix = config.objectPrefix;
  }

  isEnabled(): boolean {
    return Boolean(this.bucketName);
  }

  async prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload> {
    if (!this.bucketName) throw new StoreError('audio object storage is not configured', 'unavailable');
    const normalized = this.normalizePrepareInput(input);
    const policy = this.policyFor(normalized.qualityProfile);
    const effectiveMaxBytes = this.effectiveMaxBytes(policy, normalized.durationMs);
    this.assertCostPolicy(normalized, policy, effectiveMaxBytes);

    const uploadId = randomUUID();
    const objectName = this.objectNameFor(normalized, uploadId);
    const storageUri = `gs://${this.bucketName}/${objectName}`;
    const expiresAtMs = Date.now() + this.config.signedUrlTtlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const headers = uploadHeaders(normalized, uploadId);
    const [uploadUrl] = await this.storage.bucket(this.bucketName).file(objectName).getSignedUrl({
      action: 'write',
      version: 'v4',
      expires: expiresAtMs,
      contentType: normalized.contentType,
      extensionHeaders: signedExtensionHeaders(headers)
    });

    return {
      method: 'PUT',
      uploadUrl,
      uploadId,
      expiresAt,
      headers,
      maxBytes: effectiveMaxBytes,
      qualityPolicy: publicPolicy(policy),
      asset: {
        uploadId,
        repoId: normalized.repoId,
        branchId: normalized.branchId ?? null,
        turnId: normalized.turnId ?? null,
        role: normalized.role,
        storageProvider: 'gcs',
        storageUri,
        contentType: normalized.contentType,
        sha256: normalized.sha256,
        crc32c: normalized.crc32c ?? null,
        codec: normalized.codec,
        container: normalized.container,
        qualityProfile: normalized.qualityProfile,
        bitrateKbps: normalized.bitrateKbps,
        channelCount: normalized.channelCount,
        sampleRate: normalized.sampleRate,
        durationMs: normalized.durationMs,
        byteLength: normalized.byteLength,
        encryptionKeyRef: null
      }
    };
  }

  async createPlaybackUrl(asset: AudioAsset): Promise<PreparedAudioPlayback> {
    if (!this.bucketName) throw new StoreError('audio object storage is not configured', 'unavailable');
    if (asset.storageProvider && asset.storageProvider !== 'gcs') {
      throw new StoreError('audio asset is not backed by GCS object storage', 'invalid');
    }
    const parsed = parseGcsUri(asset.storageUri);
    if (!parsed) throw new StoreError('audio storageUri must be a gs:// URI', 'invalid');
    if (parsed.bucket !== this.bucketName) {
      throw new StoreError('audio object is not in the configured GCS bucket', 'invalid');
    }
    if (this.objectPrefix && !parsed.objectName.startsWith(`${this.objectPrefix}/`)) {
      throw new StoreError('audio object is outside the configured GCS prefix', 'invalid');
    }

    const expiresAtMs = Date.now() + this.config.signedUrlTtlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const [playbackUrl] = await this.storage.bucket(parsed.bucket).file(parsed.objectName).getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: expiresAtMs
    });

    return {
      method: 'GET',
      playbackUrl,
      expiresAt,
      contentType: asset.contentType ?? null,
      byteLength: asset.byteLength,
      durationMs: asset.durationMs
    };
  }

  async verifyUploadedAsset(input: RegisterAudioAssetInput, intent?: AudioUploadIntent): Promise<AudioObjectVerification> {
    if (!this.bucketName) return new DisabledAudioObjectStore().verifyUploadedAsset(input);
    const expected = this.normalizeManifest(expectedManifest(input, intent));
    const policy = this.policyFor(expected.qualityProfile);
    const effectiveMaxBytes = this.effectiveMaxBytes(policy, expected.durationMs);
    this.assertCostPolicy(expected, policy, effectiveMaxBytes);

    const parsed = parseGcsUri(expected.storageUri);
    if (!parsed) throw new StoreError('audio storageUri must be a gs:// URI', 'invalid');
    if (parsed.bucket !== this.bucketName) {
      throw new StoreError('audio object is not in the configured GCS bucket', 'invalid');
    }
    if (this.objectPrefix && !parsed.objectName.startsWith(`${this.objectPrefix}/`)) {
      throw new StoreError('audio object is outside the configured GCS prefix', 'invalid');
    }

    const file = this.storage.bucket(parsed.bucket).file(parsed.objectName);
    const metadata = await this.readMetadata(file);
    const custom = metadata.metadata ?? {};
    const actualByteLength = metadataSize(metadata);
    if (actualByteLength !== expected.byteLength) {
      throw new StoreError('audio object byte length does not match upload intent', 'invalid');
    }
    const actualContentType = stringValue(metadata.contentType).toLowerCase();
    if (actualContentType !== expected.contentType) {
      throw new StoreError('audio object content type does not match upload intent', 'invalid');
    }

    if (expected.uploadId) assertMetadata(custom, 'ariadne-upload-id', expected.uploadId);
    assertMetadata(custom, 'ariadne-repo-id', expected.repoId);
    assertMetadata(custom, 'ariadne-branch-id', expected.branchId ?? '');
    assertMetadata(custom, 'ariadne-turn-id', expected.turnId ?? '');
    assertMetadata(custom, 'ariadne-role', expected.role);
    assertMetadata(custom, 'ariadne-content-type', expected.contentType);
    assertMetadata(custom, 'ariadne-sha256', expected.sha256);
    if (expected.crc32c) assertMetadata(custom, 'ariadne-crc32c', expected.crc32c);
    assertMetadata(custom, 'ariadne-codec', expected.codec);
    assertMetadata(custom, 'ariadne-container', expected.container);
    assertMetadata(custom, 'ariadne-quality-profile', expected.qualityProfile);
    assertMetadata(custom, 'ariadne-bitrate-kbps', String(expected.bitrateKbps));
    assertMetadata(custom, 'ariadne-channel-count', String(expected.channelCount));
    assertMetadata(custom, 'ariadne-byte-length', String(expected.byteLength));
    assertOptionalMetadata(custom, 'ariadne-sample-rate', expected.sampleRate);
    assertMetadata(custom, 'ariadne-duration-ms', String(expected.durationMs));

    const actualCrc32c = stringValue(metadata.crc32c);
    if (expected.crc32c && actualCrc32c && actualCrc32c !== expected.crc32c) {
      throw new StoreError('audio object CRC32C does not match upload intent', 'invalid');
    }
    const actualSha256 = await this.sha256(file);
    if (actualSha256 !== expected.sha256) {
      throw new StoreError('audio object SHA-256 does not match upload intent', 'invalid');
    }

    return {
      byteLength: actualByteLength,
      contentType: actualContentType || expected.contentType,
      crc32c: actualCrc32c || expected.crc32c || null,
      md5Hash: stringValue(metadata.md5Hash) || null,
      generation: stringValue(metadata.generation) || null,
      metageneration: stringValue(metadata.metageneration) || null,
      etag: stringValue(metadata.etag) || null,
      encryptionKeyRef: stringValue(metadata.kmsKeyName) || expected.encryptionKeyRef || null,
      updatedAt: stringValue(metadata.updated) || stringValue(metadata.timeCreated) || null
    };
  }

  async deleteRepoObjects(repoId: string): Promise<void> {
    if (!this.bucketName) return;
    const prefix = `${this.repoPrefixFor(repoId)}/`;
    try {
      await this.storage.bucket(this.bucketName).deleteFiles({ prefix, force: true });
    } catch (error) {
      throw new StoreError(`failed to delete audio objects for repo ${repoId}: ${messageFromError(error)}`, 'unavailable');
    }
  }

  private normalizePrepareInput(input: PrepareAudioUploadInput): NormalizedAudioInput {
    const base = normalizeCommonInput(input, this.config.defaultQualityProfile);
    return requireUploadCostFields(base);
  }

  private normalizeManifest(input: RegisterAudioAssetInput): NormalizedAudioManifest {
    return normalizeManifestInput(input, this.config.defaultQualityProfile);
  }

  private policyFor(profile: AudioQualityProfile): AudioQualityProfilePolicy {
    if (!this.config.allowedQualityProfiles.includes(profile)) {
      throw new StoreError(`audio quality profile ${profile} is not allowed by this deployment`, 'invalid');
    }
    return AUDIO_QUALITY_PROFILES[profile];
  }

  private effectiveMaxBytes(policy: AudioQualityProfilePolicy, durationMs: number): number {
    return Math.min(this.config.maxBytes, maxBytesForAudioProfile(policy, durationMs));
  }

  private assertCostPolicy(input: NormalizedAudioPolicyInput, policy: AudioQualityProfilePolicy, effectiveMaxBytes: number): void {
    if (!compatibleAudioProfile(policy, input)) {
      throw new StoreError(`audio must match quality profile ${policy.profile}: codec=${policy.codec}, containers=${policy.containers.join('|')}`, 'invalid');
    }
    if (input.durationMs <= 0) throw new StoreError('audio durationMs must be greater than zero for cost-managed storage', 'invalid');
    if (input.byteLength > this.config.maxBytes) {
      throw new StoreError(`audio object exceeds the configured ${this.config.maxBytes} byte limit`, 'invalid');
    }
    if (input.bitrateKbps > policy.maxBitrateKbps) {
      throw new StoreError(`audio bitrateKbps exceeds the ${policy.profile} limit of ${policy.maxBitrateKbps}`, 'invalid');
    }
    if (input.sampleRate !== undefined && input.sampleRate > policy.maxSampleRate) {
      throw new StoreError(`audio sampleRate exceeds the ${policy.profile} limit of ${policy.maxSampleRate}`, 'invalid');
    }
    if (input.channelCount > policy.maxChannelCount) {
      throw new StoreError(`audio channelCount exceeds the ${policy.profile} limit of ${policy.maxChannelCount}`, 'invalid');
    }
    if (input.byteLength > effectiveMaxBytes) {
      throw new StoreError(`audio object exceeds the ${policy.profile} byte budget of ${effectiveMaxBytes}`, 'invalid');
    }
  }

  private async readMetadata(file: GcsFileClient): Promise<GcsObjectMetadata> {
    try {
      const [metadata] = await file.getMetadata();
      return metadata;
    } catch (error) {
      if (isNotFoundError(error)) throw new StoreError('audio object has not been uploaded to GCS', 'not_found');
      throw new StoreError(`failed to read audio object metadata from GCS: ${messageFromError(error)}`, 'unavailable');
    }
  }

  private async sha256(file: GcsFileClient): Promise<string> {
    return hashReadable(file.createReadStream({ decompress: false, validation: false }));
  }

  private objectNameFor(input: NormalizedAudioInput, uploadId: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${safeObjectSegment(uploadId)}.${extensionFor(input.container, input.contentType)}`;
    return [
      this.repoPrefixFor(input.repoId),
      'branches',
      safeObjectSegment(input.branchId || '_repo'),
      input.role,
      input.qualityProfile,
      date,
      'uploads',
      filename
    ].filter(Boolean).join('/');
  }

  private repoPrefixFor(repoId: string): string {
    return [this.objectPrefix, 'repos', safeObjectSegment(repoId)].filter(Boolean).join('/');
  }
}

export function createAudioObjectStore(config: AudioStorageConfig): AudioObjectStore {
  return config.gcsBucket ? new GcsAudioObjectStore(config) : new DisabledAudioObjectStore();
}

type NormalizedAudioPolicyInput = {
  contentType: string;
  codec: string;
  container: string;
  qualityProfile: AudioQualityProfile;
  bitrateKbps: number;
  channelCount: number;
  sampleRate?: number;
  durationMs: number;
  byteLength: number;
};

type NormalizedAudioInput = Omit<PrepareAudioUploadInput, 'qualityProfile' | 'bitrateKbps' | 'channelCount' | 'durationMs' | 'crc32c'> & NormalizedAudioPolicyInput & {
  crc32c?: string | null;
};

type NormalizedAudioManifest = Omit<RegisterAudioAssetInput, 'qualityProfile' | 'bitrateKbps' | 'channelCount' | 'durationMs' | 'contentType' | 'byteLength' | 'crc32c'> & NormalizedAudioPolicyInput & {
  crc32c?: string | null;
};

type NormalizedCommonPrepareInput = PrepareAudioUploadInput & {
  contentType: string;
  sha256: string;
  codec: string;
  container: string;
  qualityProfile: AudioQualityProfile;
  bitrateKbps: number;
  channelCount: number;
  crc32c?: string | null;
};

type NormalizedCommonManifestInput = RegisterAudioAssetInput & {
  contentType: string;
  sha256: string;
  codec: string;
  container: string;
  qualityProfile: AudioQualityProfile;
  bitrateKbps: number;
  channelCount: number;
  crc32c?: string | null;
};

function uploadHeaders(input: NormalizedAudioInput, uploadId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': input.contentType,
    'cache-control': AUDIO_CACHE_CONTROL,
    'x-goog-content-length-range': `${input.byteLength},${input.byteLength}`,
    'x-goog-if-generation-match': ONE_WRITE_PRECONDITION,
    'x-goog-meta-ariadne-upload-id': uploadId,
    'x-goog-meta-ariadne-repo-id': input.repoId,
    'x-goog-meta-ariadne-branch-id': input.branchId ?? '',
    'x-goog-meta-ariadne-turn-id': input.turnId ?? '',
    'x-goog-meta-ariadne-role': input.role,
    'x-goog-meta-ariadne-content-type': input.contentType,
    'x-goog-meta-ariadne-sha256': input.sha256,
    'x-goog-meta-ariadne-codec': input.codec,
    'x-goog-meta-ariadne-container': input.container,
    'x-goog-meta-ariadne-quality-profile': input.qualityProfile,
    'x-goog-meta-ariadne-bitrate-kbps': String(input.bitrateKbps),
    'x-goog-meta-ariadne-channel-count': String(input.channelCount),
    'x-goog-meta-ariadne-byte-length': String(input.byteLength),
    'x-goog-meta-ariadne-duration-ms': String(input.durationMs)
  };
  if (input.crc32c) {
    headers['x-goog-hash'] = `crc32c=${input.crc32c}`;
    headers['x-goog-meta-ariadne-crc32c'] = input.crc32c;
  }
  if (input.sampleRate !== undefined) headers['x-goog-meta-ariadne-sample-rate'] = String(input.sampleRate);
  return headers;
}

function signedExtensionHeaders(headers: Record<string, string>): Record<string, string> {
  const { 'content-type': _contentType, ...extensionHeaders } = headers;
  return extensionHeaders;
}

function publicPolicy(policy: AudioQualityProfilePolicy): PreparedAudioQualityPolicy {
  return {
    profile: policy.profile,
    codec: policy.codec,
    containers: policy.containers,
    contentTypes: policy.contentTypes,
    targetBitrateKbps: policy.targetBitrateKbps,
    maxBitrateKbps: policy.maxBitrateKbps,
    maxSampleRate: policy.maxSampleRate,
    maxChannelCount: policy.maxChannelCount
  };
}

function normalizeCommonInput(input: PrepareAudioUploadInput, defaultProfile: AudioQualityProfile): NormalizedCommonPrepareInput;
function normalizeCommonInput(input: RegisterAudioAssetInput, defaultProfile: AudioQualityProfile): NormalizedCommonManifestInput;
function normalizeCommonInput(
  input: PrepareAudioUploadInput | RegisterAudioAssetInput,
  defaultProfile: AudioQualityProfile
): NormalizedCommonPrepareInput | NormalizedCommonManifestInput {
  const qualityProfile = input.qualityProfile ?? defaultProfile;
  const policy = AUDIO_QUALITY_PROFILES[qualityProfile];
  if (!policy) throw new StoreError(`audio quality profile ${String(input.qualityProfile)} is invalid`, 'invalid');
  return {
    ...input,
    repoId: normalizeMetadataValue(input.repoId, 'repoId'),
    branchId: input.branchId === undefined || input.branchId === null ? input.branchId : normalizeMetadataValue(input.branchId, 'branchId'),
    turnId: input.turnId === undefined || input.turnId === null ? input.turnId : normalizeMetadataValue(input.turnId, 'turnId'),
    contentType: normalizeHeaderValue(input.contentType ?? '', 'contentType').toLowerCase(),
    sha256: normalizeSha256(input.sha256),
    crc32c: normalizeOptionalCrc32c(input.crc32c),
    codec: normalizeMetadataValue(normalizeCodecName(input.codec), 'codec'),
    container: normalizeMetadataValue(normalizeContainerName(input.container), 'container'),
    qualityProfile,
    bitrateKbps: input.bitrateKbps ?? policy.targetBitrateKbps,
    channelCount: input.channelCount ?? Math.min(1, policy.maxChannelCount)
  };
}

function requireUploadCostFields(input: NormalizedCommonPrepareInput): NormalizedAudioInput {
  if (input.durationMs === undefined) throw new StoreError('audio durationMs is required for cost-managed storage', 'invalid');
  return {
    ...input,
    durationMs: assertSafeInt(input.durationMs, 'durationMs'),
    byteLength: assertSafeInt(input.byteLength, 'byteLength'),
    bitrateKbps: assertSafeInt(input.bitrateKbps, 'bitrateKbps'),
    channelCount: assertSafeInt(input.channelCount, 'channelCount'),
    sampleRate: input.sampleRate === undefined ? undefined : assertSafeInt(input.sampleRate, 'sampleRate')
  };
}

function normalizeManifestInput(input: RegisterAudioAssetInput, defaultProfile: AudioQualityProfile): NormalizedAudioManifest {
  if (!input.contentType) throw new StoreError('audio manifest contentType is required for GCS-backed registration', 'invalid');
  if (input.byteLength === undefined) throw new StoreError('audio manifest byteLength is required for GCS-backed registration', 'invalid');
  if (input.durationMs === undefined) throw new StoreError('audio manifest durationMs is required for GCS-backed registration', 'invalid');
  const normalized = normalizeCommonInput(input, defaultProfile);
  return {
    ...normalized,
    durationMs: assertSafeInt(input.durationMs, 'durationMs'),
    byteLength: assertSafeInt(input.byteLength, 'byteLength'),
    bitrateKbps: assertSafeInt(normalized.bitrateKbps, 'bitrateKbps'),
    channelCount: assertSafeInt(normalized.channelCount, 'channelCount'),
    sampleRate: normalized.sampleRate === undefined ? undefined : assertSafeInt(normalized.sampleRate, 'sampleRate')
  };
}

function expectedManifest(input: RegisterAudioAssetInput, intent?: AudioUploadIntent): RegisterAudioAssetInput {
  if (!intent) return input;
  return {
    uploadId: intent.id,
    repoId: intent.repoId,
    branchId: intent.branchId ?? null,
    turnId: intent.turnId ?? null,
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

async function hashReadable(stream: NodeJS.ReadableStream): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function assertMetadata(metadata: Record<string, unknown>, key: string, expected: string): void {
  const actual = metadataValue(metadata, key);
  if (actual !== expected) {
    throw new StoreError(`audio object metadata ${key} does not match upload intent`, 'invalid');
  }
}

function assertOptionalMetadata(metadata: Record<string, unknown>, key: string, expected: number | undefined): void {
  if (expected !== undefined) assertMetadata(metadata, key, String(expected));
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  return stringValue(metadata[key] ?? metadata[key.toLowerCase()]);
}

function parseGcsUri(uri: string): { bucket: string; objectName: string } | null {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], objectName: match[2] };
}

function safeObjectSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._=-]/g, '_').slice(0, 160) || '_';
}

function extensionFor(container: string, contentType: string): string {
  const normalizedContentType = contentType.toLowerCase().split(';', 1)[0].trim();
  if (normalizedContentType === 'audio/webm') return 'webm';
  if (normalizedContentType === 'audio/ogg' || normalizedContentType === 'application/ogg') return 'ogg';
  if (normalizedContentType === 'audio/mp4' || normalizedContentType === 'audio/aac' || normalizedContentType === 'audio/x-m4a') return 'm4a';
  if (normalizedContentType === 'audio/mpeg' || normalizedContentType === 'audio/mp3') return 'mp3';
  if (normalizedContentType === 'audio/flac' || normalizedContentType === 'audio/x-flac') return 'flac';
  const clean = container.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean ? clean.slice(0, 16) : 'bin';
}

function normalizeSha256(value: string): string {
  const normalized = normalizeMetadataValue(value, 'sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new StoreError('audio sha256 must be a 64-character lowercase hex digest', 'invalid');
  return normalized;
}

function normalizeOptionalCrc32c(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = normalizeHeaderValue(value, 'crc32c');
  if (!/^[A-Za-z0-9+/]{6}==$/.test(normalized)) throw new StoreError('audio crc32c must be base64-encoded big-endian CRC32C', 'invalid');
  return normalized;
}

function normalizeHeaderValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n\0]/.test(normalized)) throw new StoreError(`audio ${label} contains an invalid header value`, 'invalid');
  if (normalized.length > 512) throw new StoreError(`audio ${label} is too long`, 'invalid');
  return normalized;
}

function normalizeMetadataValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n\0]/.test(normalized)) throw new StoreError(`audio ${label} contains an invalid metadata value`, 'invalid');
  if (normalized.length > 1024) throw new StoreError(`audio ${label} is too long`, 'invalid');
  return normalized;
}

function assertSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new StoreError(`audio ${label} is invalid`, 'invalid');
  return value;
}

function metadataSize(metadata: GcsObjectMetadata): number {
  const parsed = Number(metadata.size);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new StoreError('audio object size metadata is invalid', 'invalid');
  return parsed;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === '404';
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
