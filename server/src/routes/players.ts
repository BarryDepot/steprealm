// REST API for player progression.
//
// Every mutating route follows the same shape: open a transaction, load the
// player, run the pure engine function, persist the result, return the new
// state. Keeping that shape identical across routes means the transaction
// boundary is never accidentally left out of one of them.

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

import { withTransaction, pool } from '../db';
import {
  appendEvents, createPlayer, lastSyncAt, loadPlayer,
  recentEvents, recordStepBatch, savePlayer,
} from '../repo/players';
import {
  claimQuest, craft, equipTool, ingestSteps, startActivity, stopActivity,
} from '../game/engine';
import { activities, recipes, skills } from '../content';
import type { Player } from '../types';

export const router = Router();

class BadRequestError extends Error {
  status = 400;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function playerIdOf(req: Request): string {
  const id = req.params.id;
  // Validated before it reaches the database so a malformed id returns 400
  // rather than surfacing a Postgres type error as a 500.
  if (!UUID_RE.test(id)) throw new BadRequestError('Malformed player id.');
  return id;
}

// Wraps an async handler so rejected promises reach the error middleware
// instead of hanging the request.
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

async function respondWithState(res: Response, playerId: string, player: Player) {
  const client = await pool.connect();
  try {
    res.json({
      playerId,
      player,
      events: await recentEvents(client, playerId),
      lastSyncAt: await lastSyncAt(client, playerId),
    });
  } finally {
    client.release();
  }
}

// --- static game content ---------------------------------------------------
// Served from the API so the client never has to ship a second copy of the
// balance numbers. Change a step cost here and every device picks it up.

router.get('/content', (_req, res) => {
  res.json({ skills, activities, recipes });
});

// --- player lifecycle ------------------------------------------------------

router.post('/players', wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 40) {
    throw new BadRequestError('name is required and must be 1–40 characters.');
  }
  const playerId = await withTransaction(db => createPlayer(db, name));
  const player = await withTransaction(db => loadPlayer(db, playerId));
  res.status(201);
  await respondWithState(res, playerId, player);
}));

router.get('/players/:id', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const player = await withTransaction(db => loadPlayer(db, playerId));
  await respondWithState(res, playerId, player);
}));

// --- step ingestion --------------------------------------------------------
//
// The client reports a window of walked steps read from the device pedometer.
// The server decides what those steps earned. windowStart/windowEnd are
// recorded in the ledger so offline catch-up is auditable after the fact.

router.post('/players/:id/steps', wrap(async (req, res) => {
  const playerId = playerIdOf(req);

  const steps = Number(req.body?.steps);
  if (!Number.isInteger(steps) || steps <= 0) {
    throw new BadRequestError('steps must be a positive integer.');
  }
  // A generous ceiling. The point is not to catch a determined cheat but to
  // stop a pedometer glitch handing someone fifty levels in one request.
  if (steps > 200_000) {
    throw new BadRequestError('steps exceeds the plausible maximum for one sync.');
  }

  const source = req.body?.source === 'manual' ? 'manual' : 'pedometer';
  const windowStart = req.body?.windowStart ? new Date(req.body.windowStart) : null;
  const windowEnd = req.body?.windowEnd ? new Date(req.body.windowEnd) : new Date();
  if (windowStart && Number.isNaN(windowStart.getTime())) {
    throw new BadRequestError('windowStart is not a valid date.');
  }

  const player = await withTransaction(async db => {
    const current = await loadPlayer(db, playerId);
    const result = ingestSteps(current, steps);
    await savePlayer(db, playerId, result.player);
    await recordStepBatch(db, playerId, steps, source, result.actions, windowStart, windowEnd);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });

  await respondWithState(res, playerId, player);
}));

// --- activity control ------------------------------------------------------

router.post('/players/:id/activity', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const activityId = req.body?.activityId;
  if (typeof activityId !== 'string' || !activityId) {
    throw new BadRequestError('activityId is required.');
  }

  const player = await withTransaction(async db => {
    const result = startActivity(await loadPlayer(db, playerId), activityId);
    await savePlayer(db, playerId, result.player);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });

  await respondWithState(res, playerId, player);
}));

// Collect a finished quest. Registered before the bare /activity routes only
// for readability — Express matches on the full path, so the order of these
// two is not load-bearing.
router.post('/players/:id/activity/claim', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const player = await withTransaction(async db => {
    const result = claimQuest(await loadPlayer(db, playerId));
    await savePlayer(db, playerId, result.player);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });
  await respondWithState(res, playerId, player);
}));

router.delete('/players/:id/activity', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const player = await withTransaction(async db => {
    const result = stopActivity(await loadPlayer(db, playerId));
    await savePlayer(db, playerId, result.player);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });
  await respondWithState(res, playerId, player);
}));

// --- equipment -------------------------------------------------------------

router.post('/players/:id/equip', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const itemId = req.body?.itemId;
  if (typeof itemId !== 'string' || !itemId) {
    throw new BadRequestError('itemId is required.');
  }

  const player = await withTransaction(async db => {
    const result = equipTool(await loadPlayer(db, playerId), itemId);
    await savePlayer(db, playerId, result.player);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });

  await respondWithState(res, playerId, player);
}));

// --- crafting --------------------------------------------------------------

router.post('/players/:id/craft', wrap(async (req, res) => {
  const playerId = playerIdOf(req);
  const recipeId = req.body?.recipeId;
  if (typeof recipeId !== 'string' || !recipeId) {
    throw new BadRequestError('recipeId is required.');
  }

  const player = await withTransaction(async db => {
    const result = craft(await loadPlayer(db, playerId), recipeId);
    await savePlayer(db, playerId, result.player);
    await appendEvents(db, playerId, result.events);
    return result.player;
  });

  await respondWithState(res, playerId, player);
}));
