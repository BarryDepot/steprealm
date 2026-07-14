// Activity tick logic. Given an amount of newly-walked steps, how many quest
// actions did the player complete?
//
// Rewards are deliberately absent here. Under the quest model an action only
// advances a counter; what that counter is worth is decided at collection
// time, in the engine's claimQuest.
//
// This is pure - no state mutation. The store calls it and applies the result.

import { activityById, itemById } from '../content';
import type { Activity, Player } from '../types';

export interface TickResult {
  actions: number;          // how many discrete actions completed
  stepsConsumed: number;
  stepsBankedAfter: number; // leftover steps not enough for another action
}

// Apply the equipped tool's efficiency to the base step cost.
// efficiency of 0.15 means 15% off, so step cost * (1 - 0.15) = 85% of base.
export function effectiveStepCost(activity: Activity, player: Player): number {
  const equippedId = player.equipped[activity.skill];
  if (!equippedId) return activity.stepCost;
  const tool = itemById(equippedId);
  if (!tool || tool.kind !== 'tool' || !tool.tool) return activity.stepCost;
  const mult = 1 - tool.tool.efficiency;
  return Math.max(1, Math.round(activity.stepCost * mult));
}

// Returns an unapplied TickResult. The caller decides whether to apply or
// discard (we'll always apply, but separating compute from mutation makes
// the logic easy to unit-test).
//
// Actions are capped at the quest's remaining count, and steps are only
// consumed for actions actually credited — so once a quest is finished,
// further walking banks steps rather than being silently burned.
export function computeTick(player: Player, freshSteps: number): TickResult | null {
  if (!player.current) return null;
  const act = activityById(player.current.activityId);
  if (!act) return null;

  const cost = effectiveStepCost(act, player);
  const totalBank = player.current.stepsBanked + freshSteps;
  const remaining = Math.max(0, act.targetActions - player.current.actionsCompleted);

  const actions = Math.min(Math.floor(totalBank / cost), remaining);
  if (actions <= 0) {
    return { actions: 0, stepsConsumed: 0, stepsBankedAfter: totalBank };
  }

  const stepsConsumed = actions * cost;

  return {
    actions,
    stepsConsumed,
    stepsBankedAfter: totalBank - stepsConsumed,
  };
}
