// Shared domain types — kept dependency-free so the engine, API routes, and
// client components all import from here.

export const FORMATS = ["VIRTUAL", "IN_PERSON", "HYBRID"] as const;
export type Format = (typeof FORMATS)[number];

export const PHYSICAL_CAMPUSES = ["NORTH", "CENTRAL"] as const;
export type PhysicalCampus = (typeof PHYSICAL_CAMPUSES)[number];

// Event-level location; EITHER = "no preference, pick the best campus".
export const EVENT_LOCATIONS = ["NORTH", "CENTRAL", "EITHER"] as const;
export type EventLocation = (typeof EVENT_LOCATIONS)[number];

// Per-block location a participant can tag on their availability grid.
export const BLOCK_LOCS = ["NORTH", "CENTRAL", "EITHER", "REMOTE"] as const;
export type BlockLoc = (typeof BLOCK_LOCS)[number];

export interface EventConfig {
  format: Format;
  location: EventLocation;
  /** ISO dates "YYYY-MM-DD" */
  days: string[];
  /** minutes from midnight */
  startMin: number;
  endMin: number;
  slotMinutes: number;
  /** inter-campus commute buffer, minutes */
  travelMin: number;
}

/**
 * Selection map: `${day}@${startMin}` -> BlockLoc.
 * round1 = preferred grid, round2 = "all times that work" grid.
 */
export type SelectionMap = Record<string, BlockLoc>;

export interface ParticipantInput {
  id: string;
  name: string;
  round1: SelectionMap;
  round2: SelectionMap;
}

export const slotKey = (day: string, startMin: number) => `${day}@${startMin}`;

export function parseSlotKey(key: string): { day: string; startMin: number } {
  const at = key.lastIndexOf("@");
  return { day: key.slice(0, at), startMin: Number(key.slice(at + 1)) };
}

export function otherCampus(c: PhysicalCampus): PhysicalCampus {
  return c === "NORTH" ? "CENTRAL" : "NORTH";
}
