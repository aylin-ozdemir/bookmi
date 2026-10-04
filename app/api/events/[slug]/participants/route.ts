import { getPrisma } from "@/lib/db";
import { joinSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/events/[slug]/participants">,
) {
  const { slug } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid name" }, { status: 400 });
  }

  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) return Response.json({ error: "event not found" }, { status: 404 });

  // Idempotent join: rejoining with the same name returns the same
  // participant instead of creating a duplicate.
  const name = parsed.data.name;
  const existing = await prisma.participant.findFirst({
    where: { eventId: event.id, name },
  });
  if (existing) {
    return Response.json({ participantId: existing.id, name: existing.name });
  }

  const participant = await prisma.participant.create({
    data: { eventId: event.id, name },
  });
  return Response.json(
    { participantId: participant.id, name: participant.name },
    { status: 201 },
  );
}
