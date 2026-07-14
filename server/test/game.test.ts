// Unit tests for the core game rules.
//
// These cover the criteria stated in the project proposal: that an action
// deducts the correct step cost, awards the correct resource and XP, and that
// levelling and crafting recipes resolve correctly.
//
// Every function under test is pure, so none of this needs a database.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ingestSteps, startActivity, claimQuest, craft, equipTool, GameRuleError,
} from '../src/game/engine';
import { effectiveStepCost, computeTick } from '../src/game/tick';
import { levelFromXp, xpForLevel, progressInLevel } from '../src/game/xp';
import { rollLoot } from '../src/game/loot';
import { activityById } from '../src/content';
import type { CurrentActivity, Player } from '../src/types';

// A fresh player, matching the seed state the repository writes on signup.
function newPlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Tester',
    totalSteps: 0,
    skills: {
      woodcutting: { xp: 0, level: 1 },
      mining: { xp: 0, level: 1 },
      smithing: { xp: 0, level: 1 },
    },
    inventory: [
      { item: 'basic_hatchet', count: 1 },
      { item: 'basic_pickaxe', count: 1 },
    ],
    equipped: { woodcutting: 'basic_hatchet', mining: 'basic_pickaxe' },
    current: null,
    ...overrides,
  };
}

// A quest in progress. Defaults to freshly started; override to place the
// player partway through one.
function quest(activityId: string, overrides: Partial<CurrentActivity> = {}): CurrentActivity {
  return {
    activityId,
    stepsBanked: 0,
    totalSteps: 0,
    actionsCompleted: 0,
    startedAt: Date.now(),
    ...overrides,
  };
}

// Loot is a 1-in-200 roll per action, so any test asserting an exact
// inventory has to pin it down or it fails intermittently.
function withoutLoot<T>(fn: () => T): T {
  const original = Math.random;
  Math.random = () => 0.99;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const countOf = (p: Player, item: string) =>
  p.inventory.find(e => e.item === item)?.count ?? 0;

describe('xp curve', () => {
  test('level 1 requires no xp', () => {
    assert.equal(xpForLevel(1), 0);
  });

  test('the curve is strictly increasing', () => {
    for (let lvl = 2; lvl < 50; lvl++) {
      assert.ok(xpForLevel(lvl) > xpForLevel(lvl - 1),
        `level ${lvl} should cost more than ${lvl - 1}`);
    }
  });

  test('levelFromXp is the inverse of xpForLevel at the boundary', () => {
    for (let lvl = 1; lvl < 30; lvl++) {
      assert.equal(levelFromXp(xpForLevel(lvl)), lvl);
      assert.equal(levelFromXp(xpForLevel(lvl + 1) - 1), lvl,
        'one xp short of the threshold must not level up');
    }
  });

  test('progress within a level stays in 0..1', () => {
    for (const xp of [0, 1, 50, 137, 999, 12_345]) {
      const p = progressInLevel(xp);
      assert.ok(p >= 0 && p <= 1, `progress out of range at ${xp} xp: ${p}`);
    }
  });
});

describe('step cost and tools', () => {
  test('an unequipped skill pays the base cost', () => {
    const player = newPlayer({ equipped: {} });
    const act = activityById('chop_birch')!;
    assert.equal(effectiveStepCost(act, player), act.stepCost);
  });

  test('the starter hatchet gives no discount', () => {
    const act = activityById('chop_birch')!;
    assert.equal(effectiveStepCost(act, newPlayer()), act.stepCost);
  });

  test('a bronze hatchet reduces the cost by 15 per cent', () => {
    const player = newPlayer({ equipped: { woodcutting: 'bronze_hatchet' } });
    const act = activityById('chop_birch')!; // 50 steps base
    assert.equal(effectiveStepCost(act, player), 43); // round(50 * 0.85)
  });

  test('a tool never reduces the cost below one step', () => {
    const player = newPlayer({ equipped: { woodcutting: 'iron_hatchet' } });
    const act = activityById('chop_birch')!;
    assert.ok(effectiveStepCost(act, player) >= 1);
  });
});

describe('quest progress', () => {
  test('steps below the action cost fund nothing and stay banked', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const tick = computeTick(player, 10)!; // cost is 50
    assert.equal(tick.actions, 0);
    assert.equal(tick.stepsConsumed, 0);
    assert.equal(tick.stepsBankedAfter, 10);
  });

  test('leftover steps carry across separate batches', () => {
    let player = newPlayer({ current: quest('chop_birch') });
    // 40 then 20 = 60 total, which funds exactly one 50-step action.
    player = ingestSteps(player, 40).player;
    assert.equal(player.current!.actionsCompleted, 0);

    const result = ingestSteps(player, 20);
    assert.equal(result.actions, 1);
    assert.equal(result.player.current!.actionsCompleted, 1);
    assert.equal(result.player.current!.stepsBanked, 10);
  });

  test('a batch funds several actions at once', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 200); // 4 x 50
    assert.equal(result.actions, 4);
    assert.equal(result.stepsConsumed, 200);
    assert.equal(result.player.current!.actionsCompleted, 4);
  });

  test('walking grants no items or xp until the quest is collected', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 200); // enough for 4 actions

    assert.equal(countOf(result.player, 'birch_log'), 0);
    assert.equal(result.player.skills.woodcutting.xp, 0);
    // Only the two starter tools — no loot was granted either.
    assert.equal(result.player.inventory.length, 2);
  });

  test('actions stop at the target and surplus steps stay banked', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    // 500 steps could fund 10 actions, but the quest only wants 5.
    const result = ingestSteps(player, 500);

    assert.equal(result.actions, 5);
    assert.equal(result.stepsConsumed, 250);
    assert.equal(result.player.current!.actionsCompleted, 5);
    assert.equal(result.player.current!.stepsBanked, 250);
  });

  test('a finished quest does not consume further steps', () => {
    const done = newPlayer({
      current: quest('chop_birch', { actionsCompleted: 5, stepsBanked: 10 }),
    });
    const result = ingestSteps(done, 100);

    assert.equal(result.actions, 0);
    assert.equal(result.stepsConsumed, 0);
    assert.equal(result.player.current!.stepsBanked, 110);
    assert.equal(result.player.current!.actionsCompleted, 5);
  });

  test('reaching the target announces completion exactly once', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const finished = ingestSteps(player, 250);
    assert.equal(finished.player.current!.actionsCompleted, 5);
    assert.equal(finished.events.filter(e => e.kind === 'system').length, 1);

    // A later sync against an uncollected quest must not re-announce it.
    const later = ingestSteps(finished.player, 100);
    assert.equal(later.events.filter(e => e.kind === 'system').length, 0);
  });

  test('every walked step counts towards the quest total, banked or spent', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 130); // 2 actions (100), 30 banked
    assert.equal(result.player.current!.totalSteps, 130);
  });

  test('steps still count towards the lifetime total when idle', () => {
    const result = ingestSteps(newPlayer(), 500);
    assert.equal(result.player.totalSteps, 500);
    assert.equal(result.actions, 0);
  });

  test('a negative or zero step count changes nothing', () => {
    const before = newPlayer();
    assert.deepEqual(ingestSteps(before, 0).player, before);
    assert.deepEqual(ingestSteps(before, -50).player, before);
  });
});

