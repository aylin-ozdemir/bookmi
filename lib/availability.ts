// BookMi availability engine — pure functions, no DB imports.
// Implements IMPLEMENTATION_PLAN.md §4: per-slot feasibility with a
// bidirectional inter-campus travel buffer, EITHER-campus resolution,
// and the two-round preferred/fallback overlap.

import {
  BLOCK_LOCS,
  BlockLoc,
  EventConfig,
  ParticipantInput,
  PhysicalCampus,
  SelectionMap,
  slotKey,
} from "./types";

const VALID_LOCS = new Set<string>(BLOCK_LOCS);

export type BlockReason =
  | "not-marked"
  | "remote-only"
  | "other-campus"
  | "travel-before"
  | "travel-after";

export type AttendMode = "in-person" | "remote";

export interface Verdict {
  ok: boolean;
  mode?: AttendMode;
  reason?: BlockReason;
}

export interface ParticipantVerdict extends Verdict {
  participantId: string;
  /** the location the participant marked at this slot, if any */
  loc?: BlockLoc;
}

export interface SlotResult {
  day: string;
  startMin: number;
  verdicts: ParticipantVerdict[];
  feasible: number;
  total: number;
  /** Resolved campus when the event location is EITHER (else undefined). */
  suggestedLocation?: PhysicalCampus;
  /** For EITHER-location events: every campus on which ALL participants are
   *  feasible (so its length > 1 means the slot is genuinely flexible). */
  allFeasible?: PhysicalCampus[];
}

export interface RecommendedSlot {
  day: string;
  startMin: number;
  suggestedLocation?: PhysicalCampus;
}

export interface RecommendedRun {
  day: string;
  startMin: number;
  endMin: number;
  /** resolved campus for EITHER events; runs split when this changes */
  suggestedLocation?: PhysicalCampus;
}

export type ResultTier = "preferred" | "fallback" | "none";

export interface EventResults {
  tier: ResultTier;
  recommended: RecommendedSlot[];
  recommendedRuns: RecommendedRun[];
  /** per-slot results against round-1 (preferred) selections */
  preferred: SlotResult[];
  /** per-slot results against the round1 ∪ round2 union */
  union: SlotResult[];
}

/** A block where the participant committed to a physical campus. */
interface Committed {
  start: number;
  end: number;
  loc: PhysicalCampus;
}

interface Prepared {
  input: ParticipantInput;
  /** round1 ∪ round2 — most-specific mark wins (see prepare) */
  union: SelectionMap;
  /** committed campus blocks per day, sorted by start */
  timeline: Map<string, Committed[]>;
}

function prepare(p: ParticipantInput, slotMinutes: number): Prepared {
  // Union of both rounds, most-informative mark winning on conflict:
  // a concrete campus beats EITHER/REMOTE; between two concrete campuses
  // the round-2 repaint wins; a concrete r1 campus survives a vague r2
  // EITHER (the preferred mark is a stated campus preference). EITHER
  // beats REMOTE (it keeps in-person eligibility). Out-of-enum locations
  // are dropped so they can't masquerade as EITHER.
  const union: SelectionMap = {};
  const keys = new Set([...Object.keys(p.round1), ...Object.keys(p.round2)]);
  const phys = (l?: string) => l === "NORTH" || l === "CENTRAL";
  for (const key of keys) {
    const l1 = p.round1[key];
    const l2 = p.round2[key];
    const loc =
      phys(l1) && phys(l2)
        ? l2
        : phys(l1)
          ? l1
          : phys(l2)
            ? l2
            : l1 === "EITHER" || l2 === "EITHER"
              ? "EITHER"
              : l1 === "REMOTE" || l2 === "REMOTE"
                ? "REMOTE"
                : undefined;
    if (loc && VALID_LOCS.has(loc)) union[key] = loc;
  }

  const timeline = new Map<string, Committed[]>();
  for (const [key, loc] of Object.entries(union)) {
    if (loc !== "NORTH" && loc !== "CENTRAL") continue;
    const at = key.lastIndexOf("@");
    const day = key.slice(0, at);
    const start = Number(key.slice(at + 1));
    // Malformed keys are ignored rather than producing NaN arithmetic.
    if (!day || !Number.isFinite(start)) continue;
    const list = timeline.get(day) ?? [];
    list.push({ start, end: start + slotMinutes, loc });
    timeline.set(day, list);
  }
  for (const list of timeline.values()) list.sort((a, b) => a.start - b.start);
  return { input: p, union, timeline };
}

