// Treasure box drops. WalkScape uses roughly 1-in-200 per completed action
// from what I saw in the dev video. I'll keep that rate as a starting point
// and tune it later if the numbers feel too stingy in testing.

import { items } from '../content/starterRegion';
import type { ItemId, Rarity, SkillId } from '../types';

const BASE_DROP_CHANCE = 1 / 200;

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

// Call once per completed action. Returns whether a chest dropped and what
// was inside if so. For now one chest = one piece of gear, no decoupling.
export function rollLoot(skill: SkillId): LootRoll {
  if (Math.random() >= BASE_DROP_CHANCE) return { dropped: false };
  const rarity = rollRarity();
  const tool = pickToolForDrop(skill, rarity);
  if (!tool) return { dropped: false };
  return { dropped: true, item: tool, rarity };
}
