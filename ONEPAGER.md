# BookMi

**Location-aware scheduling for a two-campus university.** A When2Meet-style availability grid built for University of Michigan students, where "when can you meet" is inseparable from "where can you be."

## The Problem

U-M's campus is effectively two campuses — Central and North — connected by a bus system with a 15–30 minute commute. Existing tools like When2Meet and Doodle treat availability as purely temporal. The result is familiar to every Michigan student:

- A "yes" at 2:00pm is meaningless if you're on North Campus and the meeting is on Central.
- Groups pick times where everyone is technically free but half the team spends the meeting on a bus.
- Every marked block is treated equally — there's no way to say "this time is my first choice" vs. "this time works in a pinch."

## The Solution

BookMi adds **location** and **preference** as first-class citizens of the availability grid:

1. **Event format.** Every event is designated **virtual**, **in-person**, or **hybrid**. In-person events specify a location: **North Campus**, **Central Campus**, or **either / no preference**.
2. **Location-tagged availability.** Every time block a participant marks carries a location indicator — where they'll be during that block (North, Central, either/flexible, or remote). The grid doubles as a location plan, so teammates can see not just *when* but *where* everyone will be.
3. **Travel-time awareness.** BookMi bakes the inter-campus commute into availability math. If you're on North at 1:30pm, BookMi knows you can't make a 1:45pm meeting on Central — the buffer is configurable per event (default ~20 min, matching the real bus ride).
4. **Two rounds of selection.**
   - **Round 1 — Preferred:** participants mark their first-choice times. Everyone's top preference gets considered before anything else.
   - **Round 2 — Available:** participants mark every time that could possibly work. These act as a fallback: they're only used to find overlap if no Round-1 slot works for the whole team.
5. **Smart overlap results.** A heatmap shows partial availability like When2Meet, but the recommendation engine distinguishes *fully overlapping*, *fallback-available*, and *travel-blocked* slots — and for "either location" events it suggests which campus produces the most feasible times.

## How It Works

1. Organizer creates an event: format, location, date range, time window, slot granularity.
2. A share link goes out — no accounts needed, When2Meet-style.
3. Each participant paints their **preferred** grid (Round 1), tagging blocks with where they'll be, then their **available** grid (Round 2).
4. BookMi computes the overlap: first on Round-1 selections, falling back to Round 2 only if needed — always honoring the travel buffer for in-person and hybrid events.
5. The organizer books the recommended slot and location.

## Why It Wins

| | When2Meet | BookMi |
|---|---|---|
| Availability | times only | times + locations |
| Travel between campuses | ignored | built into overlap math |
| Preference vs. fallback | no distinction | two-round selection |
| Event formats | none | virtual / in-person / hybrid |

## Audience & Demo Goal

Built for Michigan student teams, clubs, study groups, and office hours — and generalizable to any org split across sites (multi-office companies, conferences, etc.).

**Demo story:** a naive When2Meet overlap picks 1:45pm on Central — but two teammates are on North until 1:30. BookMi catches the impossible commute and surfaces 2:15pm on Central instead, or suggests making the meeting hybrid so they can join from the bus.
