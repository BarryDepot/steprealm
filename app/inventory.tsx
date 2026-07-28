// Inventory view. Resources and tools in two groups; tapping a tool equips it
// for its own skill. The server rejects equipping anything not owned.

import { Pressable, ScrollView, Text, View } from 'react-native';

import { itemById } from '../src/content/starterRegion';
import { useGameStore } from '../src/state/gameStore';
import { palette, styles } from '../src/ui/styles';
import type { ItemDef } from '../src/types';

function prettyName(id: string) {
  return itemById(id)?.name ?? id.replace(/_/g, ' ');
}

export default function Inventory() {
  const inventory = useGameStore(s => s.player.inventory);
  const equipped  = useGameStore(s => s.player.equipped);
  const busy      = useGameStore(s => s.busy);
  const equip     = useGameStore(s => s.equipTool);

  const enriched = inventory
    .map(e => ({ ...e, def: itemById(e.item) }))
    .filter((e): e is typeof e & { def: ItemDef } => !!e.def);

  const resources = enriched.filter(e => e.def.kind === 'resource');
  const tools     = enriched.filter(e => e.def.kind === 'tool');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Inventory</Text>

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

      <Text style={styles.sectionLabel}>Tools</Text>
      {tools.length === 0 && <Text style={styles.textDim}>None yet.</Text>}
      {tools.map(e => {
        if (!e.def.tool) return null;
        const isEquipped = equipped[e.def.tool.skill] === e.item;
        return (
          <Pressable
            key={e.item}
            disabled={busy || isEquipped}
            onPress={() => void equip(e.item)}
            style={[styles.panel, isEquipped && { borderColor: palette.accent }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{prettyName(e.item)}</Text>
              <Text style={styles.textDim}>
                {isEquipped ? 'Equipped' : 'Tap to equip'}
              </Text>
            </View>
            <Text style={styles.textDim}>
              {e.def.tool.skill} · -{Math.round(e.def.tool.efficiency * 100)}% step cost
              {e.def.rarity ? ` · ${e.def.rarity}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
