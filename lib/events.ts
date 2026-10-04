import { computeResults, EventResults } from "./availability";
import { getPrisma } from "./db";
import {
  BlockLoc,
  EventConfig,
  EventLocation,
  Format,
  ParticipantInput,
  SelectionMap,
  slotKey,
} from "./types";

export interface PublicEvent {
  slug: string;
  name: string;
  format: Format;
  location: EventLocation;
  days: string[];
  startMin: number;
  endMin: number;
  slotMinutes: number;
  travelMin: number;
}

export interface EventBundle {
  event: PublicEvent;
  participants: ParticipantInput[];
  results: EventResults;
}

/** Load an event + participants + computed overlap, or null if missing. */
export async function getEventBundle(slug: string): Promise<EventBundle | null> {
  const prisma = getPrisma();
  const row = await prisma.event.findUnique({
    where: { slug },
    include: { participants: { include: { selections: true } } },
  });
  if (!row) return null;

  const config: EventConfig = {
    format: row.format as Format,
    location: row.location as EventLocation,
    days: JSON.parse(row.days) as string[],
    startMin: row.startMin,
    endMin: row.endMin,
    slotMinutes: row.slotMinutes,
    travelMin: row.travelMin,
  };

  const participants: ParticipantInput[] = row.participants.map((p) => {
    const round1: SelectionMap = {};
    const round2: SelectionMap = {};
    for (const s of p.selections) {
      const map = s.round === 1 ? round1 : round2;
      map[slotKey(s.day, s.slotStartMin)] = s.location as BlockLoc;
    }
    return { id: p.id, name: p.name, round1, round2 };
  });

  return {
    event: { slug: row.slug, name: row.name, ...config },
    participants,
    results: computeResults(config, participants),
  };
}
