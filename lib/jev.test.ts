import { describe, expect, it } from "vitest";
import { answerToClass, buildClassifyRequest } from "./jev";
import type { CalBlock } from "./calendarImport";

const block = (over: Partial<CalBlock> = {}): CalBlock => ({
  summary: "Study for exam",
  location: "Duderstadt",
  startDay: "2026-10-05",
  startMin: 600,
  durationMin: 120,
  allDay: false,
  transparent: false,
  ...over,
});

describe("buildClassifyRequest", () => {
  it("asks one choice question per event over shared state", () => {
    const req = buildClassifyRequest([block(), block({ summary: "Gym" })]);
    expect(req.model).toBe("jev-latest");
    expect(Object.keys(req.questions)).toEqual(["b0", "b1"]);
    const q = req.questions.b0 as { type: string; instructions: string };
    expect(q.type).toBe("choice");
    expect(q.instructions).toContain("`events[0]`");
    const events = (req.state as { events: unknown[] }).events;
    expect(events).toHaveLength(2);
  });

  it("offsets question ids across chunks", () => {
    const req = buildClassifyRequest([block()], 30);
    expect(Object.keys(req.questions)).toEqual(["b30"]);
  });
});

describe("answerToClass", () => {
  const ans = (choice: string, confidence = 0.9) => ({
    type: "choice",
    choice,
    confidence,
    probabilities: {},
  });

  it("maps labels to block classes", () => {
    expect(answerToClass(ans("busy"))).toBe("busy");
    expect(answerToClass(ans("preferred"))).toBe("preferred");
    expect(answerToClass(ans("flexible"))).toBe("study");
    expect(answerToClass(ans("ignore"))).toBe("ignore");
  });

  it("defers low-confidence answers to the rules", () => {
    expect(answerToClass(ans("preferred", 0.3))).toBeNull();
    expect(answerToClass(ans("ignore", 0))).toBeNull();
  });

  it("defers unknown or malformed answers", () => {
    expect(answerToClass(ans("bogus"))).toBeNull();
    expect(answerToClass(null)).toBeNull();
    expect(answerToClass({})).toBeNull();
  });
});
