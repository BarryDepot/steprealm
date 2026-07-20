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
import { computeTick, effectiveTargetSteps } from './tick';
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
  /**
   * Quests finished by this call — 0 or 1. Recorded in the step ledger, which
   * is why it survived the move away from per-action counting: the column
   * answers "what did this batch of steps achieve", and a completed quest is
   * now the only thing it can achieve.
   */
  questsCompleted: number;
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
 * Credit a batch of walked steps against the player's running quest.
 *
 * Nothing is granted here — steps only advance the quest's progress, and the
 * reward that progress earns is handed over by claimQuest once the target is
 * reached. This is what makes a quest feel like a quest rather than a trickle
 * of loot, and it keeps the reward calculation in exactly one place.
 */
export function ingestSteps(player: Player, freshSteps: number): EngineResult {
  const events: GameEvent[] = [];

  if (freshSteps <= 0) {
    return { player, events, questsCompleted: 0, stepsConsumed: 0 };
  }

  let next: Player = { ...player, totalSteps: player.totalSteps + freshSteps };

  // Steps still count towards the lifetime total when the player is idle,
  // they just do not advance any quest.
  if (!next.current) {
    return { player: next, events, questsCompleted: 0, stepsConsumed: 0 };
  }

  const tick = computeTick(next, freshSteps);
  if (!tick) {
    return { player: next, events, questsCompleted: 0, stepsConsumed: 0 };
  }

  const act = activityById(next.current.activityId);
  const wasComplete = next.current.totalSteps >= tick.targetSteps;

  next = {
    ...next,
    current: {
      ...next.current,
      // Banked steps are the crafting pool and are never spent by walking,
      // so every step lands in both counters.
      stepsBanked: next.current.stepsBanked + freshSteps,
      totalSteps: tick.stepsTowardsTarget,
    },
  };

  if (act) {
    events.push({
      kind: 'activity',
      message: `${act.name}: ${Math.min(tick.stepsTowardsTarget, tick.targetSteps)}/${tick.targetSteps} steps`,
    });

    // Announced once, on the tick that finishes the quest — the guard stops a
    // later sync re-announcing a quest that is merely sitting uncollected.
    if (!wasComplete && tick.complete) {
      events.push({
        kind: 'system',
        message: `${act.name} complete — ready to collect.`,
      });
    }
  }

  return {
    player: next,
    events,
    questsCompleted: !wasComplete && tick.complete ? 1 : 0,
    stepsConsumed: freshSteps,
  };
}

/**
 * Collect a finished quest: grant its flat reward, then clear it.
 *
 * The reward is read from the activity definition rather than from stored
 * state, so there is no pending-reward record that could drift out of step
 * with the progress that earned it.
 */
export function claimQuest(player: Player): EngineResult {
  if (!player.current) {
    throw new GameRuleError('No quest to collect.');
  }

  const act = activityById(player.current.activityId);
  if (!act) {
    throw new GameRuleError(`Unknown activity: ${player.current.activityId}`);
  }

  const targetSteps = effectiveTargetSteps(act, player);
  const walked = player.current.totalSteps;
  if (walked < targetSteps) {
    throw new GameRuleError(
      `${act.name} is ${walked}/${targetSteps} steps complete — keep walking.`);
  }

  const events: GameEvent[] = [];
  let next = addToInventory(player, act.yieldItem, act.yieldCount);

  events.push({
    kind: 'activity',
    message: `Collected ${act.yieldCount}x ${pretty(act.yieldItem)} from ${act.name}`,
  });

  // One roll per completed quest. The old model rolled once per action, so at
  // five actions a quest this is a fifth of the previous chance per quest —
  // but a quest is also a much shorter walk now, so the rate per step is
  // broadly unchanged.
  const drop = rollLoot(act.skill);
  if (drop.dropped && drop.item) {
    next = addToInventory(next, drop.item, 1);
    events.push({ kind: 'loot', message: `Chest! Found ${drop.rarity} ${pretty(drop.item)}` });
  }

  const res = applyXp(next, act.skill, act.xpReward);
  next = res.player;
  if (res.levelledTo !== null) {
    events.push({ kind: 'level', message: `${act.skill} is now level ${res.levelledTo}` });
  }

  // Clearing the quest also discards any steps still banked against it. That
  // is the same thing stopActivity has always done, and it keeps "a quest" a
  // single self-contained unit rather than a rolling step balance.
  next = { ...next, current: null };

  return { player: next, events, questsCompleted: 1, stepsConsumed: 0 };
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
      current: {
        activityId, stepsBanked: 0, totalSteps: 0, startedAt: Date.now(),
      },
    },
    events: [{
      kind: 'system',
      message: `Started: ${act.name} (${effectiveTargetSteps(act, player)} steps to collect)`,
    }],
    questsCompleted: 0,
    stepsConsumed: 0,
  };
}

export function stopActivity(player: Player): EngineResult {
  return {
    player: { ...player, current: null },
    events: [{ kind: 'system', message: 'Activity stopped.' }],
    questsCompleted: 0,
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
    questsCompleted: 0,
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

  return { player: next, events, questsCompleted: 0, stepsConsumed: recipe.stepCost };
}

export { effectiveTargetSteps };
