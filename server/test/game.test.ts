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
import { effectiveTargetSteps, computeTick } from '../src/game/tick';
import { levelFromXp, xpForLevel, progressInLevel } from '../src/game/xp';
import { rollLoot } from '../src/game/loot';
import { activityById, itemById, items, recipeById, recipes } from '../src/content';
import type { CurrentActivity, Player, Rarity } from '../src/types';

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
    startedAt: Date.now(),
    ...overrides,
  };
}

// Loot is a 1-in-8 roll per quest, so any test asserting an exact
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

describe('step target and tools', () => {
  test('an unequipped skill walks the full target', () => {
    const player = newPlayer({ equipped: {} });
    const act = activityById('chop_birch')!;
    assert.equal(effectiveTargetSteps(act, player), act.targetSteps);
  });

  test('the starter hatchet gives no discount', () => {
    const act = activityById('chop_birch')!;
    assert.equal(effectiveTargetSteps(act, newPlayer()), act.targetSteps);
  });

  test('a bronze hatchet reduces the target by 15 per cent', () => {
    const player = newPlayer({ equipped: { woodcutting: 'bronze_hatchet' } });
    const act = activityById('chop_birch')!; // 50 steps base
    assert.equal(effectiveTargetSteps(act, player), 43); // round(50 * 0.85)
  });

  test('a tool never reduces the target below one step', () => {
    const player = newPlayer({ equipped: { woodcutting: 'iron_hatchet' } });
    const act = activityById('chop_birch')!;
    assert.ok(effectiveTargetSteps(act, player) >= 1);
  });

  test('the discount applies to the skill that owns the tool, not others', () => {
    const player = newPlayer({ equipped: { woodcutting: 'bronze_hatchet' } });
    const mining = activityById('mine_copper')!;
    assert.equal(effectiveTargetSteps(mining, player), mining.targetSteps);
  });
});

describe('quest progress', () => {
  // chop_birch is a 50-step quest with the starter hatchet equipped.
  test('steps short of the target leave the quest unfinished', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const tick = computeTick(player, 10)!;
    assert.equal(tick.stepsTowardsTarget, 10);
    assert.equal(tick.targetSteps, 50);
    assert.equal(tick.complete, false);
  });

  test('progress accumulates across separate batches', () => {
    let player = newPlayer({ current: quest('chop_birch') });
    player = ingestSteps(player, 30).player;
    assert.equal(player.current!.totalSteps, 30);

    const result = ingestSteps(player, 20); // 50 total — exactly the target
    assert.equal(result.player.current!.totalSteps, 50);
    assert.equal(result.questsCompleted, 1);
  });

  test('reaching the target finishes the quest', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 50);
    assert.equal(result.questsCompleted, 1);
    assert.equal(computeTick(result.player, 0)!.complete, true);
  });

  test('walking grants no items or xp until the quest is collected', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 200); // well past the target

    assert.equal(countOf(result.player, 'birch_log'), 0);
    assert.equal(result.player.skills.woodcutting.xp, 0);
    // Only the two starter tools — no loot was granted either.
    assert.equal(result.player.inventory.length, 2);
  });

  test('an equipped tool brings the target closer', () => {
    const player = newPlayer({
      equipped: { woodcutting: 'bronze_hatchet' },
      current: quest('chop_birch'),
    });
    // 43 steps rather than 50 with the 15 per cent bronze discount.
    const result = ingestSteps(player, 43);
    assert.equal(result.questsCompleted, 1);
  });

  test('surplus steps past the target still bank for crafting', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 500);

    assert.equal(result.player.current!.stepsBanked, 500);
    assert.equal(result.player.current!.totalSteps, 500);
  });

  test('a finished quest keeps banking steps without completing again', () => {
    const done = newPlayer({
      current: quest('chop_birch', { totalSteps: 50, stepsBanked: 50 }),
    });
    const result = ingestSteps(done, 100);

    assert.equal(result.questsCompleted, 0);
    assert.equal(result.player.current!.stepsBanked, 150);
  });

  test('reaching the target announces completion exactly once', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const finished = ingestSteps(player, 50);
    assert.equal(finished.events.filter(e => e.kind === 'system').length, 1);

    // A later sync against an uncollected quest must not re-announce it.
    const later = ingestSteps(finished.player, 100);
    assert.equal(later.events.filter(e => e.kind === 'system').length, 0);
  });

  test('walking feeds the quest target and the crafting pool alike', () => {
    const player = newPlayer({ current: quest('chop_birch') });
    const result = ingestSteps(player, 30);
    assert.equal(result.player.current!.totalSteps, 30);
    assert.equal(result.player.current!.stepsBanked, 30);
  });

  test('steps still count towards the lifetime total when idle', () => {
    const result = ingestSteps(newPlayer(), 500);
    assert.equal(result.player.totalSteps, 500);
    assert.equal(result.questsCompleted, 0);
  });

  test('a negative or zero step count changes nothing', () => {
    const before = newPlayer();
    assert.deepEqual(ingestSteps(before, 0).player, before);
    assert.deepEqual(ingestSteps(before, -50).player, before);
  });
});

