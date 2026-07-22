# Requirements Migration

**StepRealm — Barry Malley — Project Module, National College of Ireland**

This document records the changes made between the approved Project Proposal
(8 June 2026) and the delivered system, together with the reasoning behind
each. It supports the *requirements migration and critical analysis of
approach followed* required in the final technical report.

---

## 1. Step data source: Android Health Connect → iOS Core Motion

### What was proposed

> StepRealm is a native Android application built with React Native and Expo,
> integrating the Android Health Connect API via `expo-health-connect` to read
> verified step-count data.
>
> — Project Proposal, §4 Technical Approach

The proposal's stack list recorded the platform APIs as
*"Android Health Connect via `expo-health-connect`; HealthKit (optional iOS)"*,
and §5 stated that *"an Android device or emulator with Health Connect support
is needed for testing."*

### What changed

Step ingestion is delivered against **Apple Core Motion**, accessed through the
`Pedometer` module of `expo-sensors`, rather than Android Health Connect.

### Why

Health Connect is an Android-only platform: it is part of the Android framework
from Android 14, and a Play Store application on Android 13 and below. It has
no iOS implementation. The only Android hardware available for development and
demonstration during the delivery window was not owned by the developer, and
acquiring it would have introduced an unmitigated dependency on borrowed
hardware at the point of assessment.

The alternative paths were assessed as follows:

| Option | Assessment |
| --- | --- |
| Borrow an Android device | Rejected. Requires an EAS development build cycle plus Health Connect permission propagation on hardware not controlled by the developer, against a fixed submission date. |
| Apple HealthKit via `react-native-health` | Viable but rejected. Requires a custom development client and an Apple Developer Program membership to install on a physical device, adding cost and enrolment delay for no functional gain over Core Motion for step data. |
| **Core Motion via `expo-sensors`** | **Selected.** Included in Expo Go, so it requires no native build; provides both live step updates and historical queries. |

### Why the substitution is functionally equivalent

The proposal's stated technical risk was *"unreliable or delayed step data …
mitigated by reading cumulative step totals (not live deltas) and reconciling
on app resume."* That mitigation is preserved exactly. Core Motion records
steps continuously at the hardware level whether or not the application is
running, and `Pedometer.getStepCountAsync(start, end)` returns the total for an
arbitrary past window.

The offline progression feature — *"start an activity, close the app, walk in
real life, and return later to claim resources and XP"* — is therefore
delivered as specified. The implementation stores a high-water mark
(`players.last_step_sync_at`) and, on resume, requests the step count between
that timestamp and the present. See `src/health/usePedometer.ts`.

### Residual limitations

- `getStepCountAsync` returns only steps recorded by the handset itself; steps
  synchronised from a paired Apple Watch or third-party tracker are excluded.
  For this application that is acceptable, and arguably preferable, since the
  design intent is to reward the user's own walking.
- Core Motion retains approximately seven days of history. Catch-up windows are
  clamped accordingly, so a player returning after a longer absence is credited
  for the last seven days only.
- The delivered build targets iOS. The Android path is unchanged in principle:
  substituting `react-native-health-connect` behind the same hook interface
  would restore Android support without altering the game logic, because the
  hook's only contract with the rest of the system is
  `(steps, windowStart, windowEnd)`.

---

## 2. Client-authoritative state → server-authoritative game engine

### What was proposed

> Game state (skills, XP, inventory, and unclaimed offline progress) is held in
> a local persistent store and synced through a lightweight backend.
>
> — Project Proposal, §4

### What changed

The game engine was moved from the client into the API server. The device now
reports only how many steps were walked; the server decides what those steps
earned, writes the outcome, and returns the new state.

### Why

Two reasons, one required and one defensive.

The project brief requires that *"you must use a server side programming
language to maintain a complex persistent data storage pertaining to the
application functionality."* A backend that only stored a state blob computed
on the device would satisfy the letter of that requirement and not its intent.

More substantively, a client that computes its own rewards can fabricate them.
Any user able to modify local storage could grant themselves arbitrary XP and
items. Placing the rules server-side means the only thing the client can assert
is a step count, which is bounded and audited (see §3).

### Effect on the original design

No feature was lost. At the point of this change the step-cost activity loop,
tool efficiency multipliers, crafting chains, loot rolls and the XP curve were
unchanged in behaviour — the functions were moved, not rewritten, and the unit
tests asserted the same numerical outcomes. The activity loop was subsequently
restructured for game-design reasons unrelated to the move; see §3.

---

## 3. Step economy: per-action costs → step-target quests

