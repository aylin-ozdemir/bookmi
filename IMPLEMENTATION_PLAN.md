# BookMi — Implementation Plan

Companion doc to `ONEPAGER.md`. This plan is written to be executed autonomously (developer is asleep): every phase has verification gates, default decisions are locked in below, and open questions are listed with the default I'll build to.

---

## 1. Scope

**In scope (hackathon MVP):**
- Event creation: name, format (virtual / in-person / hybrid), location (north / central / either), date(s), time window, slot granularity, travel buffer.
- Shareable event link, name-only participant join (no auth).
- Per-participant availability grid with a location tag on every block.
- Two-round selection flow (preferred → available).
- Overlap/results engine honoring format, location, and travel buffer.
- Results heatmap with recommended slot(s) and per-slot participant breakdown.
- Live-ish updates via polling.

**Explicitly out of scope (cut list):**
- Accounts/auth, calendar sync, timezone handling (assume single TZ — Ann Arbor), real-time collaboration via websockets, mobile app, recurring events.

## 2. Tech Stack

Default choice, optimized for hackathon speed + testability:

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One deployable, API routes + UI in one place |
| Styling | **Tailwind CSS** | Fast iteration, no design system needed |
| DB | **SQLite via Prisma** | Zero-infra, file-based, real relations |
| Validation | **zod** | Shared schema between client/server |
| Tests | **Vitest** (unit + engine) · **Playwright** (E2E smoke, if time) | Engine is pure functions → easy to test hard |
| Live updates | HTTP polling every ~4s on results/grid views | SSE/websockets not worth it for MVP |

Alternatives considered: Convex/Supabase (realtime for free, but adds hosted-account setup friction), Vite+Express (more wiring than Next). If the team prefers one, the engine layer is framework-agnostic and ports cleanly.

## 3. Data Model (Prisma sketch)

```prisma
enum Format   { VIRTUAL  IN_PERSON  HYBRID }
enum Campus   { NORTH  CENTRAL  EITHER }        // event location; EITHER = no preference
enum BlockLoc { NORTH  CENTRAL  EITHER  REMOTE } // participant per-block location

model Event {
  id          String   @id @default(cuid())
  slug        String   @unique            // share link: /e/[slug]
  name        String
  format      Format
  location    Campus                      // ignored when format == VIRTUAL
  days        String                      // JSON array of ISO dates, e.g. ["2026-10-05","2026-10-06"]
  startMin    Int                         // minutes from midnight, e.g. 540 = 9:00
  endMin      Int                         // e.g. 1080 = 18:00
  slotMinutes Int      @default(30)
  travelMin   Int      @default(20)       // inter-campus commute buffer
  participants Participant[]
  createdAt   DateTime @default(now())
}

model Participant {
  id        String      @id @default(cuid())
  eventId   String
  event     Event       @relation(fields: [eventId])
  name      String
  selections Selection[]
}

model Selection {
  id            String   @id @default(cuid())
  participantId String
  participant   Participant @relation(fields: [participantId])
  day           String   // ISO date
  slotStartMin  Int      // minutes from midnight
  round         Int      // 1 = preferred, 2 = available
  location      BlockLoc

  @@unique([participantId, day, slotStartMin, round])
}
```

Notes:
- Storing `days` + `startMin/endMin` as ints keeps the engine arithmetic simple (minutes since midnight, no Date math except day identity).
- A participant's Round-2 grid is "all times that work" — the engine treats effective availability for the fallback pass as `round1 ∪ round2` (preferred times are by definition also available).

## 4. Availability Engine (core logic)

Pure module — `lib/availability.ts` — no DB imports, fully unit-tested.

### 4.1 Per-slot feasibility

```
canAttend(p, slot t, event, round) -> { ok: boolean, mode: 'in-person'|'remote', reason? }
```

Let `loc(p, t)` = the BlockLoc the participant marked at `t` (null if unmarked).

