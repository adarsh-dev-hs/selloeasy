import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, initConfig } from '@selloeasy/core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client';

/** Applies SQL migrations from ./drizzle. Used by the compose `migrate` service and the ECS migrate task. */
export async function runMigrations() {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
  await migrate(getDb(), { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await initConfig();
  const log = createLogger('migrate');
  try {
    await runMigrations();
    log.info('Migrations applied');
  } catch (err) {
    log.error({ err }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
