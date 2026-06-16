import { spawnSync } from 'node:child_process';

const project = process.env.FIREBASE_PROJECT || 'ariadne-engine-rt';
const webAppId = process.env.FIREBASE_WEB_APP_ID || '1:234362703129:web:8955fcac6bea60ee050988';

const sdkConfigOutput = run('firebase', ['apps:sdkconfig', 'WEB', webAppId, '--project', project, '--json'], {
  capture: true
});
const sdkConfig = JSON.parse(sdkConfigOutput).result?.sdkConfig;
if (!sdkConfig?.apiKey || !sdkConfig?.authDomain || !sdkConfig?.projectId || !sdkConfig?.appId) {
  throw new Error(`Firebase web app config is incomplete for project ${project}.`);
}
const hostingAuthDomain = process.env.FIREBASE_AUTH_DOMAIN || sdkConfig.authDomain;

console.log(`Building Firebase Hosting bundle for ${project}.`);
run('npm', ['run', 'build:web'], {
  env: {
    ...process.env,
    VITE_FIREBASE_API_KEY: sdkConfig.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: hostingAuthDomain,
    VITE_FIREBASE_PROJECT_ID: sdkConfig.projectId,
    VITE_FIREBASE_APP_ID: sdkConfig.appId,
    VITE_FIREBASE_STORAGE_BUCKET: sdkConfig.storageBucket || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: sdkConfig.messagingSenderId || '',
    VITE_DISABLE_FIREBASE_AUTH: 'false',
    VITE_ARIADNE_API_BASE: process.env.VITE_ARIADNE_API_BASE || ''
  }
});

function run(command, args, options = {}) {
  const commandLine = [command, ...args].map(quoteShellArg).join(' ');
  const result = process.platform === 'win32'
    ? spawnSync(commandLine, {
        cwd: process.cwd(),
        env: options.env || process.env,
        encoding: 'utf8',
        shell: true,
        stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
      })
    : spawnSync(command, args, {
        cwd: process.cwd(),
        env: options.env || process.env,
        encoding: 'utf8',
        stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
      });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.stdout || '';
}

function quoteShellArg(value) {
  const text = String(value);
  if (!/[\\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
