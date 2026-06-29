// Activity tick logic. Given an amount of newly-walked steps, how many actions
// did the player complete, what items did they gain, what XP did they earn?
//
// This is pure - no state mutation. The store calls it and applies the result.

import { activityById, itemById } from '../content';
import type { Activity, ItemId, Player, SkillId } from '../types';

export interface TickResult {
  actions: number;          // how many discrete actions completed
  yieldedItems: Array<{ item: ItemId; count: number }>;
  xpGained: Partial<Record<SkillId, number>>;
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
export function computeTick(player: Player, freshSteps: number): TickResult | null {
  if (!player.current) return null;
  const act = activityById(player.current.activityId);
  if (!act) return null;

  const cost = effectiveStepCost(act, player);
  const totalBank = player.current.stepsBanked + freshSteps;

  const actions = Math.floor(totalBank / cost);
  if (actions <= 0) {
    return {
      actions: 0,
      yieldedItems: [],
      xpGained: {},
      stepsConsumed: 0,
      stepsBankedAfter: totalBank,
    };
  }

  const stepsConsumed = actions * cost;
  const stepsBankedAfter = totalBank - stepsConsumed;

  return {
    actions,
    yieldedItems: [{ item: act.yieldItem, count: actions }],
    xpGained: { [act.skill]: act.xpReward * actions },
    stepsConsumed,
    stepsBankedAfter,
  };
}
