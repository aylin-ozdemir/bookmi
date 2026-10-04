# BookMi — Pitch & Tech Stack Summary

## The Pitch

**Location-aware scheduling for a two-campus university.** A When2Meet-style
availability grid built for University of Michigan students, where "when can
you meet" is inseparable from "where can you be."

### The Problem

U-M's campus is effectively two campuses — Central and North — connected by a
bus system with a 15–30 minute commute. Existing tools like When2Meet and
Doodle treat availability as purely temporal:

- A "yes" at 2:00pm is meaningless if you're on North Campus and the meeting
  is on Central.
- Groups pick times where everyone is technically free but half the team
  spends the meeting on a bus.
- Every marked block is treated equally — no way to say "this time is my
  first choice" vs. "this time works in a pinch."

### The Solution

BookMi adds **location** and **preference** as first-class citizens of the
availability grid:

1. **Event format.** Every event is **virtual**, **in-person**, or
   **hybrid**. In-person events specify a location: **North Campus**,
   **Central Campus**, or **either / no preference**.
2. **Location-tagged availability.** Every time block a participant marks
   carries a location tag — North, Central, either/flexible, or remote. The
   grid doubles as a location plan.
3. **Travel-time awareness.** The inter-campus commute is baked into
   availability math — a configurable per-event buffer (default ~20 min,
   matching the real bus ride).
4. **Two rounds of selection.** Round 1 = preferred times; Round 2 = all
   times that could work, used only as a fallback when no preferred slot
   works for everyone.
5. **Smart overlap results.** A heatmap distinguishes *fully overlapping*,
   *fallback-available*, and *travel-blocked* slots — and for "either
   location" events it suggests which campus produces the most feasible
   times.

### How It Works

1. Organizer creates an event: format, location, date range, time window,
   slot granularity.
2. A share link goes out — no accounts needed, When2Meet-style.
3. Participants paint their **preferred** grid (Round 1), tagging blocks with
   where they'll be, then their **available** grid (Round 2).
4. BookMi computes overlap on Round-1 selections first, falling back to
   Round 2 only if needed — always honoring the travel buffer for in-person
   and hybrid events.
5. The organizer books the recommended slot and location.

### Why It Wins

| | When2Meet | BookMi |
|---|---|---|
| Availability | times only | times + locations |
| Travel between campuses | ignored | built into overlap math |
| Preference vs. fallback | no distinction | two-round selection |
| Event formats | none | virtual / in-person / hybrid |

### Audience & Demo Goal

Built for Michigan student teams, clubs, study groups, and office hours —
and generalizable to any org split across sites.

**Demo story:** a naive When2Meet overlap picks 1:45pm on Central — but two
teammates are on North until 1:30. BookMi catches the impossible commute and
surfaces 2:15pm on Central instead, or suggests making the meeting hybrid so
they can join from the bus.

---

## Tech Stack & Justification

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript** | One deployable — API routes and UI in a single codebase; type safety end-to-end |
| Styling | **Tailwind CSS v4** | Fast iteration; no design system needed for a hackathon UI |
| Database | **SQLite via Prisma 7** (better-sqlite3 driver adapter) | Zero-infra, file-based DB with real relations and migrations; nothing to provision |
| Validation | **zod** | Schemas shared between client and server so payloads can't drift |
| AI classification | **TypeSafe Jev** (System One model) | Semantically classifies imported Google Calendar events as busy / flexible / preferred / ignore — regex rules as fallback so it degrades gracefully without an API key |
| Tests | **Vitest** (unit + API) · **Playwright** (E2E) | The availability engine is pure functions → the hard logic is fully unit-testable without DB or browser |
| Live updates | **HTTP polling (~4s)** on results/grid views | SSE/websockets not worth it for an MVP; polling is simple and sufficient |

### Why this stack overall

- **Hackathon-speed + testability:** Next.js keeps everything in one
  process; SQLite means zero external infra; the pure-function engine
  (`lib/availability.ts`) makes the differentiating logic (travel buffers,
  two-round overlap, EITHER-campus resolution) trivially testable.
- **Shared engine, no drift:** the same availability module runs on the
  server (authoritative results) and the client (instant paint feedback), so
  previewed and computed results can never disagree.
- **Graceful AI integration:** Jev turns fuzzy calendar-event semantics
  ("is 'Gym' busy? is 'Study block' preferred?") into typed judgments, with
  regex fallback — a real System One use case, not prompt-and-parse.

### Alternatives considered

- **Convex / Supabase** — realtime for free, but adds hosted-account setup
  friction.
- **Vite + Express** — more wiring than Next.js for the same result.
- The engine layer is framework-agnostic and ports cleanly if the team ever
  wants a different stack.

### Accepted trade-offs (hackathon scope)

- SQLite is local-file only — a real deploy needs Postgres + env config.
- Polling, not websockets.
- No auth beyond the share link (When2Meet parity).
- Single timezone (America/Detroit).
