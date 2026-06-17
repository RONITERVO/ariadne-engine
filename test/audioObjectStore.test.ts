import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AudioStorageConfig } from '../src/config.js';
import type { AudioAsset, RegisterAudioAssetInput } from '../src/domain/types.js';
import {
  GcsAudioObjectStore,
  type GcsBucketClient,
  type GcsFileClient,
  type GcsObjectMetadata,
  type GcsStorageClient,
  type PrepareAudioUploadInput
} from '../src/storage/audioObjectStore.js';

function config(): AudioStorageConfig {
  return {
    gcsBucket: 'ariadne-audio-test',
    objectPrefix: 'live-audio',
    signedUrlTtlSeconds: 900,
    maxBytes: 10 * 1024 * 1024,
    defaultQualityProfile: 'voice-hifi',
    allowedQualityProfiles: ['voice-balanced', 'voice-hifi', 'music-hifi', 'aac-hifi']
  };
}

const uploadInput: PrepareAudioUploadInput = {
  repoId: 'repo-1',
  branchId: 'branch-1',
  role: 'user',
  contentType: 'audio/webm;codecs=opus',
  sha256: 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
  crc32c: 'AAAAAA==',
  codec: 'opus',
  container: 'webm',
  qualityProfile: 'voice-hifi',
  bitrateKbps: 96,
  channelCount: 1,
  sampleRate: 48000,
  durationMs: 250,
  byteLength: 12
};

test('GCS audio upload URLs are one-write, exact-size, cacheable, and quality-profile-bound', async () => {
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);

  const upload = await store.prepareUpload(uploadInput);
  const objectName = objectNameFromUri(upload.asset.storageUri);
  const file = storage.bucket('ariadne-audio-test').file(objectName) as FakeFile;

  assert.equal(upload.method, 'PUT');
  assert.match(upload.uploadUrl, /^https:\/\/storage\.example\//);
  assert.match(
    upload.asset.storageUri,
    /^gs:\/\/ariadne-audio-test\/live-audio\/repos\/repo-1\/branches\/branch-1\/user\/voice-hifi\/\d{4}-\d{2}-\d{2}\/uploads\/[0-9a-f-]{36}\.webm$/
  );
  assert.equal(upload.asset.contentType, 'audio/webm;codecs=opus');
  assert.equal(upload.asset.sha256, uploadInput.sha256.toLowerCase());
  assert.equal(upload.asset.crc32c, 'AAAAAA==');
  assert.equal(upload.asset.qualityProfile, 'voice-hifi');
  assert.equal(upload.asset.bitrateKbps, 96);
  assert.equal(upload.asset.channelCount, 1);
  assert.equal(upload.headers['content-type'], 'audio/webm;codecs=opus');
  assert.equal(upload.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(upload.headers['x-goog-content-length-range'], '12,12');
  assert.equal(upload.headers['x-goog-if-generation-match'], '0');
  assert.equal(upload.headers['x-goog-hash'], 'crc32c=AAAAAA==');
  assert.equal(upload.headers['x-goog-meta-ariadne-upload-id'], upload.uploadId);
  assert.equal(upload.headers['x-goog-meta-ariadne-content-type'], 'audio/webm;codecs=opus');
  assert.equal(upload.headers['x-goog-meta-ariadne-quality-profile'], 'voice-hifi');
  assert.equal(upload.headers['x-goog-meta-ariadne-bitrate-kbps'], '96');
  assert.equal(upload.headers['x-goog-meta-ariadne-channel-count'], '1');
  assert.equal(upload.headers['x-goog-meta-ariadne-byte-length'], '12');
  assert.equal(upload.qualityPolicy.profile, 'voice-hifi');
  assert.equal(upload.qualityPolicy.targetBitrateKbps, 96);
  assert.equal(file.signedUrlConfigs.length, 1);
  assert.equal(file.signedUrlConfigs[0].action, 'write');
  assert.equal(file.signedUrlConfigs[0].version, 'v4');
  assert.deepEqual(file.signedUrlConfigs[0].extensionHeaders, {
    'cache-control': 'private, max-age=31536000, immutable',
    'x-goog-content-length-range': '12,12',
    'x-goog-if-generation-match': '0',
    'x-goog-meta-ariadne-upload-id': upload.uploadId,
    'x-goog-meta-ariadne-repo-id': 'repo-1',
    'x-goog-meta-ariadne-branch-id': 'branch-1',
    'x-goog-meta-ariadne-role': 'user',
    'x-goog-meta-ariadne-content-type': 'audio/webm;codecs=opus',
    'x-goog-meta-ariadne-sha256': uploadInput.sha256.toLowerCase(),
    'x-goog-meta-ariadne-crc32c': 'AAAAAA==',
    'x-goog-meta-ariadne-codec': 'opus',
    'x-goog-meta-ariadne-container': 'webm',
    'x-goog-meta-ariadne-quality-profile': 'voice-hifi',
    'x-goog-meta-ariadne-bitrate-kbps': '96',
    'x-goog-meta-ariadne-channel-count': '1',
    'x-goog-meta-ariadne-byte-length': '12',
    'x-goog-meta-ariadne-duration-ms': '250',
    'x-goog-meta-ariadne-sample-rate': '48000',
    'x-goog-hash': 'crc32c=AAAAAA=='
  });
});

test('GCS audio verification checks metadata, content type, size, sha256 bytes, and returns object metadata', async () => {
  const bytes = Buffer.from('audio-bytes');
  const sha256 = sha256Hex(bytes);
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);
  const upload = await store.prepareUpload({ ...uploadInput, sha256, byteLength: bytes.byteLength });
  const file = storage.bucket('ariadne-audio-test').file(objectNameFromUri(upload.asset.storageUri)) as FakeFile;
  file.bytes = bytes;
  file.metadata = metadataFor(upload.asset, {
    size: bytes.byteLength,
    generation: '1718600000000000',
    metageneration: '1',
    crc32c: 'AAAAAA==',
    md5Hash: 'md5-base64',
    etag: 'opaque-etag',
    kmsKeyName: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
    updated: '2026-06-17T10:00:00.000Z'
  });

  const verified = await store.verifyUploadedAsset(upload.asset);

  assert.deepEqual(verified, {
    contentType: 'audio/webm;codecs=opus',
    byteLength: bytes.byteLength,
    crc32c: 'AAAAAA==',
    md5Hash: 'md5-base64',
    generation: '1718600000000000',
    metageneration: '1',
    etag: 'opaque-etag',
    encryptionKeyRef: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
    updatedAt: '2026-06-17T10:00:00.000Z'
  });
});

