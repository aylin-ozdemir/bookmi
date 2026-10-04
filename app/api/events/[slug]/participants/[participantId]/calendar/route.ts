import { computeImport, defaultCalendarIncluded } from "@/lib/calendarImport";
import { classifyBlocks, jevConfigured } from "@/lib/jev";
import { getPrisma } from "@/lib/db";
import {
  googleConfigured,
  listCalendarEvents,
  listCalendars,
  refreshTokens,
  toCalBlocks,
  type GcalCalendarEntry,
} from "@/lib/google";
import {
  BlockLoc,
  EventConfig,
  EventLocation,
  Format,
  SelectionMap,
  slotKey,
} from "@/lib/types";
import type { ParticipantModel } from "@/lib/generated/prisma/models/Participant";
import { calendarSelectionSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/events/[slug]/participants/[participantId]/calendar">;
type ParticipantRow = ParticipantModel;

async function load(slug: string, participantId: string) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) return null;
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId: event.id },
  });
  return participant ? { prisma, event, participant } : null;
}

const linked = (p: ParticipantRow) =>
  Boolean(p.googleAccessToken || p.googleRefreshToken);

/** Stored calendar picks, or null = auto mode. */
function storedCalIds(p: ParticipantRow): string[] | null {
  return p.calendarIds ? (JSON.parse(p.calendarIds) as string[]) : null;
}

/**
 * Imported marks per round. Older rows stored a flat round-2 SelectionMap;
 * newer syncs store { r1, r2 } so preferred imports can be cleaned up too.
 */
function importedMaps(p: ParticipantRow): {
  r1: SelectionMap;
  r2: SelectionMap;
} {
  const raw = JSON.parse(p.calendarImported ?? "{}") as Record<
    string,
    unknown
  >;
  if ("r1" in raw || "r2" in raw) {
    return {
      r1: (raw.r1 ?? {}) as SelectionMap,
      r2: (raw.r2 ?? {}) as SelectionMap,
    };
  }
  return { r1: {}, r2: raw as SelectionMap };
}

