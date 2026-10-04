import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  CalBlock,
  classify,
  computeImport,
  defaultCalendarIncluded,
  inferCampus,
  STUDY_MIN_MINUTES,
} from "./calendarImport";
import { EventConfig, slotKey } from "./types";

const ev: EventConfig = {
  format: "VIRTUAL",
  location: "EITHER",
  days: ["2026-10-05"],
  startMin: 540, // 9:00
  endMin: 720, // 12:00
  slotMinutes: 30,
  travelMin: 20,
};

function block(partial: Partial<CalBlock>): CalBlock {
  return {
    summary: "Event",
    location: "",
    startDay: "2026-10-05",
    startMin: 600,
    durationMin: 60,
    allDay: false,
    transparent: false,
    ...partial,
  };
}

describe("classify", () => {
  it("treats a normal timed event as busy", () => {
    expect(classify(block({}))).toBe("busy");
  });

  it("treats a long study-titled block as study (available)", () => {
    expect(
      classify(block({ summary: "Study for midterm", durationMin: 120 })),
    ).toBe("study");
    expect(
      classify(block({ summary: "Library focus block", durationMin: 90 })),
    ).toBe("study");
  });

  it("treats a short study-titled event as busy", () => {
    expect(
      classify(
        block({ summary: "Study group w/ Sam", durationMin: STUDY_MIN_MINUTES - 30 }),
      ),
    ).toBe("busy");
  });

  it("ignores transparent events", () => {
    expect(classify(block({ transparent: true }))).toBe("ignore");
  });

  it("treats all-day events as busy even if the title matches", () => {
    expect(
      classify(block({ allDay: true, summary: "study day", durationMin: 1440 })),
    ).toBe("busy");
  });
});

describe("inferCampus", () => {
  it("maps north-side buildings to NORTH", () => {
    expect(inferCampus("Duderstadt Center")).toBe("NORTH");
    expect(inferCampus("Bursley Hall, North Campus")).toBe("NORTH");
  });

  it("maps central-side buildings to CENTRAL", () => {
    expect(inferCampus("Shapiro Library (UGLI)")).toBe("CENTRAL");
    expect(inferCampus("Michigan Union")).toBe("CENTRAL");
  });

  it("returns null for unknown locations", () => {
    expect(inferCampus("Zoom")).toBeNull();
    expect(inferCampus("")).toBeNull();
  });
});

describe("defaultCalendarIncluded", () => {
  it("includes calendars the user owns or can write on", () => {
    expect(defaultCalendarIncluded({ id: "me@gmail.com", accessRole: "owner" })).toBe(
      true,
    );
    expect(
      defaultCalendarIncluded({ id: "team@group.calendar.google.com", accessRole: "writer" }),
    ).toBe(true);
  });

  it("excludes read-only subscriptions", () => {
    expect(
      defaultCalendarIncluded({ id: "classes@group.calendar.google.com", accessRole: "reader" }),
    ).toBe(false);
    expect(
      defaultCalendarIncluded({ id: "x", accessRole: "freeBusyReader" }),
    ).toBe(false);
  });

  it("excludes Google-provided public calendars (reader role)", () => {
    expect(
      defaultCalendarIncluded({
        id: "en.usa#holiday@group.v.calendar.google.com",
        accessRole: "reader",
      }),
    ).toBe(false);
  });

  it("excludes hidden and deleted entries", () => {
    expect(
      defaultCalendarIncluded({ id: "x", accessRole: "owner", hidden: true }),
    ).toBe(false);
    expect(
      defaultCalendarIncluded({ id: "x", accessRole: "owner", deleted: true }),
    ).toBe(false);
  });
});

