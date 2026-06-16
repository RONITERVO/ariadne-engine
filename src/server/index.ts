import 'dotenv/config';
import { loadConfig } from '../config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
