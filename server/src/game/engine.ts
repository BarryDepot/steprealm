// Server-authoritative game engine.
//
// This is the logic that used to live in the client's zustand store. It was
// moved server-side for two reasons: the project brief requires meaningful
// server-side functionality, and more practically, a client that computes its
// own XP can trivially fabricate progression. The device now only reports how
// many steps were walked; every reward is decided here.
//
// Every function in this file is pure — it takes a player and returns a new
// player. Persistence is the repository layer's job, which keeps the rules
// easy to unit-test without a database.

import { activityById, itemById, recipeById } from '../content';
import { computeTick, effectiveStepCost } from './tick';
import { rollLoot } from './loot';
import { levelFromXp } from './xp';
import type { ItemId, Player, Recipe, SkillId } from '../types';

export interface GameEvent {
  kind: 'activity' | 'loot' | 'level' | 'system';
  message: string;
}

export interface EngineResult {
  player: Player;
  events: GameEvent[];
  actions: number;
  stepsConsumed: number;
}

// --- inventory helpers -----------------------------------------------------

function addToInventory(player: Player, item: ItemId, count: number): Player {
  const existing = player.inventory.find(e => e.item === item);
  if (existing) {
    return {
      ...player,
      inventory: player.inventory.map(e =>
        e.item === item ? { ...e, count: e.count + count } : e),
    };
  }
  return { ...player, inventory: [...player.inventory, { item, count }] };
}

function removeFromInventory(player: Player, item: ItemId, count: number): Player {
  return {
    ...player,
    inventory: player.inventory
      .map(e => (e.item === item ? { ...e, count: e.count - count } : e))
      .filter(e => e.count > 0),
  };
}

function countOf(player: Player, item: ItemId): number {
  return player.inventory.find(e => e.item === item)?.count ?? 0;
}

// Applies XP and reports whether the skill gained a level, so the caller can
// emit a level-up event without recomputing the curve.
function applyXp(player: Player, skill: SkillId, xp: number): { player: Player; levelledTo: number | null } {
  const cur = player.skills[skill];
  const nextXp = cur.xp + xp;
  const nextLevel = levelFromXp(nextXp);
  return {
    player: {
      ...player,
      skills: { ...player.skills, [skill]: { xp: nextXp, level: nextLevel } },
    },
    levelledTo: nextLevel > cur.level ? nextLevel : null,
  };
}

const pretty = (id: string) => itemById(id)?.name ?? id.replace(/_/g, ' ');

// --- step ingestion --------------------------------------------------------

/**
 * Spend a batch of walked steps against the player's running activity.
 *
 * Leftover steps that were not enough to fund a whole action stay banked on
 * the activity, which is what allows progression to accumulate across many
 * small sync batches rather than being rounded away each time.
 */
export function ingestSteps(player: Player, freshSteps: number): EngineResult {
  const events: GameEvent[] = [];

  if (freshSteps <= 0) {
    return { player, events, actions: 0, stepsConsumed: 0 };
  }

  let next: Player = { ...player, totalSteps: player.totalSteps + freshSteps };

  // Steps still count towards the lifetime total when the player is idle,
  // they just do not fund any actions.
  if (!next.current) {
    return { player: next, events, actions: 0, stepsConsumed: 0 };
  }

  const tick = computeTick(next, freshSteps);
  if (!tick) {
    return { player: next, events, actions: 0, stepsConsumed: 0 };
  }

  next = {
    ...next,
    current: { ...next.current!, stepsBanked: tick.stepsBankedAfter },
  };

  for (const y of tick.yieldedItems) {
    next = addToInventory(next, y.item, y.count);
  }

  const act = activityById(next.current!.activityId);

  for (const [skill, gained] of Object.entries(tick.xpGained)) {
    if (!gained) continue;
    const res = applyXp(next, skill as SkillId, gained);
    next = res.player;
    if (res.levelledTo !== null) {
      events.push({ kind: 'level', message: `${skill} is now level ${res.levelledTo}` });
    }
  }

  if (tick.actions > 0 && act) {
    events.push({
      kind: 'activity',
      message: `+${tick.actions} ${pretty(act.yieldItem)} (${tick.stepsConsumed} steps)`,
    });

    // One loot roll per completed action.
    for (let i = 0; i < tick.actions; i++) {
      const drop = rollLoot(act.skill);
      if (drop.dropped && drop.item) {
        next = addToInventory(next, drop.item, 1);
        events.push({ kind: 'loot', message: `Chest! Found ${drop.rarity} ${pretty(drop.item)}` });
      }
    }
  }

  return { player: next, events, actions: tick.actions, stepsConsumed: tick.stepsConsumed };
}

