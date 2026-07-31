// Inventory view.
//
// Resources list what you hold. Tools list the full progression for each
// skill, owned or not, because the upgrade path is the main thing pulling a
// player forward and it used to be invisible until the item was already in
// hand — there was no way to learn a better hatchet existed, let alone how to
// get one.
//
// Tapping an owned tool equips it for its own skill. The server rejects
// equipping anything not owned, so the greyed-out rows are inert by rule as
// well as by disabled state.

import { Pressable, ScrollView, Text, View } from 'react-native';

import { items, itemById, recipes, skills } from '../../src/content/starterRegion';
import { useGameStore } from '../../src/state/gameStore';
import { palette, styles } from '../../src/ui/styles';
import type { ItemDef, SkillId } from '../../src/types';

function prettyName(id: string) {
  return itemById(id)?.name ?? id.replace(/_/g, ' ');
}

/**
 * How a tool is obtained, derived rather than written out by hand.
 *
 * Reading it from the recipe list means adding a recipe updates this text on
 * its own, and a tool that stops being craftable cannot keep claiming it is.
 * Every craftable tool can also drop, so the crafting route names the chest as
 * a second chance rather than pretending it is the only way in.
 */
function howToGet(def: ItemDef): string {
  const recipe = recipes.find(r => r.output.item === def.id);
  if (recipe) {
    return `Craft at the forge · smithing Lv ${recipe.minLevel}, or find one in a chest`;
  }
  // A tool with no recipe and no advantage is starting kit, not a reward.
  if ((def.tool?.efficiency ?? 0) === 0) return 'Starting equipment';
  return 'Rare drop from a treasure chest';
}

const rarityColour = (rarity?: string) =>
  rarity === 'epic' ? palette.good
  : rarity === 'rare' ? palette.accent
  : palette.textDim;

export default function Inventory() {
  const inventory = useGameStore(s => s.player.inventory);
  const equipped  = useGameStore(s => s.player.equipped);
  const busy      = useGameStore(s => s.busy);
  const equip     = useGameStore(s => s.equipTool);

  const countOf = (id: string) =>
    inventory.find(e => e.item === id)?.count ?? 0;

  const resources = inventory
    .map(e => ({ ...e, def: itemById(e.item) }))
    .filter((e): e is typeof e & { def: ItemDef } => e.def?.kind === 'resource');

  // Every tool in the game, grouped by the skill it serves and ordered from
  // starter to best, so each group reads as a progression ladder.
  const toolsForSkill = (skill: SkillId) =>
    items
      .filter(i => i.kind === 'tool' && i.tool?.skill === skill)
      .sort((a, b) => (a.tool?.efficiency ?? 0) - (b.tool?.efficiency ?? 0));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.sectionLabel}>Resources</Text>
      {resources.length === 0 && <Text style={styles.textDim}>None yet.</Text>}
      {resources.map(e => (
        <View key={e.item} style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.text}>{prettyName(e.item)}</Text>
            <Text style={styles.textDim}>x {e.count}</Text>
          </View>
        </View>
      ))}

      {skills.map(skill => {
        const tools = toolsForSkill(skill.id);
        if (tools.length === 0) return null; // smithing has no tools of its own

        return (
          <View key={skill.id}>
            <Text style={styles.sectionLabel}>{skill.name} tools</Text>
            {tools.map(def => {
              const owned = countOf(def.id) > 0;
              const isEquipped = equipped[skill.id] === def.id;
              const discount = Math.round((def.tool?.efficiency ?? 0) * 100);

              return (
                <Pressable
                  key={def.id}
                  disabled={!owned || busy || isEquipped}
                  onPress={() => void equip(def.id)}
                  style={[
                    styles.panel,
                    isEquipped && { borderColor: palette.accent },
                    // Unowned rows stay visible but read as unavailable.
                    !owned && { opacity: 0.45 },
                  ]}
                >
                  <View style={styles.rowBetween}>
                    <Text style={styles.text}>{def.name}</Text>
                    <Text style={styles.textDim}>
                      {isEquipped ? 'Equipped' : owned ? 'Tap to equip' : 'Not owned'}
                    </Text>
                  </View>

                  <Text style={styles.textDim}>
                    {discount === 0
                      ? 'No step reduction'
                      : `-${discount}% steps per quest`}
                    {def.rarity ? '  ·  ' : ''}
                    {def.rarity && (
                      <Text style={{ color: rarityColour(def.rarity) }}>
                        {def.rarity}
                      </Text>
                    )}
                  </Text>

                  {/* Only unowned tools need to explain themselves. */}
                  {!owned && (
                    <Text style={[styles.textDim, { marginTop: 4 }]}>
                      {howToGet(def)}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}
