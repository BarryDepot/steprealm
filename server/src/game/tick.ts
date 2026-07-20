// Quest tick logic. Given an amount of newly-walked steps, how far along the
// quest is the player, and is it finished?
//
// A quest is a flat step target: there are no discrete actions to divide it
// into, so this is arithmetic on a running total. Rewards are absent here —
// what a finished quest pays out is decided at collection time, in the
// engine's claimQuest.
//
// This is pure - no state mutation. The store calls it and applies the result.

import { activityById, itemById } from '../content';
import type { Activity, Player } from '../types';

export interface TickResult {
  stepsTowardsTarget: number; // progress after this tick
  targetSteps: number;        // the tool-adjusted requirement it is measured against
  complete: boolean;
}

// Apply the equipped tool's efficiency to the quest's step requirement.
// efficiency of 0.15 means 15% off, so target * (1 - 0.15) = 85% of base.
//
// Tools used to discount a per-action cost; with a flat target they discount
// the target itself, which is the same 15% saving over the whole quest.
export function effectiveTargetSteps(activity: Activity, player: Player): number {
  const equippedId = player.equipped[activity.skill];
  if (!equippedId) return activity.targetSteps;
  const tool = itemById(equippedId);
  if (!tool || tool.kind !== 'tool' || !tool.tool) return activity.targetSteps;
  const mult = 1 - tool.tool.efficiency;
  return Math.max(1, Math.round(activity.targetSteps * mult));
}

// Returns an unapplied TickResult. The caller decides whether to apply or
// discard (we'll always apply, but separating compute from mutation makes
// the logic easy to unit-test).
export function computeTick(player: Player, freshSteps: number): TickResult | null {
  if (!player.current) return null;
  const act = activityById(player.current.activityId);
  if (!act) return null;

  const targetSteps = effectiveTargetSteps(act, player);
  const stepsTowardsTarget = player.current.totalSteps + Math.max(0, freshSteps);

  return {
    stepsTowardsTarget,
    targetSteps,
    complete: stepsTowardsTarget >= targetSteps,
  };
}
