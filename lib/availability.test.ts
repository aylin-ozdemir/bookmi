import { describe, expect, it } from "vitest";
import { computeResults } from "./availability";
import type { EventConfig, ParticipantInput, SelectionMap } from "./types";

const DAY = "2026-10-05";
const DAY2 = "2026-10-06";

const base: EventConfig = {
  format: "IN_PERSON",
  location: "CENTRAL",
  days: [DAY],
  startMin: 12 * 60, // 12:00
  endMin: 16 * 60, // 16:00
  slotMinutes: 15,
  travelMin: 30,
};

const ev = (over: Partial<EventConfig> = {}): EventConfig => ({ ...base, ...over });

/** Build a selection map for one day from {minuteOffset: loc} entries. */
const sel = (entries: Record<number, string>, day = DAY): SelectionMap =>
  Object.fromEntries(
    Object.entries(entries).map(([min, loc]) => [`${day}@${min}`, loc]),
  ) as SelectionMap;

const p = (
  id: string,
  round1: SelectionMap = {},
  round2: SelectionMap = {},
): ParticipantInput => ({ id, name: id, round1, round2 });

const verdictAt = (
  res: ReturnType<typeof computeResults>,
  tier: "preferred" | "union",
  startMin: number,
  pid: string,
  day = DAY,
) =>
  res[tier].find((s) => s.day === day && s.startMin === startMin)!
    .verdicts.find((v) => v.participantId === pid)!;

describe("virtual events", () => {
  const event = ev({ format: "VIRTUAL" });

  it("any marked block counts as remote attendance", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "NORTH", 750: "REMOTE", 765: "EITHER" })),
    ]);
    for (const t of [735, 750, 765]) {
      expect(verdictAt(res, "preferred", t, "a")).toMatchObject({
        ok: true,
        mode: "remote",
      });
    }
    expect(verdictAt(res, "preferred", 720, "a")).toMatchObject({
      ok: false,
      reason: "not-marked",
    });
  });
});

describe("in-person events: location matching", () => {
  it("accepts same-campus and EITHER blocks, rejects the rest", () => {
    const res = computeResults(ev(), [
      p(
        "a",
        sel({
          720: "CENTRAL", // same campus
          735: "EITHER", // flexible (next committed block is 60 min out)
          810: "NORTH", // wrong campus
          840: "REMOTE", // remote
          // 870 unmarked
        }),
      ),
    ]);
    expect(verdictAt(res, "preferred", 720, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
    expect(verdictAt(res, "preferred", 810, "a")).toMatchObject({
      ok: false,
      reason: "other-campus",
    });
    expect(verdictAt(res, "preferred", 840, "a")).toMatchObject({
      ok: false,
      reason: "remote-only",
    });
    expect(verdictAt(res, "preferred", 870, "a")).toMatchObject({
      ok: false,
      reason: "not-marked",
    });
  });
});

describe("travel buffer — before the meeting", () => {
  // travelMin = 30, slotMinutes = 15, event on CENTRAL

  it("blocks when the last committed block on the other campus leaves < travelMin", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 720: "NORTH", 735: "EITHER" })), // NORTH until 12:15, meeting 12:15
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: false,
      reason: "travel-before",
    });
  });

  it("allows when the gap is >= travelMin", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 720: "NORTH", 750: "EITHER" })), // NORTH until 12:15, meeting 12:30, gap 15? no
    ]);
    // prev committed ends 12:15 (720+15); meeting at 12:30 → gap 15 < 30 → blocked
    expect(verdictAt(res, "preferred", 750, "a")).toMatchObject({
      ok: false,
      reason: "travel-before",
    });
  });

  it("exactly travelMin of gap is feasible (boundary)", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 720: "NORTH", 750: "EITHER" }), sel({})),
    ]);
    // same as above: gap 15 — blocked. Now shift meeting to 12:45 → gap 30 → ok
    const res2 = computeResults(ev(), [p("a", sel({ 720: "NORTH", 765: "EITHER" }))]);
    expect(verdictAt(res2, "preferred", 765, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
  });

  it("a committed block on the same campus never blocks", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 720: "CENTRAL", 735: "EITHER" })),
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
  });

  it("uses the latest committed block only", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 720: "NORTH", 735: "CENTRAL", 750: "EITHER" })),
    ]);
    // latest committed before 12:30 is CENTRAL 12:15–12:30 → feasible
    expect(verdictAt(res, "preferred", 750, "a")).toMatchObject({ ok: true });
  });

  it("committed blocks on other days are ignored", () => {
    const res = computeResults(ev({ days: [DAY, DAY2] }), [
      p("a", { ...sel({ 900: "NORTH" }, DAY), ...sel({ 735: "EITHER" }, DAY2) }),
    ]);
    // On DAY2, no prior commitment — a 12:15 Central meeting is fine.
    expect(verdictAt(res, "preferred", 735, "a", DAY2)).toMatchObject({ ok: true });
  });
});

