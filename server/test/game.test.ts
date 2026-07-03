// Unit tests for the core game rules.
//
// These cover the criteria stated in the project proposal: that an action
// deducts the correct step cost, awards the correct resource and XP, and that
// levelling and crafting recipes resolve correctly.
//
// Every function under test is pure, so none of this needs a database.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ingestSteps, startActivity, craft, equipTool, GameRuleError } from '../src/game/engine';
import { effectiveStepCost, computeTick } from '../src/game/tick';
import { levelFromXp, xpForLevel, progressInLevel } from '../src/game/xp';
import { rollLoot } from '../src/game/loot';
import { activityById } from '../src/content';
import type { Player } from '../src/types';

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
    const act = activityById('chop_birch')!; // 25 steps base
    assert.equal(effectiveStepCost(act, player), 21); // round(25 * 0.85)
  });

  test('a tool never reduces the cost below one step', () => {
    const player = newPlayer({ equipped: { woodcutting: 'iron_hatchet' } });
    const act = activityById('chop_birch')!;
    assert.ok(effectiveStepCost(act, player) >= 1);
  });
});

describe('activity tick', () => {
  test('steps below the action cost fund nothing and stay banked', () => {
    const player = newPlayer({
      current: { activityId: 'chop_birch', stepsBanked: 0, startedAt: Date.now() },
    });
    const tick = computeTick(player, 10)!; // cost is 25
    assert.equal(tick.actions, 0);
    assert.equal(tick.stepsConsumed, 0);
    assert.equal(tick.stepsBankedAfter, 10);
  });

  test('leftover steps carry across separate batches', () => {
    let player = newPlayer({
      current: { activityId: 'chop_birch', stepsBanked: 0, startedAt: Date.now() },
    });
    // 20 then 10 = 30 total, which funds exactly one 25-step action.
    player = ingestSteps(player, 20).player;
    assert.equal(countOf(player, 'birch_log'), 0);

    const result = ingestSteps(player, 10);
    assert.equal(result.actions, 1);
    assert.equal(countOf(result.player, 'birch_log'), 1);
    assert.equal(result.player.current!.stepsBanked, 5);
  });

  test('a batch funds several actions at once', () => {
    const player = newPlayer({
      current: { activityId: 'chop_birch', stepsBanked: 0, startedAt: Date.now() },
    });
    const result = ingestSteps(player, 100); // 4 x 25
    assert.equal(result.actions, 4);
    assert.equal(result.stepsConsumed, 100);
    assert.equal(countOf(result.player, 'birch_log'), 4);
    assert.equal(result.player.skills.woodcutting.xp, 32); // 4 x 8
  });

  test('steps still count towards the lifetime total when idle', () => {
    const result = ingestSteps(newPlayer(), 500);
    assert.equal(result.player.totalSteps, 500);
    assert.equal(result.actions, 0);
  });

  test('enough xp raises the level and emits an event', () => {
    const player = newPlayer({
      current: { activityId: 'chop_birch', stepsBanked: 0, startedAt: Date.now() },
    });
    const result = ingestSteps(player, 25 * 30); // 240 woodcutting xp
    assert.ok(result.player.skills.woodcutting.level > 1);
    assert.ok(result.events.some(e => e.kind === 'level'));
  });

  test('a negative or zero step count changes nothing', () => {
    const before = newPlayer();
    assert.deepEqual(ingestSteps(before, 0).player, before);
    assert.deepEqual(ingestSteps(before, -50).player, before);
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

  test('starting an activity banks no steps initially', () => {
    const result = startActivity(newPlayer(), 'chop_birch');
    assert.equal(result.player.current!.activityId, 'chop_birch');
    assert.equal(result.player.current!.stepsBanked, 0);
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
      current: { activityId: 'mine_copper', stepsBanked: 500, startedAt: Date.now() },
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
      current: { activityId: 'mine_copper', stepsBanked: 500, startedAt: Date.now() },
    });
    assert.throws(() => craft(player, 'smelt_bronze'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('crafting without enough banked steps is refused', () => {
    const player = newPlayer({
      inventory: [{ item: 'copper_ore', count: 4 }],
      current: { activityId: 'mine_copper', stepsBanked: 5, startedAt: Date.now() },
    });
    assert.throws(() => craft(player, 'smelt_bronze'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('crafting below the required level is refused', () => {
    const player = newPlayer({
      inventory: [{ item: 'iron_ore', count: 4 }],
      current: { activityId: 'mine_iron', stepsBanked: 500, startedAt: Date.now() },
    });
    // smelt_iron needs smithing level 8, the player is level 1
    assert.throws(() => craft(player, 'smelt_iron'),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('an exhausted input is dropped from the inventory rather than left at zero', () => {
    const player = newPlayer({
      inventory: [{ item: 'copper_ore', count: 2 }],
      current: { activityId: 'mine_copper', stepsBanked: 100, startedAt: Date.now() },
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
