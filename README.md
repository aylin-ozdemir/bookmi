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
