import { existsSync, readFileSync } from 'node:fs';

const required = [
  'README.md',
  'SECURITY.md',
  'PRIVACY.md',
  '.env.example',
  'package-lock.json',
  'Dockerfile',
  'docker-compose.yml',
  'cloudbuild.api.yaml',
  'db/schema.sql',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
  'docs/BYOK_GOOGLE_AI_STUDIO.md',
  'docs/RELEASE_CHECKLIST.md',
  'docs/THREAT_MODEL.md',
  'web/index.html',
  'web/tsconfig.json',
  'src/server/app.ts',
  'src/adapters/geminiProvider.ts'
];

const missing = required.filter(path => !existsSync(path));
if (missing.length) {
  console.error(`Missing release files:\n${missing.map(path => `- ${path}`).join('\n')}`);
  process.exit(1);
}

const readme = readFileSync('README.md', 'utf8');
for (const phrase of ['BYOK', 'Google AI Studio', 'event ledger', 'transcript-only', 'not persisted']) {
  if (!readme.includes(phrase)) {
    console.error(`README is missing required phrase: ${phrase}`);
    process.exit(1);
  }
}

const app = readFileSync('src/server/app.ts', 'utf8');
for (const phrase of ['/v1/story/turn/stream', 'rejectProviderSecretsInBody', 'rejectProviderSecretsInQuery', "app.get('/',", "app.get('/assets/*',"]) {
  if (!app.includes(phrase)) {
    console.error(`Server app is missing release guardrail/route: ${phrase}`);
    process.exit(1);
  }
}

const firebase = readFileSync('firebase.json', 'utf8') + readFileSync('firestore.rules', 'utf8');
for (const phrase of ['ariadne-api', '/v1/**', 'entitlements/{userId}', 'usage/{userId}']) {
  if (!firebase.includes(phrase)) {
    console.error(`Firebase release config is missing: ${phrase}`);
    process.exit(1);
  }
}

const cloudbuild = readFileSync('cloudbuild.api.yaml', 'utf8');
for (const phrase of ['ariadne-api', 'ARIADNE_STORAGE=firestore', 'GEMINI_API_KEYS=gemini-api-keys:latest']) {
  if (!cloudbuild.includes(phrase)) {
    console.error(`Cloud Run deploy config is missing: ${phrase}`);
    process.exit(1);
  }
}

const web = readFileSync('web/index.html', 'utf8') + readFileSync('web/src/app.ts', 'utf8');
for (const phrase of ['Sign in for credits or paste a Gemini key', 'transcript', 'SpeechRecognition', 'GoogleGenAI', 'sendRealtimeInput']) {
  if (!web.includes(phrase)) {
    console.error(`Transcript-only web app is missing: ${phrase}`);
    process.exit(1);
  }
}

console.log('Release checklist files and guardrails are present.');
