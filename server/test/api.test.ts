// Integration tests.
//
// These cover the path the proposal names in its Evaluation section: reading a
// batch of steps, spending them on an activity, and persisting the updated
// game state. Unlike the unit tests these run against a real PostgreSQL
// database, because the thing being tested is precisely the round trip.
//
// Requires DATABASE_URL to point at a database with db/schema.sql applied.
// The suite creates its own players and does not touch existing rows.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

import { createApp } from '../src/app';
import { pool, closePool } from '../src/db';

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port assigned');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closePool();
});

// --- helpers ---------------------------------------------------------------

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() as any };
}

async function newPlayer(name = 'IntegrationTest') {
  const res = await api('POST', '/api/players', { name });
  assert.equal(res.status, 201);
  return res.body.playerId as string;
}

const countOf = (player: any, item: string) =>
  player.inventory.find((e: any) => e.item === item)?.count ?? 0;

// --- tests -----------------------------------------------------------------

describe('health', () => {
  test('reports the database is reachable', async () => {
    const res = await api('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.db, 'up');
  });
});

describe('player creation', () => {
  test('a new player starts at level 1 in every skill with starter tools', async () => {
    const res = await api('POST', '/api/players', { name: 'Fresh' });
    assert.equal(res.status, 201);

    const p = res.body.player;
    assert.equal(p.totalSteps, 0);
    assert.equal(p.skills.woodcutting.level, 1);
    assert.equal(p.skills.mining.level, 1);
    assert.equal(p.skills.smithing.level, 1);
    assert.equal(countOf(p, 'basic_hatchet'), 1);
    assert.equal(p.equipped.woodcutting, 'basic_hatchet');
    assert.equal(p.current, null);
  });

  test('a missing name is rejected', async () => {
    const res = await api('POST', '/api/players', {});
    assert.equal(res.status, 400);
  });

  test('a malformed player id returns 400, not 500', async () => {
    const res = await api('GET', '/api/players/not-a-uuid');
    assert.equal(res.status, 400);
  });

  test('an unknown player returns 404', async () => {
    const res = await api('GET', '/api/players/00000000-0000-4000-8000-000000000000');
    assert.equal(res.status, 404);
  });
});

describe('the full step-to-reward round trip', () => {
  test('walking funds actions, and the result survives a reload', async () => {
    const id = await newPlayer();

    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });

    // 260 steps at 25 per action = 10 logs, 10 steps left banked.
    const walked = await api('POST', `/api/players/${id}/steps`, {
      steps: 260,
      source: 'pedometer',
      windowStart: '2026-07-27T01:00:00.000Z',
      windowEnd: '2026-07-27T02:00:00.000Z',
    });

    assert.equal(walked.status, 200);
    assert.equal(walked.body.player.totalSteps, 260);
    assert.equal(countOf(walked.body.player, 'birch_log'), 10);
    assert.equal(walked.body.player.skills.woodcutting.xp, 80); // 10 x 8
    assert.equal(walked.body.player.current.stepsBanked, 10);

    // Reload from the database — this is the part that proves persistence
    // rather than in-memory state.
    const reloaded = await api('GET', `/api/players/${id}`);
    assert.equal(reloaded.body.player.totalSteps, 260);
    assert.equal(countOf(reloaded.body.player, 'birch_log'), 10);
    assert.equal(reloaded.body.player.skills.woodcutting.xp, 80);
    assert.equal(reloaded.body.player.current.stepsBanked, 10);
  });

  test('banked steps carry across separate sync batches', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });

    await api('POST', `/api/players/${id}/steps`, { steps: 20 });
    const first = await api('GET', `/api/players/${id}`);
    assert.equal(countOf(first.body.player, 'birch_log'), 0);

    await api('POST', `/api/players/${id}/steps`, { steps: 10 });
    const second = await api('GET', `/api/players/${id}`);
    assert.equal(countOf(second.body.player, 'birch_log'), 1);
    assert.equal(second.body.player.current.stepsBanked, 5);
  });

  test('the sync high-water mark advances so steps are never double counted', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });

    const res = await api('POST', `/api/players/${id}/steps`, {
      steps: 100,
      windowStart: '2026-07-27T01:00:00.000Z',
      windowEnd: '2026-07-27T03:30:00.000Z',
    });

    assert.ok(res.body.lastSyncAt, 'lastSyncAt should be set after a sync');
    assert.equal(new Date(res.body.lastSyncAt).toISOString(), '2026-07-27T03:30:00.000Z');
  });

  test('every sync is written to the step ledger', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'mine_copper' });
    await api('POST', `/api/players/${id}/steps`, { steps: 90 });  // 3 actions at 30
    await api('POST', `/api/players/${id}/steps`, { steps: 60 });  // 2 actions

    const { rows } = await pool.query(
      `SELECT steps, actions, source FROM step_ledger
       WHERE player_id = $1 ORDER BY id`, [id]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0].steps, 90);
    assert.equal(rows[0].actions, 3);
    assert.equal(rows[1].actions, 2);
    assert.equal(rows[0].source, 'pedometer');
  });

  test('steps walked while idle count to the total but earn nothing', async () => {
    const id = await newPlayer();
    const res = await api('POST', `/api/players/${id}/steps`, { steps: 5000 });
    assert.equal(res.body.player.totalSteps, 5000);
    assert.equal(res.body.player.inventory.length, 2); // just the starter tools
  });

  test('a non-positive step count is rejected', async () => {
    const id = await newPlayer();
    assert.equal((await api('POST', `/api/players/${id}/steps`, { steps: 0 })).status, 400);
    assert.equal((await api('POST', `/api/players/${id}/steps`, { steps: -10 })).status, 400);
    assert.equal((await api('POST', `/api/players/${id}/steps`, { steps: 1e9 })).status, 400);
  });
});

