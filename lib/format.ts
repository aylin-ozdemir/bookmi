import { BlockReason } from "./availability";
import type { ParticipantVerdict, SlotResult } from "./availability";
import type { BlockLoc, EventConfig } from "./types";

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function fmtDay(iso: string): string {
  // noon anchor avoids TZ edge cases
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const LOC_LABEL: Record<BlockLoc, string> = {
  NORTH: "North",
  CENTRAL: "Central",
  EITHER: "Flexible",
  REMOTE: "Remote",
};

/** Tailwind classes for a block-location chip/cell. */
export const LOC_STYLE: Record<BlockLoc, string> = {
  NORTH: "bg-sky-500",
  CENTRAL: "bg-amber-400",
  EITHER: "bg-emerald-500",
  REMOTE: "bg-violet-400",
};

export function verdictText(
  v: ParticipantVerdict,
  travelMin: number,
): string {
  if (v.ok) return v.mode === "remote" ? "joins remotely" : "in person";
  switch (v.reason as BlockReason) {
    case "not-marked":
      return "didn't mark this";
    case "remote-only":
      return "remote only";
    case "other-campus":
      return "committed to the other campus";
    case "travel-before":
      return `can't get here in time (${travelMin} min commute)`;
    case "travel-after":
      return `can't reach next commitment (${travelMin} min commute)`;
    default:
      return "unavailable";
  }
}

/** Heatmap cell shading by feasible fraction. */
export function heatClass(slot: SlotResult, recommended: boolean): string {
  const base = recommended ? "ring-2 ring-blue-600 ring-offset-1 " : "";
  if (slot.total === 0 || slot.feasible === 0) return base + "bg-zinc-100";
  const frac = slot.feasible / slot.total;
  if (frac >= 1) return base + "bg-green-500";
  if (frac >= 0.75) return base + "bg-green-300";
  if (frac >= 0.5) return base + "bg-green-200";
  if (frac >= 0.25) return base + "bg-green-100";
  return base + "bg-green-50";
}

export function slotTooltip(slot: SlotResult, ev: EventConfig): string {
  const lines = slot.verdicts.map((v) => {
    const name = v.participantId; // replaced by caller with real name
    return `${name}: ${verdictText(v, ev.travelMin)}`;
  });
  return lines.join("\n");
}
