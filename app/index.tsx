// Home screen — skill levels, the activity lineup, and step-sync status.
//
// Step input now comes from the device pedometer rather than the dev buttons.
// A manual entry remains, but only as a fallback when the pedometer is
// genuinely unavailable (the iOS Simulator has no motion hardware), so the app
// can still be demonstrated without a physical walk.

import { Link, router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { activities, activityById, skills } from '../src/content/starterRegion';
import { progressInLevel } from '../src/game/xp';
import { effectiveTargetSteps } from '../src/game/tick';
import { useGameStore } from '../src/state/gameStore';
import { usePedometer } from '../src/health/usePedometer';
import { AnimatedCounter, AnimatedProgressBar } from '../src/ui/AnimatedProgress';
import { palette, styles } from '../src/ui/styles';

export default function Home() {
  const player          = useGameStore(s => s.player);
  const ready           = useGameStore(s => s.ready);
  const busy            = useGameStore(s => s.busy);
  const offline         = useGameStore(s => s.offline);
  const error           = useGameStore(s => s.error);
  const pending         = useGameStore(s => s.pending);
  const lastSyncAt      = useGameStore(s => s.lastSyncAt);
  const bootstrap       = useGameStore(s => s.bootstrap);
  const reportSteps     = useGameStore(s => s.reportSteps);
  const startActivity   = useGameStore(s => s.startActivity);
  const claimQuest      = useGameStore(s => s.claimQuest);
  const clearError      = useGameStore(s => s.clearError);
  const setUnsyncedSteps = useGameStore(s => s.setUnsyncedSteps);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  const onSteps = useCallback(
    (steps: number, from: Date, to: Date) => reportSteps(steps, from, to),
    [reportSteps]
  );

  const { status, liveSteps, unsyncedSteps } = usePedometer({
    onSteps,
    lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : null,
    enabled: ready,
  });

  // The activity screen doesn't run its own pedometer subscription — this
  // screen stays mounted underneath it in the stack, so the store is how the
  // live count reaches whichever screen is on top.
  useEffect(() => {
    setUnsyncedSteps(unsyncedSteps);
  }, [unsyncedSteps, setUnsyncedSteps]);

  const begin = async (activityId: string) => {
    await startActivity(activityId);
    if (!useGameStore.getState().error) router.push('/activity');
  };

  // The quest in progress, if any, resolved against the content definitions so
  // the card can show its target without another server round trip.
  const activeQuest = player.current
    ? activityById(player.current.activityId) ?? null
    : null;
  const questTarget = activeQuest ? effectiveTargetSteps(activeQuest, player) : 0;
  const questWalked = activeQuest
    ? Math.min(questTarget, player.current!.totalSteps + unsyncedSteps)
    : 0;
  const questDone = !!activeQuest && questWalked >= questTarget;

  if (!ready) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={palette.accent} />
        <Text style={[styles.textDim, { marginTop: 12 }]}>Waking the realm…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Disenchanted Forest</Text>
      <Text style={styles.textDim}>
        Total steps walked: {player.totalSteps.toLocaleString()}
        {liveSteps > 0 ? `  ·  +${liveSteps} since opening` : ''}
      </Text>

      {offline && (
        <Pressable
          disabled={busy}
          onPress={() => void bootstrap()}
          style={[styles.panel, { borderColor: palette.bad, marginTop: 12 }]}
        >
          <Text style={styles.text}>
            {busy ? 'Reconnecting…' : 'Offline — progress is saved on this device.'}
          </Text>
          <Text style={styles.textDim}>
            {pending.length > 0
              ? `${pending.length} step batch${pending.length === 1 ? '' : 'es'} waiting to sync.`
              : 'Tap to retry. A sleeping free-tier server can take a minute to wake.'}
          </Text>
        </Pressable>
      )}

      {error && (
        <Pressable onPress={clearError} style={[styles.panel, { borderColor: palette.bad, marginTop: 12 }]}>
          <Text style={styles.text}>{error}</Text>
          <Text style={styles.textDim}>Tap to dismiss</Text>
        </Pressable>
      )}

      {status === 'denied' && (
        <View style={[styles.panel, { borderColor: palette.bad, marginTop: 12 }]}>
          <Text style={styles.text}>Motion access denied.</Text>
          <Text style={styles.textDim}>
            Enable Motion &amp; Fitness for this app in Settings to earn from walking.
          </Text>
        </View>
      )}

      {activeQuest && player.current && (
        <>
          <Text style={styles.sectionLabel}>Active quest</Text>
          <View style={[styles.panel, questDone && { borderColor: palette.good }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{activeQuest.name}</Text>
              <AnimatedCounter
                value={questWalked}
                style={styles.textDim}
                format={n => `${n} / ${questTarget} steps`}
              />
            </View>
            <AnimatedProgressBar
              progress={questTarget > 0 ? questWalked / questTarget : 0}
              height={6}
              colour={questDone ? palette.good : palette.accent}
            />

            <Pressable
              disabled={busy}
              onPress={() => {
                if (questDone) void claimQuest();
                else router.push('/activity');
              }}
              style={[styles.button, { marginTop: 12 }, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.buttonText}>
                {questDone ? 'Collect' : 'View quest'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>Skills</Text>
      {skills.map(skill => {
        const prog = player.skills[skill.id];
        const pct  = Math.round(progressInLevel(prog.xp) * 100);
        return (
          <View key={skill.id} style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{skill.name}</Text>
              <Text style={styles.textDim}>Lv {prog.level}  |  {prog.xp} xp</Text>
            </View>
            <View style={{
              height: 6, backgroundColor: palette.panelEdge, borderRadius: 3,
              marginTop: 8, overflow: 'hidden',
            }}>
              <View style={{
                width: `${pct}%`, height: '100%', backgroundColor: palette.accent,
              }} />
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionLabel}>
        {activeQuest ? 'Quests — finish the active one first' : 'Quests'}
      </Text>
      {activities.map(act => {
        const target = effectiveTargetSteps(act, player);
        const locked = player.skills[act.skill].level < act.minLevel;
        // Starting a quest replaces the running one, discarding uncollected
        // progress — so while one is active the rest are held shut rather
        // than quietly throwing away what the player has walked for.
        const blocked = locked || busy || !!activeQuest;
        return (
          <Pressable
            key={act.id}
            disabled={blocked}
            onPress={() => void begin(act.id)}
            style={[styles.panel, blocked && { opacity: 0.5 }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{act.name}</Text>
              <Text style={styles.textDim}>{target} steps</Text>
            </View>
            <Text style={styles.textDim}>
              {act.skill} · {act.yieldCount}x {act.yieldItem.replace(/_/g, ' ')} · +{act.xpReward} xp
              {locked ? `  (req lv ${act.minLevel})` : ''}
            </Text>
          </Pressable>
        );
      })}

      {status === 'unavailable' && (
        <>
          <Text style={styles.sectionLabel}>Manual entry — no pedometer on this device</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[100, 1000].map(n => (
              <Pressable
                key={n}
                disabled={busy}
                onPress={() => void reportSteps(n, new Date(), new Date())}
                style={[styles.ghostButton, { flex: 1 }, busy && { opacity: 0.5 }]}
              >
                <Text style={styles.ghostButtonText}>+{n.toLocaleString()} steps</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Link href="/inventory" asChild>
          <Pressable style={[styles.button, { flex: 1 }]}>
            <Text style={styles.buttonText}>Inventory</Text>
          </Pressable>
        </Link>
        <Link href="/forge" asChild>
          <Pressable style={[styles.button, { flex: 1 }]}>
            <Text style={styles.buttonText}>Forge</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
