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

No feature was lost. The step-cost activity loop, tool efficiency multipliers,
crafting chains, loot rolls and the XP curve are unchanged in behaviour — the
functions were moved, not rewritten, and the unit tests assert the same
numerical outcomes.

---

## 3. Additions not present in the proposal

| Addition | Rationale |
| --- | --- |
| `step_ledger` table | Every batch of ingested steps is recorded with its device time window and the number of in-game actions it funded. This makes offline progression auditable after the fact and provides the evidence base for evaluating the step economy. |
| `event_log` table | The proposal described an in-memory event feed. Persisting it means the feed survives reinstallation and can be inspected during evaluation. |
| Server-side plausibility ceiling on step batches | A single sync of more than 200,000 steps is rejected. This is not anti-cheat so much as protection against a pedometer fault awarding many levels at once. |
| Offline step buffering on the client | Batches that cannot reach the server are queued locally and replayed in order on the next successful call, so a lost signal mid-walk does not cost progress. |

---

## 4. Scope not delivered

| Proposed item | Status |
| --- | --- |
| Android platform support | Not delivered. See §1. |
| Multiple regions and travel | Out of scope in the proposal; remains out of scope. |
| Combat, friends, multiplayer | Out of scope in the proposal; remains out of scope. |
| Original artwork | Not delivered. The interface is typographic, using a fixed palette. |

---

## 5. Requirements traceability

Functional requirements from the Requirements Specification (12 June 2026) that
referenced Health Connect explicitly should be read as referring to the device
step-data provider. The acceptance criteria are otherwise unchanged: each still
specifies granting motion permission, reading a step count, and converting it
to in-game progress, and each remains testable in those terms.