describe('activity rules over HTTP', () => {
  test('a locked activity is refused with 422', async () => {
    const id = await newPlayer();
    const res = await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_oak' });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /level 5/);
  });

  test('stopping an activity clears it and leaves inventory intact', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });
    await api('POST', `/api/players/${id}/steps`, { steps: 50 });

    const stopped = await api('DELETE', `/api/players/${id}/activity`);
    assert.equal(stopped.body.player.current, null);
    assert.equal(countOf(stopped.body.player, 'birch_log'), 2);
  });
});

describe('crafting over HTTP', () => {
  test('smithing is reachable through the forge', async () => {
    const id = await newPlayer();

    // Mine enough copper for one bronze bar, plus steps to pay the craft cost.
    await api('POST', `/api/players/${id}/activity`, { activityId: 'mine_copper' });
    await api('POST', `/api/players/${id}/steps`, { steps: 100 }); // 3 ore, 10 banked
    await api('POST', `/api/players/${id}/steps`, { steps: 100 }); // more banked steps

    const crafted = await api('POST', `/api/players/${id}/craft`, { recipeId: 'smelt_bronze' });
    assert.equal(crafted.status, 200);
    assert.equal(countOf(crafted.body.player, 'bronze_bar'), 1);
    assert.equal(crafted.body.player.skills.smithing.xp, 12);

    // And it persisted.
    const reloaded = await api('GET', `/api/players/${id}`);
    assert.equal(reloaded.body.player.skills.smithing.xp, 12);
  });

  test('crafting without the inputs is refused and changes nothing', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'mine_copper' });
    await api('POST', `/api/players/${id}/steps`, { steps: 500 });

    const before = await api('GET', `/api/players/${id}`);
    const banked = before.body.player.current.stepsBanked;

    const res = await api('POST', `/api/players/${id}/craft`, { recipeId: 'craft_bronze_hatchet' });
    assert.equal(res.status, 422);

    // The transaction rolled back, so the banked steps were not spent.
    const after = await api('GET', `/api/players/${id}`);
    assert.equal(after.body.player.current.stepsBanked, banked);
  });
});

describe('equipment over HTTP', () => {
  test('an unowned tool cannot be equipped', async () => {
    const id = await newPlayer();
    const res = await api('POST', `/api/players/${id}/equip`, { itemId: 'iron_hatchet' });
    assert.equal(res.status, 422);
  });

  test('equipping a better tool lowers the step cost of future actions', async () => {
    const id = await newPlayer();

    // Grant a bronze hatchet directly so the test does not depend on a
    // 1-in-200 loot roll.
    await pool.query(
      `INSERT INTO player_inventory (player_id, item_id, count) VALUES ($1, 'bronze_hatchet', 1)`,
      [id]);

    const equipped = await api('POST', `/api/players/${id}/equip`, { itemId: 'bronze_hatchet' });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.body.player.equipped.woodcutting, 'bronze_hatchet');

    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });
    // Base cost 25 drops to 21, so 21 steps buys exactly one log.
    const walked = await api('POST', `/api/players/${id}/steps`, { steps: 21 });
    assert.equal(countOf(walked.body.player, 'birch_log'), 1);
    assert.equal(walked.body.player.current.stepsBanked, 0);
  });
});

describe('game content', () => {
  test('the client can fetch the balance data from the API', async () => {
    const res = await api('GET', '/api/content');
    assert.equal(res.status, 200);
    assert.equal(res.body.skills.length, 3);
    assert.ok(res.body.activities.length >= 4);
    assert.ok(res.body.recipes.length >= 2);
  });
});
