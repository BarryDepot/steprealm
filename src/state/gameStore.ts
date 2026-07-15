// Client game state.
//
// The server is now the authority on progression — this store holds the last
// state the server returned, plus enough local bookkeeping to survive being
// offline. AsyncStorage persistence remains, but its role has changed: it is a
// cache so the app can render immediately on launch, not the source of truth.
//
// Steps walked while the server is unreachable are buffered locally and
// replayed on the next successful call, so a lost signal on a walk does not
// cost the player progress.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { api, ApiError, OfflineError, type GameEvent, type StateResponse } from '../api/client';
import type { ItemId, Player } from '../types';

const initialPlayer: Player = {
  name: 'Wanderer',
  totalSteps: 0,
  skills: {
    woodcutting: { xp: 0, level: 1 },
    mining:      { xp: 0, level: 1 },
    smithing:    { xp: 0, level: 1 },
  },
  inventory: [],
  equipped: {},
  current: null,
};

interface PendingBatch {
  steps: number;
  windowStart: string | null;
  windowEnd: string;
}

interface GameState {
  playerId: string | null;
  player: Player;
  log: GameEvent[];
  lastSyncAt: string | null;

  /** Steps the device reported that the server has not accepted yet. */
  pending: PendingBatch[];

  /**
   * Steps the pedometer has seen since the last flush, not yet confirmed by
   * the server. Purely for optimistic display — e.g. so the activity progress
   * bar moves as the user walks rather than only on sync — never used to
   * decide rewards.
   */
  unsyncedSteps: number;

  ready: boolean;
  busy: boolean;
  offline: boolean;
  error: string | null;

  bootstrap: (name?: string) => Promise<void>;
  reportSteps: (steps: number, windowStart: Date, windowEnd: Date) => Promise<void>;
  startActivity: (activityId: string) => Promise<void>;
  stopActivity: () => Promise<void>;
  claimQuest: () => Promise<void>;
  equipTool: (itemId: ItemId) => Promise<void>;
  craft: (recipeId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  setUnsyncedSteps: (steps: number) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => {
      // Applies a server response, which is always the complete truth.
      const apply = (res: StateResponse) => {
        set({
          playerId: res.playerId,
          player: res.player,
          log: res.events,
          lastSyncAt: res.lastSyncAt,
          offline: false,
          error: null,
        });
      };

      // Guard for actions that need a player. Returning silently here was a
      // bug: taps did nothing, with no error and no explanation, whenever
      // bootstrap had failed.
      const requirePlayer = (): string | null => {
        const id = get().playerId;
        if (!id) {
          set({ error: 'Not connected to the server yet — tap the banner to retry.' });
          return null;
        }
        return id;
      };

      // Shared wrapper for every mutating call. Rule violations surface to the
      // user; connectivity failures flip the offline flag instead, because the
      // player has done nothing wrong and the action can be retried.
      const call = async (fn: () => Promise<StateResponse>) => {
        set({ busy: true, error: null });
        try {
          apply(await fn());
        } catch (err) {
          if (err instanceof OfflineError) {
            set({ offline: true });
          } else if (err instanceof ApiError) {
            set({ error: err.message });
          } else {
            set({ error: 'Something went wrong.' });
          }
        } finally {
          set({ busy: false });
        }
      };

      return {
        playerId: null,
        player: initialPlayer,
        log: [],
        lastSyncAt: null,
        pending: [],
        unsyncedSteps: 0,
        ready: false,
        busy: false,
        offline: false,
        error: null,

        bootstrap: async (name = 'Wanderer') => {
          const existing = get().playerId;
          set({ busy: true });
          try {
            // Retry a few times before giving up. A sleeping free-tier service
            // can refuse or stall the first request while it wakes, and a
            // single failure used to leave the app permanently unusable until
            // it was force-quit.
            let res: StateResponse | null = null;
            let lastErr: unknown = null;

            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                res = existing
                  ? await api.getPlayer(existing)
                  : await api.createPlayer(name);
                break;
              } catch (err) {
                lastErr = err;
                // Only connectivity failures are worth repeating; a 404 or a
                // rejected request will fail identically every time.
                if (!(err instanceof OfflineError)) throw err;
                if (attempt < 2) {
                  await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                }
              }
            }

            if (!res) throw lastErr;
            apply(res);
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              // The saved id no longer exists on the server — most likely the
              // database was reset during development. Start fresh rather than
              // leaving the app permanently broken.
              try {
                apply(await api.createPlayer(name));
              } catch {
                set({ offline: true });
              }
            } else if (err instanceof OfflineError) {
              // Render the cached state; the pending queue will drain later.
              set({ offline: true });
            } else {
              set({ error: 'Could not load your character.' });
            }
          } finally {
            set({ ready: true, busy: false });
          }
        },

        reportSteps: async (steps, windowStart, windowEnd) => {
          if (steps <= 0) return;

          const playerId = get().playerId;
          const batch: PendingBatch = {
            steps,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          };

          if (!playerId) {
            set(s => ({ pending: [...s.pending, batch] }));
            return;
          }

          // Send anything queued from earlier failures first, so rewards are
          // credited in the order they were walked.
          const queue = [...get().pending, batch];
          const unsent: PendingBatch[] = [];
          let latest: StateResponse | null = null;

          for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            try {
              latest = await api.syncSteps(
                playerId,
                item.steps,
                item.windowStart ? new Date(item.windowStart) : null,
                new Date(item.windowEnd)
              );
            } catch (err) {
              if (err instanceof OfflineError) {
                // Keep this batch and everything after it for the next attempt.
                unsent.push(...queue.slice(i));
                set({ offline: true });
                break;
              }
              // A rejected batch is dropped rather than retried forever — it
              // would fail identically every time and block the queue.
              console.warn('[steps] batch rejected', err);
            }
          }

          set({ pending: unsent });
          if (latest) apply(latest);
        },

        startActivity: (activityId) => {
          const id = requirePlayer();
          return id ? call(() => api.startActivity(id, activityId)) : Promise.resolve();
        },

        stopActivity: () => {
          const id = requirePlayer();
          return id ? call(() => api.stopActivity(id)) : Promise.resolve();
        },

        claimQuest: () => {
          const id = requirePlayer();
          return id ? call(() => api.claimQuest(id)) : Promise.resolve();
        },

        equipTool: (itemId) => {
          const id = requirePlayer();
          return id ? call(() => api.equipTool(id, itemId)) : Promise.resolve();
        },

        craft: (recipeId) => {
          const id = requirePlayer();
          return id ? call(() => api.craft(id, recipeId)) : Promise.resolve();
        },

        refresh: () => {
          const id = requirePlayer();
          return id ? call(() => api.getPlayer(id)) : Promise.resolve();
        },

        clearError: () => set({ error: null }),

        setUnsyncedSteps: (steps) => set({ unsyncedSteps: steps }),

        reset: () => set({
          playerId: null, player: initialPlayer, log: [],
          lastSyncAt: null, pending: [], unsyncedSteps: 0, ready: false, error: null,
        }),
      };
    },
    {
      name: 'steprealm-state-v2',
      storage: createJSONStorage(() => AsyncStorage),
      // Transient UI flags are deliberately not persisted — a stale "busy" or
      // "offline" flag restored from disk would misrepresent the live state.
      partialize: (s) => ({
        playerId: s.playerId,
        player: s.player,
        log: s.log,
        lastSyncAt: s.lastSyncAt,
        pending: s.pending,
      }),
    }
  )
);
