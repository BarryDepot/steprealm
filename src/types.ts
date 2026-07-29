// Core domain types for the game world.
// Kept deliberately small for the MVP - three skills, one region.

export type SkillId = 'woodcutting' | 'mining' | 'smithing';

export type ItemId = string; // simple string keys, e.g. 'birch_log'

export type Rarity = 'common' | 'rare' | 'epic';

export interface Skill {
  id: SkillId;
  name: string;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'resource' | 'tool';
  // Tools only - which skill they affect and how much they cut step cost by.
  tool?: {
    skill: SkillId;
    efficiency: number; // 0.15 = 15% reduction in step cost
  };
  rarity?: Rarity; // mostly for tools that drop from chests
}

// A quest: walk targetSteps, then collect a flat reward. There is no
// per-action subdivision — the step target is the whole of the requirement.
export interface Activity {
  id: string;
  name: string;
  skill: SkillId;
  targetSteps: number; // steps to finish the quest; tools reduce this
  yieldItem: ItemId;   // granted once, on collection
  yieldCount: number;
  xpReward: number;    // granted once, on collection
  minLevel: number;    // skill level required
}

// A place in the world.
//
// The MVP ships one unlocked region; the rest are declared so the world has a
// visible shape beyond its first area. Locked regions carry no activities and
// nothing reads them except the World screen — they are a roadmap rendered
// from data rather than a mockup drawn in a screen.
export interface Region {
  id: string;
  name: string;
  blurb: string;
  unlocked: boolean;
  /** Activity ids available here. Empty until a region is built. */
  activityIds: string[];
  /** The region's town, if it has one. */
  town?: Town;
  /**
   * Skills the region deals in. Display names rather than SkillId, because a
   * locked region names skills the game does not implement yet.
   */
  skills: string[];
}

export interface Town {
  name: string;
  /** The one place inside the town you can currently visit. */
  location: string;
  blurb: string;
}

// Crafting recipe (consumed at the forge / workshop).
export interface Recipe {
  id: string;
  name: string;
  skill: SkillId;
  inputs: Array<{ item: ItemId; count: number }>;
  output: { item: ItemId; count: number };
  xpReward: number;
  minLevel: number;
  stepCost: number; // crafting also consumes steps in the WalkScape model
}

// Player state
export interface SkillProgress {
  xp: number;
  level: number; // derived but cached for cheap reads
}

export interface InventoryEntry {
  item: ItemId;
  count: number;
}

// The quest currently running, if any. Null when player is idle.
//
// Rewards are not granted as the player walks — the quest is collected once
// totalSteps reaches the activity's (tool-adjusted) targetSteps, and the
// reward it pays out is read from the activity definition at that point.
//
// The two counters are deliberately separate. totalSteps only ever grows and
// measures progress towards the target; stepsBanked is a spendable pool that
// crafting draws down, so a trip to the forge cannot undo quest progress.
export interface CurrentActivity {
  activityId: string;
  stepsBanked: number; // spendable steps, consumed by crafting recipes
  totalSteps: number;  // progress towards the quest target
  startedAt: number;   // unix ms
}

export interface Player {
  name: string;
  totalSteps: number;
  skills: Record<SkillId, SkillProgress>;
  inventory: InventoryEntry[];
  equipped: Partial<Record<SkillId, ItemId>>; // one tool slot per skill
  current: CurrentActivity | null;
}
