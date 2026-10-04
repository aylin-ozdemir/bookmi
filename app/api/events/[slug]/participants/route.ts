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

  const participant = await prisma.participant.create({
    data: { eventId: event.id, name: parsed.data.name },
  });
  return Response.json(
    { participantId: participant.id, name: participant.name },
    { status: 201 },
  );
}
