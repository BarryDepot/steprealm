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
 * Spend a batch of walked steps against the player's running quest.
 *
 * Nothing is granted here — completed actions only advance a counter, and the
 * rewards they represent are handed over by claimQuest once the quest is
 * finished. This is what makes a quest feel like a quest rather than a trickle
 * of loot, and it keeps the reward calculation in exactly one place.
 *
 * Leftover steps that were not enough to fund a whole action stay banked on
 * the quest, which is what allows progression to accumulate across many small
 * sync batches rather than being rounded away each time.
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

  const act = activityById(next.current.activityId);
  const wasComplete = act ? next.current.actionsCompleted >= act.targetActions : false;
  const actionsCompleted = next.current.actionsCompleted + tick.actions;

  next = {
    ...next,
    current: {
      ...next.current,
      stepsBanked: tick.stepsBankedAfter,
      // Every step walked while this quest is running counts here, even the
      // ones left over in stepsBanked — this is "effort put in", not "steps
      // still owed to the next action".
      totalSteps: next.current.totalSteps + freshSteps,
      actionsCompleted,
    },
  };

  if (tick.actions > 0 && act) {
    events.push({
      kind: 'activity',
      message: `${act.name}: ${actionsCompleted}/${act.targetActions} (${tick.stepsConsumed} steps)`,
    });

    // Announced once, on the tick that finishes the quest — the guard stops a
    // later sync re-announcing a quest that is merely sitting uncollected.
    if (!wasComplete && actionsCompleted >= act.targetActions) {
      events.push({
        kind: 'system',
        message: `${act.name} complete — ready to collect.`,
      });
    }
  }

  return { player: next, events, actions: tick.actions, stepsConsumed: tick.stepsConsumed };
}

/**
 * Collect a finished quest: grant everything it accumulated, then clear it.
 *
 * The rewards are recomputed from the action count and the activity definition
 * rather than read from a stored list, so there is no pending-reward state that
 * could drift out of step with the counter that produced it.
 */
export function claimQuest(player: Player): EngineResult {
  if (!player.current) {
    throw new GameRuleError('No quest to collect.');
  }

  const act = activityById(player.current.activityId);
  if (!act) {
    throw new GameRuleError(`Unknown activity: ${player.current.activityId}`);
  }

  const actions = player.current.actionsCompleted;
  if (actions < act.targetActions) {
    throw new GameRuleError(
      `${act.name} is ${actions}/${act.targetActions} complete — keep walking.`);
  }

  const events: GameEvent[] = [];
  let next = addToInventory(player, act.yieldItem, actions);

  events.push({
    kind: 'activity',
    message: `Collected ${actions}x ${pretty(act.yieldItem)} from ${act.name}`,
  });

  // One loot roll per completed action, same rate as before — the rolls simply
  // happen at collection rather than as each action lands.
  for (let i = 0; i < actions; i++) {
    const drop = rollLoot(act.skill);
    if (drop.dropped && drop.item) {
      next = addToInventory(next, drop.item, 1);
      events.push({ kind: 'loot', message: `Chest! Found ${drop.rarity} ${pretty(drop.item)}` });
    }
  }

  const res = applyXp(next, act.skill, act.xpReward * actions);
  next = res.player;
  if (res.levelledTo !== null) {
    events.push({ kind: 'level', message: `${act.skill} is now level ${res.levelledTo}` });
  }

  // Clearing the quest also discards any steps still banked against it. That
  // is the same thing stopActivity has always done, and it keeps "a quest" a
  // single self-contained unit rather than a rolling step balance.
  next = { ...next, current: null };

  return { player: next, events, actions, stepsConsumed: 0 };
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
        activityId, stepsBanked: 0, totalSteps: 0, actionsCompleted: 0,
        startedAt: Date.now(),
      },
    },
    events: [{
      kind: 'system',
      message: `Started: ${act.name} (${act.targetActions} to collect)`,
    }],
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
