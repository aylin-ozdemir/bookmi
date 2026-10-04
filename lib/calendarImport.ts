// Google Calendar → availability import. Pure functions, no fetch/DB:
// lib/google.ts normalizes raw Calendar API events into CalBlocks; this
// module classifies them and turns them into grid selections.
//
// Semantics: every grid slot not overlapped by a busy block is marked
// available (round-2 "all times that work"). Long self-scheduled blocks
// whose title looks like "study" (or similar flexible work time) count as
// available rather than busy. Free slots default to EITHER ("flexible"
// location); a study block whose location names a campus tags the slot
// with that campus instead.

import {
  EventConfig,
  PhysicalCampus,
  SelectionMap,
  slotKey,
} from "./types";

/** One calendar event normalized to event-local (America/Detroit) minutes. */
export interface CalBlock {
  /** Google event id — stable key for per-event overrides */
  eventId?: string;
  summary: string;
  location: string;
  /** ISO date the block starts on, local time */
  startDay: string;
  /** minutes from local midnight */
  startMin: number;
  /** block length in minutes — may cross midnight */
  durationMin: number;
  /** Google all-day event (start.date rather than start.dateTime) */
  allDay: boolean;
  /** Google "transparent" = shown as free, doesn't occupy time */
  transparent: boolean;
  /** Event created by the user — counts even on an excluded calendar */
  selfCreated?: boolean;
}

/** Minimum length for a "study"-titled block to count as free time. */
export const STUDY_MIN_MINUTES = 60;

// Self-scheduled flexible work time. Keep the list tight: generic words
// like "work" or "meeting" are real obligations, not free blocks.
const STUDY_RE =
  /\b(study|studying|homework|pset|problem sets?|library|focus|deep work|review|reading|essay|office hours|work block|prep|grind|co-?work)\b/i;

const CAMPUS_RE: [PhysicalCampus, RegExp][] = [
  [
    "NORTH",
    /\b(north|duderstadt|bursley|pierpont|baits|chrysler|cooley|eecs|bbb|g\.?\s?f\.?\s?brown)\b/i,
  ],
  [
    "CENTRAL",
    /\b(central|diag|ugli|shapiro|mlb|mason|angell|downtown|state st|lorch|weiser|ross|michigan union|west hall|haven)\b/i,
  ],
];

/** Guess a campus from an event's location text, or null when unclear. */
export function inferCampus(location: string): PhysicalCampus | null {
  for (const [campus, re] of CAMPUS_RE) if (re.test(location)) return campus;
  return null;
}

/**
 * Auto-inclusion rule for a calendar: ones the user can write on — their
 * own calendars, whose events are their real commitments. Subscribed
 * calendars (accessRole reader/freeBusyReader — TA office hours, public
 * schedules, Google-provided holiday calendars) default to excluded but
 * stay user-pickable; events the user created anywhere still count.
 */
export function defaultCalendarIncluded(e: {
  id: string;
  accessRole?: string;
  hidden?: boolean;
  deleted?: boolean;
}): boolean {
  if (e.hidden || e.deleted) return false;
  return e.accessRole === "owner" || e.accessRole === "writer";
}

/**
 * busy     — occupies time, blocks the slot
 * study    — flexible/movable block: counts as available (round 2)
 * preferred— deliberately-set-aside work time: available AND a first
 *            choice (also marked in round 1). Only produced by the Jev
 *            classifier; the regex fallback never returns it.
 * ignore   — scheduling noise
 */
export type BlockClass = "busy" | "study" | "preferred" | "ignore";

export function classify(b: CalBlock): BlockClass {
  // "Transparent" events are explicitly marked as not taking your time.
  if (b.transparent) return "ignore";
  if (!b.allDay && b.durationMin >= STUDY_MIN_MINUTES && STUDY_RE.test(b.summary))
    return "study";
  return "busy";
}

export interface CalendarImportResult {
  /** free grid slots → location tag, ready to merge into a round-2 map */
  selections: SelectionMap;
  /** slots inside "preferred" blocks → location tag, for the round-1 map */
  preferred: SelectionMap;
  /** grid slots a busy block overlaps (for stats / debugging) */
  busyKeys: string[];
  stats: {
    busy: number;
    study: number;
    preferred: number;
    ignored: number;
    marked: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** ISO date → day number, so intervals can be compared across days. */
const dayIndex = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

interface Interval {
  start: number; // absolute minutes (dayIndex * 1440 + minute)
  end: number;
  location: string;
}

/** Precedence: user override > model/rule class. Keyed by Google event id. */
export function applyOverrides(
  blocks: CalBlock[],
  classes: (BlockClass | null)[],
  overrides: Record<string, BlockClass>,
): (BlockClass | null)[] {
  return classes.map((c, i) => {
    const id = blocks[i].eventId;
    return id ? (overrides[id] ?? c) : c;
  });
}

export function computeImport(
  ev: EventConfig,
  blocks: CalBlock[],
  classes?: (BlockClass | null)[],
): CalendarImportResult {
  const busy: Interval[] = [];
  const study: Interval[] = [];
  const preferred: Interval[] = [];
  const stats = { busy: 0, study: 0, preferred: 0, ignored: 0, marked: 0 };

  blocks.forEach((b, i) => {
    const cls = classes?.[i] ?? classify(b);
    if (cls === "ignore") {
      stats.ignored++;
      return;
    }
    stats[cls]++;
    if (b.durationMin <= 0) return;
    const start = dayIndex(b.startDay) * 1440 + b.startMin;
    const iv = { start, end: start + b.durationMin, location: b.location };
    if (cls === "busy") busy.push(iv);
    else {
      study.push(iv); // study + preferred both yield availability
      if (cls === "preferred") preferred.push(iv);
    }
  });

  const selections: SelectionMap = {};
  const preferredSel: SelectionMap = {};
  const busyKeys: string[] = [];
  const overlaps = (iv: Interval, s: number, e: number) =>
    iv.start < e && iv.end > s;

  for (const day of new Set(ev.days)) {
    const base = dayIndex(day) * 1440;
    for (let t = ev.startMin; t + ev.slotMinutes <= ev.endMin; t += ev.slotMinutes) {
      const s = base + t;
      const e = s + ev.slotMinutes;
      const key = slotKey(day, t);
      if (busy.some((iv) => overlaps(iv, s, e))) {
        busyKeys.push(key);
        continue;
      }
      const hit = study.find((iv) => overlaps(iv, s, e));
      selections[key] = (hit && inferCampus(hit.location)) || "EITHER";
      const pref = preferred.find((iv) => overlaps(iv, s, e));
      if (pref) preferredSel[key] = inferCampus(pref.location) || "EITHER";
      stats.marked++;
    }
  }

  return { selections, preferred: preferredSel, busyKeys, stats };
}