### What was proposed

> Walking funds in-game actions. Each activity has a step cost; steps walked
> are converted into completed actions, which yield resources and XP.
>
> — Project Proposal, §3 Core Mechanic

The proposal's economy was a continuous one: steps were spent as they arrived,
each completed action granting its own resource and XP immediately, with any
remainder banked towards the next action.

### What changed

Activities are now **quests with a flat step target**. An activity declares
`targetSteps`, and the player walks towards it; nothing is granted while
walking. On reaching the target the quest becomes collectable, and collecting
it grants a single fixed reward (`yieldCount` of the yield item, plus
`xpReward`) and clears the quest.

This replaced an intermediate design, briefly in the codebase, in which a quest
was a fixed *number of actions* (`targetActions`) with per-action costs
retained underneath. That model kept two units of progress — steps into
actions, actions into a quest — and the second added nothing the first did not
already express.

| | Proposed | Delivered |
| --- | --- | --- |
| Unit of progress | Steps → actions | Steps |
| Reward timing | Per action, immediately | Once, on collection |
| Tool efficiency | Reduces per-action step cost | Reduces the quest's step target |
| Loot rolls | One per action | One per quest |

### Why

Three reasons.

The per-action model gave no sense of an objective. Rewards arrived in a steady
trickle whose size depended on how long the app had been closed, so there was
no moment of completion — the central feedback loop a walking game needs. A
step target creates one, and the "collect" step makes it deliberate.

The two-level model that preceded this one was redundant. With five actions of
fifty steps, the player's actual requirement was two hundred and fifty steps;
the action count was an implementation detail surfaced as game vocabulary. A
flat target says the same thing in the unit the player actually controls.

Removing per-action subdivision also removed a class of rounding artefact. Step
batches that did not divide evenly into an action cost left residue whose
behaviour was hard to explain in the interface and, at the boundary, hard to
distinguish from a bug.

### Effect on progression

Reward rates were re-derived to hold the previous pace, not to change it. The
delivered values keep XP-per-step and items-per-step at approximately their
earlier levels, with `targetSteps` scaled by each quest's level gate:

| Quest | Level | Target steps | Yield | XP |
| --- | --- | --- | --- | --- |
| Chop Birch Tree | 1 | 50 | 1 birch log | 8 |
| Mine Copper Vein | 1 | 60 | 2 copper ore | 20 |
| Chop Oak Tree | 5 | 150 | 4 oak logs | 70 |
| Mine Iron Vein | 8 | 250 | 5 iron ore | 110 |

Loot rate per step is broadly unchanged: the roll moved from once per action to
once per quest, but a quest is now a much shorter walk than five actions were.

### Residual limitations

- Crafting recipes are still paid for from `stepsBanked`, which is cleared when
  a quest is collected. A player must therefore start a fresh quest and bank
  the cost before visiting the forge. The two counters are kept separate so
  that crafting cannot consume quest progress, but the pool not surviving
  collection is a known rough edge rather than a deliberate constraint.
- Steps walked past a quest's target do not carry into the next quest's
  progress. They are added to the crafting pool, so they are not lost outright.

---

## 4. Additions not present in the proposal

| Addition | Rationale |
| --- | --- |
| `step_ledger` table | Every batch of ingested steps is recorded with its device time window and the number of quests it completed. This makes offline progression auditable after the fact and provides the evidence base for evaluating the step economy. |
| `event_log` table | The proposal described an in-memory event feed. Persisting it means the feed survives reinstallation and can be inspected during evaluation. |
| Server-side plausibility ceiling on step batches | A single sync of more than 200,000 steps is rejected. This is not anti-cheat so much as protection against a pedometer fault awarding many levels at once. |
| Offline step buffering on the client | Batches that cannot reach the server are queued locally and replayed in order on the next successful call, so a lost signal mid-walk does not cost progress. |

---

## 5. Scope not delivered

| Proposed item | Status |
| --- | --- |
| Android platform support | Not delivered. See §1. |
| Multiple regions and travel | Out of scope in the proposal; remains out of scope. |
| Combat, friends, multiplayer | Out of scope in the proposal; remains out of scope. |
| Original artwork | Not delivered. The interface is typographic, using a fixed palette. |

---

## 6. Requirements traceability

Functional requirements from the Requirements Specification (12 June 2026) that
referenced Health Connect explicitly should be read as referring to the device
step-data provider. The acceptance criteria are otherwise unchanged: each still
specifies granting motion permission, reading a step count, and converting it
to in-game progress, and each remains testable in those terms.
