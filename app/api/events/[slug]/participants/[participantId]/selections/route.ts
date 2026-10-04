import { getPrisma } from "@/lib/db";
import { parseSlotKey } from "@/lib/types";
import { saveSelectionsSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/events/[slug]/participants/[participantId]/selections">;

/** Replace a participant's selections for one round (idempotent). */
export async function PUT(request: Request, ctx: Ctx) {
  const { slug, participantId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = saveSelectionsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid selections", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) return Response.json({ error: "event not found" }, { status: 404 });

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId: event.id },
  });
  if (!participant)
    return Response.json({ error: "participant not found" }, { status: 404 });

  const days = JSON.parse(event.days) as string[];
  const bad: string[] = [];
  for (const key of Object.keys(parsed.data.selections)) {
    const { day, startMin } = parseSlotKey(key);
    const aligned =
      startMin >= event.startMin &&
      startMin < event.endMin &&
      (startMin - event.startMin) % event.slotMinutes === 0;
    if (!days.includes(day) || !aligned) bad.push(key);
  }
  if (bad.length > 0) {
    return Response.json(
      { error: "selections outside the event grid", badKeys: bad.slice(0, 20) },
      { status: 400 },
    );
  }

  const { round, selections } = parsed.data;
  await prisma.$transaction([
    prisma.selection.deleteMany({
      where: { participantId: participant.id, round },
    }),
    prisma.selection.createMany({
      data: Object.entries(selections).map(([key, location]) => {
        const { day, startMin } = parseSlotKey(key);
        return { participantId: participant.id, day, slotStartMin: startMin, round, location };
      }),
    }),
  ]);

  return Response.json({ saved: Object.keys(selections).length });
}
