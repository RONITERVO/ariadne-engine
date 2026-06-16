export interface AudioChunk {
  data: ArrayBuffer;
  mimeType: string;
  timestampMs: number;
}

export interface TranscriptDelta {
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  startMs?: number;
  endMs?: number;
}

export interface ContextPatch {
  instructions?: string;
  contextJson?: unknown;
}

export interface VoiceSessionConfig {
  sessionId: string;
  voice: string;
  instructions: string;
  metadata?: Record<string, string>;
}

export interface VoiceSession {
  id: string;
  close(): Promise<void>;
}

export interface RealtimeVoiceAdapter {
  startSession(config: VoiceSessionConfig): Promise<VoiceSession>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  sendContextPatch(patch: ContextPatch): Promise<void>;
  onAssistantAudio(cb: (chunk: AudioChunk) => void): void;
  onTranscriptDelta(cb: (delta: TranscriptDelta) => void): void;
  close(): Promise<void>;
}
