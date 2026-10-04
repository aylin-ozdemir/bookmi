// Feature-tour seed: an IN_PERSON / EITHER-location event whose grids are
// arranged so the results view shows every BookMi feature at once:
//
//   Mon 10/5 — the commute trap. Everyone marks 10:30 free, but Aylin's
//     North class ends at 10:30 → "can't get here in time (30 min)".
//     Preferred-tier recommendation 11:00–12:30 (Central). At 12:30 Maya is
//     squeezed: "can't reach their next commitment". The 1pm hour mixes
//     remote marks with a North-resolved cell.
//   Tue 10/6 — remote + backup day. 9–10am everyone is remote (violet
//     remote-only cells + the "switch to hybrid" hint). 10–11am everyone is
//     flexible → "works on either campus". 11am–1pm is round-2-only
//     availability → a "not preferred" alternative that resolves North.
//
// Run: npm run seed:showcase   (prints the event link)
// Idempotent: deletes and recreates slug "feature-tour" only; other events
// (including locally created ones like "mhacks!") are untouched.

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  }),
});

const MON = "2026-10-05";
const TUE = "2026-10-06";

/** Expand [day, startMin, endMin, location, round] ranges into Selection rows. */
function rows(
  participantId: string,
  spans: [string, number, number, string, number][],
) {
  const out = [];
  for (const [day, start, end, location, round] of spans) {
    for (let t = start; t < end; t += 30) {
      out.push({ participantId, day, slotStartMin: t, round, location });
    }
  }
  return out;
}

async function main() {
  const slug = "feature-tour";
  await prisma.event.deleteMany({ where: { slug } });

  const event = await prisma.event.create({
    data: {
      slug,
      name: "Feature tour — capstone sync",
      format: "IN_PERSON",
      location: "EITHER",
      days: JSON.stringify([MON, TUE]),
      startMin: 9 * 60, // 9am
      endMin: 14 * 60, // 2pm
      slotMinutes: 30,
      travelMin: 30,
    },
  });

  // Aylin — North campus mornings; flexible midday; remote after 1pm.
  // Tuesday she's on North all late morning (round-2 marks only).
  const aylin = await prisma.participant.create({
    data: { eventId: event.id, name: "Aylin" },
  });
  await prisma.selection.createMany({
    data: rows(aylin.id, [
      [MON, 540, 630, "NORTH", 1], // committed North 9:00–10:30 → travel trap
      [MON, 630, 780, "EITHER", 1], // free after, can bus anywhere
      [MON, 780, 840, "REMOTE", 1],
      [TUE, 540, 600, "REMOTE", 2],
      [TUE, 600, 660, "EITHER", 2],
      [TUE, 660, 840, "NORTH", 2],
    ]),
  });

  // Philippe — Central all Monday, remote after 1pm. Tuesday mostly
  // flexible/backup, on Central late.
  const philippe = await prisma.participant.create({
    data: { eventId: event.id, name: "Philippe" },
  });
  await prisma.selection.createMany({
    data: rows(philippe.id, [
      [MON, 540, 780, "CENTRAL", 1],
      [MON, 780, 840, "REMOTE", 1],
      [TUE, 540, 600, "REMOTE", 2],
      [TUE, 600, 780, "EITHER", 2],
      [TUE, 780, 840, "CENTRAL", 2],
    ]),
  });

  // Maya — flexible early Monday, on Central midday, but has a 1pm North
  // class: 12:30 is travel-blocked ("can't reach their next commitment").
  const maya = await prisma.participant.create({
    data: { eventId: event.id, name: "Maya" },
  });
  await prisma.selection.createMany({
    data: rows(maya.id, [
      [MON, 540, 600, "EITHER", 1],
      [MON, 600, 750, "CENTRAL", 1],
      [MON, 750, 780, "EITHER", 1], // sandwiched: can't reach North class by 1pm
      [MON, 780, 840, "NORTH", 1],
      [TUE, 540, 600, "REMOTE", 2],
      [TUE, 600, 780, "EITHER", 2],
      [TUE, 780, 840, "CENTRAL", 2],
    ]),
  });

  // Jordan — remote Monday morning, on Central midday, flexible after.
  const jordan = await prisma.participant.create({
    data: { eventId: event.id, name: "Jordan" },
  });
  await prisma.selection.createMany({
    data: rows(jordan.id, [
      [MON, 540, 660, "REMOTE", 1],
      [MON, 660, 750, "CENTRAL", 1],
      [MON, 750, 840, "EITHER", 1],
      [TUE, 540, 600, "REMOTE", 2],
      [TUE, 600, 780, "EITHER", 2],
      [TUE, 780, 840, "REMOTE", 2],
    ]),
  });

  console.log(`Seeded feature-tour event → http://localhost:3000/e/${slug}`);
  console.log(`Participants: Aylin, Philippe, Maya, Jordan (${event.id})`);
}

main().finally(() => prisma.$disconnect());
