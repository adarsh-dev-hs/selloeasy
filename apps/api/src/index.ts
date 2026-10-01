import { closeQueues, initConfig } from '@selloeasy/core';
import { closeDb } from '@selloeasy/db';
import { buildServer } from './server';

const config = await initConfig();
const app = await buildServer();

if (config.llmAutoMocked) {
  app.log.warn({ provider: config.LLM_PROVIDER }, 'No API key for the selected LLM provider — running with LLM_MODE=mock. Set it in .env for live AI.');
} else {
  app.log.info({ mode: config.LLM_MODE, provider: app.llm.providerId, model: app.llm.model }, 'LLM configured');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
    await closeQueues();
    await closeDb();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.API_PORT });
