import { getEventBundle } from "@/lib/events";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/events/[slug]">,
) {
  const { slug } = await ctx.params;
  const bundle = await getEventBundle(slug);
  if (!bundle) return Response.json({ error: "event not found" }, { status: 404 });
  return Response.json(bundle);
}
