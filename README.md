# StepRealm

A walking-driven fantasy RPG, inspired by the WalkScape activity model.
Pick an activity, walk in real life, your character does the work.

Two parts: an Expo mobile app and a Node/Express API backed by PostgreSQL.
The server owns the game rules — the phone reports how many steps were walked,
the server decides what they earned.

---

## Quick start

Developed on **Windows** with an **iPhone** running Expo Go. Notes for
macOS/Linux are marked where the commands differ.

### One-off: install PostgreSQL

Download the installer from https://www.postgresql.org/download/windows/ and
run it. It asks for a password for the `postgres` superuser — remember it, you
need it in the next step. Leave the port as 5432.

You do **not** need to create a database or use pgAdmin; the setup script does
that for you.

### Every session: two terminals

**Terminal 1 — the API**

```
cd server
copy .env.example .env
```

Open `server\.env` and put your postgres password in:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/steprealm
```

Then:

```
npm install
npm run db:setup
npm start
```

`db:setup` creates the database and its tables, prints the host it is
targeting, and lists what it made. `npm start` should print
`StepRealm API listening on :3000`.

> **Deploying too?** The hosted database has its own file, `server/.env.render`,
> and its own command, `npm run db:setup:remote`. You never edit `DATABASE_URL`
> to switch between the two. See [SETUP.md](SETUP.md) §2.1.

> **Windows Firewall will pop up the first time.** Tick **Private networks**
> and allow it. If you dismiss it, your phone cannot reach the server and the
> app shows an Offline banner.

Check it works:

```
curl http://localhost:3000/health
```

Expect `{"ok":true,"db":"up"}`.

**Terminal 2 — the app**

Find your laptop's address on the Wi-Fi network:

```
ipconfig
```

Look for your Wi-Fi adapter's **IPv4 Address** — something like `192.168.1.20`.
(macOS: `ipconfig getifaddr en0`.)

```
copy .env.example .env
```

Open `.env` in the project root and set that address:

```
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

Not `localhost` — on your phone, `localhost` means the phone.

```
npm install
npx expo start
```

Scan the QR code with the iOS **Camera** app.

> **Adding Expo packages later?** Always use `npx expo install <package>`, never
> `npm install <package>`. `npm install` fetches the newest release, which is
> built for the newest SDK — installing an SDK 57 package into this SDK 54
> project makes the native module fail to resolve and the app crashes at import
> with an error like `Cannot read property 'GRANTED' of undefined`.
> `npx expo install --check` audits existing versions against the SDK.

Both devices must be on the same Wi-Fi. If you change `.env`, restart
`expo start` — those values are baked in at bundle time.

---

## What's working

- Three skills (Woodcutting, Mining, Smithing), each with XP and levelling
- Four quests across the Disenchanted Forest, the starter region
- Quest loop: each quest is a flat step target — walk it, then collect a fixed
  reward of resources and XP
- Tools with work-efficiency multipliers that reduce a quest's step target
- Crafting at the forge in Emberhollow — the only source of Smithing XP, with
  a full bronze → iron → steel tool ladder
- Treasure-box loot rolls (~1 in 8 quests) across three rarity tiers, up to
  epic steel tools
- **Real step input** from the device pedometer (iOS Core Motion)
- **Offline progression** — close the app, walk, reopen, and the steps you took
  while away are credited
- Server-side persistence in PostgreSQL, with a step ledger and event log
- Offline tolerance — step batches that can't reach the server are queued on
  the device and replayed in order

## Testing

```bash
cd server
npm test          # 81 tests: 60 unit on the game rules, 21 integration
npm run typecheck
```

The integration tests read `server/.env` and need the schema applied there.
They always run against your local database — `server/.env.render` is used
only by `db:setup:remote` — and they create their own players, leaving
existing rows alone.

---

## Layout

```
app/                    expo-router screens
  _layout.tsx           root stack + theming
  (tabs)/
    _layout.tsx         the four permanent destinations
    index.tsx           Quests — region, skills, quest list, sync status
    world.tsx           the realm — regions, locked and unlocked
    inventory.tsx       resources + the full tool ladder, tap to equip
    forge.tsx           crafting, in the town of Emberhollow
  activity.tsx          live quest screen, pushed from Quests

src/
  types.ts              core game types
  api/client.ts         typed API client
  health/usePedometer.ts  Core Motion step reading + resume catch-up
  state/gameStore.ts    zustand store, server-synced, AsyncStorage cache
  content/starterRegion.ts   region, activities, items, recipes (display copy)
  game/                 xp / tick — used client-side for display only
  ui/styles.ts          shared styles + palette
  ui/AnimatedProgress.tsx  eased progress bars and counters

server/
  db/schema.sql         PostgreSQL schema
  src/
    app.ts              express app
    index.ts            process entry point
    db.ts               connection pool + transaction helper
    content.ts          authoritative game content
    game/               xp / tick / loot / engine — the real rules
    repo/players.ts     data access
    routes/players.ts   REST endpoints
    middleware/errors.ts
  test/                 unit + integration suites
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + database check |
| `GET` | `/api/content` | Skills, activities and recipes |
| `POST` | `/api/players` | Create a character |
| `GET` | `/api/players/:id` | Full current state |
| `POST` | `/api/players/:id/steps` | Report walked steps; server advances the quest |
| `POST` | `/api/players/:id/activity` | Start a quest |
| `POST` | `/api/players/:id/activity/claim` | Collect a finished quest |
| `DELETE` | `/api/players/:id/activity` | Abandon the running quest |
| `POST` | `/api/players/:id/equip` | Equip an owned tool |
| `POST` | `/api/players/:id/craft` | Craft a recipe |

---

## Known limitations

- **No authentication.** A player is identified by a UUID stored on the device;
  anyone holding it can act as that player.
- **iOS only.** Step reading uses Core Motion. See `MIGRATION.md` for why this
  replaced Android Health Connect and how the Android path would be restored.
- **`src/game/` is duplicated** between client and server. The client copy is
  used only to render step targets and XP bars before the server responds; the
  server copy is authoritative. `GET /api/content` exists to remove this
  duplication but the client does not consume it yet.
- **Crafting requires an active quest**, since recipes spend banked steps and
  steps are only banked against a running quest. Collecting a quest clears the
  pool with it, so crafting means starting a fresh quest and banking the cost.
- **Simulator has no pedometer.** `Pedometer.isAvailableAsync()` returns false
  and the home screen falls back to manual step buttons. The offline mechanic
  only demonstrates on a physical device.

## Documents

- `SETUP.md` — fuller setup, deployment, and troubleshooting
- `MIGRATION.md` — requirements migration from the approved proposal
