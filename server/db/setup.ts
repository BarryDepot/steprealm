// Applies db/schema.sql to the database in DATABASE_URL.
//
// This runs through node-postgres rather than shelling out to `psql` so that
// it works identically on Windows, macOS and Linux, and does not require the
// PostgreSQL command-line tools to be installed or on PATH.

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Create the target database if it is not there yet.
 *
 * A fresh PostgreSQL install has no `steprealm` database, and CREATE DATABASE
 * cannot run from inside the database being created — so this connects to the
 * default `postgres` database to issue it. Saves a manual pgAdmin step on a
 * new machine. Hosted providers create the database for you, so a failure here
 * is not fatal; the real connection attempt that follows will report anything
 * that actually matters.
 */
async function ensureDatabaseExists(
  connectionString: string,
  ssl: { rejectUnauthorized: boolean } | undefined
): Promise<void> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return; // Not a URL we can pick apart — let the main connection report it.
  }

  const target = url.pathname.replace(/^\//, '');
  if (!target || target === 'postgres') return;

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString(), ssl });
  try {
    await admin.connect();
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (rowCount === 0) {
      // Identifier cannot be parameterised, so quote it explicitly. The value
      // comes from the developer's own .env, not from user input.
      await admin.query(`CREATE DATABASE "${target.replace(/"/g, '""')}"`);
      console.log(`Created database "${target}".`);
    }
  } catch {
    // Fall through — the main connection below produces the useful error.
  } finally {
    await admin.end().catch(() => {});
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

  await ensureDatabaseExists(connectionString, ssl);

  const client = new pg.Client({ connectionString, ssl });

  try {
    await client.connect();
  } catch (err) {
    console.error('Could not connect to the database.');
    console.error(err instanceof Error ? err.message : err);
    console.error('\nCheck that PostgreSQL is running and DATABASE_URL in .env is correct.');
    process.exit(1);
  }

  try {
    // The whole schema goes in one transaction: a partial apply would leave
    // tables referencing others that were never created.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Schema applied. Tables created:');
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    for (const row of rows) console.log('  -', row.tablename);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to apply schema:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
