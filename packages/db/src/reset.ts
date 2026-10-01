import { createLogger, initConfig } from '@selloeasy/core';
import { closeDb, getPool } from './client';

/** Drops everything (dev only). `pnpm db:reset` then re-migrates and re-seeds. */
await initConfig();
const log = createLogger('db-reset');
if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') {
  log.error('Refusing to reset a staging/production database');
  process.exit(1);
}
await getPool().query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
log.info('Database reset');
await closeDb();
