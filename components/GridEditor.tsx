"use client";

import { useEffect, useRef } from "react";
import { fmtDay, fmtMin, LOC_LABEL, LOC_STYLE } from "@/lib/format";
import { BLOCK_LOCS, BlockLoc, EventConfig, SelectionMap, slotKey } from "@/lib/types";

export type Brush = BlockLoc | "ERASE";

const BRUSHES: { value: Brush; label: string; chip?: string }[] = [
  ...BLOCK_LOCS.map((l) => ({ value: l as Brush, label: LOC_LABEL[l], chip: LOC_STYLE[l] })),
  { value: "ERASE", label: "Erase", chip: "bg-zinc-200" },
];

interface Props {
  event: EventConfig;
  value: SelectionMap;
  onCell(day: string, startMin: number, loc: BlockLoc | null): void;
  brush: Brush;
  setBrush(b: Brush): void;
}

/**
 * Drag-to-paint availability grid. Pointer down starts a stroke: if the
 * starting cell already holds the active brush it erases, otherwise it paints.
 */
export default function GridEditor({ event, value, onCell, brush, setBrush }: Props) {
  const stroke = useRef<null | { paint: boolean; loc: BlockLoc }>(null);

  useEffect(() => {
    const up = () => (stroke.current = null);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  function apply(day: string, startMin: number) {
    const s = stroke.current;
    if (!s) return;
    const key = slotKey(day, startMin);
    if (s.paint) {
      if (value[key] !== s.loc) onCell(day, startMin, s.loc);
    } else if (value[key] != null) {
      onCell(day, startMin, null);
    }
  }

  function down(day: string, startMin: number) {
    const cur = value[slotKey(day, startMin)];
    if (brush === "ERASE") {
      stroke.current = { paint: false, loc: "NORTH" };
    } else {
      stroke.current =
        cur === brush ? { paint: false, loc: brush } : { paint: true, loc: brush };
    }
    apply(day, startMin);
  }

  const times: number[] = [];
  for (let t = event.startMin; t + event.slotMinutes <= event.endMin; t += event.slotMinutes)
    times.push(t);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Where you&apos;ll be:
        </span>
        {BRUSHES.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => setBrush(b.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
              brush === b.value
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${b.chip}`} />
            {b.label}
          </button>
        ))}
      </div>

      <div
        className="inline-block select-none overflow-x-auto"
        style={{ touchAction: "none" }}
      >
        <div className="flex gap-3">
          <div className="w-14 shrink-0" />
          {event.days.map((d) => (
            <div key={d} className="w-28 shrink-0 text-center text-xs font-semibold text-zinc-600">
              {fmtDay(d)}
            </div>
          ))}
        </div>
        {times.map((t) => (
          <div key={t} className="flex items-center gap-3">
            <div className="w-14 shrink-0 text-right text-[10px] leading-6 text-zinc-400">
              {t % 60 === 0 ? fmtMin(t) : ""}
            </div>
            {event.days.map((d) => {
              const loc = value[slotKey(d, t)];
              return (
                <div
                  key={d}
                  onPointerDown={() => down(d, t)}
                  onPointerEnter={() => apply(d, t)}
                  className={`h-6 w-28 shrink-0 cursor-pointer rounded-sm border border-zinc-200 ${
                    loc ? LOC_STYLE[loc] : "bg-white hover:bg-zinc-50"
                  }`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