/**
 * Can the participant physically be on campus L during [t0, t1)?
 * Checks the nearest committed-campus block before the meeting and the
 * nearest one after it; each must be on L or leave >= travelMin to transit.
 * EITHER/REMOTE/unmarked blocks are uncommitted and don't create travel debt.
 */
function travelFeasible(
  blocks: Committed[],
  t0: number,
  t1: number,
  L: PhysicalCampus,
  travelMin: number,
): true | "travel-before" | "travel-after" {
  let prev: Committed | undefined;
  for (const b of blocks) {
    if (b.start < t0) prev = b;
    else break;
  }
  if (prev && prev.loc !== L && t0 - prev.end < travelMin) return "travel-before";

  const next = blocks.find((b) => b.start >= t1);
  if (next && next.loc !== L && next.start - t1 < travelMin) return "travel-after";

  return true;
}

/** Marked location at a slot, or null when absent/out-of-enum. */
function markedLoc(avail: SelectionMap, day: string, t0: number): BlockLoc | null {
  const loc = avail[slotKey(day, t0)];
  return loc != null && VALID_LOCS.has(loc) ? loc : null;
}

/** Feasibility for an in-person meeting on campus L at [day, t0). */
function attendAtCampus(
  p: Prepared,
  ev: EventConfig,
  avail: SelectionMap,
  day: string,
  t0: number,
  L: PhysicalCampus,
): Verdict {
  const loc = markedLoc(avail, day, t0);
  if (loc == null) return { ok: false, reason: "not-marked" };
  if (loc === "REMOTE") return { ok: false, reason: "remote-only" };
  if ((loc === "NORTH" || loc === "CENTRAL") && loc !== L)
    return { ok: false, reason: "other-campus" };
  // loc === L or EITHER
  const trav = travelFeasible(
    p.timeline.get(day) ?? [],
    t0,
    t0 + ev.slotMinutes,
    L,
    ev.travelMin,
  );
  if (trav !== true) return { ok: false, reason: trav };
  return { ok: true, mode: "in-person" };
}

/**
 * Verdict for one participant at one slot under a given resolved campus.
 * `campus` is null for virtual events. For hybrid events a marked slot is
 * always attendable — remotely if in-person isn't feasible.
 */
function verdict(
  p: Prepared,
  ev: EventConfig,
  avail: SelectionMap,
  day: string,
  t0: number,
  campus: PhysicalCampus | null,
): Verdict {
  const loc = markedLoc(avail, day, t0);
  if (loc == null) return { ok: false, reason: "not-marked" };

  if (ev.format === "VIRTUAL") return { ok: true, mode: "remote" };

  if (ev.format === "IN_PERSON")
    return attendAtCampus(p, ev, avail, day, t0, campus!);

  // HYBRID
  if (loc === "REMOTE" || campus == null) return { ok: true, mode: "remote" };
  const v = attendAtCampus(p, ev, avail, day, t0, campus);
  return v.ok ? v : { ok: true, mode: "remote", reason: v.reason };
}

/**
 * Evaluate one slot across all participants. When the event location is
 * EITHER, evaluates both campuses and keeps the best: more feasible
 * participants first, then more in-person attendees (deterministic NORTH
 * tie-break).
 */
