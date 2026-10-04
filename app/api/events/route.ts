import crypto from "node:crypto";
import { getPrisma } from "@/lib/db";
import { createEventSchema } from "@/lib/validation";

function slug(): string {
  return crypto.randomBytes(6).toString("base64url");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid event", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { name, format, location, days, startMin, endMin, slotMinutes, travelMin } =
    parsed.data;

  const prisma = getPrisma();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const event = await prisma.event.create({
        data: {
          slug: slug(),
          name,
          format,
          location,
          days: JSON.stringify(days),
          startMin,
          endMin,
          slotMinutes,
          travelMin,
        },
      });
      return Response.json({ slug: event.slug }, { status: 201 });
    } catch {
      // slug collision — retry
    }
  }
  return Response.json({ error: "could not allocate slug" }, { status: 500 });
}
