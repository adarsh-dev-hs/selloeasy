import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_SECRET_PATTERN, parseConfig, readConnectorSecret } from '../src/config';

const base = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
};

describe('config (ADR-0012)', () => {
  it('auto-falls back to mock LLM mode when no OpenRouter key is set', () => {
    const c = parseConfig({ ...base, LLM_MODE: 'live' });
    expect(c.LLM_MODE).toBe('mock');
    expect(c.llmAutoMocked).toBe(true);
  });
  it('requires OPENROUTER_MODEL in live mode — no default model in code', () => {
    expect(() => parseConfig({ ...base, OPENROUTER_API_KEY: 'k' })).toThrow(/OPENROUTER_MODEL/);
    expect(parseConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'x/y' }).OPENROUTER_MODEL).toBe('x/y');
  });
  it('validates driver-specific keys', () => {
    expect(() => parseConfig({ ...base, MAIL_DRIVER: 'ses' })).toThrow(/SES_REGION/);
    expect(() => parseConfig({ ...base, SECRETS_SOURCE: 'aws-secrets-manager' })).toThrow(/AWS_SECRETS_ID/);
    expect(() => parseConfig({ ...base, STORAGE_DRIVER: 'minio', S3_ENDPOINT: '' })).toThrow(/S3_ENDPOINT/);
    expect(parseConfig({ ...base, STORAGE_DRIVER: 's3', S3_ENDPOINT: '' }).STORAGE_DRIVER).toBe('s3');
  });
  it('rejects insecure settings outside local', () => {
    expect(() => parseConfig({ ...base, APP_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });
});

describe('LLM provider auto-mock (plan2 §10.3)', () => {
  it.each([
    ['openai', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    ['openrouter', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
  ])('%s: mock without %s, live with it', (provider, keyVar, modelVar) => {
    const noKey = parseConfig({ ...base, LLM_MODE: 'live', LLM_PROVIDER: provider });
    expect(noKey.LLM_MODE).toBe('mock');
    expect(noKey.llmAutoMocked).toBe(true);
    expect(noKey.LLM_PROVIDER).toBe(provider);

    const withKey = parseConfig({ ...base, LLM_MODE: 'live', LLM_PROVIDER: provider, [keyVar]: 'k', [modelVar]: 'x/y' });
    expect(withKey.LLM_MODE).toBe('live');
    expect(withKey.llmAutoMocked).toBe(false);
  });

  it('only the selected provider\'s key counts', () => {
    const c = parseConfig({ ...base, LLM_MODE: 'live', LLM_PROVIDER: 'openai', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'x/y' });
    expect(c.LLM_MODE).toBe('mock');
    expect(c.llmAutoMocked).toBe(true);
  });

  it('a whitespace-only key still auto-mocks', () => {
    expect(parseConfig({ ...base, LLM_MODE: 'live', LLM_PROVIDER: 'openai', OPENAI_API_KEY: '   ' }).LLM_MODE).toBe('mock');
  });

  it('explicit mock mode is not reported as auto-mocked', () => {
    const c = parseConfig({ ...base, LLM_MODE: 'mock', LLM_PROVIDER: 'openai' });
    expect(c.LLM_MODE).toBe('mock');
    expect(c.llmAutoMocked).toBe(false);
  });

  it('live mode with a key but no model fails validation (ADR-0009: no default model)', () => {
    expect(() => parseConfig({ ...base, LLM_MODE: 'live', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toThrow(/OPENAI_MODEL/);
  });

  it('rejects a fallback provider equal to the primary', () => {
    expect(() =>
      parseConfig({ ...base, LLM_MODE: 'mock', LLM_PROVIDER: 'openai', LLM_FALLBACK_PROVIDER: 'openai' }),
    ).toThrow(/LLM_FALLBACK_PROVIDER/);
  });
});

describe('readConnectorSecret (plan2 §6.1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads CONNECTOR_* env vars', () => {
    vi.stubEnv('CONNECTOR_TEST_FEED_TOKEN', 'tok-123');
    expect(readConnectorSecret('CONNECTOR_TEST_FEED_TOKEN')).toBe('tok-123');
    expect(readConnectorSecret('CONNECTOR_TEST_NOT_SET_ANYWHERE')).toBeUndefined();
  });

  it.each(['JWT_ACCESS_SECRET', 'OPENAI_API_KEY', 'DATABASE_URL', 'connector_lower', 'CONNECTOR_', 'X_CONNECTOR_TOKEN', 'CONNECTOR_A-B'])(
    'refuses %s',
    (name) => {
      vi.stubEnv(name, 'secret-value');
      expect(() => readConnectorSecret(name)).toThrow(/CONNECTOR_/);
    },
  );

  it('pattern matches the DTO rule', () => {
    expect(CONNECTOR_SECRET_PATTERN.test('CONNECTOR_ABC_1')).toBe(true);
    expect(CONNECTOR_SECRET_PATTERN.test(`CONNECTOR_${'A'.repeat(61)}`)).toBe(false);
  });
});
