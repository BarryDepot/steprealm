// Treasure box drops.

import { items } from '../content';
import type { ItemId, Rarity, SkillId } from '../types';

/**
 * Chance of a chest per completed quest.
 *
 * This was 1-in-200 when the unit of progress was a single action and a quest
 * was five of them, so a chest averaged once per forty quests. Once quests
 * became the unit and the roll moved to one per quest, that rate left a player
 * walking tens of thousands of steps between drops — a reward tier nobody
 * would see during a demonstration, or plausibly ever.
 *
 * 1-in-8 puts a chest roughly within an evening's walking: at the starter
 * quests' 50-60 steps, around 400 steps between drops on average. Frequent
 * enough that the tier is visibly part of the game, rare enough that crafting
 * remains the reliable route to a better tool rather than an afterthought.
 */
const DROP_CHANCE_PER_QUEST = 1 / 8;

// Rarity roll - this gets called when a drop has already been confirmed.
function rollRarity(): Rarity {
  const r = Math.random();
  if (r < 0.05) return 'epic';
  if (r < 0.30) return 'rare';
  return 'common';
}

// Pick a tool that matches both the producing skill and the rolled rarity.
// Falls back to any tool of that skill if no exact rarity match.
function pickToolForDrop(skill: SkillId, rarity: Rarity): ItemId | null {
  const matches = items.filter(i =>
    i.kind === 'tool' && i.tool?.skill === skill && i.rarity === rarity);
  if (matches.length > 0) {
    return matches[Math.floor(Math.random() * matches.length)].id;
  }
  // Soft fallback - any tool for this skill
  const anyForSkill = items.filter(i =>
    i.kind === 'tool' && i.tool?.skill === skill);
  if (anyForSkill.length === 0) return null;
  return anyForSkill[Math.floor(Math.random() * anyForSkill.length)].id;
}

export interface LootRoll {
  dropped: boolean;
  item?: ItemId;
  rarity?: Rarity;
}

// Call once per completed quest. Returns whether a chest dropped and what was
// inside if so. For now one chest = one piece of gear, no decoupling.
export function rollLoot(skill: SkillId): LootRoll {
  if (Math.random() >= DROP_CHANCE_PER_QUEST) return { dropped: false };
  const rarity = rollRarity();
  const tool = pickToolForDrop(skill, rarity);
  if (!tool) return { dropped: false };
  return { dropped: true, item: tool, rarity };
}