describe('collecting a quest', () => {
  // chop_birch: 5 actions, 8 xp and one birch log each.
  const finished = () => newPlayer({
    current: quest('chop_birch', { actionsCompleted: 5, stepsBanked: 40 }),
  });

  test('collecting grants one yield item per completed action', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(countOf(result.player, 'birch_log'), 5);
  });

  test('collecting grants the accumulated xp in one go', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(result.player.skills.woodcutting.xp, 40); // 5 x 8
  });

  test('collecting clears the quest', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(result.player.current, null);
  });

  test('an unfinished quest cannot be collected', () => {
    const player = newPlayer({
      current: quest('chop_birch', { actionsCompleted: 4 }),
    });
    assert.throws(() => claimQuest(player),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('an unfinished quest is left untouched by a refused collection', () => {
    const player = newPlayer({
      current: quest('chop_birch', { actionsCompleted: 4 }),
    });
    assert.throws(() => claimQuest(player));
    assert.equal(player.current!.actionsCompleted, 4);
    assert.equal(countOf(player, 'birch_log'), 0);
  });

  test('collecting with no quest running is refused', () => {
    assert.throws(() => claimQuest(newPlayer()),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('loot is rolled once per completed action', () => {
    const original = Math.random;
    Math.random = () => 0; // guarantees a drop on every roll
    try {
      const result = claimQuest(finished());
      // Five guaranteed woodcutting drops on top of the starter hatchet.
      assert.equal(countOf(result.player, 'basic_hatchet'), 6);
      assert.equal(result.events.filter(e => e.kind === 'loot').length, 5);
    } finally {
      Math.random = original;
    }
  });

  test('crossing a level threshold on collection emits a level event', () => {
    const player = newPlayer({
      // One quest (40 xp) tips this over the 162 xp needed for level 2.
      skills: {
        woodcutting: { xp: 130, level: 1 },
        mining: { xp: 0, level: 1 },
        smithing: { xp: 0, level: 1 },
      },
      current: quest('chop_birch', { actionsCompleted: 5 }),
    });

    const result = withoutLoot(() => claimQuest(player));
    assert.equal(result.player.skills.woodcutting.level, 2);
    assert.ok(result.events.some(e => e.kind === 'level'));
  });
});

describe('activity rules', () => {
  test('a locked activity is refused', () => {
    assert.throws(
      () => startActivity(newPlayer(), 'chop_oak'), // requires level 5
      (err: unknown) => err instanceof GameRuleError
    );
  });

  test('an unknown activity is refused', () => {
    assert.throws(
      () => startActivity(newPlayer(), 'chop_nothing'),
      (err: unknown) => err instanceof GameRuleError
    );
  });

  test('starting a quest banks no steps and no progress initially', () => {
    const result = startActivity(newPlayer(), 'chop_birch');
    assert.equal(result.player.current!.activityId, 'chop_birch');
    assert.equal(result.player.current!.stepsBanked, 0);
    assert.equal(result.player.current!.actionsCompleted, 0);
  });
});

describe('equipment rules', () => {
  test('equipping an unowned tool is refused', () => {
    assert.throws(
      () => equipTool(newPlayer(), 'iron_hatchet'),
      (err: unknown) => err instanceof GameRuleError
    );
  });

  test('equipping a resource is refused', () => {
    const player = newPlayer({ inventory: [{ item: 'birch_log', count: 5 }] });
    assert.throws(
      () => equipTool(player, 'birch_log'),
      (err: unknown) => err instanceof GameRuleError
    );
  });

  test('an owned tool equips to its own skill slot', () => {
    const player = newPlayer({
      inventory: [{ item: 'bronze_pickaxe', count: 1 }],
    });
    const result = equipTool(player, 'bronze_pickaxe');
    assert.equal(result.player.equipped.mining, 'bronze_pickaxe');
    assert.equal(result.player.equipped.woodcutting, 'basic_hatchet');
  });
});

describe('crafting', () => {
  // Crafting is the only source of smithing xp, so these tests also cover the
  // third MVP skill being reachable at all.
  function crafter(): Player {
    return newPlayer({
      inventory: [{ item: 'copper_ore', count: 4 }],
      current: quest('mine_copper', { stepsBanked: 500 }),
    });
  }

  test('a recipe consumes its inputs and yields its output', () => {
    const result = craft(crafter(), 'smelt_bronze'); // 2 copper -> 1 bronze bar
    assert.equal(countOf(result.player, 'copper_ore'), 2);
    assert.equal(countOf(result.player, 'bronze_bar'), 1);
  });

  test('crafting awards smithing xp', () => {
    const result = craft(crafter(), 'smelt_bronze');
    assert.equal(result.player.skills.smithing.xp, 12);
  });

  test('crafting deducts its step cost from the banked pool', () => {
    const result = craft(crafter(), 'smelt_bronze'); // costs 20 steps
    assert.equal(result.player.current!.stepsBanked, 480);
  });

  test('crafting without the inputs is refused', () => {
    const player = newPlayer({
      inventory: [{ item: 'copper_ore', count: 1 }],
      current: quest('mine_copper', { stepsBanked: 500 }),
    });
    assert.throws(() => craft(player, 'smelt_bronze'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('crafting without enough banked steps is refused', () => {
    const player = newPlayer({
      inventory: [{ item: 'copper_ore', count: 4 }],
      current: quest('mine_copper', { stepsBanked: 5 }),
    });
    assert.throws(() => craft(player, 'smelt_bronze'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('crafting below the required level is refused', () => {
    const player = newPlayer({
      inventory: [{ item: 'iron_ore', count: 4 }],
      current: quest('mine_iron', { stepsBanked: 500 }),
    });
    // smelt_iron needs smithing level 8, the player is level 1
    assert.throws(() => craft(player, 'smelt_iron'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('an exhausted input is dropped from the inventory rather than left at zero', () => {
    const player = newPlayer({
      inventory: [{ item: 'copper_ore', count: 2 }],
      current: quest('mine_copper', { stepsBanked: 100 }),
    });
    const result = craft(player, 'smelt_bronze');
    assert.ok(!result.player.inventory.some(e => e.item === 'copper_ore'));
  });
});

describe('loot rolls', () => {
  test('no chest drops when the roll misses', () => {
    const original = Math.random;
    Math.random = () => 0.99;
    try {
      assert.equal(rollLoot('woodcutting').dropped, false);
    } finally {
      Math.random = original;
    }
  });

  test('a hit yields a tool belonging to the producing skill', () => {
    const original = Math.random;
    Math.random = () => 0; // guarantees the drop and the epic tier
    try {
      const roll = rollLoot('mining');
      assert.equal(roll.dropped, true);
      assert.ok(roll.item?.includes('pickaxe'),
        `mining should not drop ${roll.item}`);
    } finally {
      Math.random = original;
    }
  });

  test('smithing has no tools to drop, so it never yields a chest', () => {
    const original = Math.random;
    Math.random = () => 0;
    try {
      assert.equal(rollLoot('smithing').dropped, false);
    } finally {
      Math.random = original;
    }
  });
});
