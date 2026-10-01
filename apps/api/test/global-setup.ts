import { createRedis, resetConfigForTests, setStorageForTests } from '@selloeasy/core';
import { closeDb } from '@selloeasy/db';
import pg from 'pg';
import { applyTestEnv } from './env';
import { memoryStorage } from './memory-storage';

/** Recreate the test database, migrate and seed it once per test run. */
export default async function setup() {
  applyTestEnv();
  resetConfigForTests();
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`drop database if exists "${dbName}" with (force)`);
  await client.query(`create database "${dbName}"`);
  await client.end();

  const redis = createRedis();
  await redis.flushdb();
  await redis.quit();

  setStorageForTests(memoryStorage());
  const { runMigrations } = await import('@selloeasy/db/migrate');
  await runMigrations();
  const { runSeed } = await import('@selloeasy/seed');
  const { createLogger } = await import('@selloeasy/core');
  await runSeed(createLogger('test-seed'));
  await closeDb();
}