test('GCS audio playback URLs are signed read URLs scoped to the configured bucket and prefix', async () => {
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);
  const upload = await store.prepareUpload(uploadInput);
  const asset: AudioAsset = {
    id: 'asset-1',
    ...upload.asset,
    storageProvider: 'gcs',
    byteLength: upload.asset.byteLength,
    createdAt: new Date().toISOString()
  };
  const objectName = objectNameFromUri(asset.storageUri);
  const file = storage.bucket('ariadne-audio-test').file(objectName) as FakeFile;

  const playback = await store.createPlaybackUrl(asset);

  assert.equal(playback.method, 'GET');
  assert.match(playback.playbackUrl, /^https:\/\/storage\.example\//);
  assert.equal(playback.contentType, 'audio/webm;codecs=opus');
  assert.equal(playback.byteLength, 12);
  assert.equal(file.signedUrlConfigs.length, 2);
  assert.equal(file.signedUrlConfigs[1].action, 'read');
  assert.equal(file.signedUrlConfigs[1].version, 'v4');
});

test('GCS audio verification rejects a manifest whose sha256 does not match stored bytes', async () => {
  const bytes = Buffer.from('actual audio bytes');
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);
  const upload = await store.prepareUpload({
    ...uploadInput,
    sha256: sha256Hex(Buffer.from('claimed audio bytes')),
    byteLength: bytes.byteLength
  });
  const file = storage.bucket('ariadne-audio-test').file(objectNameFromUri(upload.asset.storageUri)) as FakeFile;
  file.bytes = bytes;
  file.metadata = metadataFor(upload.asset, { size: bytes.byteLength });

  await assert.rejects(() => store.verifyUploadedAsset(upload.asset), /SHA-256 does not match/);
});

