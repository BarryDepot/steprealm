// Real step input.
//
// The proposal specified Android Health Connect. That is Android-only, so on
// iOS the equivalent is Core Motion, which expo-sensors exposes through its
// Pedometer module. The migration is documented in MIGRATION.md.
//
// The important property for this game is that Core Motion records steps
// whether or not the app is running, and getStepCountAsync can be asked for a
// past window. That is what makes offline progression work: nothing needs to
// run in the background, because on resume we simply ask the device how far
// the player walked while we were gone.
//
// Note on permissions: expo-sensors exposes requestPermissionsAsync, but on
// iOS it is effectively a shim and can resolve to undefined. iOS instead
// prompts for Motion & Fitness the first time motion data is actually read.
// So availability is treated as optimistically granted, and a real denial is
// detected from a failed read rather than from the permission call.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Pedometer } from 'expo-sensors';

export type PedometerStatus = 'checking' | 'available' | 'unavailable' | 'denied';

interface UsePedometerOptions {
  /** Called with steps walked since the last successful sync. */
  onSteps: (steps: number, windowStart: Date, windowEnd: Date) => Promise<void> | void;
  /** Server's high-water mark. Steps after this point have not been counted. */
  lastSyncAt: Date | null;
  enabled?: boolean;
}

// Core Motion keeps roughly seven days of history. Asking for more returns
// nothing useful, so clamp the catch-up window rather than sending a request
// the device cannot answer.
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// How often to send foreground steps to the server. Short enough that progress
// visibly ticks along while walking, long enough not to hammer the API — and
// on Render's free tier, not so chatty that it keeps the dyno permanently hot.
const FLUSH_INTERVAL_MS = 5_000;

// iOS reports a denied motion permission as an error on the read, not through
// the permission API. The wording is not contractual, so this is best effort.
function looksLikePermissionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /permission|denied|unauthor|not authorized|NSMotion/i.test(message);
}

export function usePedometer({ onSteps, lastSyncAt, enabled = true }: UsePedometerOptions) {
  const [status, setStatus] = useState<PedometerStatus>('checking');
  const [liveSteps, setLiveSteps] = useState(0);

  // Steps walked since the last successful flush, for optimistic display
  // (e.g. the activity progress bar) that shouldn't wait for a server round
  // trip. Tracked separately from liveSteps, which is a since-opening total
  // for the home screen and must keep counting up through a flush rather
  // than reset with it.
  const [unsyncedSteps, setUnsyncedSteps] = useState(0);
  // watchStepCount reports a cumulative count since the subscription began,
  // not a per-event delta, so this ref is the running total to diff against.
  const rawStepsRef = useRef(0);
  // The value of rawStepsRef at the last successful flush — the baseline
  // unsyncedSteps is measured from.
  const unsyncedBaselineRef = useRef(0);

  // Held in a ref so the AppState listener always sees the current value
  // without needing to be torn down and rebuilt on every sync.
  const lastSyncRef = useRef<Date | null>(lastSyncAt);
  useEffect(() => { lastSyncRef.current = lastSyncAt; }, [lastSyncAt]);

  // Guards against two catch-ups overlapping — for example a foreground event
  // arriving while the initial sync is still in flight, which would report the
  // same steps twice.
  const syncing = useRef(false);

  const catchUp = useCallback(async () => {
    if (!enabled || syncing.current) return;

    const now = new Date();
    const earliest = new Date(now.getTime() - MAX_LOOKBACK_MS);
    const from = lastSyncRef.current && lastSyncRef.current > earliest
      ? lastSyncRef.current
      : earliest;

    if (from >= now) return;

    syncing.current = true;
    try {
      const result = await Pedometer.getStepCountAsync(from, now);
      const steps = result?.steps ?? 0;
      if (steps > 0) {
        await onSteps(steps, from, now);
      }
      // Whatever was walked up to "now" has been reported (or queued while
      // offline — see reportSteps), so the optimistic count restarts from
      // here rather than double-adding the same steps next tick.
      unsyncedBaselineRef.current = rawStepsRef.current;
      setUnsyncedSteps(0);
    } catch (err) {
      // A read failure is not fatal: the high-water mark has not moved, so the
      // same window is retried on the next resume and nothing is lost. But a
      // permission refusal will never resolve itself, so surface that.
      if (looksLikePermissionError(err)) {
        setStatus('denied');
      } else {
        console.warn('[pedometer] catch-up failed', err);
      }
    } finally {
      syncing.current = false;
    }
  }, [enabled, onSteps]);

  // Availability and permission.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (cancelled) return;
        if (!available) {
          setStatus('unavailable');
          return;
        }

        try {
          const permission = await Pedometer.requestPermissionsAsync?.();
          // Only trust an explicit denial. undefined, a missing method, or a
          // missing `granted` field all mean "no useful answer here" — let the
          // first real read decide instead.
          if (permission && permission.granted === false) {
            if (!cancelled) setStatus('denied');
            return;
          }
        } catch {
          // Permission call unsupported on this platform — ignore it.
        }

        if (!cancelled) setStatus('available');
      } catch (err) {
        if (!cancelled) {
          console.warn('[pedometer] availability check failed', err);
          setStatus('unavailable');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Live updates while the app is open, so the activity screen ticks along as
  // the player walks rather than only updating on resume.
  useEffect(() => {
    if (status !== 'available' || !enabled) return;

    let subscription: { remove: () => void } | undefined;
    try {
      subscription = Pedometer.watchStepCount(result => {
        const raw = result?.steps ?? 0;
        rawStepsRef.current = raw;
        setLiveSteps(raw);
        setUnsyncedSteps(Math.max(0, raw - unsyncedBaselineRef.current));
      });
    } catch (err) {
      console.warn('[pedometer] live updates unavailable', err);
    }

    return () => subscription?.remove();
  }, [status, enabled]);

  // Catch up once on mount and again whenever the app returns to the
  // foreground. Pedometer updates are not delivered while backgrounded, which
  // is exactly why the historical query above is the mechanism that matters.
  useEffect(() => {
    if (status !== 'available') return;

    void catchUp();

    const handler = (next: AppStateStatus) => {
      if (next === 'active') {
        setLiveSteps(0);
        void catchUp();
      }
    };

    const subscription = AppState.addEventListener('change', handler);
    return () => subscription.remove();
  }, [status, catchUp]);

  // Flush periodically while the app is open.
  //
  // Without this, steps walked with the app in the foreground are never
  // credited — the catch-up above only fires on launch and on resume, and
  // watchStepCount is display-only. Someone testing by walking while watching
  // the screen would see nothing happen, which is the first thing anyone
  // tries. The server holds the high-water mark, so repeating the query is
  // safe: a window that has already been counted comes back empty.
  useEffect(() => {
    if (status !== 'available' || !enabled) return;

    const timer = setInterval(() => { void catchUp(); }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, enabled, catchUp]);

  return { status, liveSteps, unsyncedSteps, catchUp };
}