- **VIRTUAL**: `ok = loc(p,t) != null`. Mode = `remote`.
- **HYBRID**: `ok = loc(p,t) != null`. Mode = `remote` if `loc ∈ {REMOTE}` or in-person at the event campus isn't travel-feasible; else `in-person`.
- **IN_PERSON** at campus `L` (if `event.location == EITHER`, evaluate separately for L=NORTH and L=CENTRAL):
  - `ok = false` if `loc(p,t) == null` or `loc(p,t) == REMOTE`.
  - `ok = false` if `loc(p,t)` is the *other* campus.
  - If `loc(p,t) ∈ {L, EITHER}` → `ok = travelFeasible(p, t, t + slot, L)`.

### 4.2 Travel feasibility

A participant "committed" to a campus at time `t` if they marked `NORTH` or `CENTRAL` there (`EITHER`/`REMOTE`/null are uncommitted). For an in-person meeting spanning `[t0, t1)` on campus `L`:

```
travelFeasible(p, t0, t1, L):
  prev = latest committed slot strictly before t0
  next = earliest committed slot strictly after/equal t1
  if prev exists and prev.loc != L and (t0 - prev.end) < event.travelMin  -> false
  if next exists and next.loc != L and (next.start - t1) < event.travelMin -> false
  true
```

Intuition: to attend on Central at `t0`, the last place you were definitely pinned before `t0` must either be Central or leave ≥ `travelMin` to get there — and symmetrically for wherever you're pinned after. `EITHER` blocks are treated as "can be wherever needed," so they don't create travel debt.

The meeting length for the check is the event's slot size; for the results view we evaluate each slot independently (a recommended slot = one bookable block; contiguous runs of bookable blocks are coalesced for display).

### 4.3 Campus resolution for `EITHER` events

For `event.location == EITHER`: run the feasibility pass twice (L=NORTH, L=CENTRAL). For each slot pick the campus where all participants are feasible; if both work, prefer the one with more `in-person` modes (fewer forced remotes in hybrid). Expose `suggestedLocation` per recommended slot.

### 4.4 Two-round overlap

```
computeResults(event, participants):
  r1 = slots where ∀p: canAttend(p, t, event, round=1).ok
  if r1 nonempty -> recommended = r1, tier = 'preferred'
  else:
    r2 = slots where ∀p: canAttend(p, t, event, effective round = 1∪2).ok
    recommended = r2, tier = 'fallback'
  heatmap = per-slot count of feasible participants (round-aware, both tiers computed
            so the UI can show near-misses)
  return { recommended, tier, heatmap, perSlotBreakdown: who can/can't + reason }
```

Breakdown reasons drive the UI copy: `on-other-campus`, `insufficient-travel-time`, `remote-only`, `not-marked`.

## 5. API Surface (Next.js route handlers)

| Route | Purpose |
|---|---|
| `POST /api/events` | create event → returns slug |
| `GET /api/events/[slug]` | event + participants + selections (client polls this) |
| `POST /api/events/[slug]/participants` | join with display name → participant id (stored in localStorage) |
| `PUT /api/events/[slug]/participants/[pid]/selections` | bulk-save one round's grid (idempotent replace) |
| `GET /api/events/[slug]/results` | server-side `computeResults` (also reused client-side for instant paint feedback) |

zod schemas per route; the engine module is shared so results computed on the server and previewed on the client can't drift.

## 6. UI Plan

Routes: `/` (create event), `/e/[slug]` (event room: join → select → results).

Components:
- **`AvailabilityGrid`** — rows = time slots, cols = days; click-and-drag painting. Active "paintbrush" = current location tag (North / Central / Either / Remote), chosen via a segmented control above the grid. Blocks render location via color + icon (N/C/~/⌂).
- **Round flow** — two-tab/step UI: "① My preferred times" → "② All times I'm free." Round 1 grid carries into Round 2 pre-painted (preferred ⊆ available).
- **`ResultsPanel`** — heatmap shading by feasible fraction, recommended slot(s) highlighted with tier badge ("Everyone's first choice" / "Works for everyone"), tooltip per slot listing each participant's status + reason, and `suggestedLocation` for EITHER events.
- Small legend explaining location tags and the travel buffer.

