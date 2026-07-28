// PostgreSQL connection pool.
//
// A pool rather than single connections because every request needs a
// connection briefly and opening one per request would dominate the response
// time. Railway, Render and Supabase all provide a DATABASE_URL, so that is
// the only configuration this needs.

// Loaded here rather than only in index.ts because the tests import the app
// directly, bypassing the server entry point. Without this `npm test` fails
// with "DATABASE_URL is not set" even when .env is present.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
}

export const pool = new Pool({
  connectionString,
  // Hosted Postgres requires TLS; a local development database does not.
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type Db = pg.PoolClient;

/**
 * Run a set of queries inside a single transaction.
 *
 * Step ingestion touches five tables — the player row, skills, inventory, the
 * running activity and the ledger. If any one of those failed midway the
 * player would be left with resources they did not earn, or steps deducted for
 * nothing, so the whole batch has to commit or roll back together.
 */
export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
