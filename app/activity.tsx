// Live activity screen. Shows what's running, progress to the next completed
// action, and the server-authored event feed.

import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { activityById } from '../src/content/starterRegion';
import { effectiveStepCost } from '../src/game/tick';
import { useGameStore } from '../src/state/gameStore';
import { palette, styles } from '../src/ui/styles';

export default function ActivityScreen() {
  const player = useGameStore(s => s.player);
  const log    = useGameStore(s => s.log);
  const busy   = useGameStore(s => s.busy);
  const stop   = useGameStore(s => s.stopActivity);

  const act = useMemo(() => {
    if (!player.current) return null;
    return activityById(player.current.activityId) ?? null;
  }, [player.current]);

  if (!player.current || !act) {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>Nothing running.</Text>
        <Pressable onPress={() => router.back()} style={[styles.button, { marginTop: 16 }]}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const cost   = effectiveStepCost(act, player);
  const banked = player.current.stepsBanked;
  const pct    = Math.min(100, Math.round((banked / cost) * 100));

  // Event colour follows its kind, so a chest drop reads differently from a
  // routine yield without needing an icon set.
  const colourFor = (kind: string) =>
    kind === 'loot' ? palette.accent
    : kind === 'level' ? palette.good
    : palette.textDim;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>{act.name}</Text>
      <Text style={styles.textDim}>
        {cost} steps per action · +{act.xpReward} {act.skill} xp
      </Text>

      <View style={[styles.panel, { marginTop: 18 }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.text}>Progress to next</Text>
          <Text style={styles.textDim}>{banked} / {cost}</Text>
        </View>
        <View style={{
          height: 8, backgroundColor: palette.panelEdge, borderRadius: 4,
          marginTop: 8, overflow: 'hidden',
        }}>
          <View style={{
            width: `${pct}%`, height: '100%', backgroundColor: palette.accent,
          }} />
        </View>
        <Text style={[styles.textDim, { marginTop: 8 }]}>
          Keep walking — steps are collected when you reopen the app.
        </Text>
      </View>

      <Pressable
        disabled={busy}
        onPress={() => { void stop().then(() => router.back()); }}
        style={[styles.button, { marginTop: 16 }, busy && { opacity: 0.5 }]}
      >
        <Text style={styles.buttonText}>Stop activity</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Recent events</Text>
      {log.length === 0 && <Text style={styles.textDim}>Nothing yet — walk around.</Text>}
      {log.map((entry, i) => (
        <Text
          key={`${i}-${entry.message}`}
          style={[styles.textDim, { marginBottom: 4, color: colourFor(entry.kind) }]}
        >
          {entry.message}
        </Text>
      ))}
    </ScrollView>
  );
}
