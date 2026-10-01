import { pino, type Logger, type LoggerOptions } from 'pino';
import { getConfig } from './config';

/** Fields that must never reach logs (plan §24). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.apiKey',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
];

export function loggerOptions(service: string): LoggerOptions {
  const config = getConfig();
  const pretty = config.NODE_ENV === 'development' && process.stdout.isTTY;
  return {
    level: config.LOG_LEVEL,
    base: { service, env: config.APP_ENV },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
  };
}

export function createLogger(service: string): Logger {
  return pino(loggerOptions(service));
}

export type { Logger };
