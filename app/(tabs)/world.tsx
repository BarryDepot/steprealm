// The world map.
//
// One unlocked region and the shape of what would come after it. Everything
// here is rendered from the `regions` list in content, so the locked entries
// are data rather than decoration — adding a region is a content edit.
//
// Presentational only. Locked regions are inert: they grant nothing, cannot be
// selected, and no rule reads them. The unlocked card is a shortcut to screens
// that already exist rather than a new way to do anything.

import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { activityById, regions } from '../../src/content/starterRegion';
import { useGameStore } from '../../src/state/gameStore';
import { palette, styles } from '../../src/ui/styles';
import type { Region } from '../../src/types';

function RegionCard({ region }: { region: Region }) {
  const player = useGameStore(s => s.player);

  const nodes = region.activityIds
    .map(id => activityById(id))
    .filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <View
      style={[
        styles.panel,
        { marginBottom: 12 },
        region.unlocked
          ? { borderColor: palette.accent }
          : { opacity: 0.45 },
      ]}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.text}>{region.name}</Text>
        <Text style={[
          styles.textDim,
          { color: region.unlocked ? palette.good : palette.textDim },
        ]}>
          {region.unlocked ? 'UNLOCKED' : 'LOCKED'}
        </Text>
      </View>

      <Text style={[styles.textDim, { marginTop: 4 }]}>{region.blurb}</Text>

      <Text style={[styles.textDim, { marginTop: 6 }]}>
        Skills: {region.skills.join(' · ')}
      </Text>

      {region.unlocked ? (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 12 }]}>
            Activity nodes
          </Text>
          {nodes.map(node => {
            const locked = player.skills[node.skill].level < node.minLevel;
            return (
              <View key={node.id} style={styles.rowBetween}>
                <Text style={[styles.textDim, { marginBottom: 2 }]}>
                  {node.name}
                </Text>
                <Text style={styles.textDim}>
                  {locked ? `Lv ${node.minLevel}` : `${node.targetSteps} steps`}
                </Text>
              </View>
            );
          })}

          {region.town && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 12 }]}>
                {region.town.name}
              </Text>
              <Text style={styles.textDim}>{region.town.blurb}</Text>

              <Pressable
                onPress={() => router.navigate('/forge')}
                style={[styles.ghostButton, { marginTop: 8 }]}
              >
                <Text style={styles.ghostButtonText}>
                  Visit {region.town.location}
                </Text>
              </Pressable>
            </>
          )}

          <Pressable
            onPress={() => router.navigate('/')}
            style={[styles.button, { marginTop: 12 }]}
          >
            <Text style={styles.buttonText}>Go to quests</Text>
          </Pressable>
        </>
      ) : (
        <Text style={[styles.textDim, { marginTop: 10, color: palette.accent }]}>
          Planned — future release
        </Text>
      )}
    </View>
  );
}

export default function World() {
  const unlockedCount = regions.filter(r => r.unlocked).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>The Realm</Text>
      <Text style={styles.textDim}>
        {unlockedCount} of {regions.length} regions open. The rest are mapped,
        not yet walked.
      </Text>

      <Text style={styles.sectionLabel}>Regions</Text>
      {regions.map(region => (
        <RegionCard key={region.id} region={region} />
      ))}
    </ScrollView>
  );
}