describe("computeImport", () => {
  it("marks every grid slot EITHER when there are no events", () => {
    const { selections, busyKeys, stats } = computeImport(ev, []);
    expect(busyKeys).toEqual([]);
    // 9:00–12:00 at 30min → 6 slots
    expect(Object.keys(selections)).toHaveLength(6);
    expect(selections[slotKey("2026-10-05", 540)]).toBe("EITHER");
    expect(stats.marked).toBe(6);
  });

  it("blocks slots overlapped by a busy event", () => {
    const { selections, busyKeys } = computeImport(ev, [
      block({ summary: "Lecture", startMin: 600, durationMin: 60 }), // 10–11
    ]);
    expect(busyKeys).toEqual([
      slotKey("2026-10-05", 600),
      slotKey("2026-10-05", 630),
    ]);
    expect(selections[slotKey("2026-10-05", 600)]).toBeUndefined();
    expect(selections[slotKey("2026-10-05", 660)]).toBe("EITHER");
  });

  it("does not block a slot that only touches the event boundary", () => {
    const { selections, busyKeys } = computeImport(ev, [
      block({ summary: "Call", startMin: 540, durationMin: 30 }), // 9–9:30
    ]);
    expect(busyKeys).toEqual([slotKey("2026-10-05", 540)]);
    expect(selections[slotKey("2026-10-05", 570)]).toBe("EITHER");
  });

  it("keeps study blocks available and tags them with the inferred campus", () => {
    const { selections } = computeImport(ev, [
      block({
        summary: "Study for exam",
        startMin: 600,
        durationMin: 120,
        location: "Duderstadt Center",
      }),
    ]);
    expect(selections[slotKey("2026-10-05", 600)]).toBe("NORTH");
    expect(selections[slotKey("2026-10-05", 690)]).toBe("NORTH");
  });

  it("lets a busy event win over an overlapping study block", () => {
    const { selections, busyKeys } = computeImport(ev, [
      block({ summary: "Study block", startMin: 540, durationMin: 180 }),
      block({ summary: "Doctor", startMin: 600, durationMin: 30 }),
    ]);
    expect(busyKeys).toEqual([slotKey("2026-10-05", 600)]);
    expect(selections[slotKey("2026-10-05", 540)]).toBe("EITHER");
    expect(selections[slotKey("2026-10-05", 600)]).toBeUndefined();
  });

  it("clips events spanning midnight to the grid day", () => {
    const { selections, busyKeys } = computeImport(ev, [
      block({ startDay: "2026-10-04", startMin: 23 * 60, durationMin: 120 }), // 23:00–01:00
      block({ startDay: "2026-10-05", startMin: 0, durationMin: 9 * 60 }), // until 9:00
    ]);
    // First event ends 1:00, second ends 9:00 — nothing inside 9–12 is busy.
    expect(busyKeys).toEqual([]);
    expect(Object.keys(selections)).toHaveLength(6);
  });

  it("handles multi-day events and only counts grid days", () => {
    const multi: EventConfig = { ...ev, days: ["2026-10-05", "2026-10-06"] };
    const { selections, busyKeys } = computeImport(multi, [
      block({ summary: "Trip", startDay: "2026-10-05", startMin: 660, durationMin: 23 * 60 }),
    ]);
    // Busy from 11:00 Oct 5 through 10:00 Oct 6 → last two slots of day 1
    // and first two of day 2 are blocked.
    expect(busyKeys).toEqual([
      slotKey("2026-10-05", 660),
      slotKey("2026-10-05", 690),
      slotKey("2026-10-06", 540),
      slotKey("2026-10-06", 570),
    ]);
    expect(selections[slotKey("2026-10-06", 600)]).toBe("EITHER");
  });

  it("all-day events block the whole day", () => {
    const { selections, busyKeys } = computeImport(ev, [
      block({ allDay: true, startMin: 0, durationMin: 1440 }),
    ]);
    expect(busyKeys).toHaveLength(6);
    expect(Object.keys(selections)).toHaveLength(0);
  });

  it("paints preferred blocks into both rounds, campus-tagged", () => {
    const b = block({
      summary: "Grind for midterm",
      startMin: 600,
      durationMin: 120,
      location: "Shapiro Library", // → CENTRAL
    });
    const { selections, preferred, stats } = computeImport(ev, [b], [
      "preferred",
    ]);
    expect(preferred[slotKey("2026-10-05", 600)]).toBe("CENTRAL");
    expect(preferred[slotKey("2026-10-05", 690)]).toBe("CENTRAL");
    // preferred ⊆ available — same slots are in round 2 too
    expect(selections[slotKey("2026-10-05", 600)]).toBe("CENTRAL");
    expect(preferred[slotKey("2026-10-05", 540)]).toBeUndefined();
    expect(stats.preferred).toBe(1);
  });

  it("lets a busy event win over an overlapping preferred block", () => {
    const { selections, preferred } = computeImport(
      ev,
      [
        block({ summary: "Focus time", startMin: 540, durationMin: 180 }),
        block({ summary: "Dentist", startMin: 600, durationMin: 60 }),
      ],
      ["preferred", "busy"],
    );
    expect(preferred[slotKey("2026-10-05", 540)]).toBe("EITHER");
    expect(preferred[slotKey("2026-10-05", 600)]).toBeUndefined();
    expect(selections[slotKey("2026-10-05", 600)]).toBeUndefined();
  });

  it("falls back to the regex rules where classes are null", () => {
    const { stats } = computeImport(
      ev,
      [
        block({ summary: "Study session", durationMin: 120 }), // regex: study
        block({ summary: "Lecture", durationMin: 60 }), // regex: busy
      ],
      [null, "ignore"], // Jev answered only for the second
    );
    expect(stats.study).toBe(1);
    expect(stats.ignored).toBe(1);
    expect(stats.busy).toBe(0);
  });
});

describe("applyOverrides", () => {
  it("overrides classes by event id", () => {
    const blocks = [
      block({ eventId: "a" }),
      block({ eventId: "b" }),
      block({ eventId: "c" }),
    ];
    expect(
      applyOverrides(blocks, ["busy", "study", null], { b: "ignore" }),
    ).toEqual(["busy", "ignore", null]);
  });

  it("ignores unknown ids and blocks without an id", () => {
    const blocks = [block({}), block({ eventId: "x" })];
    expect(
      applyOverrides(blocks, ["busy", "busy"], { "": "ignore", missing: "study" }),
    ).toEqual(["busy", "busy"]);
  });
});
