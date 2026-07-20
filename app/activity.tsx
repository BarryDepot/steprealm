// Live quest screen. Shows what's running, progress towards the quest target,
// and the server-authored event feed.
//
// Rewards are not granted as actions land — they are collected in one go when
// the quest finishes, so this screen shows what is owed rather than what has
// already been banked into the inventory.

import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { activityById } from '../src/content/starterRegion';
import { effectiveTargetSteps } from '../src/game/tick';
import { useGameStore } from '../src/state/gameStore';
import { AnimatedCounter, AnimatedProgressBar } from '../src/ui/AnimatedProgress';
import { palette, styles } from '../src/ui/styles';

// "2 min ago" style formatting for the event feed. Recomputed on every
// render, which is frequent enough (the store updates on every pedometer
// tick while an activity is running) that entries stay roughly current
// without a dedicated timer.
function relativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

export default function ActivityScreen() {
  const player        = useGameStore(s => s.player);
  const log           = useGameStore(s => s.log);
  const busy          = useGameStore(s => s.busy);
  const unsyncedSteps = useGameStore(s => s.unsyncedSteps);
  const stop          = useGameStore(s => s.stopActivity);
  const claim         = useGameStore(s => s.claimQuest);

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

  const target = effectiveTargetSteps(act, player);

  // The server only learns about steps every flush; adding the pedometer's
  // own count in between makes the bar move as the player walks instead of
  // sitting still until the next sync. The reward is still decided entirely
  // by the server response — this is display only.
  const walked = Math.min(target, player.current.totalSteps + unsyncedSteps);
  const done   = walked >= target;

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
        Walk {target} steps · {act.yieldCount}x {act.yieldItem.replace(/_/g, ' ')} · +{act.xpReward} {act.skill} xp
      </Text>

      <View style={[styles.panel, { marginTop: 18 }, done && { borderColor: palette.good }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.text}>Quest progress</Text>
          <AnimatedCounter
            value={walked}
            style={styles.textDim}
            format={n => `${n} / ${target} steps`}
          />
        </View>
        <AnimatedProgressBar
          progress={walked / target}
          colour={done ? palette.good : palette.accent}
        />
        <Text style={[styles.textDim, { marginTop: 8 }]}>
          {done
            ? `Ready to collect: ${act.yieldCount}x ${act.yieldItem.replace(/_/g, ' ')} and ${act.xpReward} xp.`
            : 'Keep walking — the reward is handed over when the quest is finished.'}
        </Text>
      </View>

      <View style={[styles.panel, { marginTop: 12 }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.text}>Steps banked for crafting</Text>
          <Text style={styles.textDim}>
            {(player.current.stepsBanked + unsyncedSteps).toLocaleString()}
          </Text>
        </View>
      </View>

      {done && (
        <Pressable
          disabled={busy}
          onPress={() => {
            void claim().then(() => {
              // Collecting clears the quest, so this screen has nothing left
              // to show.
              if (!useGameStore.getState().player.current) router.back();
            });
          }}
          style={[styles.button, { marginTop: 16 }, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.buttonText}>{busy ? 'Collecting…' : 'Collect'}</Text>
        </Pressable>
      )}

      <Pressable
        disabled={busy}
        onPress={() => { void stop().then(() => router.back()); }}
        style={[styles.ghostButton, { marginTop: 12 }, busy && { opacity: 0.5 }]}
      >
        <Text style={styles.ghostButtonText}>
          {done ? 'Abandon (forfeits rewards)' : 'Abandon quest'}
        </Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Recent events</Text>
      {log.length === 0 && <Text style={styles.textDim}>Nothing yet — walk around.</Text>}
      {log.map((entry, i) => (
        <View key={`${i}-${entry.message}`} style={[styles.rowBetween, { marginBottom: 4 }]}>
          <Text style={[styles.textDim, { color: colourFor(entry.kind), flex: 1, marginRight: 8 }]}>
            {entry.message}
          </Text>
          <Text style={styles.textDim}>{relativeTime(entry.createdAt)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