Copy matters for the demo: slot tooltips should say e.g. *"Aylin: on North at 1:30 — can't reach Central by 1:45 (needs 20 min)"*.

## 7. Testing & Verification

**Engine unit tests (Vitest) — the highest-value suite:**
- Virtual: marked = available regardless of location.
- In-person: other-campus marked → blocked; same-campus/`EITHER` → ok.
- Travel boundary: gap exactly `travelMin` → feasible; `travelMin − slot` → blocked; forward-direction check (committed to other campus right after meeting) → blocked.
- `EITHER`-location events resolve to best campus; hybrid falls back to remote mode.
- Rounds: full Round-1 overlap → preferred tier; no Round-1 overlap → falls back to union grid; preferred ⊆ available invariant.
- Partial overlap → correct heatmap counts + per-person reasons.

**API tests**: create → join → save selections → results, via route-handler calls against a test SQLite db.

**E2E (Playwright, one happy path)**: create event, join as two participants, paint grids, assert a recommended slot renders. Include the scripted demo scenario: P1 on North at 1:30, in-person Central event — naive overlap would pick 1:45, engine must pick ≥ 2:10 or flag P1.

**Manual checklist**: no-participant state, single participant, all-remote hybrid, empty Round 1.

## 8. Autonomous Workflow (phases + gates)

Work proceeds phase-by-phase; each phase ends with a **gate** that must pass before moving on. Subagents are used as reviewers/verifiers, not primary implementers.

| Phase | Work | Gate |
|---|---|---|
| P0 | One-pager + this plan (done — no code) | Docs reviewed |
| P1 | Scaffold (Next+TS+Tailwind+Prisma+Vitest), schema, engine + full unit tests | `vitest` green, `tsc` clean |
| P2 | API routes + zod + persistence | API tests green |
| P3 | Grid UI, location paintbrush, two-round flow, results panel | Build passes; manual smoke via dev server + browser preview |
| P4 | Seed/demo script, E2E smoke, polish, README run instructions | E2E green, demo scenario verified |

**Subagent checkpoints:**
- After P1: `subagent_explore` reviews `lib/availability.ts` against §4 of this plan and hunts for missing edge cases (boundary arithmetic, EITHER semantics, round union). Findings → fix before P2.
- After P3: reviewer does a spec-vs-UI pass (all features in ONEPAGER present? reasons shown? rounds enforced?).
- Final: `subagent_general` runs the full verification suite fresh (install → test → build → e2e) on a clean checkout mindset and reports blockers only.

**Iteration rule:** any gate failure → fix-forward, re-run gate; if the same gate fails twice, reassess the design rather than patching symptoms. Commit at each green gate with conventional-style messages.

## 9. Defaults & Open Questions

Locked defaults (revisit if the team disagrees):

| Question | Default |
|---|---|
| Stack | Next.js + TS + Tailwind + Prisma/SQLite (§2) |
| Auth | None — share link + display name, participant id in localStorage |
| Slot size | 30 min default; 15 min option at event creation |
| Travel buffer | 20 min default; editable per event (15/20/30 quick picks) |
| `EITHER` event location | Engine auto-picks best campus per slot and surfaces it |
| Round 2 semantics | Effective availability = Round 1 ∪ Round 2 |
| Days | Concrete dates selected by organizer (not day-of-week recurring) |
| Timezone | Single TZ (America/Detroit) — ignore others |

## 10. Risks

- **Grid UX complexity** (drag-paint × 4 location tags × 2 rounds) is the biggest build risk → build the grid as a dumb controlled component early (P3) and keep painting logic isolated.
- **Travel-feasibility edge cases** (off-by-one at boundaries) → covered by explicit boundary tests in §7.
- **Scope creep** → §1 cut list is final for the hackathon; stretch items below only after P4 gate passes.

## 11. Stretch Goals (post-MVP)

- Live bus integration (UMich Magic Bus / TheRide realtime positions) to auto-size `travelMin`.
- Google Calendar import to pre-fill availability/location from class locations.
- Recurring weekly meetings; iCal export of the booked slot.
- Discord/Slack share + notifications when the team reaches full overlap.
