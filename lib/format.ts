import { BlockReason } from "./availability";
import type { ParticipantVerdict, SlotResult } from "./availability";
import type { BlockLoc } from "./types";

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

function campusShort(l?: BlockLoc): string {
  return l === "NORTH" ? "North" : l === "CENTRAL" ? "Central" : "";
}

function reasonText(v: ParticipantVerdict, travelMin: number): string {
  switch (v.reason as BlockReason) {
    case "not-marked":
      return "didn't mark this";
    case "remote-only":
      return "remote only";
    case "other-campus":
      return campusShort(v.loc) ? `on ${campusShort(v.loc)}` : "on the other campus";
    case "travel-before":
      return campusShort(v.loc)
        ? `on ${campusShort(v.loc)} — can't get here in time (${travelMin} min)`
        : `can't get here in time (${travelMin} min)`;
    case "travel-after":
      return `can't reach their next commitment (${travelMin} min)`;
    default:
      return "unavailable";
  }
}

export function verdictText(
  v: ParticipantVerdict,
  travelMin: number,
): string {
  if (!v.ok) return reasonText(v, travelMin);
  if (v.mode === "remote")
    return v.reason ? `joins remotely — ${reasonText(v, travelMin)}` : "joins remotely";
  return "in person";
}

/** True when every marked verdict on an infeasible slot is remote-only:
 *  the only availability flagged here is remote. */
export function allRemoteOnly(slot: SlotResult): boolean {
  if (slot.feasible !== 0) return false;
  const marked = slot.verdicts.filter((v) => v.reason !== "not-marked");
  return marked.length > 0 && marked.every((v) => v.reason === "remote-only");
}

/** Stricter: EVERY participant is remote-only — a genuine remote overlap. */
export function everyoneRemoteOnly(slot: SlotResult): boolean {
  return (
    slot.feasible === 0 &&
    slot.verdicts.length > 0 &&
    slot.verdicts.every((v) => v.reason === "remote-only")
  );
}

/** Every participant marked this slot (any location) — technically free
 *  for all, even if format/location/travel keeps it from being a candidate. */
export function everyoneMarked(slot: SlotResult): boolean {
  return (
    slot.verdicts.length > 0 &&
    slot.verdicts.every((v) => v.reason !== "not-marked")
  );
}

/** Heatmap cell shading by feasible fraction; feasible=0 still
 *  distinguishes "marked but can't attend" from "nobody marked". */
export function heatClass(slot: SlotResult, recommended: boolean): string {
  const base = recommended ? "ring-2 ring-blue-600 ring-offset-1 " : "";
  if (slot.total === 0 || slot.feasible === 0) {
    // Everyone remote = a real overlap in the wrong format; partial remote
    // marks get a lighter shade.
    if (everyoneRemoteOnly(slot)) return base + "bg-violet-500";
    if (allRemoteOnly(slot)) return base + "bg-violet-200";
    const marked = slot.verdicts.some((v) => v.reason !== "not-marked");
    return base + (marked ? "bg-zinc-300" : "bg-zinc-100");
  }
  const frac = slot.feasible / slot.total;
  if (frac >= 1) return base + "bg-green-600";
  if (frac >= 0.75) return base + "bg-green-300";
  if (frac >= 0.5) return base + "bg-green-200";
  if (frac >= 0.25) return base + "bg-green-100";
  return base + "bg-green-50";
}