function evalSlot(
  preps: Prepared[],
  ev: EventConfig,
  availOf: (p: Prepared) => SelectionMap,
  day: string,
  t0: number,
): SlotResult {
  const campuses: (PhysicalCampus | null)[] =
    ev.format === "VIRTUAL"
      ? [null]
      : ev.location === "EITHER"
        ? ["NORTH", "CENTRAL"]
        : [ev.location];

  const evals = campuses.map((L) => {
    const verdicts = preps.map((p) => ({
      participantId: p.input.id,
      loc: markedLoc(availOf(p), day, t0) ?? undefined,
      ...verdict(p, ev, availOf(p), day, t0, L),
    }));
    const result: SlotResult = {
      day,
      startMin: t0,
      verdicts,
      feasible: verdicts.filter((v) => v.ok).length,
      total: preps.length,
      suggestedLocation:
        ev.location === "EITHER" && L ? L : undefined,
    };
    return {
      L,
      result,
      inPerson: verdicts.filter((v) => v.mode === "in-person").length,
    };
  });

  // Most feasible participants wins; ties go to more in-person attendees.
  // A full tie (either campus works equally well) is reported as such —
  // suggesting one campus would imply a constraint that doesn't exist.
  let best = evals[0];
  let tied = false;
  for (const r of evals.slice(1)) {
    if (
      r.result.feasible > best.result.feasible ||
      (r.result.feasible === best.result.feasible &&
        r.inPerson > best.inPerson)
    ) {
      best = r;
      tied = false;
    } else if (
      r.result.feasible === best.result.feasible &&
      r.inPerson === best.inPerson
    ) {
      tied = true;
    }
  }
  if (ev.location === "EITHER") {
    if (tied) best.result.suggestedLocation = undefined;
    best.result.allFeasible = evals
      .filter((r) => r.L != null && r.result.feasible === preps.length)
      .map((r) => r.L as PhysicalCampus);
  }
  return best.result;
}

function toRecommended(s: SlotResult): RecommendedSlot {
  return {
    day: s.day,
    startMin: s.startMin,
    suggestedLocation: s.suggestedLocation,
  };
}

/**
 * Merge consecutive recommended slots into runs for display. Runs split
 * when the suggested campus changes (EITHER events). Note: a run means
 * "each slot is independently bookable" — on an aligned grid, each-slot
 * feasibility already accounts for travel before/after, so adjacent
 * feasible slots form a feasible longer meeting.
 */
function coalesce(recs: RecommendedSlot[], slotMinutes: number): RecommendedRun[] {
  const runs: RecommendedRun[] = [];
  for (const r of recs) {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.day === r.day &&
      last.endMin === r.startMin &&
      last.suggestedLocation === r.suggestedLocation
    ) {
      last.endMin = r.startMin + slotMinutes;
    } else {
      runs.push({
        day: r.day,
        startMin: r.startMin,
        endMin: r.startMin + slotMinutes,
        suggestedLocation: r.suggestedLocation,
      });
    }
  }
  return runs;
}

/**
 * Full overlap computation. Round-1 (preferred) selections are checked
 * first; if no slot works for everyone, falls back to the round1 ∪ round2
 * union. Travel feasibility always uses the union timeline — a
 * participant's "where I'll be" is independent of which round marked it.
 */
export function computeResults(
  ev: EventConfig,
  participants: ParticipantInput[],
): EventResults {
  // Guards — the engine also runs client-side, so a bad config must not hang.
  if (!Number.isFinite(ev.slotMinutes) || ev.slotMinutes <= 0)
    throw new Error("slotMinutes must be a positive number");
  if (!(ev.startMin < ev.endMin)) throw new Error("startMin must be < endMin");
  if (ev.days.length === 0) throw new Error("days must be non-empty");

  const preps = participants.map((p) => prepare(p, ev.slotMinutes));

  const slots: { day: string; startMin: number }[] = [];
  for (const day of new Set(ev.days))
    for (let t = ev.startMin; t + ev.slotMinutes <= ev.endMin; t += ev.slotMinutes)
      slots.push({ day, startMin: t });

  const preferred = slots.map((s) =>
    evalSlot(preps, ev, (p) => p.input.round1, s.day, s.startMin),
  );
  const union = slots.map((s) => evalSlot(preps, ev, (p) => p.union, s.day, s.startMin));

  const total = participants.length;
  const isFull = (r: SlotResult) => total > 0 && r.feasible === total;

  let tier: ResultTier = "none";
  let recommended: RecommendedSlot[] = [];
  const r1Full = preferred.filter(isFull);
  if (total > 0 && r1Full.length > 0) {
    tier = "preferred";
    recommended = r1Full.map(toRecommended);
  } else if (total > 0) {
    const uFull = union.filter(isFull);
    if (uFull.length > 0) {
      tier = "fallback";
      recommended = uFull.map(toRecommended);
    }
  }

  return {
    tier,
    recommended,
    recommendedRuns: coalesce(recommended, ev.slotMinutes),
    preferred,
    union,
  };
}
