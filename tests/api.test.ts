import { beforeEach, describe, expect, it } from "vitest";
import { POST as createEvent } from "@/app/api/events/route";
import { GET as getEvent } from "@/app/api/events/[slug]/route";
import { POST as joinEvent } from "@/app/api/events/[slug]/participants/route";
import { PUT as saveSelections } from "@/app/api/events/[slug]/participants/[participantId]/selections/route";
import { getPrisma } from "@/lib/db";

const DAY = "2026-10-05";

function req(method: string, body?: unknown): Request {
  return new Request("http://test/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

const ctx = <T extends Record<string, string>>(params: T) =>
  ({ params: Promise.resolve(params) }) as never;

async function makeEvent(over: Record<string, unknown> = {}) {
  const res = await createEvent(
    req("POST", {
      name: "Team sync",
      format: "IN_PERSON",
      location: "CENTRAL",
      days: [DAY],
      startMin: 720,
      endMin: 960,
      slotMinutes: 15,
      travelMin: 30,
      ...over,
    }),
  );
  const { slug } = await res.json();
  return slug as string;
}

async function join(slug: string, name: string) {
  const res = await joinEvent(
    req("POST", { name }),
    ctx({ slug }),
  );
  const body = await res.json();
  return body.participantId as string;
}

async function save(slug: string, pid: string, round: 1 | 2, selections: object) {
  return saveSelections(
    req("PUT", { round, selections }),
    ctx({ slug, participantId: pid }),
  );
}

beforeEach(async () => {
  const prisma = getPrisma();
  await prisma.selection.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.event.deleteMany();
});

describe("POST /api/events", () => {
  it("creates an event and returns a slug", async () => {
    const slug = await makeEvent();
    expect(slug).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("rejects invalid payloads", async () => {
    const res = await createEvent(req("POST", { name: "" }));
    expect(res.status).toBe(400);
    const res2 = await createEvent(
      req("POST", {
        name: "x",
        format: "IN_PERSON",
        location: "CENTRAL",
        days: [DAY],
        startMin: 960,
        endMin: 720,
      }),
    );
    expect(res2.status).toBe(400);
  });
});

describe("join + save + get flow", () => {
  it("full happy path produces a recommendation", async () => {
    const slug = await makeEvent({ format: "VIRTUAL", location: "EITHER" });
    const a = await join(slug, "Aylin");
    const b = await join(slug, "Ravi");

    await save(slug, a, 1, { [`${DAY}@735`]: "REMOTE" });
    await save(slug, b, 1, { [`${DAY}@735`]: "REMOTE" });

    const res = await getEvent(req("GET"), ctx({ slug }));
    const body = await res.json();
    expect(body.event.name).toBe("Team sync");
    expect(body.participants).toHaveLength(2);
    expect(body.results.tier).toBe("preferred");
    expect(body.results.recommended).toEqual([
      { day: DAY, startMin: 735 },
    ]);
  });

  it("rejects selections outside the grid", async () => {
    const slug = await makeEvent();
    const a = await join(slug, "Aylin");
    const bad = await save(slug, a, 1, {
      [`${DAY}@723`]: "NORTH", // not aligned to 15-min grid
      [`2099-01-01@720`]: "NORTH", // day not in event
    });
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error).toMatch(/outside the event grid/);
  });

  it("saving a round twice replaces it, leaving the other round intact", async () => {
    const slug = await makeEvent({ format: "VIRTUAL", location: "EITHER" });
    const a = await join(slug, "Aylin");
    await save(slug, a, 1, { [`${DAY}@735`]: "REMOTE" });
    await save(slug, a, 1, { [`${DAY}@750`]: "REMOTE" }); // replace round 1
    await save(slug, a, 2, { [`${DAY}@735`]: "REMOTE" });

    const res = await getEvent(req("GET"), ctx({ slug }));
    const body = await res.json();
    const me = body.participants[0];
    expect(me.round1).toEqual({ [`${DAY}@750`]: "REMOTE" });
    expect(me.round2).toEqual({ [`${DAY}@735`]: "REMOTE" });
  });

  it("404s for unknown event / participant", async () => {
    const res = await getEvent(req("GET"), ctx({ slug: "nope-nope" }));
    expect(res.status).toBe(404);

    const slug = await makeEvent();
    const res2 = await joinEvent(req("POST", { name: "Ghost" }), ctx({ slug: "nope-nope" }));
    expect(res2.status).toBe(404);
    const res3 = await save(slug, "nonexistent", 1, {});
    expect(res3.status).toBe(404);
  });

  it("end-to-end: travel buffer blocks the naive overlap pick", async () => {
    // In-person on CENTRAL. Aylin is on NORTH 12:00-12:15 and marks EITHER at
    // 12:15 — she cannot reach Central by 12:15 (needs 30 min).
    const slug = await makeEvent();
    const a = await join(slug, "Aylin");
    const b = await join(slug, "Ravi");
    await save(slug, a, 1, {
      [`${DAY}@720`]: "NORTH",
      [`${DAY}@735`]: "EITHER",
      [`${DAY}@765`]: "EITHER",
    });
    await save(slug, b, 1, {
      [`${DAY}@735`]: "CENTRAL",
      [`${DAY}@765`]: "CENTRAL",
    });

    const res = await getEvent(req("GET"), ctx({ slug }));
    const body = await res.json();
    expect(body.results.tier).toBe("preferred");
    // 735 is travel-blocked for Aylin; 765 works for everyone.
    expect(body.results.recommended).toEqual([
      { day: DAY, startMin: 765 },
    ]);
    const slot735 = body.results.preferred.find(
      (s: { startMin: number }) => s.startMin === 735,
    );
    const aylin = slot735.verdicts.find(
      (v: { participantId: string }) => v.participantId === a,
    );
    expect(aylin).toMatchObject({ ok: false, reason: "travel-before" });
  });
});