/** A usable access token, refreshing (and persisting) when near expiry. */
async function accessToken(
  prisma: ReturnType<typeof getPrisma>,
  p: ParticipantRow,
): Promise<string | null> {
  if (
    p.googleAccessToken &&
    (p.googleTokenExpiry?.getTime() ?? 0) > Date.now() + 60_000
  ) {
    return p.googleAccessToken;
  }
  if (!p.googleRefreshToken) return null;
  const tokens = await refreshTokens(p.googleRefreshToken);
  await prisma.participant.update({
    where: { id: p.id },
    data: {
      googleAccessToken: tokens.access_token,
      googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
  return tokens.access_token;
}

/**
 * Calendar ids to import from: the participant's explicit picks if they
 * made any, else the auto rule (calendars they can write on). May return
 * [] meaning "import nothing".
 */
function resolveCalIds(
  p: ParticipantRow,
  entries: GcalCalendarEntry[] | null,
): string[] {
  const stored = storedCalIds(p);
  if (stored) return stored;
  if (entries) {
    const ids = entries.filter(defaultCalendarIncluded).map((e) => e.id);
    return ids.length > 0 ? ids : ["primary"];
  }
  return ["primary"];
}

/** Link status + calendar list for the participant card. */
export async function GET(_request: Request, ctx: Ctx) {
  const { slug, participantId } = await ctx.params;
  const found = await load(slug, participantId);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  const { prisma, participant } = found;

  const body: Record<string, unknown> = {
    configured: googleConfigured(),
    jev: jevConfigured(),
    linked: linked(participant),
    email: participant.googleEmail,
    syncedAt: participant.calendarSyncedAt,
    selectionMode: storedCalIds(participant) ? "custom" : "auto",
    calendars: null,
  };

  // Calendar list powers the picker. Tokens linked before the calendar-
  // list scope was granted 403 here — the picker just stays hidden.
  if (linked(participant)) {
    try {
      const token = await accessToken(prisma, participant);
      if (token) {
        const stored = storedCalIds(participant);
        const entries = await listCalendars(token);
        body.calendars = entries.map((e) => ({
          id: e.id,
          summary: e.summaryOverride ?? e.summary ?? e.id,
          primary: Boolean(e.primary),
          accessRole: e.accessRole ?? null,
          included: stored ? stored.includes(e.id) : defaultCalendarIncluded(e),
        }));
      }
    } catch {
      // leave calendars: null
    }
  }
  return Response.json(body);
}

/** Save an explicit calendar selection (or null → back to auto). */
export async function PATCH(request: Request, ctx: Ctx) {
  const { slug, participantId } = await ctx.params;
  const found = await load(slug, participantId);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  const { prisma, participant } = found;
  if (!linked(participant)) {
    return Response.json({ error: "calendar not linked" }, { status: 409 });
  }

  const parsed = calendarSelectionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid calendarIds" }, { status: 400 });
  }

  await prisma.participant.update({
    where: { id: participant.id },
    data: {
      calendarIds: parsed.data.calendarIds
        ? JSON.stringify(parsed.data.calendarIds)
        : null,
    },
  });
  return Response.json({ saved: true });
}

/** Unlink the account and drop previously imported grid marks. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { slug, participantId } = await ctx.params;
  const found = await load(slug, participantId);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  const { prisma, participant } = found;

  const prior = importedMaps(participant);

  const keyWhere = (map: SelectionMap) =>
    Object.keys(map).map((key) => {
      const at = key.lastIndexOf("@");
      return {
        day: key.slice(0, at),
        slotStartMin: Number(key.slice(at + 1)),
      };
    });

  await prisma.$transaction([
    // Imported marks were machine-written; unlinking removes them so the
    // grid doesn't keep claiming times that may no longer hold.
    prisma.selection.deleteMany({
      where: {
        participantId: participant.id,
        OR: [
          { round: 2, OR: keyWhere(prior.r2) },
          { round: 1, OR: keyWhere(prior.r1) },
        ],
      },
    }),
    prisma.participant.update({
      where: { id: participant.id },
      data: {
        googleEmail: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        calendarImported: null,
        calendarSyncedAt: null,
        calendarIds: null,
      },
    }),
  ]);

  const remaining = await prisma.selection.findMany({
    where: { participantId: participant.id },
  });
  const selections: SelectionMap = {};
  const preferred: SelectionMap = {};
  for (const s of remaining) {
    const map = s.round === 1 ? preferred : selections;
    map[slotKey(s.day, s.slotStartMin)] = s.location as BlockLoc;
  }
  return Response.json({ linked: false, selections, preferred });
}

/**
 * Re-fetch the calendar and rewrite the imported portion of round 2.
 * Merge rule: (existing marks − last import's keys) ∪ fresh free slots —
 * so hand-painted marks survive and stale imports are cleaned up.
 */
export async function POST(_request: Request, ctx: Ctx) {
  const { slug, participantId } = await ctx.params;
  if (!googleConfigured()) {
    return Response.json(
      { error: "google sign-in is not configured" },
      { status: 501 },
    );
  }
  const found = await load(slug, participantId);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  const { prisma, event, participant } = found;
  if (!linked(participant)) {
    return Response.json({ error: "calendar not linked" }, { status: 409 });
  }

  const config: EventConfig = {
    format: event.format as Format,
    location: event.location as EventLocation,
    days: JSON.parse(event.days) as string[],
    startMin: event.startMin,
    endMin: event.endMin,
    slotMinutes: event.slotMinutes,
    travelMin: event.travelMin,
  };

  const emptyImport = {
    selections: {} as SelectionMap,
    preferred: {} as SelectionMap,
    busyKeys: [] as string[],
    stats: { busy: 0, study: 0, preferred: 0, ignored: 0, marked: 0 },
  };

  const token = await accessToken(prisma, participant);
  if (!token) {
    return Response.json(
      { error: "calendar token expired — relink" },
      { status: 409 },
    );
  }

  let result = emptyImport;
  let calendars = 0;
  let eventCount = 0;
  try {
    // Tokens linked before the calendar-list scope was granted 403 on
    // listCalendars — fall back to primary only.
    let entries: GcalCalendarEntry[] | null = null;
    try {
      entries = await listCalendars(token);
    } catch {
      // keep null → primary fallback
    }
    const calIds = resolveCalIds(participant, entries);
    calendars = calIds.length;

    // Fetch set = included calendars PLUS any calendar the user can write
    // on. Events the user created count as busy even on an excluded
    // calendar, and only owner/writer calendars can hold their events —
    // read-only subscriptions never do.
    const fetchIds = new Set(calIds);
    for (const e of entries ?? []) {
      if (defaultCalendarIncluded(e)) fetchIds.add(e.id);
    }

    if (fetchIds.size > 0) {
      const ids = [...fetchIds];
      const included = new Set(calIds);
      // Tolerate individual unreadable calendars (stale subscriptions).
      const settled = await Promise.allSettled(
        ids.map((id) => listCalendarEvents(token, id, config.days)),
      );
      const blocks = settled.flatMap((r, i) =>
        r.status === "fulfilled"
          ? toCalBlocks(r.value).filter(
              (b) => included.has(ids[i]) || b.selfCreated,
            )
          : [],
      );
      if (blocks.length === 0 && settled.every((r) => r.status === "rejected")) {
        throw settled[0].reason;
      }
      eventCount = settled.reduce(
        (n, r) => n + (r.status === "fulfilled" ? r.value.length : 0),
        0,
      );
      // Jev classifies each block (busy / preferred / flexible / ignore);
      // entries it leaves null fall back to the regex rules in computeImport.
      const classes = jevConfigured() ? await classifyBlocks(blocks) : undefined;
      result = computeImport(config, blocks, classes ?? undefined);
    }
  } catch (e) {
    return Response.json(
      { error: `calendar fetch failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const prior = importedMaps(participant);
  const existing = await prisma.selection.findMany({
    where: { participantId: participant.id },
  });
  // Hand-painted marks (anything not written by the last import) win over
  // imported ones on the same slot, per round.
  const manual: [SelectionMap, SelectionMap] = [{}, {}];
  for (const s of existing) {
    const key = slotKey(s.day, s.slotStartMin);
    const prev = s.round === 1 ? prior.r1 : prior.r2;
    if (!(key in prev)) manual[s.round - 1][key] = s.location as BlockLoc;
  }
  const mergedR2: SelectionMap = { ...result.selections, ...manual[1] };
  const mergedR1: SelectionMap = { ...result.preferred, ...manual[0] };
  const rows = [
    ...Object.entries(mergedR2).map(([key, location]) => ({ key, location, round: 2 })),
    ...Object.entries(mergedR1).map(([key, location]) => ({ key, location, round: 1 })),
  ];

  await prisma.$transaction([
    prisma.selection.deleteMany({
      where: { participantId: participant.id },
    }),
    prisma.selection.createMany({
      data: rows.map(({ key, location, round }) => {
        const at = key.lastIndexOf("@");
        return {
          participantId: participant.id,
          day: key.slice(0, at),
          slotStartMin: Number(key.slice(at + 1)),
          round,
          location,
        };
      }),
    }),
    prisma.participant.update({
      where: { id: participant.id },
      data: {
        calendarImported: JSON.stringify({
          r1: result.preferred,
          r2: result.selections,
        }),
        calendarSyncedAt: new Date(),
      },
    }),
  ]);

  return Response.json({
    selections: mergedR2,
    preferred: mergedR1,
    stats: {
      ...result.stats,
      calendars,
      events: eventCount,
      classifier: jevConfigured() ? "jev" : "rules",
    },
  });
}
