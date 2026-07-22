# StepRealm — project context

A walking-driven fantasy RPG. Real steps fund in-game actions. Final-year
project for the NCI Higher Diploma in Computing; assessed on the codebase, a
written report, and a live demonstration.

**Development machine is Windows. Test device is an iPhone running Expo Go.**

---

## Architecture

Two packages in one repo.

- **Root** — Expo / React Native app, expo-router, zustand + AsyncStorage
- **`server/`** — Node + Express + PostgreSQL REST API, deployed on Render

The server is authoritative. The phone reports how many steps were walked; the
server decides what they earned, persists it, and returns the new state. This
was deliberate: the brief requires meaningful server-side functionality, and a
client that computes its own XP can fabricate progression.

`src/game/` exists on both sides. The client copy renders step costs and XP
bars optimistically; `server/src/game/` is the real thing. Do not add rules to
the client copy.

## Constraints that have already caused bugs

- **Expo SDK 54.** Install Expo packages with `npx expo install`, never
  `npm install`. The latter fetches the newest release, which targets the
  newest SDK, and the native module then fails to resolve — the symptom is a
  crash at import like `Cannot read property 'GRANTED' of undefined`.
  `expo-sensors` must stay on `~15.0.8`.
- **`tsx` and `typescript` are runtime dependencies in `server/`**, not dev
  dependencies. Render sets `NODE_ENV=production`, which makes `npm install`
  skip devDependencies, and `npm start` runs through `tsx`.
- **Render free tier sleeps after 15 minutes** and takes about a minute to
  wake. The API client timeout is 45s and bootstrap retries — do not lower
  either.
- **The client tsconfig excludes `server/`.** Without it, `npx tsc` in the root
  tries to compile the API and fails on `express`.

## Step tracking

The proposal specified Android Health Connect. The developer has an iPhone, so
this was migrated to Core Motion via `expo-sensors`. `MIGRATION.md` documents
the change and must stay accurate — it is submitted as part of the report.

The offline mechanic is the core of the project: `players.last_step_sync_at` is
a high-water mark, and on resume the app asks Core Motion for steps since then
via `getStepCountAsync`. Nothing runs in the background. Foreground walking is
flushed on a 5-second interval; `watchStepCount` itself is display-only (and
also drives the activity screen's optimistic progress bar between flushes).

## Commands

```
# API — from server/
npm start            # dev server on :3000
npm test             # 67 tests (46 unit, 21 integration); needs .env + schema
npm run typecheck
npm run db:setup     # DROPS and recreates all tables

# App — from root
npx expo start -c    # -c after any dependency or .env change
npx expo start --tunnel   # local firewall blocks LAN access to Metro
```

`EXPO_PUBLIC_*` values are baked in at bundle time. Always restart with `-c`
after editing `.env`.

## Testing expectations

`server/src/game/` is pure and fully unit-tested. Any change to game rules
needs matching tests in `server/test/game.test.ts`. Integration tests in
`server/test/api.test.ts` run against a real database and assert that state
survives a reload — keep that property.

## Known gaps

- No authentication. A player is a UUID stored on the device.
- Android unsupported since the Core Motion migration.
- Crafting requires an active quest, because recipes spend banked steps.
  Collecting a quest clears it, so the banked steps go with it — to craft you
  must start a fresh quest and bank the cost again. The forge would be better
  served by a step pool that outlives a single quest.
- Abandoning a quest forfeits uncollected progress. The home screen blocks
  starting a second quest so this cannot happen by accident, but there is no
  confirmation on the abandon button itself.
- Steps walked past a quest's target do not carry into the next quest. They
  still bank for crafting, so they are not lost outright.
- `GET /api/content` exists to remove the duplicated game content but the
  client does not consume it yet.
- `savePlayer` rewrites inventory and equipment wholesale rather than diffing.

## Style

Comments explain *why*, not *what*. Existing code follows this — match it.
British English in user-facing strings and documentation.
