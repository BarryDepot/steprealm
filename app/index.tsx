// Home screen — skill levels, the activity lineup, and step-sync status.
//
// Step input now comes from the device pedometer rather than the dev buttons.
// A manual entry remains, but only as a fallback when the pedometer is
// genuinely unavailable (the iOS Simulator has no motion hardware), so the app
// can still be demonstrated without a physical walk.

import { Link, router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { activities, skills } from '../src/content/starterRegion';
import { progressInLevel } from '../src/game/xp';
import { effectiveStepCost } from '../src/game/tick';
import { useGameStore } from '../src/state/gameStore';
import { usePedometer } from '../src/health/usePedometer';
import { palette, styles } from '../src/ui/styles';

export default function Home() {
  const player        = useGameStore(s => s.player);
  const ready         = useGameStore(s => s.ready);
  const busy          = useGameStore(s => s.busy);
  const offline       = useGameStore(s => s.offline);
  const error         = useGameStore(s => s.error);
  const pending       = useGameStore(s => s.pending);
  const lastSyncAt    = useGameStore(s => s.lastSyncAt);
  const bootstrap     = useGameStore(s => s.bootstrap);
  const reportSteps   = useGameStore(s => s.reportSteps);
  const startActivity = useGameStore(s => s.startActivity);
  const clearError    = useGameStore(s => s.clearError);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  const onSteps = useCallback(
    (steps: number, from: Date, to: Date) => reportSteps(steps, from, to),
    [reportSteps]
  );

  const { status, liveSteps } = usePedometer({
    onSteps,
    lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : null,
    enabled: ready,
  });

  const begin = async (activityId: string) => {
    await startActivity(activityId);
    if (!useGameStore.getState().error) router.push('/activity');
  };

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
        <View style={[styles.panel, { borderColor: palette.bad, marginTop: 12 }]}>
          <Text style={styles.text}>Offline — progress is saved on this device.</Text>
          <Text style={styles.textDim}>
            {pending.length > 0
              ? `${pending.length} step batch${pending.length === 1 ? '' : 'es'} waiting to sync.`
              : 'Steps will sync when the server is reachable.'}
          </Text>
        </View>
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

      <Text style={styles.sectionLabel}>Activities</Text>
      {activities.map(act => {
        const cost = effectiveStepCost(act, player);
        const locked = player.skills[act.skill].level < act.minLevel;
        return (
          <Pressable
            key={act.id}
            disabled={locked || busy}
            onPress={() => void begin(act.id)}
            style={[styles.panel, (locked || busy) && { opacity: 0.5 }]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.text}>{act.name}</Text>
              <Text style={styles.textDim}>{cost} steps</Text>
            </View>
            <Text style={styles.textDim}>
              {act.skill} · +{act.xpReward} xp{locked ? `  (req lv ${act.minLevel})` : ''}
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
