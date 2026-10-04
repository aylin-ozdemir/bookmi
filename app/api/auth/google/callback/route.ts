import { getPrisma } from "@/lib/db";
import {
  exchangeCode,
  googleConfigured,
  idTokenEmail,
  verifyState,
} from "@/lib/google";

/** OAuth redirect target. Always lands back on /e/[slug] with a status hint. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyState(url.searchParams.get("state"));
  if (!state) {
    return Response.json({ error: "invalid or expired state" }, { status: 400 });
  }
  const back = (q: string) =>
    Response.redirect(`${url.origin}/e/${state.slug}?${q}`, 302);

  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (oauthError || !code) return back("gcal=denied");
  if (!googleConfigured()) return back("gcal=error");

  try {
    const tokens = await exchangeCode(url.origin, code);
    const prisma = getPrisma();
    const participant = await prisma.participant.findFirst({
      where: { id: state.pid, event: { slug: state.slug } },
    });
    if (!participant) return back("gcal=error");

    await prisma.participant.update({
      where: { id: participant.id },
      data: {
        googleEmail: idTokenEmail(tokens.id_token) ?? participant.googleEmail,
        googleAccessToken: tokens.access_token,
        // Google only returns a refresh token on fresh consent; keep the old one.
        googleRefreshToken:
          tokens.refresh_token ?? participant.googleRefreshToken,
        googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
    return back("gcal=connected");
  } catch {
    return back("gcal=error");
  }
}
