// Applies db/schema.sql to the database in DATABASE_URL.
//
// This runs through node-postgres rather than shelling out to `psql` so that
// it works identically on Windows, macOS and Linux, and does not require the
// PostgreSQL command-line tools to be installed or on PATH.
//
// Which database it targets is chosen by flag, not by editing .env:
//
//   npm run db:setup           → server/.env         (local)
//   npm run db:setup:remote    → server/.env.render  (hosted)
//
// Keeping the two connection strings in separate files means the destructive
// remote reset cannot be triggered by a stale edit left in .env.

import { config as loadEnv } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

const REMOTE = process.argv.includes('--remote');
const FORCE = process.argv.includes('--force');

const envFile = join(serverRoot, REMOTE ? '.env.render' : '.env');
if (!existsSync(envFile)) {
  const template = REMOTE ? '.env.render.example' : '.env.example';
  console.error(`Missing ${REMOTE ? 'server/.env.render' : 'server/.env'}.`);
  console.error(`Copy server/${template} to that name and fill it in.`);
  process.exit(1);
}
loadEnv({ path: envFile });

/**
 * The host a connection string points at, for display.
 *
 * Built by hand rather than by printing the URL, so that a password can never
 * reach the terminal or a screen recording. Returns null when the string is
 * not parseable — the caller falls back to refusing rather than guessing.
 */
function describeTarget(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '') || '(default)';
    const port = url.port ? `:${url.port}` : '';
    return `${url.hostname}${port}/${database}`;
  } catch {
    return null;
  }
}

/**
 * Ask for typed confirmation. Returns false on anything but exactly "yes".
 *
 * Closed stdin counts as a refusal. Without that check the question resolves
 * to nothing, the event loop drains, and the process exits 0 — reporting
 * success for a migration it never ran.
 */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('Not an interactive terminal, so the prompt cannot be answered.');
    console.error('Re-run with --force if you are certain:');
    console.error('  npm run db:setup:remote -- --force');
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

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
    const file = REMOTE ? 'server/.env.render' : 'server/.env';
    console.error(`DATABASE_URL is not set in ${file}.`);
    process.exit(1);
  }

  // Always say out loud what is about to be rewritten. Host and database name
  // only — never the credentials in front of them.
  const target = describeTarget(connectionString);
  if (!target) {
    console.error('DATABASE_URL could not be parsed, so the target cannot be');
    console.error('confirmed. Refusing to apply the schema to an unknown database.');
    process.exit(1);
  }

  console.log(`Environment : ${REMOTE ? 'REMOTE (hosted)' : 'local'}`);
  console.log(`Config file : ${REMOTE ? 'server/.env.render' : 'server/.env'}`);
  console.log(`Target      : ${target}`);
  console.log('');

  if (REMOTE && !FORCE) {
    console.log('!!  This DROPS AND RECREATES every table on the hosted database.  !!');
    console.log('!!  All player data on it — characters, inventories, XP, the step !!');
    console.log('!!  ledger and the event log — will be permanently destroyed.     !!');
    console.log('');
    const ok = await confirm('Type "yes" to continue: ');
    if (!ok) {
      console.log('Cancelled. Nothing was changed.');
      process.exit(1);
    }
    console.log('');
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
    console.error(REMOTE
      ? '\nCheck DATABASE_URL in server/.env.render. It must be Render\'s'
        + ' External\nDatabase URL — the Internal one resolves only from'
        + ' inside Render.'
      : '\nCheck that PostgreSQL is running and DATABASE_URL in server/.env'
        + ' is correct.');
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
