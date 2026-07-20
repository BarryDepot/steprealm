// All starter-region content lives here. Treat this file as data, not logic -
// the game engine in src/game/* should never hardcode IDs from this list.

import type { Activity, ItemDef, Recipe, Skill } from './types';

export const skills: Skill[] = [
  { id: 'woodcutting', name: 'Woodcutting' },
  { id: 'mining',      name: 'Mining' },
  { id: 'smithing',    name: 'Smithing' },
];

export const items: ItemDef[] = [
  // Resources
  { id: 'birch_log',   name: 'Birch Log',   kind: 'resource' },
  { id: 'oak_log',     name: 'Oak Log',     kind: 'resource' },
  { id: 'copper_ore',  name: 'Copper Ore',  kind: 'resource' },
  { id: 'iron_ore',    name: 'Iron Ore',    kind: 'resource' },
  { id: 'bronze_bar',  name: 'Bronze Bar',  kind: 'resource' },
  { id: 'iron_bar',    name: 'Iron Bar',    kind: 'resource' },

  // Starter tools - given on first run.
  { id: 'basic_hatchet',  name: 'Basic Hatchet',  kind: 'tool',
    tool: { skill: 'woodcutting', efficiency: 0 },    rarity: 'common' },
  { id: 'basic_pickaxe',  name: 'Basic Pickaxe',  kind: 'tool',
    tool: { skill: 'mining',      efficiency: 0 },    rarity: 'common' },

  // Craftable upgrades
  { id: 'bronze_hatchet', name: 'Bronze Hatchet', kind: 'tool',
    tool: { skill: 'woodcutting', efficiency: 0.15 }, rarity: 'common' },
  { id: 'bronze_pickaxe', name: 'Bronze Pickaxe', kind: 'tool',
    tool: { skill: 'mining',      efficiency: 0.15 }, rarity: 'common' },
  { id: 'iron_hatchet',   name: 'Iron Hatchet',   kind: 'tool',
    tool: { skill: 'woodcutting', efficiency: 0.30 }, rarity: 'rare' },
  { id: 'iron_pickaxe',   name: 'Iron Pickaxe',   kind: 'tool',
    tool: { skill: 'mining',      efficiency: 0.30 }, rarity: 'rare' },
];

// Quests for the Disenchanted Forest, the starter region.
//
// targetSteps is scaled by the level gate rather than by the old per-action
// step costs: with a flat target the tier a quest unlocks at is the only
// meaningful difficulty signal left. The two level-1 quests are a short walk;
// by level 8 a quest is five times that. Rewards are set to hold the previous
// xp-per-step and items-per-step rates, so the change alters pacing rather
// than the rate of progression.
export const activities: Activity[] = [
  { id: 'chop_birch',   name: 'Chop Birch Tree', skill: 'woodcutting',
    targetSteps: 50,  yieldItem: 'birch_log',  yieldCount: 1, xpReward: 8,   minLevel: 1 },
  { id: 'chop_oak',     name: 'Chop Oak Tree',   skill: 'woodcutting',
    targetSteps: 150, yieldItem: 'oak_log',    yieldCount: 4, xpReward: 70,  minLevel: 5 },
  { id: 'mine_copper',  name: 'Mine Copper Vein', skill: 'mining',
    targetSteps: 60,  yieldItem: 'copper_ore', yieldCount: 2, xpReward: 20,  minLevel: 1 },
  { id: 'mine_iron',    name: 'Mine Iron Vein',   skill: 'mining',
    targetSteps: 250, yieldItem: 'iron_ore',   yieldCount: 5, xpReward: 110, minLevel: 8 },
];

export const recipes: Recipe[] = [
  { id: 'smelt_bronze', name: 'Smelt Bronze Bar', skill: 'smithing',
    inputs: [{ item: 'copper_ore', count: 2 }],
    output: { item: 'bronze_bar', count: 1 },
    xpReward: 12, minLevel: 1, stepCost: 20 },
  { id: 'smelt_iron',   name: 'Smelt Iron Bar', skill: 'smithing',
    inputs: [{ item: 'iron_ore', count: 1 }],
    output: { item: 'iron_bar', count: 1 },
    xpReward: 22, minLevel: 8, stepCost: 35 },

  { id: 'craft_bronze_hatchet', name: 'Bronze Hatchet', skill: 'smithing',
    inputs: [{ item: 'bronze_bar', count: 1 }, { item: 'birch_log', count: 1 }],
    output: { item: 'bronze_hatchet', count: 1 },
    xpReward: 30, minLevel: 3, stepCost: 50 },
  { id: 'craft_bronze_pickaxe', name: 'Bronze Pickaxe', skill: 'smithing',
    inputs: [{ item: 'bronze_bar', count: 2 }, { item: 'birch_log', count: 1 }],
    output: { item: 'bronze_pickaxe', count: 1 },
    xpReward: 45, minLevel: 5, stepCost: 75 },
];

// Helpers so screens don't have to know about array internals.
export const itemById = (id: string) => items.find(i => i.id === id);
export const activityById = (id: string) => activities.find(a => a.id === id);
export const recipeById = (id: string) => recipes.find(r => r.id === id);