describe('collecting a quest', () => {
  // chop_birch: walk 50 steps for 1 birch log and 8 xp.
  const finished = () => newPlayer({
    current: quest('chop_birch', { totalSteps: 50, stepsBanked: 50 }),
  });

  test('collecting grants the quest yield', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(countOf(result.player, 'birch_log'), 1);
  });

  test('collecting grants the quest xp', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(result.player.skills.woodcutting.xp, 8);
  });

  test('collecting clears the quest', () => {
    const result = withoutLoot(() => claimQuest(finished()));
    assert.equal(result.player.current, null);
  });

  test('an unfinished quest cannot be collected', () => {
    const player = newPlayer({
      current: quest('chop_birch', { totalSteps: 49 }),
    });
    assert.throws(() => claimQuest(player),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('an unfinished quest is left untouched by a refused collection', () => {
    const player = newPlayer({
      current: quest('chop_birch', { totalSteps: 49 }),
    });
    assert.throws(() => claimQuest(player));
    assert.equal(player.current!.totalSteps, 49);
    assert.equal(countOf(player, 'birch_log'), 0);
  });

  test('a tool discount lets a quest be collected earlier', () => {
    const player = newPlayer({
      equipped: { woodcutting: 'bronze_hatchet' },
      current: quest('chop_birch', { totalSteps: 43 }),
    });
    // 43 steps is short of the 50-step base but meets the discounted target.
    const result = withoutLoot(() => claimQuest(player));
    assert.equal(countOf(result.player, 'birch_log'), 1);
  });

  test('collecting with no quest running is refused', () => {
    assert.throws(() => claimQuest(newPlayer()),
      (err: unknown) => err instanceof GameRuleError);
  });

  test('loot is rolled once per completed quest', () => {
    const original = Math.random;
    Math.random = () => 0; // guarantees a drop, and the epic tier with it
    try {
      const result = claimQuest(finished());
      // Exactly one chest, however many rewards the quest itself paid out.
      assert.equal(result.events.filter(e => e.kind === 'loot').length, 1);
      assert.equal(countOf(result.player, 'steel_hatchet'), 1);
    } finally {
      Math.random = original;
    }
  });

  test('a larger quest pays its own flat reward', () => {
    const player = newPlayer({
      skills: {
        woodcutting: { xp: 0, level: 1 },
        mining: { xp: 0, level: 1 },
        smithing: { xp: 0, level: 1 },
      },
      current: quest('mine_copper', { totalSteps: 60 }),
    });
    const result = withoutLoot(() => claimQuest(player));
    assert.equal(countOf(result.player, 'copper_ore'), 2);
    assert.equal(result.player.skills.mining.xp, 20);
  });

  test('crossing a level threshold on collection emits a level event', () => {
    const player = newPlayer({
      // 8 xp from this quest tips this over the 162 needed for level 2.
      skills: {
        woodcutting: { xp: 160, level: 1 },
        mining: { xp: 0, level: 1 },
        smithing: { xp: 0, level: 1 },
      },
      current: quest('chop_birch', { totalSteps: 50 }),
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
    assert.equal(result.player.current!.totalSteps, 0);
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

  // The epic tier is only reachable by crafting or a rare drop, so if this
  // chain does not resolve the tier is decorative.
  describe('the crafting ladder', () => {
    const smith = (level: number, inventory: Player['inventory']) => newPlayer({
      skills: {
        woodcutting: { xp: 0, level: 1 },
        mining: { xp: 0, level: 1 },
        smithing: { xp: xpForLevel(level), level },
      },
      inventory,
      current: quest('mine_iron', { stepsBanked: 500 }),
    });

    test('iron bars forge into the rare tools', () => {
      const hatchet = craft(smith(10, [
        { item: 'iron_bar', count: 2 },
        { item: 'oak_log', count: 1 },
      ]), 'craft_iron_hatchet');
      assert.equal(countOf(hatchet.player, 'iron_hatchet'), 1);

      const pickaxe = craft(smith(12, [
        { item: 'iron_bar', count: 3 },
        { item: 'oak_log', count: 1 },
      ]), 'craft_iron_pickaxe');
      assert.equal(countOf(pickaxe.player, 'iron_pickaxe'), 1);
    });

    test('iron ore and oak smelt into a steel bar', () => {
      const player = smith(14, [
        { item: 'iron_ore', count: 3 },
        { item: 'oak_log', count: 2 },
      ]);
      const result = craft(player, 'smelt_steel');
      assert.equal(countOf(result.player, 'steel_bar'), 1);
      assert.equal(result.player.skills.smithing.xp, xpForLevel(14) + 40);
    });

    test('steel bars forge into the epic tools', () => {
      const hatchet = craft(smith(16, [
        { item: 'steel_bar', count: 2 },
        { item: 'oak_log', count: 1 },
      ]), 'craft_steel_hatchet');
      assert.equal(countOf(hatchet.player, 'steel_hatchet'), 1);

      const pickaxe = craft(smith(18, [
        { item: 'steel_bar', count: 3 },
        { item: 'oak_log', count: 1 },
      ]), 'craft_steel_pickaxe');
      assert.equal(countOf(pickaxe.player, 'steel_pickaxe'), 1);
    });

    test('every tool in the game is craftable', () => {
      // Loot is a bonus route, never the only one. A tool reachable solely by
      // a 1-in-8 roll would leave a tier the player cannot work towards.
      const craftable = new Set(recipes.map(r => r.output.item));
      const starters = new Set(['basic_hatchet', 'basic_pickaxe']);

      for (const item of items) {
        if (item.kind !== 'tool' || starters.has(item.id)) continue;
        assert.ok(craftable.has(item.id),
          `${item.id} has no recipe, so it can only ever drop`);
      }
    });

    test('every resource is consumed by something', () => {
      // A resource with no use is dead weight in the inventory and a dead end
      // in the chain — iron_bar was exactly that before the iron tools.
      const consumed = new Set(recipes.flatMap(r => r.inputs.map(i => i.item)));

      for (const item of items) {
        if (item.kind !== 'resource') continue;
        assert.ok(consumed.has(item.id),
          `${item.id} is produced but never used by any recipe`);
      }
    });

    test('each tier is gated above the one below it', () => {
      // Reads the ladder in order rather than asserting fixed numbers, so
      // rebalancing stays free but inverting the progression does not.
      const ladder = [
        'craft_bronze_hatchet', 'craft_bronze_pickaxe',
        'craft_iron_hatchet', 'craft_iron_pickaxe',
        'craft_steel_hatchet', 'craft_steel_pickaxe',
      ].map(id => recipeById(id)!);

      for (let i = 1; i < ladder.length; i++) {
        assert.ok(ladder[i].minLevel > ladder[i - 1].minLevel,
          `${ladder[i].id} should require a higher level than ${ladder[i - 1].id}`);
        assert.ok(ladder[i].stepCost > ladder[i - 1].stepCost,
          `${ladder[i].id} should cost more steps than ${ladder[i - 1].id}`);
      }
    });

    test('a bar recipe unlocks before the tools that need it', () => {
      const pairs: Array<[string, string[]]> = [
        ['smelt_bronze', ['craft_bronze_hatchet', 'craft_bronze_pickaxe']],
        ['smelt_iron',   ['craft_iron_hatchet', 'craft_iron_pickaxe']],
        ['smelt_steel',  ['craft_steel_hatchet', 'craft_steel_pickaxe']],
      ];

      for (const [barId, toolIds] of pairs) {
        const bar = recipeById(barId)!;
        for (const toolId of toolIds) {
          assert.ok(recipeById(toolId)!.minLevel >= bar.minLevel,
            `${toolId} unlocks before ${barId}, which makes it uncraftable`);
        }
      }
    });

    test('the steel tools are epic and cut the step target by 45 per cent', () => {
      for (const id of ['steel_hatchet', 'steel_pickaxe']) {
        const def = itemById(id);
        assert.equal(def?.rarity, 'epic', `${id} should be epic`);
        assert.equal(def?.tool?.efficiency, 0.45);
      }

      const player = newPlayer({ equipped: { woodcutting: 'steel_hatchet' } });
      const act = activityById('chop_birch')!; // 50 steps base
      assert.equal(effectiveTargetSteps(act, player), 28); // round(50 * 0.55)
    });

    test('the steel chain is gated above the bronze chain', () => {
      const bronze = recipeById('craft_bronze_pickaxe')!;
      const steel = recipeById('craft_steel_pickaxe')!;
      assert.ok(steel.minLevel > bronze.minLevel);
      assert.ok(steel.stepCost > bronze.stepCost);
    });

    test('every recipe input is an item that exists', () => {
      for (const recipe of recipes) {
        for (const input of recipe.inputs) {
          assert.ok(itemById(input.item),
            `${recipe.id} needs ${input.item}, which is not in the item list`);
        }
        assert.ok(itemById(recipe.output.item),
          `${recipe.id} produces ${recipe.output.item}, which is not in the item list`);
      }
    });
  });
});

describe('loot rolls', () => {
  // Runs fn with Math.random pinned, then always restores it — a leaked stub
  // would silently determine the outcome of every later test in the file.
  function withRandom<T>(value: number, fn: () => T): T {
    const original = Math.random;
    Math.random = () => value;
    try {
      return fn();
    } finally {
      Math.random = original;
    }
  }

  test('no chest drops when the roll misses', () => {
    assert.equal(withRandom(0.99, () => rollLoot('woodcutting')).dropped, false);
  });

  test('the drop rate is one in eight quests', () => {
    // Just inside the threshold drops, exactly on it does not. Pins the rate
    // itself, so a change to the constant has to be a deliberate one.
    assert.equal(withRandom(0.124, () => rollLoot('woodcutting')).dropped, true);
    assert.equal(withRandom(0.125, () => rollLoot('woodcutting')).dropped, false);
  });

  test('the rate is generous enough to be reachable in play', () => {
    // Guards the intent behind the number rather than the number itself: at
    // the old 1-in-200 this quest tier meant tens of thousands of steps
    // between chests, which is what made the tier unreachable.
    let drops = 0;
    const trials = 4_000;
    for (let i = 0; i < trials; i++) {
      if (rollLoot('woodcutting').dropped) drops++;
    }
    const questsPerDrop = trials / Math.max(1, drops);
    assert.ok(questsPerDrop < 20,
      `expected a chest within 20 quests on average, got ${questsPerDrop.toFixed(1)}`);
  });

  test('a hit yields a tool belonging to the producing skill', () => {
    const roll = withRandom(0, () => rollLoot('mining'));
    assert.equal(roll.dropped, true);
    assert.ok(roll.item?.includes('pickaxe'),
      `mining should not drop ${roll.item}`);
  });

  test('every declared rarity can actually be rolled', () => {
    // rollRarity uses < 0.05 epic, < 0.30 rare, else common. Each rarity must
    // have a matching item or pickToolForDrop quietly falls back to another
    // tier, which is how epic came to be declared but unreachable.
    const tiers: Array<[number, Rarity]> = [
      [0.00, 'epic'],
      [0.20, 'rare'],
      [0.90, 'common'],
    ];

    for (const [roll, expected] of tiers) {
      // The drop check reads Math.random first, so force a hit, then let the
      // rarity roll see the value under test.
      let first = true;
      const original = Math.random;
      Math.random = () => {
        if (first) { first = false; return 0; } // guarantees the drop
        return roll;
      };
      try {
        const result = rollLoot('woodcutting');
        assert.equal(result.dropped, true, `${expected} tier should drop`);
        assert.equal(result.rarity, expected);
        const def = itemById(result.item!);
        assert.equal(def?.rarity, expected,
          `${expected} roll returned ${result.item}, which is ${def?.rarity}`);
      } finally {
        Math.random = original;
      }
    }
  });

  test('the epic tier drops the steel tools', () => {
    const wood = withRandom(0, () => rollLoot('woodcutting'));
    assert.equal(wood.rarity, 'epic');
    assert.equal(wood.item, 'steel_hatchet');

    const mine = withRandom(0, () => rollLoot('mining'));
    assert.equal(mine.rarity, 'epic');
    assert.equal(mine.item, 'steel_pickaxe');
  });

  test('smithing has no tools to drop, so it never yields a chest', () => {
    assert.equal(withRandom(0, () => rollLoot('smithing')).dropped, false);
  });
});
