import { loadDotEnv } from '@selloeasy/core';

/**
 * Test environment: same Postgres/Redis as local dev but an isolated `<db>_test` database and Redis db 1.
 * CI provides DATABASE_URL/REDIS_URL via service containers.
 */
export function applyTestEnv() {
  loadDotEnv();
  const db = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://selloeasy:selloeasy@localhost:5432/selloeasy');
  if (!db.pathname.endsWith('_test')) db.pathname = `${db.pathname}_test`;
  const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  redis.pathname = '/1';
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: db.toString(),
    DATABASE_SSL: 'false',
    REDIS_URL: redis.toString(),
    LLM_MODE: 'mock',
    OPENROUTER_API_KEY: '',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghij',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdefghij',
    STORAGE_DRIVER: 'minio',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    MAIL_DRIVER: 'smtp',
    SEED_DEMO_DATA: 'true',
    RATE_LIMIT_MAX: '10000',
  });
}
