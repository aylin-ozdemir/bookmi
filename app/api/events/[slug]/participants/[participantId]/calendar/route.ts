import { computeImport, defaultCalendarIncluded } from "@/lib/calendarImport";
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

  const prior = JSON.parse(participant.calendarImported ?? "{}") as SelectionMap;

  await prisma.$transaction([
    // Imported marks were machine-written; unlinking removes them so the
    // grid doesn't keep claiming times that may no longer hold.
    prisma.selection.deleteMany({
      where: {
        participantId: participant.id,
        round: 2,
        OR: Object.keys(prior).map((key) => {
          const at = key.lastIndexOf("@");
          return {
            day: key.slice(0, at),
            slotStartMin: Number(key.slice(at + 1)),
          };
        }),
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
    where: { participantId: participant.id, round: 2 },
  });
  const selections: SelectionMap = {};
  for (const s of remaining)
    selections[slotKey(s.day, s.slotStartMin)] = s.location as BlockLoc;
  return Response.json({ linked: false, selections });
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
    busyKeys: [] as string[],
    stats: { busy: 0, study: 0, ignored: 0, marked: 0 },
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
      result = computeImport(config, blocks);
    }
  } catch (e) {
    return Response.json(
      { error: `calendar fetch failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const prior = JSON.parse(participant.calendarImported ?? "{}") as SelectionMap;
  const existing = await prisma.selection.findMany({
    where: { participantId: participant.id, round: 2 },
  });
  const manual: SelectionMap = {};
  for (const s of existing) {
    const key = slotKey(s.day, s.slotStartMin);
    if (!(key in prior)) manual[key] = s.location as BlockLoc;
  }
  // Hand-painted marks win over imported ones on the same slot.
  const merged: SelectionMap = { ...result.selections, ...manual };

  await prisma.$transaction([
    prisma.selection.deleteMany({
      where: { participantId: participant.id, round: 2 },
    }),
    prisma.selection.createMany({
      data: Object.entries(merged).map(([key, location]) => {
        const at = key.lastIndexOf("@");
        return {
          participantId: participant.id,
          day: key.slice(0, at),
          slotStartMin: Number(key.slice(at + 1)),
          round: 2,
          location,
        };
      }),
    }),
    prisma.participant.update({
      where: { id: participant.id },
      data: {
        calendarImported: JSON.stringify(result.selections),
        calendarSyncedAt: new Date(),
      },
    }),
  ]);

  return Response.json({
    selections: merged,
    stats: { ...result.stats, calendars, events: eventCount },
  });
}
