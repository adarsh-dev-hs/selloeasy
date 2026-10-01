import { createLogger, initConfig } from '@selloeasy/core';
import { closeDb } from '@selloeasy/db';
import { runSeed } from './seed';

await initConfig();
const log = createLogger('seed');
try {
  await runSeed(log);
} catch (err) {
  log.error({ err }, 'Seed failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
