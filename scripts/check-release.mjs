import { existsSync, readFileSync } from 'node:fs';

const required = [
  'README.md',
  'SECURITY.md',
  'PRIVACY.md',
  'CONTRIBUTING.md',
  '.env.example',
  'package-lock.json',
  'Dockerfile',
  'cloudbuild.api.yaml',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
  'docs/BYOK_GOOGLE_AI_STUDIO.md',
  'docs/ADMIN_RUNBOOK.md',
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
const config = readFileSync('src/config.ts', 'utf8');
for (const phrase of ['/v1/story/turn/stream', 'rejectProviderSecretsInBody', 'rejectProviderSecretsInQuery', "app.get('/',", "app.get('/assets/*',"]) {
  if (!app.includes(phrase)) {
    console.error(`Server app is missing release guardrail/route: ${phrase}`);
    process.exit(1);
  }
}

const storyService = readFileSync('src/application/storyService.ts', 'utf8');
const storyStore = readFileSync('src/storage/firestoreStoryStore.ts', 'utf8') + readFileSync('src/storage/inMemoryStoryStore.ts', 'utf8');
for (const [phrase, contents] of [
  ['acquireBranchMutationLease', storyService],
  ['expectedHeadTurnId', storyService + storyStore + readFileSync('src/domain/validation.ts', 'utf8') + readme],
  ['cannot canonize a turn that is no longer the branch head', storyStore],
  ['branchHeadTurnId', app + readFileSync('web/src/app.ts', 'utf8')]
]) {
  if (!contents.includes(phrase)) {
    console.error(`Server app/story service is missing branch mutation guard: ${phrase}`);
    process.exit(1);
  }
}

const firebase = readFileSync('firebase.json', 'utf8') + readFileSync('firestore.rules', 'utf8');
for (const phrase of ['ariadne-api', '/v1/**', 'users/{userId}', 'billingAccounts/{accountId}', 'storyRepos/{document=**}', 'storyRepoIndex/{repoId}']) {
  if (!firebase.includes(phrase)) {
    console.error(`Firebase release config is missing: ${phrase}`);
    process.exit(1);
  }
}

const cloudbuild = readFileSync('cloudbuild.api.yaml', 'utf8');
for (const phrase of ['ariadne-api', 'ARIADNE_STORAGE=firestore', 'ARIADNE_BRANCH_TURN_LOCK_TTL_SECONDS=300', 'GEMINI_API_KEYS=gemini-api-keys:latest', 'STRIPE_SECRET_KEY=stripe-secret-key:latest', 'STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest']) {
  if (!cloudbuild.includes(phrase)) {
    console.error(`Cloud Run deploy config is missing: ${phrase}`);
    process.exit(1);
  }
}

for (const phrase of ['APP_URL is required in production', 'STRIPE_SECRET_KEY is required in production', 'STRIPE_WEBHOOK_SECRET is required in production']) {
  if (!config.includes(phrase)) {
    console.error(`Production config guard is missing: ${phrase}`);
    process.exit(1);
  }
}

const forbiddenFiles = [
  'docker-compose.yml',
  'db/schema.sql',
  'src/storage/postgresStoryStore.ts',
  'src/adapters/openaiRealtime.placeholder.ts',
  'src/adapters/realtimeVoice.ts'
];
const presentForbiddenFiles = forbiddenFiles.filter(path => existsSync(path));
if (presentForbiddenFiles.length) {
  console.error(`Legacy files should not exist:\n${presentForbiddenFiles.map(path => `- ${path}`).join('\n')}`);
  process.exit(1);
}

const packageJson = readFileSync('package.json', 'utf8');
for (const phrase of ['@fastify/websocket', '"pg"', '@types/pg']) {
  if (packageJson.includes(phrase)) {
    console.error(`package.json still includes legacy dependency: ${phrase}`);
    process.exit(1);
  }
}

for (const phrase of ['"build:web:firebase"', 'scripts/build-firebase-web.mjs', 'npm run build:web:firebase && firebase deploy --project ariadne-engine-rt --only hosting,firestore']) {
  if (!packageJson.includes(phrase)) {
    console.error(`package.json is missing Firebase Hosting deploy guard: ${phrase}`);
    process.exit(1);
  }
}

for (const [label, contents] of [
  ['server app', app],
  ['README', readme],
  ['provider key helper', readFileSync('src/security/providerKeys.ts', 'utf8')]
]) {
  for (const phrase of ['sessions/realtime', 'Backwards-compatible', 'Authorization: Bearer <key>', 'ARIADNE_ALLOW_UNSAFE_PRODUCTION']) {
    if (contents.includes(phrase)) {
      console.error(`${label} still includes legacy phrase: ${phrase}`);
      process.exit(1);
    }
  }
}

const webFirebase = readFileSync('web/src/firebase.ts', 'utf8');
for (const phrase of ['signInAnonymously', 'anonymous Firebase Auth is enabled']) {
  if ((webFirebase + readFileSync('docs/OPERATIONS.md', 'utf8') + readFileSync('docs/RELEASE_CHECKLIST.md', 'utf8')).includes(phrase)) {
    console.error(`Anonymous hosted auth must not be reintroduced: ${phrase}`);
    process.exit(1);
  }
}
for (const phrase of ['GoogleAuthProvider', 'signInWithRedirect', 'getRedirectResult', 'signInWithGoogle']) {
  if (!webFirebase.includes(phrase)) {
    console.error(`Firebase web auth is missing Google sign-in guard: ${phrase}`);
    process.exit(1);
  }
}

const adminRunbook = readFileSync('docs/ADMIN_RUNBOOK.md', 'utf8');
for (const phrase of ['https://console.firebase.google.com/project/ariadne-engine-rt/authentication/providers', 'https://console.cloud.google.com/run/detail/europe-west1/ariadne-api/metrics?project=ariadne-engine-rt', 'https://dashboard.stripe.com/webhooks', 'Anonymous Firebase Auth must stay disabled']) {
  if (!adminRunbook.includes(phrase)) {
    console.error(`Admin runbook is missing public operations guidance: ${phrase}`);
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
