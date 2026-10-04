import { getPrisma } from "@/lib/db";
import { buildAuthUrl, googleConfigured, signState } from "@/lib/google";

/** Kick off the OAuth flow: /api/auth/google/start?slug=…&pid=… */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const pid = url.searchParams.get("pid") ?? "";

  if (!googleConfigured()) {
    return Response.json(
      { error: "google sign-in is not configured" },
      { status: 501 },
    );
  }
  if (!slug || !pid) {
    return Response.json({ error: "missing slug or pid" }, { status: 400 });
  }

  // Only redirect for a real participant — state binds the callback to
  // exactly this participant in this event.
  const prisma = getPrisma();
  const participant = await prisma.participant.findFirst({
    where: { id: pid, event: { slug } },
    select: { id: true },
  });
  if (!participant) {
    return Response.json({ error: "participant not found" }, { status: 404 });
  }

  return Response.redirect(buildAuthUrl(url.origin, signState({ slug, pid })), 302);
}
