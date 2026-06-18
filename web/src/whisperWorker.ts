import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

type InitMessage = {
  type: 'init';
  model: string;
};

type TranscribeMessage = {
  type: 'transcribe';
  id: number;
  audio: ArrayBuffer;
};

type MainToWorkerMessage = InitMessage | TranscribeMessage;

type WhisperLoadProfile = {
  label: string;
  dtype: 'fp32' | Record<string, 'fp32' | 'q4'>;
};

const DEFAULT_MODEL = 'onnx-community/whisper-tiny.en';
const LOAD_PROFILES: WhisperLoadProfile[] = [
  {
    label: 'q4',
    dtype: {
      encoder_model: 'q4',
      decoder_model_merged: 'q4'
    }
  },
  {
    label: 'fp32',
    dtype: 'fp32'
  }
];

let modelId = DEFAULT_MODEL;
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let activeProfile = LOAD_PROFILES[0].label;

env.allowLocalModels = false;

self.onmessage = event => {
  const message = event.data as MainToWorkerMessage;
  if (message.type === 'init') {
    modelId = message.model || DEFAULT_MODEL;
    void loadTranscriber();
    return;
  }
  void transcribe(message);
};

async function loadTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  transcriberPromise ??= loadFirstWorkingTranscriber();

  try {
    const transcriber = await transcriberPromise;
    self.postMessage({ type: 'ready', model: `${modelId}:${activeProfile}` });
    return transcriber;
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ type: 'error', message: messageFrom(error) });
    throw error;
  }
}

async function loadFirstWorkingTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  const errors: string[] = [];
  for (const profile of LOAD_PROFILES) {
    activeProfile = profile.label;
    self.postMessage({ type: 'loading', model: modelId, file: `wasm-${profile.label}` });
    try {
      return await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: profile.dtype,
        progress_callback: progress => {
          self.postMessage({
            type: 'loading',
            model: `${modelId}:${profile.label}`,
            file: 'file' in progress ? progress.file : undefined,
            progress: 'progress' in progress ? progress.progress : undefined
          });
        }
      });
    } catch (error) {
      errors.push(`${profile.label}: ${messageFrom(error)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function transcribe(message: TranscribeMessage): Promise<void> {
  try {
    const transcriber = await loadTranscriber();
    const startedAt = performance.now();
    const output = await transcriber(new Float32Array(message.audio), {
      max_new_tokens: 32
    });
    self.postMessage({
      type: 'result',
      id: message.id,
      text: output.text ?? '',
      elapsedMs: Math.round(performance.now() - startedAt)
    });
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: messageFrom(error) });
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return 'Unexpected worker error.';
}
