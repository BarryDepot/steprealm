-- StepRealm — PostgreSQL schema
-- Player progression is normalised rather than stored as a single JSON blob so
-- that skills, inventory and step history can be queried and constrained
-- independently. gen_random_uuid() is built in from PostgreSQL 13 onwards.

DROP TABLE IF EXISTS event_log        CASCADE;
DROP TABLE IF EXISTS step_ledger      CASCADE;
DROP TABLE IF EXISTS player_activity  CASCADE;
DROP TABLE IF EXISTS player_equipment CASCADE;
DROP TABLE IF EXISTS player_inventory CASCADE;
DROP TABLE IF EXISTS player_skills    CASCADE;
DROP TABLE IF EXISTS players          CASCADE;

-- ---------------------------------------------------------------------------
-- Core player record
-- ---------------------------------------------------------------------------
CREATE TABLE players (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       TEXT        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  total_steps        BIGINT      NOT NULL DEFAULT 0 CHECK (total_steps >= 0),
  -- High-water mark for pedometer reconciliation. The client asks the device
  -- for steps between this timestamp and now, so nothing is counted twice.
  last_step_sync_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One row per skill the player has progress in
-- ---------------------------------------------------------------------------
CREATE TABLE player_skills (
  player_id UUID    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_id  TEXT    NOT NULL,
  xp        INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level     INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  PRIMARY KEY (player_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- Inventory: one row per distinct item, count folded into the row
-- ---------------------------------------------------------------------------
CREATE TABLE player_inventory (
  player_id UUID    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id   TEXT    NOT NULL,
  count     INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (player_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Equipped tool, at most one per skill (enforced by the composite key)
-- ---------------------------------------------------------------------------
CREATE TABLE player_equipment (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_id  TEXT NOT NULL,
  item_id   TEXT NOT NULL,
  PRIMARY KEY (player_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- The quest currently running. A player may have at most one, which the
-- primary key on player_id enforces at the database level.
-- ---------------------------------------------------------------------------
CREATE TABLE player_activity (
  player_id    UUID        PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  activity_id  TEXT        NOT NULL,
  -- Spendable step pool, drawn down by crafting recipes. Distinct from
  -- total_steps so a trip to the forge cannot undo quest progress.
  steps_banked INTEGER     NOT NULL DEFAULT 0 CHECK (steps_banked >= 0),
  -- Progress towards the activity's targetSteps. The reward this earns is
  -- read from the activity definition at collection time, so no pending
  -- reward is stored.
  total_steps  INTEGER     NOT NULL DEFAULT 0 CHECK (total_steps >= 0),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit trail of every batch of steps ingested. This is what makes offline
-- progression auditable: each row records the device window the steps came
-- from and how many in-game actions they funded.
-- ---------------------------------------------------------------------------
CREATE TABLE step_ledger (
  id           BIGSERIAL   PRIMARY KEY,
  player_id    UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  steps        INTEGER     NOT NULL CHECK (steps > 0),
  source       TEXT        NOT NULL CHECK (source IN ('pedometer', 'manual')),
  window_start TIMESTAMPTZ,
  window_end   TIMESTAMPTZ,
  -- Quests this batch of steps finished (0 or 1).
  actions      INTEGER     NOT NULL DEFAULT 0 CHECK (actions >= 0),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX step_ledger_player_idx ON step_ledger (player_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Server-authored event feed (activity completions, chest drops, level ups)
-- ---------------------------------------------------------------------------
CREATE TABLE event_log (
  id         BIGSERIAL   PRIMARY KEY,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL CHECK (kind IN ('activity', 'loot', 'level', 'system')),
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_log_player_idx ON event_log (player_id, created_at DESC);