// --- activity control ------------------------------------------------------

export function startActivity(player: Player, activityId: string): EngineResult {
  const act = activityById(activityId);
  if (!act) {
    throw new GameRuleError(`Unknown activity: ${activityId}`);
  }
  if (player.skills[act.skill].level < act.minLevel) {
    throw new GameRuleError(
      `${act.name} requires ${act.skill} level ${act.minLevel}.`);
  }
  return {
    player: {
      ...player,
      current: { activityId, stepsBanked: 0, startedAt: Date.now() },
    },
    events: [{ kind: 'system', message: `Started: ${act.name}` }],
    actions: 0,
    stepsConsumed: 0,
  };
}

export function stopActivity(player: Player): EngineResult {
  return {
    player: { ...player, current: null },
    events: [{ kind: 'system', message: 'Activity stopped.' }],
    actions: 0,
    stepsConsumed: 0,
  };
}

// --- equipment -------------------------------------------------------------

export function equipTool(player: Player, itemId: ItemId): EngineResult {
  const def = itemById(itemId);
  if (!def || def.kind !== 'tool' || !def.tool) {
    throw new GameRuleError(`${itemId} is not an equippable tool.`);
  }
  if (countOf(player, itemId) <= 0) {
    throw new GameRuleError(`You do not own ${def.name}.`);
  }
  return {
    player: {
      ...player,
      equipped: { ...player.equipped, [def.tool.skill]: itemId },
    },
    events: [{ kind: 'system', message: `Equipped ${def.name}.` }],
    actions: 0,
    stepsConsumed: 0,
  };
}

// --- crafting --------------------------------------------------------------

export class GameRuleError extends Error {
  status = 422;
}

/**
 * Craft a recipe at the forge.
 *
 * Crafting is the only source of Smithing XP, so without this the third MVP
 * skill is unreachable. Like activities, crafting costs steps — they come out
 * of the same banked pool, which keeps walking as the single currency of the
 * game rather than introducing a second economy.
 */
export function craft(player: Player, recipeId: string): EngineResult {
  const recipe: Recipe | undefined = recipeById(recipeId);
  if (!recipe) {
    throw new GameRuleError(`Unknown recipe: ${recipeId}`);
  }

  if (player.skills[recipe.skill].level < recipe.minLevel) {
    throw new GameRuleError(
      `${recipe.name} requires ${recipe.skill} level ${recipe.minLevel}.`);
  }

  const banked = player.current?.stepsBanked ?? 0;
  if (banked < recipe.stepCost) {
    throw new GameRuleError(
      `${recipe.name} costs ${recipe.stepCost} banked steps, you have ${banked}.`);
  }

  for (const input of recipe.inputs) {
    if (countOf(player, input.item) < input.count) {
      throw new GameRuleError(
        `Not enough ${pretty(input.item)} — need ${input.count}.`);
    }
  }

  let next = player;
  for (const input of recipe.inputs) {
    next = removeFromInventory(next, input.item, input.count);
  }
  next = addToInventory(next, recipe.output.item, recipe.output.count);

  if (next.current) {
    next = {
      ...next,
      current: { ...next.current, stepsBanked: banked - recipe.stepCost },
    };
  }

  const events: GameEvent[] = [
    { kind: 'activity', message: `Crafted ${recipe.output.count}x ${pretty(recipe.output.item)}` },
  ];

  const res = applyXp(next, recipe.skill, recipe.xpReward);
  next = res.player;
  if (res.levelledTo !== null) {
    events.push({ kind: 'level', message: `${recipe.skill} is now level ${res.levelledTo}` });
  }

  return { player: next, events, actions: 1, stepsConsumed: recipe.stepCost };
}

export { effectiveStepCost };
