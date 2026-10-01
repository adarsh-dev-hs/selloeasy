import { existsSync, readFileSync } from 'node:fs';
import { getConfig } from '@selloeasy/core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

let pool: pg.Pool | undefined;
let db: Database | undefined;

function sslConfig(): pg.PoolConfig['ssl'] {
  const c = getConfig();
  if (!c.DATABASE_SSL) return undefined;
  // RDS: verify against the AWS RDS CA bundle baked into the image (see Dockerfiles).
  if (existsSync(c.DATABASE_SSL_CA_FILE)) {
    return { rejectUnauthorized: true, ca: readFileSync(c.DATABASE_SSL_CA_FILE, 'utf8') };
  }
  return { rejectUnauthorized: false };
}

export function getPool(): pg.Pool {
  if (!pool) {
    const c = getConfig();
    pool = new pg.Pool({
      connectionString: c.DATABASE_URL,
      max: c.DATABASE_POOL_MAX,
      ssl: sslConfig(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!db) db = drizzle(getPool(), { schema, casing: 'snake_case' });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  db = undefined;
}

export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query('select 1');
    return true;
  } catch {
    return false;
  }
}