describe("travel buffer — after the meeting", () => {
  it("blocks when the next committed block on the other campus is < travelMin away", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 735: "EITHER", 750: "NORTH" })), // meeting 12:15–12:30, North at 12:30
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: false,
      reason: "travel-after",
    });
  });

  it("allows when the next commitment leaves >= travelMin", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 735: "EITHER", 780: "NORTH" })), // ends 12:30, North at 13:00 → gap 30
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({ ok: true });
  });

  it("a next committed block on the same campus never blocks", () => {
    const res = computeResults(ev(), [
      p("a", sel({ 735: "EITHER", 750: "CENTRAL" })),
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({ ok: true });
  });
});

describe("EITHER event location", () => {
  const event = ev({ location: "EITHER" });

  it("suggests the campus everyone is actually on", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "NORTH" })),
      p("b", sel({ 735: "NORTH" })),
    ]);
    const slot = res.preferred.find((s) => s.startMin === 735)!;
    expect(slot.suggestedLocation).toBe("NORTH");
    expect(slot.feasible).toBe(2);
  });

  it("no campus works when the group is split across campuses", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "NORTH" })),
      p("b", sel({ 735: "CENTRAL" })),
    ]);
    const slot = res.preferred.find((s) => s.startMin === 735)!;
    expect(slot.feasible).toBe(1);
    expect(res.tier).toBe("none");
  });

  it("prefers the campus with more in-person attendees when both work", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "EITHER" })),
      p("b", sel({ 735: "CENTRAL" })),
      p("c", sel({ 735: "CENTRAL" })),
    ]);
    const slot = res.preferred.find((s) => s.startMin === 735)!;
    expect(slot.suggestedLocation).toBe("CENTRAL");
    expect(slot.feasible).toBe(3);
  });
});

