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
  test('walking advances the quest, and the progress survives a reload', async () => {
    const id = await newPlayer();

    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });

    // 260 steps clears the 50-step target several times over; the surplus
    // stays in the crafting pool rather than earning anything extra.
    const walked = await api('POST', `/api/players/${id}/steps`, {
      steps: 260,
      source: 'pedometer',
      windowStart: '2026-07-27T01:00:00.000Z',
      windowEnd: '2026-07-27T02:00:00.000Z',
    });

    assert.equal(walked.status, 200);
    assert.equal(walked.body.player.totalSteps, 260);
    assert.equal(walked.body.player.current.totalSteps, 260);
    assert.equal(walked.body.player.current.stepsBanked, 260);
    // Nothing is granted until the quest is collected.
    assert.equal(countOf(walked.body.player, 'birch_log'), 0);
    assert.equal(walked.body.player.skills.woodcutting.xp, 0);

    // Reload from the database — this is the part that proves persistence
    // rather than in-memory state.
    const reloaded = await api('GET', `/api/players/${id}`);
    assert.equal(reloaded.body.player.totalSteps, 260);
    assert.equal(reloaded.body.player.current.totalSteps, 260);
    assert.equal(reloaded.body.player.current.stepsBanked, 260);
    assert.equal(countOf(reloaded.body.player, 'birch_log'), 0);
  });

  test('collecting a finished quest grants its rewards and persists them', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });
    await api('POST', `/api/players/${id}/steps`, { steps: 50 }); // the target

    const claimed = await api('POST', `/api/players/${id}/activity/claim`);
    assert.equal(claimed.status, 200);
    assert.equal(countOf(claimed.body.player, 'birch_log'), 1);
    assert.equal(claimed.body.player.skills.woodcutting.xp, 8);
    assert.equal(claimed.body.player.current, null);

    const reloaded = await api('GET', `/api/players/${id}`);
    assert.equal(countOf(reloaded.body.player, 'birch_log'), 1);
    assert.equal(reloaded.body.player.skills.woodcutting.xp, 8);
    assert.equal(reloaded.body.player.current, null);
  });

  test('an unfinished quest cannot be collected', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });
    await api('POST', `/api/players/${id}/steps`, { steps: 30 }); // 30 of 50

    const res = await api('POST', `/api/players/${id}/activity/claim`);
    assert.equal(res.status, 422);

    // The refusal changed nothing.
    const after = await api('GET', `/api/players/${id}`);
    assert.equal(after.body.player.current.totalSteps, 30);
    assert.equal(countOf(after.body.player, 'birch_log'), 0);
  });

  test('collecting with no quest running is refused', async () => {
    const id = await newPlayer();
    const res = await api('POST', `/api/players/${id}/activity/claim`);
    assert.equal(res.status, 422);
  });

  test('quest progress carries across separate sync batches', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });

    await api('POST', `/api/players/${id}/steps`, { steps: 30 });
    const first = await api('GET', `/api/players/${id}`);
    assert.equal(first.body.player.current.totalSteps, 30);

    // Short of the target, so collecting is still refused.
    assert.equal((await api('POST', `/api/players/${id}/activity/claim`)).status, 422);

    await api('POST', `/api/players/${id}/steps`, { steps: 20 });
    const second = await api('GET', `/api/players/${id}`);
    assert.equal(second.body.player.current.totalSteps, 50);
    assert.equal((await api('POST', `/api/players/${id}/activity/claim`)).status, 200);
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
    await api('POST', `/api/players/${id}/steps`, { steps: 30 }); // 30 of 60
    await api('POST', `/api/players/${id}/steps`, { steps: 30 }); // finishes it

    const { rows } = await pool.query(
      `SELECT steps, actions, source FROM step_ledger
       WHERE player_id = $1 ORDER BY id`, [id]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0].steps, 30);
    // The ledger's actions column now counts quests finished by the batch.
    assert.equal(rows[0].actions, 0);
    assert.equal(rows[1].actions, 1);
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

  test('abandoning a quest clears it and forfeits the uncollected progress', async () => {
    const id = await newPlayer();
    await api('POST', `/api/players/${id}/activity`, { activityId: 'chop_birch' });
    await api('POST', `/api/players/${id}/steps`, { steps: 50 }); // finished, uncollected

    const stopped = await api('DELETE', `/api/players/${id}/activity`);
    assert.equal(stopped.body.player.current, null);
    // The quest was never collected, so it yielded nothing — only the two
    // starter tools remain.
    assert.equal(countOf(stopped.body.player, 'birch_log'), 0);
    assert.equal(stopped.body.player.inventory.length, 2);
  });
});

describe('crafting over HTTP', () => {
  test('smithing is reachable through the forge', async () => {
    const id = await newPlayer();

    // Ore now only arrives by collecting a finished quest.
    await api('POST', `/api/players/${id}/activity`, { activityId: 'mine_copper' });
    await api('POST', `/api/players/${id}/steps`, { steps: 60 }); // the target
    const claimed = await api('POST', `/api/players/${id}/activity/claim`);
    assert.equal(countOf(claimed.body.player, 'copper_ore'), 2);

    // Collecting cleared the quest, and with it the banked steps a recipe is
    // paid from — so a fresh quest has to bank the craft cost.
    await api('POST', `/api/players/${id}/activity`, { activityId: 'mine_copper' });
    await api('POST', `/api/players/${id}/steps`, { steps: 20 });

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

  test('equipping a better tool lowers the step target of future quests', async () => {
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
    // The 50-step target drops to 43, so 43 steps finishes the quest.
    await api('POST', `/api/players/${id}/steps`, { steps: 43 });
    const claimed = await api('POST', `/api/players/${id}/activity/claim`);
    assert.equal(claimed.status, 200);
    assert.equal(countOf(claimed.body.player, 'birch_log'), 1);
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
