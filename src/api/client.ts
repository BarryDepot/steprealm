// Client for the StepRealm API.
//
// Every game rule now lives on the server, so this module is deliberately
// thin: it sends an intent and returns whatever state the server decided on.
// The screens render that state and nothing else.

import type { Player } from '../types';

// Set EXPO_PUBLIC_API_URL in .env. On a physical phone, localhost points at
// the phone itself — use the development machine's LAN address (for example
// http://192.168.1.20:3000) or the deployed URL.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const TIMEOUT_MS = 10_000;

export interface GameEvent {
  kind: 'activity' | 'loot' | 'level' | 'system';
  message: string;
}

export interface StateResponse {
  playerId: string;
  player: Player;
  events: GameEvent[];
  lastSyncAt: string | null;
}

/** Thrown when the server rejected a request for a stated reason. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the server was reachable but refused — retrying will not help. */
  get isRuleViolation() {
    return this.status >= 400 && this.status < 500;
  }
}

/** Thrown when the server could not be reached at all. */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('Could not reach the StepRealm server.');
    this.name = 'OfflineError';
    this.cause = cause;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // React Native has no default request timeout, so a dead server would leave
  // the UI spinning indefinitely without this.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new OfflineError(err);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // A 5xx means the server is broken rather than the request being wrong,
    // so treat it as retryable rather than as a rule violation.
    let message = `Request failed (${response.status})`;
    try {
      const parsed = await response.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  createPlayer: (name: string) =>
    request<StateResponse>('POST', '/api/players', { name }),

  getPlayer: (playerId: string) =>
    request<StateResponse>('GET', `/api/players/${playerId}`),

  /**
   * Report a window of walked steps.
   *
   * The window bounds are sent so the server can record what period the steps
   * came from, which is what makes offline catch-up auditable.
   */
  syncSteps: (playerId: string, steps: number, windowStart: Date | null, windowEnd: Date, source: 'pedometer' | 'manual' = 'pedometer') =>
    request<StateResponse>('POST', `/api/players/${playerId}/steps`, {
      steps,
      source,
      windowStart: windowStart?.toISOString() ?? null,
      windowEnd: windowEnd.toISOString(),
    }),

  startActivity: (playerId: string, activityId: string) =>
    request<StateResponse>('POST', `/api/players/${playerId}/activity`, { activityId }),

  stopActivity: (playerId: string) =>
    request<StateResponse>('DELETE', `/api/players/${playerId}/activity`),

  equipTool: (playerId: string, itemId: string) =>
    request<StateResponse>('POST', `/api/players/${playerId}/equip`, { itemId }),

  craft: (playerId: string, recipeId: string) =>
    request<StateResponse>('POST', `/api/players/${playerId}/craft`, { recipeId }),
};
