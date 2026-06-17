import { createHash, randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import type { AudioStorageConfig } from '../config.js';
import type { AudioObjectVerification, AudioRole, AudioUploadIntent, RegisterAudioAssetInput } from '../domain/types.js';
import { StoreError } from './storyStore.js';

export interface PrepareAudioUploadInput {
  repoId: string;
  branchId?: string | null;
  role: AudioRole;
  contentType: string;
  sha256: string;
  crc32c?: string | null;
  codec: string;
  container: string;
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
}

export interface AudioObjectStore {
  isEnabled(): boolean;
  prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload>;
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

  async verifyUploadedAsset(input: RegisterAudioAssetInput): Promise<AudioObjectVerification> {
    return {
      byteLength: input.byteLength ?? 0,
      contentType: input.contentType ?? null,
      crc32c: input.crc32c ?? null,
      md5Hash: input.md5Hash ?? null,
      generation: input.gcsGeneration ?? null,
      metageneration: input.gcsMetageneration ?? null,
      updatedAt: input.uploadedAt ?? null
    };
  }

  async deleteRepoObjects(_repoId: string): Promise<void> {
    // No-op for local/dev deployments that only keep external manifests.
  }
}

export class GcsAudioObjectStore implements AudioObjectStore {
  private readonly storage = new Storage();
  private readonly bucketName: string | undefined;
  private readonly objectPrefix: string;

  constructor(private readonly config: AudioStorageConfig) {
    this.bucketName = config.gcsBucket;
    this.objectPrefix = config.objectPrefix;
  }

  isEnabled(): boolean {
    return Boolean(this.bucketName);
  }

  async prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload> {
    if (!this.bucketName) throw new StoreError('audio object storage is not configured', 'unavailable');
    if (input.byteLength > this.config.maxBytes) {
      throw new StoreError(`audio object exceeds the configured ${this.config.maxBytes} byte limit`, 'invalid');
    }

    const uploadId = randomUUID();
    const objectName = this.objectNameFor(input, uploadId);
    const storageUri = `gs://${this.bucketName}/${objectName}`;
    const expiresAtMs = Date.now() + this.config.signedUrlTtlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const headers = uploadHeaders(input, uploadId);
    const [uploadUrl] = await this.storage.bucket(this.bucketName).file(objectName).getSignedUrl({
      action: 'write',
      version: 'v4',
      expires: expiresAtMs,
      contentType: input.contentType,
      extensionHeaders: signedExtensionHeaders(headers)
    });

    return {
      method: 'PUT',
      uploadUrl,
      uploadId,
      expiresAt,
      headers,
      maxBytes: this.config.maxBytes,
      asset: {
        uploadId,
        repoId: input.repoId,
        branchId: input.branchId ?? null,
        role: input.role,
        storageProvider: 'gcs',
        storageUri,
        contentType: input.contentType,
        sha256: input.sha256,
        crc32c: input.crc32c ?? null,
        codec: input.codec,
        container: input.container,
        sampleRate: input.sampleRate,
        durationMs: input.durationMs,
        byteLength: input.byteLength,
        encryptionKeyRef: null
      }
    };
  }

  async verifyUploadedAsset(input: RegisterAudioAssetInput, intent?: AudioUploadIntent): Promise<AudioObjectVerification> {
    if (!this.bucketName) return new DisabledAudioObjectStore().verifyUploadedAsset(input);
    const expected = expectedManifest(input, intent);
    const parsed = parseGcsUri(expected.storageUri);
    if (!parsed) throw new StoreError('audio storageUri must be a gs:// URI', 'invalid');
    if (parsed.bucket !== this.bucketName) {
      throw new StoreError('audio object is not in the configured GCS bucket', 'invalid');
    }
    if (this.objectPrefix && !parsed.objectName.startsWith(`${this.objectPrefix}/`)) {
      throw new StoreError('audio object is outside the configured GCS prefix', 'invalid');
    }

    const file = this.storage.bucket(parsed.bucket).file(parsed.objectName);
    const [exists] = await file.exists();
    if (!exists) throw new StoreError('audio object has not been uploaded to GCS', 'not_found');

    const [metadata] = await file.getMetadata();
    const custom = metadata.metadata ?? {};
    if (expected.uploadId) assertMetadata(custom, 'ariadne-upload-id', expected.uploadId);
    assertMetadata(custom, 'ariadne-repo-id', expected.repoId);
    assertMetadata(custom, 'ariadne-branch-id', expected.branchId ?? '');
    assertMetadata(custom, 'ariadne-role', expected.role);
    assertMetadata(custom, 'ariadne-sha256', expected.sha256);
    if (expected.crc32c) assertMetadata(custom, 'ariadne-crc32c', expected.crc32c);
    assertMetadata(custom, 'ariadne-codec', expected.codec);
    assertMetadata(custom, 'ariadne-container', expected.container);
    assertMetadata(custom, 'ariadne-byte-length', String(expected.byteLength ?? ''));
    assertMetadata(custom, 'ariadne-content-type', expected.contentType ?? '');

    const actualByteLength = Number(metadata.size ?? 0);
    if (expected.byteLength !== undefined && actualByteLength !== expected.byteLength) {
      throw new StoreError('audio object byte length does not match upload intent', 'invalid');
    }
    const actualContentType = stringValue(metadata.contentType);
    if (expected.contentType && actualContentType && actualContentType !== expected.contentType) {
      throw new StoreError('audio object content type does not match upload intent', 'invalid');
    }
    const actualCrc32c = stringValue(metadata.crc32c);
    if (expected.crc32c && actualCrc32c && actualCrc32c !== expected.crc32c) {
      throw new StoreError('audio object CRC32C does not match upload intent', 'invalid');
    }
    await assertObjectSha256(file, expected.sha256);

    return {
      byteLength: actualByteLength,
      contentType: actualContentType || expected.contentType || null,
      crc32c: actualCrc32c || expected.crc32c || null,
      md5Hash: stringValue(metadata.md5Hash) || null,
      generation: stringValue(metadata.generation) || null,
      metageneration: stringValue(metadata.metageneration) || null,
      updatedAt: stringValue(metadata.updated) || stringValue(metadata.timeCreated) || null
    };
  }


  async deleteRepoObjects(repoId: string): Promise<void> {
    if (!this.bucketName) return;
    const prefix = this.repoPrefixFor(repoId);
    await this.storage.bucket(this.bucketName).deleteFiles({ prefix, force: true });
  }

  private objectNameFor(input: PrepareAudioUploadInput, uploadId: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${safeObjectSegment(uploadId)}.${extensionFor(input.container, input.contentType)}`;
    return [
      this.repoPrefixFor(input.repoId),
      'branches',
      safeObjectSegment(input.branchId || '_repo'),
      input.role,
      date,
      'uploads',
      filename
    ].filter(Boolean).join('/');
  }

  private repoPrefixFor(repoId: string): string {
    return [this.objectPrefix, 'repos', safeObjectSegment(repoId)].filter(Boolean).join('/') + '/';
  }
}

export function createAudioObjectStore(config: AudioStorageConfig): AudioObjectStore {
  return config.gcsBucket ? new GcsAudioObjectStore(config) : new DisabledAudioObjectStore();
}

function uploadHeaders(input: PrepareAudioUploadInput, uploadId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': input.contentType,
    'x-goog-if-generation-match': '0',
    'x-goog-meta-ariadne-upload-id': uploadId,
    'x-goog-meta-ariadne-repo-id': input.repoId,
    'x-goog-meta-ariadne-branch-id': input.branchId ?? '',
    'x-goog-meta-ariadne-role': input.role,
    'x-goog-meta-ariadne-sha256': input.sha256,
    'x-goog-meta-ariadne-codec': input.codec,
    'x-goog-meta-ariadne-container': input.container,
    'x-goog-meta-ariadne-byte-length': String(input.byteLength),
    'x-goog-meta-ariadne-content-type': input.contentType
  };
  if (input.crc32c) {
    headers['x-goog-hash'] = `crc32c=${input.crc32c}`;
    headers['x-goog-meta-ariadne-crc32c'] = input.crc32c;
  }
  if (input.sampleRate !== undefined) headers['x-goog-meta-ariadne-sample-rate'] = String(input.sampleRate);
  if (input.durationMs !== undefined) headers['x-goog-meta-ariadne-duration-ms'] = String(input.durationMs);
  return headers;
}

function signedExtensionHeaders(headers: Record<string, string>): Record<string, string> {
  const { 'content-type': _contentType, ...extensionHeaders } = headers;
  return extensionHeaders;
}

function expectedManifest(input: RegisterAudioAssetInput, intent?: AudioUploadIntent): RegisterAudioAssetInput {
  if (!intent) return input;
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
    sampleRate: intent.sampleRate,
    durationMs: intent.durationMs,
    byteLength: intent.byteLength,
    encryptionKeyRef: intent.encryptionKeyRef ?? null
  };
}


async function assertObjectSha256(file: { createReadStream(): NodeJS.ReadableStream }, expectedSha256: string): Promise<void> {
  const actualSha256 = await hashReadable(file.createReadStream());
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new StoreError('audio object SHA-256 does not match upload intent', 'invalid');
  }
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
  const actual = metadata[key] ?? metadata[key.toLowerCase()];
  if (actual !== expected) {
    throw new StoreError(`audio object metadata ${key} does not match upload intent`, 'invalid');
  }
}

function parseGcsUri(uri: string): { bucket: string; objectName: string } | null {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], objectName: match[2] };
}

function safeObjectSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._=-]/g, '_').slice(0, 160) || '_';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extensionFor(container: string, contentType: string): string {
  const clean = container.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean) return clean.slice(0, 16);
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mpeg')) return 'mp3';
  return 'bin';
}
