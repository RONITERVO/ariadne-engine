export const AUDIO_QUALITY_PROFILE_NAMES = [
  'voice-balanced',
  'voice-hifi',
  'music-hifi',
  'aac-hifi',
  'lossless-master'
] as const;

export type AudioQualityProfile = (typeof AUDIO_QUALITY_PROFILE_NAMES)[number];

export interface AudioQualityProfilePolicy {
  profile: AudioQualityProfile;
  label: string;
  codec: string;
  containers: readonly string[];
  contentTypes: readonly string[];
  targetBitrateKbps: number;
  maxBitrateKbps: number;
  maxSampleRate: number;
  maxChannelCount: number;
  description: string;
}

export const AUDIO_QUALITY_PROFILES: Record<AudioQualityProfile, AudioQualityProfilePolicy> = {
  'voice-balanced': {
    profile: 'voice-balanced',
    label: 'Balanced voice Opus',
    codec: 'opus',
    containers: ['webm', 'ogg'],
    contentTypes: ['audio/webm', 'audio/ogg', 'application/ogg'],
    targetBitrateKbps: 64,
    maxBitrateKbps: 80,
    maxSampleRate: 48_000,
    maxChannelCount: 1,
    description: 'Low-cost mono speech archive for normal playback.'
  },
  'voice-hifi': {
    profile: 'voice-hifi',
    label: 'Hi-fi voice Opus',
    codec: 'opus',
    containers: ['webm', 'ogg'],
    contentTypes: ['audio/webm', 'audio/ogg', 'application/ogg'],
    targetBitrateKbps: 96,
    maxBitrateKbps: 128,
    maxSampleRate: 48_000,
    maxChannelCount: 1,
    description: 'Default high-quality spoken-audio archive profile without PCM-sized storage cost.'
  },
  'music-hifi': {
    profile: 'music-hifi',
    label: 'Hi-fi music Opus',
    codec: 'opus',
    containers: ['webm', 'ogg'],
    contentTypes: ['audio/webm', 'audio/ogg', 'application/ogg'],
    targetBitrateKbps: 160,
    maxBitrateKbps: 192,
    maxSampleRate: 48_000,
    maxChannelCount: 2,
    description: 'Higher ceiling for stereo music or mixed program audio.'
  },
  'aac-hifi': {
    profile: 'aac-hifi',
    label: 'Hi-fi AAC fallback',
    codec: 'aac',
    containers: ['mp4', 'm4a', 'aac'],
    contentTypes: ['audio/mp4', 'audio/aac', 'audio/x-m4a'],
    targetBitrateKbps: 128,
    maxBitrateKbps: 160,
    maxSampleRate: 48_000,
    maxChannelCount: 2,
    description: 'Browser fallback profile for clients that cannot encode Opus.'
  },
  'lossless-master': {
    profile: 'lossless-master',
    label: 'Lossless master',
    codec: 'flac',
    containers: ['flac'],
    contentTypes: ['audio/flac', 'audio/x-flac'],
    targetBitrateKbps: 700,
    maxBitrateKbps: 1_200,
    maxSampleRate: 96_000,
    maxChannelCount: 2,
    description: 'Opt-in archival master. Excluded from the default allowed production set because it is expensive.'
  }
};

export const DEFAULT_AUDIO_QUALITY_PROFILE: AudioQualityProfile = 'voice-hifi';
export const DEFAULT_ALLOWED_AUDIO_QUALITY_PROFILES: AudioQualityProfile[] = ['voice-balanced', 'voice-hifi', 'music-hifi', 'aac-hifi'];

const PROFILE_SET = new Set<string>(AUDIO_QUALITY_PROFILE_NAMES);

export function isAudioQualityProfile(value: string): value is AudioQualityProfile {
  return PROFILE_SET.has(value);
}

export function parseAudioQualityProfile(value: string | undefined, fallback: AudioQualityProfile = DEFAULT_AUDIO_QUALITY_PROFILE): AudioQualityProfile {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (!isAudioQualityProfile(normalized)) {
    throw new Error(`Invalid audio quality profile "${normalized}". Expected one of: ${AUDIO_QUALITY_PROFILE_NAMES.join(', ')}`);
  }
  return normalized;
}

export function parseAllowedAudioQualityProfiles(value: string | undefined): AudioQualityProfile[] {
  const raw = value?.trim();
  if (!raw) return [...DEFAULT_ALLOWED_AUDIO_QUALITY_PROFILES];
  const parsed: AudioQualityProfile[] = [];
  for (const part of raw.split(',')) {
    const profile = parseAudioQualityProfile(part.trim());
    if (!parsed.includes(profile)) parsed.push(profile);
  }
  return parsed.length ? parsed : [...DEFAULT_ALLOWED_AUDIO_QUALITY_PROFILES];
}

export function contentTypeBase(contentType: string): string {
  return contentType.toLowerCase().split(';', 1)[0].trim();
}

export function normalizeCodecName(codec: string): string {
  const normalized = codec.toLowerCase().trim();
  if (normalized === 'mp4a.40.2' || normalized === 'aac-lc') return 'aac';
  return normalized;
}

export function normalizeContainerName(container: string): string {
  const normalized = container.toLowerCase().trim();
  if (normalized === 'm4a') return 'mp4';
  return normalized;
}

export function compatibleAudioProfile(policy: AudioQualityProfilePolicy, input: {
  contentType: string;
  codec: string;
  container: string;
}): boolean {
  return (
    policy.contentTypes.includes(contentTypeBase(input.contentType)) &&
    normalizeCodecName(input.codec) === policy.codec &&
    policy.containers.includes(normalizeContainerName(input.container))
  );
}

export function maxBytesForAudioProfile(policy: AudioQualityProfilePolicy, durationMs: number): number {
  const durationSeconds = Math.max(0, durationMs) / 1000;
  const encodedBytes = Math.ceil((durationSeconds * policy.maxBitrateKbps * 1000) / 8);
  const muxOverheadBytes = 16 * 1024 + Math.ceil(encodedBytes * 0.2);
  return encodedBytes + muxOverheadBytes;
}
