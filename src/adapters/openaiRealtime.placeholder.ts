import type {
  AudioChunk,
  ContextPatch,
  RealtimeVoiceAdapter,
  TranscriptDelta,
  VoiceSession,
  VoiceSessionConfig
} from './realtimeVoice.js';

/**
 * Placeholder provider adapter.
 *
 * Implement with the provider's WebRTC or WebSocket realtime API.
 * Keep this adapter thin: all story logic belongs in the domain/orchestrator layer.
 */
export class OpenAIRealtimeAdapter implements RealtimeVoiceAdapter {
  private transcriptCallbacks: Array<(delta: TranscriptDelta) => void> = [];
  private audioCallbacks: Array<(chunk: AudioChunk) => void> = [];

  async startSession(config: VoiceSessionConfig): Promise<VoiceSession> {
    return {
      id: config.sessionId,
      close: async () => this.close()
    };
  }

  async sendAudio(_chunk: AudioChunk): Promise<void> {
    throw new Error('Not implemented. Wire this to the realtime provider transport.');
  }

  async sendContextPatch(_patch: ContextPatch): Promise<void> {
    throw new Error('Not implemented. Send provider-specific session/update event here.');
  }

  onAssistantAudio(cb: (chunk: AudioChunk) => void): void {
    this.audioCallbacks.push(cb);
  }

  onTranscriptDelta(cb: (delta: TranscriptDelta) => void): void {
    this.transcriptCallbacks.push(cb);
  }

  async close(): Promise<void> {
    this.transcriptCallbacks = [];
    this.audioCallbacks = [];
  }
}