test('GCS audio upload policy rejects uncompressed WAV by default', async () => {
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);

  await assert.rejects(
    () => store.prepareUpload({
      ...uploadInput,
      contentType: 'audio/wav',
      codec: 'pcm_s16le',
      container: 'wav'
    }),
    /must match quality profile/
  );
});

test('GCS audio upload policy rejects compressed files that exceed the duration byte budget', async () => {
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);

  await assert.rejects(
    () => store.prepareUpload({
      ...uploadInput,
      durationMs: 1000,
      byteLength: 1024 * 1024
    }),
    /byte budget/
  );
});

test('GCS audio deletion is scoped to the configured repo prefix', async () => {
  const storage = new FakeStorage();
  const store = new GcsAudioObjectStore(config(), storage);

  await store.deleteRepoObjects('repo/with unsafe spaces');

  assert.deepEqual(storage.bucket('ariadne-audio-test').deleteRequests, [
    { prefix: 'live-audio/repos/repo_with_unsafe_spaces/', force: true }
  ]);
});

function metadataFor(asset: RegisterAudioAssetInput, extra: Partial<GcsObjectMetadata> = {}): GcsObjectMetadata {
  return {
    contentType: asset.contentType ?? undefined,
    size: asset.byteLength,
    metadata: {
      'ariadne-upload-id': asset.uploadId ?? '',
      'ariadne-repo-id': asset.repoId,
      'ariadne-branch-id': asset.branchId ?? '',
      'ariadne-role': asset.role,
      'ariadne-content-type': asset.contentType ?? '',
      'ariadne-sha256': asset.sha256,
      'ariadne-crc32c': asset.crc32c ?? '',
      'ariadne-codec': asset.codec,
      'ariadne-container': asset.container,
      'ariadne-quality-profile': asset.qualityProfile ?? '',
      'ariadne-bitrate-kbps': String(asset.bitrateKbps),
      'ariadne-channel-count': String(asset.channelCount),
      'ariadne-byte-length': String(asset.byteLength),
      ...(asset.sampleRate !== undefined ? { 'ariadne-sample-rate': String(asset.sampleRate) } : {}),
      ...(asset.durationMs !== undefined ? { 'ariadne-duration-ms': String(asset.durationMs) } : {})
    },
    ...extra
  };
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function objectNameFromUri(uri: string): string {
  return uri.replace(/^gs:\/\/[^/]+\//, '');
}

class FakeStorage implements GcsStorageClient {
  private readonly buckets = new Map<string, FakeBucket>();

  bucket(name: string): FakeBucket {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new FakeBucket(name);
      this.buckets.set(name, bucket);
    }
    return bucket;
  }
}

class FakeBucket implements GcsBucketClient {
  readonly files = new Map<string, FakeFile>();
  readonly deleteRequests: Array<{ prefix: string; force?: boolean }> = [];

  constructor(readonly name: string) {}

  file(name: string): GcsFileClient {
    let file = this.files.get(name);
    if (!file) {
      file = new FakeFile(this.name, name);
      this.files.set(name, file);
    }
    return file;
  }

  async deleteFiles(options: { prefix: string; force?: boolean }): Promise<void> {
    this.deleteRequests.push(options);
  }
}

class FakeFile implements GcsFileClient {
  readonly signedUrlConfigs: Array<Record<string, unknown>> = [];
  metadata?: GcsObjectMetadata;
  bytes = Buffer.alloc(0);

  constructor(private readonly bucketName: string, private readonly objectName: string) {}

  async getSignedUrl(config: Record<string, unknown>): Promise<[string]> {
    this.signedUrlConfigs.push(config);
    return [`https://storage.example/${this.bucketName}/${encodeURIComponent(this.objectName)}`];
  }

  async getMetadata(): Promise<[GcsObjectMetadata]> {
    if (!this.metadata) throw Object.assign(new Error('not found'), { code: 404 });
    return [this.metadata];
  }

  createReadStream(): NodeJS.ReadableStream {
    return Readable.from([this.bytes]);
  }
}
