# StepRealm — setup, troubleshooting and deployment

Written for **Windows + iPhone**, which is the development setup in use.
macOS/Linux differences are noted inline.

---

## 1. PostgreSQL

Install from https://www.postgresql.org/download/windows/. The installer asks
for a `postgres` superuser password — write it down. Keep port 5432.

Nothing else to do. `npm run db:setup` creates the database and tables itself,
so you need neither pgAdmin nor `psql` on your PATH.

**Alternative — skip the local install.** Create a free project at
supabase.com and put its connection string in `server/.env.render` (see §2.1),
which keeps it separate from your local one.

---

## 2. Running it

Two terminals, every time.

```
cd server
copy .env.example .env       ... put your postgres password in DATABASE_URL
npm install
npm run db:setup             ... first run only
npm start
```

```
copy .env.example .env       ... edit EXPO_PUBLIC_API_URL with your IPv4
npm install
npx expo start
```

Scan the QR with the iOS Camera app.

### 2.1 Local and hosted databases

The two connection strings live in two files. You never edit one to reach the
other, and you never have to remember which is currently pasted in:

| File | Holds | Used by |
| --- | --- | --- |
| `server/.env` | Your local PostgreSQL | `npm start`, `npm test`, `npm run db:setup` |
| `server/.env.render` | Render's **External** Database URL, `PGSSL=true` | `npm run db:setup:remote` only |

Both are gitignored. Templates for each — `.env.example` and
`.env.render.example` — are committed, so a fresh clone shows what is needed.

To set up the hosted one, once:

```
cd server
copy .env.render.example .env.render
```

Then paste Render's **External Database URL** into it. Render's dashboard also
shows an *Internal* URL; that one resolves only from inside Render's network
and will not connect from your laptop.

Applying the schema to each:

```
npm run db:setup             ... local, no prompt
npm run db:setup:remote      ... hosted, prints the target and asks first
```

The remote command names the host it is about to affect, warns that it destroys
every table, and waits for you to type `yes`. Passwords are never printed. For
scripted use, `npm run db:setup:remote -- --force` skips the prompt; without a
terminal and without `--force` it refuses and exits non-zero rather than
pretending to have run.

---

## 3. When it doesn't work

### The app shows an Offline banner

The phone cannot reach the API. In order of likelihood:

1. **Windows Firewall blocked Node.** This is the most common cause. Control
   Panel → System and Security → Windows Defender Firewall → Allow an app
   through firewall → find Node.js → tick **Private**. If Node is not listed,
   restart `npm start` and accept the prompt.
2. **Wrong IP.** Run `ipconfig` and use the IPv4 Address of the adapter you are
   actually connected through. If your laptop is on ethernet and your phone is
   on Wi-Fi, they may be on different subnets.
3. **You changed `.env` without restarting `expo start`.** `EXPO_PUBLIC_*`
   values are compiled into the bundle.
4. **The network blocks device-to-device traffic.** College and eduroam
   networks routinely do. Tether your laptop to your phone's hotspot, re-run
   `ipconfig`, and use the new address.

Quick check from the phone: open `http://YOUR_IP:3000/health` in Safari. If
that shows JSON, the network is fine and the problem is in the app config. If
it times out, it is the firewall or the network.

### `npm run db:setup` fails to connect

PostgreSQL is not running, or the password in `server/.env` is wrong. Check
Services (`services.msc`) for `postgresql-x64-16` and start it if stopped.

### `npm run db:setup:remote` fails to connect

Almost always the wrong URL: Render shows both an *Internal* and an *External*
Database URL, and only the External one is reachable from your laptop. Check
which is in `server/.env.render`. The command prints the host it resolved, so
compare that against the dashboard.

### No step data on the phone

- Settings → Privacy & Security → Motion & Fitness → make sure **Expo Go** is
  on, and that Fitness Tracking at the top is on.
- The iOS Simulator has no motion hardware. `Pedometer.isAvailableAsync()`
  returns false there and the home screen shows manual step buttons instead.
  The offline mechanic can only be demonstrated on a real phone.
- `getStepCountAsync` returns steps recorded by the iPhone itself. Steps synced
  from an Apple Watch are not included.

---

## 4. Verifying the offline loop

This is the feature the whole project rests on, and it needs a real walk:

1. Start an activity, note the banked steps on the activity screen
2. Close the app completely — swipe up in the app switcher
3. Walk a few hundred steps
4. Reopen

The catch-up query runs on foreground and your character should have done the
work while you were away. Worth recording for your demo video.

---

## 5. Tests

```
cd server
npm test          ... 76 tests: 55 unit on game rules, 21 integration
npm run typecheck
```

Integration tests need `server/.env` present and the schema applied. They
create their own players and leave existing rows alone.

Note that `npm run db:setup` **drops and recreates** every table. It is a
first-run and reset command, not a migration. The same is true of
`npm run db:setup:remote`, which is why that one makes you confirm.

---

## 6. Deploying

Worth doing before the demo so you are not depending on your laptop and its
firewall in a room you do not control.

Railway or Render, pointed at the `server/` folder:

- Add a managed PostgreSQL instance; it provides `DATABASE_URL`
- Set `PGSSL=true` in the host's own environment settings
- Put the External Database URL in `server/.env.render` (§2.1) and run
  `npm run db:setup:remote` once to create the tables
- Change `EXPO_PUBLIC_API_URL` in the client `.env` to the deployed URL and
  restart with `npx expo start -c`

The deployed API reads its configuration from the host's environment
variables, not from any `.env` file in the repo — `server/.env.render` is only
ever read by `db:setup:remote`, from your laptop.

> **After changing game rules or the schema, the deploy is not the whole job.**
> Render serves what is on GitHub `main`, so unpushed work is invisible to the
> phone; and a schema change needs `db:setup:remote` as well, or the new code
> meets old columns. `curl https://<your-app>.onrender.com/api/content` shows
> what the deployed server actually believes.

---

## 7. Still open

- **No authentication.** A player is identified by the UUID stored on their
  device. Anyone with that UUID can act as that player. Fine for a
  demonstration, but state it in your report's limitations rather than leaving
  a marker to notice it.
- **`savePlayer` rewrites inventory and equipment wholesale** instead of
  diffing. At this scale that is a handful of rows and it removes a class of
  bug; it is the first thing to revisit if inventories grow.
- **The forge needs an active activity** to have banked steps to spend, so you
  cannot craft while idle. That follows from steps being the only currency —
  decide whether to defend or change it before the demo, because you will be
  asked.
- **`src/game/` exists on both sides.** The client copy renders step costs and
  XP bars; the server copy is authoritative. `GET /api/content` exists to
  remove the duplication but the client does not consume it yet.
