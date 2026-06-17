import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import type { AudioStorageConfig } from '../config.js';
import type { AudioRole, RegisterAudioAssetInput } from '../domain/types.js';
import { StoreError } from './storyStore.js';

export interface PrepareAudioUploadInput {
  repoId: string;
  branchId?: string | null;
  role: AudioRole;
  contentType: string;
  sha256: string;
  codec: string;
  container: string;
  sampleRate?: number;
  durationMs?: number;
  byteLength: number;
}

export interface PreparedAudioUpload {
  method: 'PUT';
  uploadUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
  asset: RegisterAudioAssetInput;
  maxBytes: number;
}

export interface AudioObjectStore {
  isEnabled(): boolean;
  prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload>;
  verifyUploadedAsset(input: RegisterAudioAssetInput): Promise<void>;
}

export class DisabledAudioObjectStore implements AudioObjectStore {
  isEnabled(): boolean {
    return false;
  }

  async prepareUpload(_input: PrepareAudioUploadInput): Promise<PreparedAudioUpload> {
    throw new StoreError('audio object storage is not configured', 'unavailable');
  }

  async verifyUploadedAsset(_input: RegisterAudioAssetInput): Promise<void> {
    return;
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

    const objectName = this.objectNameFor(input);
    const storageUri = `gs://${this.bucketName}/${objectName}`;
    const expiresAtMs = Date.now() + this.config.signedUrlTtlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const headers = uploadHeaders(input);
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
      expiresAt,
      headers,
      maxBytes: this.config.maxBytes,
      asset: {
        repoId: input.repoId,
        branchId: input.branchId ?? null,
        role: input.role,
        storageUri,
        sha256: input.sha256,
        codec: input.codec,
        container: input.container,
        sampleRate: input.sampleRate,
        durationMs: input.durationMs,
        byteLength: input.byteLength,
        encryptionKeyRef: null
      }
    };
  }

  async verifyUploadedAsset(input: RegisterAudioAssetInput): Promise<void> {
    if (!this.bucketName) return;
    const parsed = parseGcsUri(input.storageUri);
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
    assertMetadata(custom, 'ariadne-repo-id', input.repoId);
    assertMetadata(custom, 'ariadne-branch-id', input.branchId ?? '');
    assertMetadata(custom, 'ariadne-role', input.role);
    assertMetadata(custom, 'ariadne-sha256', input.sha256);
    assertMetadata(custom, 'ariadne-codec', input.codec);
    assertMetadata(custom, 'ariadne-container', input.container);
    if (input.byteLength !== undefined && Number(metadata.size ?? 0) !== input.byteLength) {
      throw new StoreError('audio object byte length does not match manifest', 'invalid');
    }
  }

  private objectNameFor(input: PrepareAudioUploadInput): string {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${Date.now()}-${randomUUID()}.${extensionFor(input.container, input.contentType)}`;
    const parts = [
      this.objectPrefix,
      'repos',
      safeObjectSegment(input.repoId),
      'branches',
      safeObjectSegment(input.branchId || '_repo'),
      input.role,
      date,
      filename
    ].filter(Boolean);
    return parts.join('/');
  }
}

export function createAudioObjectStore(config: AudioStorageConfig): AudioObjectStore {
  return config.gcsBucket ? new GcsAudioObjectStore(config) : new DisabledAudioObjectStore();
}

function uploadHeaders(input: PrepareAudioUploadInput): Record<string, string> {
  return {
    'content-type': input.contentType,
    'x-goog-meta-ariadne-repo-id': input.repoId,
    'x-goog-meta-ariadne-branch-id': input.branchId ?? '',
    'x-goog-meta-ariadne-role': input.role,
    'x-goog-meta-ariadne-sha256': input.sha256,
    'x-goog-meta-ariadne-codec': input.codec,
    'x-goog-meta-ariadne-container': input.container
  };
}

function signedExtensionHeaders(headers: Record<string, string>): Record<string, string> {
  const { 'content-type': _contentType, ...extensionHeaders } = headers;
  return extensionHeaders;
}

function assertMetadata(metadata: Record<string, unknown>, key: string, expected: string): void {
  const actual = metadata[key] ?? metadata[key.toLowerCase()];
  if (actual !== expected) {
    throw new StoreError(`audio object metadata ${key} does not match manifest`, 'invalid');
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

function extensionFor(container: string, contentType: string): string {
  const clean = container.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean) return clean.slice(0, 16);
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mpeg')) return 'mp3';
  return 'bin';
}
