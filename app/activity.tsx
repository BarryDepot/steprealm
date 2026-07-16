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
import { effectiveStepCost } from '../src/game/tick';
import { useGameStore } from '../src/state/gameStore';
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

  const cost      = effectiveStepCost(act, player);
  const completed = player.current.actionsCompleted;
  const done      = completed >= act.targetActions;

  // The server only learns about steps every flush; adding the pedometer's
  // own count in between makes the bar move as the player walks instead of
  // sitting still until the next sync. Rewards are still decided entirely by
  // the server response, this is display only.
  //
  // Once the quest is finished no further steps are spent on it, so the
  // step bar is pinned full rather than creeping towards an action that will
  // never be credited.
  const banked           = done ? cost : Math.min(cost, player.current.stepsBanked + unsyncedSteps);
  const pct              = Math.min(100, Math.round((banked / cost) * 100));
  const questPct         = Math.min(100, Math.round((completed / act.targetActions) * 100));
  const totalContributed = player.current.totalSteps + unsyncedSteps;

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
        {cost} steps per action · +{act.xpReward} {act.skill} xp each
      </Text>

      <View style={[styles.panel, { marginTop: 18 }, done && { borderColor: palette.good }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.text}>Quest progress</Text>
          <Text style={styles.textDim}>{completed} / {act.targetActions} actions</Text>
        </View>
        <View style={{
          height: 8, backgroundColor: palette.panelEdge, borderRadius: 4,
          marginTop: 8, overflow: 'hidden',
        }}>
          <View style={{
            width: `${questPct}%`, height: '100%',
            backgroundColor: done ? palette.good : palette.accent,
          }} />
        </View>
        <Text style={[styles.textDim, { marginTop: 8 }]}>
          {done
            ? `Ready to collect: ${act.targetActions}x ${act.yieldItem.replace(/_/g, ' ')} and ${act.xpReward * act.targetActions} xp.`
            : 'Rewards are handed over when the quest is finished.'}
        </Text>
      </View>

      {!done && (
        <View style={[styles.panel, { marginTop: 12 }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.text}>Progress to next action</Text>
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
            Keep walking — the bar tracks your steps as you go.
          </Text>
        </View>
      )}

      <View style={[styles.panel, { marginTop: 12 }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.text}>Total steps this activity</Text>
          <Text style={styles.textDim}>{totalContributed.toLocaleString()}</Text>
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
