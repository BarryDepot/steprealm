// Data access for player state.
//
// The database stores progression across five normalised tables; the game
// engine wants a single Player object. This module is the only place that
// knows how to translate between the two, so the engine stays free of SQL and
// the routes stay free of both.

import type { Db } from '../db';
import { skills as allSkills } from '../content';
import type { GameEvent } from '../game/engine';
import type { InventoryEntry, ItemId, Player, SkillId } from '../types';

export class NotFoundError extends Error {
  status = 404;
}

// Starting loadout. Both starter tools have zero efficiency, so they exist to
// give the player something equipped rather than to confer an advantage.
const STARTING_INVENTORY: InventoryEntry[] = [
  { item: 'basic_hatchet', count: 1 },
  { item: 'basic_pickaxe', count: 1 },
];

const STARTING_EQUIPMENT: Partial<Record<SkillId, ItemId>> = {
  woodcutting: 'basic_hatchet',
  mining: 'basic_pickaxe',
};

export async function createPlayer(db: Db, displayName: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (display_name) VALUES ($1) RETURNING id`,
    [displayName]
  );
  const id = rows[0].id;

  // Seed a row per skill so later updates are plain UPDATEs.
  for (const skill of allSkills) {
    await db.query(
      `INSERT INTO player_skills (player_id, skill_id, xp, level) VALUES ($1, $2, 0, 1)`,
      [id, skill.id]
    );
  }

  for (const entry of STARTING_INVENTORY) {
    await db.query(
      `INSERT INTO player_inventory (player_id, item_id, count) VALUES ($1, $2, $3)`,
      [id, entry.item, entry.count]
    );
  }

  for (const [skillId, itemId] of Object.entries(STARTING_EQUIPMENT)) {
    await db.query(
      `INSERT INTO player_equipment (player_id, skill_id, item_id) VALUES ($1, $2, $3)`,
      [id, skillId, itemId]
    );
  }

  return id;
}

export async function loadPlayer(db: Db, playerId: string): Promise<Player> {
  const playerRes = await db.query<{
    display_name: string;
    total_steps: string;
  }>(
    `SELECT display_name, total_steps FROM players WHERE id = $1`,
    [playerId]
  );
  if (playerRes.rowCount === 0) {
    throw new NotFoundError(`No player with id ${playerId}`);
  }

  const [skillsRes, invRes, equipRes, actRes] = await Promise.all([
    db.query<{ skill_id: string; xp: number; level: number }>(
      `SELECT skill_id, xp, level FROM player_skills WHERE player_id = $1`, [playerId]),
    db.query<{ item_id: string; count: number }>(
      `SELECT item_id, count FROM player_inventory WHERE player_id = $1 ORDER BY item_id`, [playerId]),
    db.query<{ skill_id: string; item_id: string }>(
      `SELECT skill_id, item_id FROM player_equipment WHERE player_id = $1`, [playerId]),
    db.query<{ activity_id: string; steps_banked: number; started_at: Date }>(
      `SELECT activity_id, steps_banked, started_at FROM player_activity WHERE player_id = $1`, [playerId]),
  ]);

  // Default every known skill to level 1 so a schema addition cannot produce
  // an undefined lookup in the engine.
  const skills = Object.fromEntries(
    allSkills.map(s => [s.id, { xp: 0, level: 1 }])
  ) as Player['skills'];
  for (const row of skillsRes.rows) {
    skills[row.skill_id as SkillId] = { xp: row.xp, level: row.level };
  }

  const equipped: Partial<Record<SkillId, ItemId>> = {};
  for (const row of equipRes.rows) {
    equipped[row.skill_id as SkillId] = row.item_id;
  }

  const activity = actRes.rows[0];

  return {
    name: playerRes.rows[0].display_name,
    // total_steps is BIGINT, which node-postgres returns as a string to avoid
    // silent precision loss. Safe to widen here — no one walks 2^53 steps.
    totalSteps: Number(playerRes.rows[0].total_steps),
    skills,
    inventory: invRes.rows.map(r => ({ item: r.item_id, count: r.count })),
    equipped,
    current: activity
      ? {
          activityId: activity.activity_id,
          stepsBanked: activity.steps_banked,
          startedAt: activity.started_at.getTime(),
        }
      : null,
  };
}

/**
 * Persist a whole player.
 *
 * Inventory and equipment are rewritten wholesale rather than diffed. With a
 * handful of item types per player that is a few rows, and it removes an
 * entire class of bug where a diff misses a deletion. If the inventory ever
 * grows large this is the first thing to revisit.
 */
export async function savePlayer(db: Db, playerId: string, player: Player): Promise<void> {
  await db.query(
    `UPDATE players SET total_steps = $2, updated_at = now() WHERE id = $1`,
    [playerId, player.totalSteps]
  );

  for (const [skillId, progress] of Object.entries(player.skills)) {
    await db.query(
      `INSERT INTO player_skills (player_id, skill_id, xp, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id, skill_id)
       DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level`,
      [playerId, skillId, progress.xp, progress.level]
    );
  }

  await db.query(`DELETE FROM player_inventory WHERE player_id = $1`, [playerId]);
  for (const entry of player.inventory) {
    if (entry.count <= 0) continue;
    await db.query(
      `INSERT INTO player_inventory (player_id, item_id, count) VALUES ($1, $2, $3)`,
      [playerId, entry.item, entry.count]
    );
  }

  await db.query(`DELETE FROM player_equipment WHERE player_id = $1`, [playerId]);
  for (const [skillId, itemId] of Object.entries(player.equipped)) {
    if (!itemId) continue;
    await db.query(
      `INSERT INTO player_equipment (player_id, skill_id, item_id) VALUES ($1, $2, $3)`,
      [playerId, skillId, itemId]
    );
  }

  if (player.current) {
    await db.query(
      `INSERT INTO player_activity (player_id, activity_id, steps_banked, started_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
       ON CONFLICT (player_id)
       DO UPDATE SET activity_id = EXCLUDED.activity_id,
                     steps_banked = EXCLUDED.steps_banked,
                     started_at = EXCLUDED.started_at`,
      [playerId, player.current.activityId, player.current.stepsBanked, player.current.startedAt]
    );
  } else {
    await db.query(`DELETE FROM player_activity WHERE player_id = $1`, [playerId]);
  }
}

export async function recordStepBatch(
  db: Db,
  playerId: string,
  steps: number,
  source: 'pedometer' | 'manual',
  actions: number,
  windowStart: Date | null,
  windowEnd: Date | null
): Promise<void> {
  await db.query(
    `INSERT INTO step_ledger (player_id, steps, source, actions, window_start, window_end)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [playerId, steps, source, actions, windowStart, windowEnd]
  );
  if (windowEnd) {
    await db.query(
      `UPDATE players SET last_step_sync_at = GREATEST(COALESCE(last_step_sync_at, $2), $2)
       WHERE id = $1`,
      [playerId, windowEnd]
    );
  }
}

export async function appendEvents(db: Db, playerId: string, events: GameEvent[]): Promise<void> {
  for (const event of events) {
    await db.query(
      `INSERT INTO event_log (player_id, kind, message) VALUES ($1, $2, $3)`,
      [playerId, event.kind, event.message]
    );
  }
}

export async function recentEvents(db: Db, playerId: string, limit = 50): Promise<GameEvent[]> {
  const { rows } = await db.query<{ kind: GameEvent['kind']; message: string }>(
    `SELECT kind, message FROM event_log
     WHERE player_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [playerId, limit]
  );
  return rows;
}

export async function lastSyncAt(db: Db, playerId: string): Promise<string | null> {
  const { rows } = await db.query<{ last_step_sync_at: Date | null }>(
    `SELECT last_step_sync_at FROM players WHERE id = $1`, [playerId]
  );
  return rows[0]?.last_step_sync_at?.toISOString() ?? null;
}
