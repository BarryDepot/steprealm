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

export interface Activity {
  id: string;
  name: string;
  skill: SkillId;
  stepCost: number;     // base steps per action, tools reduce this
  xpReward: number;
  yieldItem: ItemId;    // what you get per completed action
  minLevel: number;     // skill level required
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

// The current running activity, if any. Null when player is idle.
export interface CurrentActivity {
  activityId: string;
  stepsBanked: number; // accumulated steps not yet spent on a tick
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
