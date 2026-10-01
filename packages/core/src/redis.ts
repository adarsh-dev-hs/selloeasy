import { Redis, type RedisOptions } from 'ioredis';
import { getConfig } from './config';

/**
 * Redis connections. BullMQ needs `maxRetriesPerRequest: null` on worker connections.
 * ElastiCache in-transit encryption: use a `rediss://` URL or REDIS_TLS=true.
 */
export function redisOptions(): RedisOptions {
  const config = getConfig();
  const tls = config.REDIS_TLS || config.REDIS_URL.startsWith('rediss://');
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(tls ? { tls: {} } : {}),
  };
}

export function createRedis(overrides: RedisOptions = {}): Redis {
  return new Redis(getConfig().REDIS_URL, { ...redisOptions(), ...overrides });
}

export type { Redis };
