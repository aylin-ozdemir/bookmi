# BookMi

Location-aware group scheduling for a two-campus university — a When2Meet-style
availability grid built for U-M students, where every time block also says
*where* you'll be. See `ONEPAGER.md` for the pitch and `IMPLEMENTATION_PLAN.md`
for the architecture.

## Features

- **Event formats:** virtual, in-person, or hybrid. In-person/hybrid events pick
  North Campus, Central Campus, or "either / no preference".
- **Location-tagged availability:** every block you paint is tagged North,
  Central, Flexible, or Remote.
- **Travel-aware overlap:** a configurable inter-campus bus buffer (default
  20 min) — you can't attend a Central meeting 15 minutes after a North class.
- **Two rounds:** ① preferred times first, ② all available times as fallback.
  Round-2 times only count when no preferred slot works for everyone.
- **Live results heatmap:** shade by feasible headcount, hover for per-person
  status ("can't get here in time (20 min commute)"), suggested campus for
  either-location events.
- **Optional Google Calendar import:** link a Google account to auto-fill your
  "all available" grid from your calendar's free time. Long "study"-type
  blocks count as available (and can carry a campus tag from their location).

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Prisma 7 on
SQLite (better-sqlite3 driver adapter) · zod · Vitest · Playwright.

## Getting started

```bash
npm install            # postinstall runs prisma generate
npm run db:push        # create prisma/dev.db from the schema
npm run dev            # http://localhost:3000
npm run seed           # optional: demo event at /e/demo-study-group
```

`DATABASE_URL` defaults to `file:./prisma/dev.db` (see `.env.example`).

## Google Calendar link (optional)

Participants can connect a Google account from the event room to auto-fill
their round-2 availability grid: busy calendar events block slots, free time
is marked Flexible, and self-scheduled blocks titled "study" (or similar —
see `STUDY_RE` in `lib/calendarImport.ts`) of 60+ minutes count as available.
Campus names in an event's location field (e.g. "Duderstadt") tag the slot
with that campus. Re-syncing keeps hand-painted marks and drops stale
imported ones; unlinking removes imported marks too.

By default the import only counts calendars the user can write on
(`accessRole` owner/writer — their own calendars, whose events are real
commitments). Read-only subscriptions — TA office hours, public schedules,
Google's holiday calendars — default to excluded but stay pickable, and
events the user created count as busy no matter which calendar they sit
on. The linked card shows a per-calendar checklist to override the
defaults; the choice is stored per participant.

To enable it, create OAuth credentials in
[Google Cloud Console](https://console.cloud.google.com/apis/credentials)
(web application type, Calendar API enabled) and register the redirect URI
`http://localhost:3000/api/auth/google/callback`, then set:

```bash
GOOGLE_CLIENT_ID="…"
GOOGLE_CLIENT_SECRET="…"
```

Without these vars the feature is hidden and its endpoints return 501.

## Testing

```bash
npm test               # vitest: engine unit tests + API integration tests
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npx playwright test    # UI happy path (uses system Chrome, dev server reused)
```

The availability engine (`lib/availability.ts`) is pure functions — all
overlap/travel logic is unit-testable without the DB or the browser.

## Docs

- `ONEPAGER.md` — product pitch
- `IMPLEMENTATION_PLAN.md` — data model, engine algorithm, API surface, phases
