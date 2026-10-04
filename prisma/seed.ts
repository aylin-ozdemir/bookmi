// Demo seed: an in-person "Study group" event where the naive When2Meet
// answer is wrong — Aylin is on North Campus until minutes before the
// "obvious" slot, so the engine must pick a later time on Central.
// Run: npm run seed   (prints the event link)

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../lib/generated/prisma/client";
import { slotKey } from "../lib/types";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  }),
});

const DAY = "2026-10-05"; // adjust to demo day as needed

function toRows(
  participantId: string,
  entries: [number, string][],
  round: number,
) {
  return entries.map(([startMin, location]) => ({
    participantId,
    day: DAY,
    slotStartMin: startMin,
    round,
    location,
  }));
}

async function main() {
  const slug = "demo-study-group";
  await prisma.event.deleteMany({ where: { slug } });

  const event = await prisma.event.create({
    data: {
      slug,
      name: "Hackathon team sync",
      format: "IN_PERSON",
      location: "CENTRAL",
      days: JSON.stringify([DAY]),
      startMin: 12 * 60, // noon
      endMin: 16 * 60, // 4pm
      slotMinutes: 15,
      travelMin: 30,
    },
  });

  // Aylin: committed NORTH 12:00–12:30 (class on North), flexible 12:45+,
  // committed NORTH again at 15:00 (another class).
  const aylin = await prisma.participant.create({
    data: { eventId: event.id, name: "Aylin" },
  });
  await prisma.selection.createMany({
    data: [
      ...toRows(aylin.id, [[720, "NORTH"], [735, "NORTH"], [750, "EITHER"], [765, "EITHER"], [780, "EITHER"], [795, "EITHER"], [810, "EITHER"], [825, "EITHER"], [840, "EITHER"], [855, "EITHER"], [870, "EITHER"], [885, "EITHER"], [900, "NORTH"], [915, "NORTH"]], 1),
    ],
  });

  // Ravi: on Central all afternoon, preferred 12:15–12:45.
  const ravi = await prisma.participant.create({
    data: { eventId: event.id, name: "Ravi" },
  });
  await prisma.selection.createMany({
    data: toRows(
      ravi.id,
      [[735, "CENTRAL"], [750, "CENTRAL"], [765, "CENTRAL"], [780, "CENTRAL"], [795, "CENTRAL"], [810, "CENTRAL"], [825, "CENTRAL"], [840, "CENTRAL"], [855, "CENTRAL"], [870, "CENTRAL"]],
      1,
    ),
  });

  // Sam: round-1 preferred early, but round-2 says they can do all afternoon.
  const sam = await prisma.participant.create({
    data: { eventId: event.id, name: "Sam" },
  });
  await prisma.selection.createMany({
    data: [
      ...toRows(sam.id, [[735, "EITHER"], [750, "EITHER"]], 1),
      ...toRows(sam.id, [[750, "EITHER"], [765, "EITHER"], [780, "EITHER"], [795, "EITHER"], [810, "EITHER"], [825, "EITHER"], [840, "EITHER"], [855, "EITHER"], [870, "EITHER"]], 2),
    ],
  });

  console.log(`Seeded demo event → http://localhost:3000/e/${slug}`);
  console.log(`Participants: Aylin, Ravi, Sam (${event.id})`);
}

main().finally(() => prisma.$disconnect());