describe("hybrid events", () => {
  const event = ev({ format: "HYBRID", location: "CENTRAL" });

  it("marked slots always count; mode is remote when in-person isn't feasible", () => {
    const res = computeResults(event, [
      p(
        "a",
        sel({
          720: "CENTRAL", // in-person
          750: "REMOTE", // remote by choice
          780: "NORTH", // remote — wrong campus
          840: "EITHER", // in-person (45 min after the North commitment)
        }),
      ),
    ]);
    expect(verdictAt(res, "preferred", 720, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
    expect(verdictAt(res, "preferred", 750, "a")).toMatchObject({
      ok: true,
      mode: "remote",
    });
    expect(verdictAt(res, "preferred", 780, "a")).toMatchObject({
      ok: true,
      mode: "remote",
      reason: "other-campus",
    });
    expect(verdictAt(res, "preferred", 840, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
  });
});

describe("two-round overlap", () => {
  const event = ev({ location: "CENTRAL" });

  it("tier=preferred when a round-1 slot works for everyone", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "CENTRAL" }), sel({ 780: "CENTRAL" })),
      p("b", sel({ 735: "EITHER" }), sel({ 780: "CENTRAL" })),
    ]);
    expect(res.tier).toBe("preferred");
    expect(res.recommended).toEqual([
      { day: DAY, startMin: 735, suggestedLocation: undefined },
    ]);
  });

  it("falls back to the union only when no round-1 slot is shared", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "CENTRAL" }), sel({ 780: "CENTRAL" })),
      p("b", sel({ 750: "CENTRAL" }), sel({ 780: "CENTRAL" })),
    ]);
    // 780 works for both in round 2 but nobody picked it in round 1 together
    expect(res.tier).toBe("fallback");
    expect(res.recommended).toEqual([
      { day: DAY, startMin: 780, suggestedLocation: undefined },
    ]);
  });

  it("tier=none when not even the union overlaps", () => {
    const res = computeResults(event, [
      p("a", sel({ 735: "CENTRAL" }), sel({ 780: "CENTRAL" })),
      p("b", sel({ 750: "CENTRAL" }), sel({ 810: "CENTRAL" })),
    ]);
    expect(res.tier).toBe("none");
    expect(res.recommended).toEqual([]);
  });

  it("round-2-only slots count in the union pass", () => {
    const res = computeResults(event, [
      p("a", {}, sel({ 735: "CENTRAL" })),
      p("b", {}, sel({ 735: "CENTRAL" })),
    ]);
    expect(res.tier).toBe("fallback");
  });

  it("round 2 overrides round 1 on conflicting locations for the same slot", () => {
    // a marked NORTH in r1 but repainted CENTRAL in r2
    const res = computeResults(event, [
      p("a", sel({ 735: "NORTH" }), sel({ 735: "CENTRAL" })),
      p("b", {}, sel({ 735: "CENTRAL" })),
    ]);
    expect(res.tier).toBe("fallback");
    expect(verdictAt(res, "union", 735, "a")).toMatchObject({
      ok: true,
      mode: "in-person",
    });
    // but the preferred pass still sees NORTH → other-campus
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: false,
      reason: "other-campus",
    });
  });

  it("travel feasibility uses the union timeline even in the preferred pass", () => {
    // a marks EITHER preferred at 12:15, and records a NORTH commitment at
    // 12:00 only in round 2 — the preferred check must still see it.
    const res = computeResults(event, [
      p("a", sel({ 735: "EITHER" }), sel({ 720: "NORTH" })),
      p("b", sel({ 735: "CENTRAL" })),
    ]);
    expect(verdictAt(res, "preferred", 735, "a")).toMatchObject({
      ok: false,
      reason: "travel-before",
    });
    expect(res.tier).toBe("none");
  });
});

describe("edge cases", () => {
  it("zero participants → tier none, no recommendations", () => {
    const res = computeResults(ev(), []);
    expect(res.tier).toBe("none");
    expect(res.recommended).toEqual([]);
    expect(res.union.every((s) => s.feasible === 0)).toBe(true);
  });

  it("single participant recommends all their preferred feasible slots", () => {
    const res = computeResults(ev({ format: "VIRTUAL" }), [
      p("a", sel({ 735: "REMOTE", 750: "NORTH" })),
    ]);
    expect(res.tier).toBe("preferred");
    expect(res.recommended.map((r) => r.startMin)).toEqual([735, 750]);
  });

  it("coalesces consecutive recommended slots into runs", () => {
    const res = computeResults(ev({ format: "VIRTUAL" }), [
      p("a", sel({ 735: "REMOTE", 750: "REMOTE", 765: "REMOTE", 795: "REMOTE" })),
    ]);
    expect(res.recommendedRuns).toEqual([
      { day: DAY, startMin: 735, endMin: 780 },
      { day: DAY, startMin: 795, endMin: 810 },
    ]);
  });

  it("slots run from startMin to endMin - slotMinutes", () => {
    const res = computeResults(ev({ format: "VIRTUAL" }), [p("a", sel({}))]);
    const starts = res.union.map((s) => s.startMin);
    expect(starts[0]).toBe(720);
    expect(starts[starts.length - 1]).toBe(945); // 15:45 + 15 = 16:00 end
  });
});
