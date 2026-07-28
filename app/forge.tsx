// The forge.
//
// Crafting is the only source of Smithing XP, so without this screen the third
// MVP skill is unreachable. Recipes cost banked steps as well as materials,
// which keeps walking as the game's single currency.

import { ScrollView, Pressable, Text, View } from 'react-native';

import { itemById, recipes } from '../src/content/starterRegion';
import { useGameStore } from '../src/state/gameStore';
import { palette, styles } from '../src/ui/styles';

const prettyName = (id: string) => itemById(id)?.name ?? id.replace(/_/g, ' ');

export default function Forge() {
  const player = useGameStore(s => s.player);
  const busy   = useGameStore(s => s.busy);
  const error  = useGameStore(s => s.error);
  const craft  = useGameStore(s => s.craft);
  const clear  = useGameStore(s => s.clearError);

  const countOf = (item: string) =>
    player.inventory.find(e => e.item === item)?.count ?? 0;

  const banked = player.current?.stepsBanked ?? 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Forge</Text>
      <Text style={styles.textDim}>
        Smithing Lv {player.skills.smithing.level} · {banked} steps banked
      </Text>

      {error && (
        <Pressable onPress={clear} style={[styles.panel, { borderColor: palette.bad, marginTop: 12 }]}>
          <Text style={styles.text}>{error}</Text>
          <Text style={styles.textDim}>Tap to dismiss</Text>
        </Pressable>
      )}

      {banked === 0 && (
        <Text style={[styles.textDim, { marginTop: 12 }]}>
          Start an activity and walk to bank steps before crafting.
        </Text>
      )}

      <Text style={styles.sectionLabel}>Recipes</Text>
      {recipes.map(recipe => {
        const levelOk  = player.skills[recipe.skill].level >= recipe.minLevel;
        const stepsOk  = banked >= recipe.stepCost;
        const inputsOk = recipe.inputs.every(i => countOf(i.item) >= i.count);
        const canCraft = levelOk && stepsOk && inputsOk && !busy;

        return (
          <Pressable
            key={recipe.id}
            disabled={!canCraft}
            onPress={() => void craft(recipe.id)}
            style={[styles.panel, !canCraft && { opacity: 0.5 }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{recipe.name}</Text>
              <Text style={styles.textDim}>{recipe.stepCost} steps</Text>
            </View>

            <Text style={[styles.textDim, { marginTop: 4 }]}>
              {recipe.inputs
                .map(i => `${prettyName(i.item)} x${i.count} (have ${countOf(i.item)})`)
                .join('  ·  ')}
            </Text>

            <Text style={[styles.textDim, { marginTop: 2 }]}>
              → {prettyName(recipe.output.item)} x{recipe.output.count} · +{recipe.xpReward} smithing xp
            </Text>

            {/* Only ever show the first unmet condition — listing all of them
                at once reads as noise when a recipe is simply not ready yet. */}
            {!levelOk && (
              <Text style={[styles.textDim, { color: palette.bad, marginTop: 4 }]}>
                Requires smithing level {recipe.minLevel}
              </Text>
            )}
            {levelOk && !inputsOk && (
              <Text style={[styles.textDim, { color: palette.bad, marginTop: 4 }]}>
                Missing materials
              </Text>
            )}
            {levelOk && inputsOk && !stepsOk && (
              <Text style={[styles.textDim, { color: palette.bad, marginTop: 4 }]}>
                Needs {recipe.stepCost - banked} more banked steps
              </Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
