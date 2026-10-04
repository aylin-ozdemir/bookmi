"use client";

import { useState } from "react";
import type { EventResults, SlotResult } from "@/lib/availability";
import { allRemoteOnly, everyoneRemoteOnly, fmtDay, fmtMin, heatClass, verdictText } from "@/lib/format";
import type { EventConfig } from "@/lib/types";
import { slotKey } from "@/lib/types";

interface Props {
  event: EventConfig;
  results: EventResults;
  names: Record<string, string>; // participantId -> display name
}

const TIER_COPY = {
  preferred: "Everyone's first choice works",
  fallback: "No shared first-choice slot — best available times",
  none: "No full overlap yet",
} as const;

export default function ResultsPanel({ event, results, names }: Props) {
  const [view, setView] = useState<"preferred" | "union">("preferred");
  const grid = view === "preferred" ? results.preferred : results.union;
  // Recommended rings only make sense on the view that produced them.
  const showRings =
    (results.tier === "preferred" && view === "preferred") ||
    (results.tier === "fallback" && view === "union");
  const recKeys = new Set(
    showRings ? results.recommended.map((r) => slotKey(r.day, r.startMin)) : [],
  );

  const times: number[] = [];
  for (let t = event.startMin; t + event.slotMinutes <= event.endMin; t += event.slotMinutes)
    times.push(t);

  const byKey = new Map<string, SlotResult>();
  for (const s of grid) byKey.set(slotKey(s.day, s.startMin), s);

  // Remote-only overlaps: consecutive infeasible slots where every mark is
  // remote — worth surfacing for in-person events (a hint to go hybrid).
  // Computed from the union so the hint shows on either view.
  const unionByKey = new Map<string, SlotResult>();
  for (const s of results.union) unionByKey.set(slotKey(s.day, s.startMin), s);
  const remoteRuns: { day: string; startMin: number; endMin: number }[] = [];
  for (const d of event.days) {
    let runStart: number | null = null;
    for (const t of [...times, event.endMin]) {
      const s = unionByKey.get(slotKey(d, t));
      const remote = t < event.endMin && !!s && everyoneRemoteOnly(s);
      if (remote && runStart === null) runStart = t;
      if (!remote && runStart !== null) {
        remoteRuns.push({ day: d, startMin: runStart, endMin: t });
        runStart = null;
      }
    }
  }

  return (
    <div data-testid="results-panel">
      <div className="mb-3">
        <div
          className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold ${
            results.tier === "preferred"
              ? "bg-green-100 text-green-800"
              : results.tier === "fallback"
                ? "bg-amber-100 text-amber-800"
                : "bg-zinc-100 text-zinc-600"
          }`}
        >
          {TIER_COPY[results.tier]}
        </div>
        {results.recommendedRuns.length > 0 && (
          <ul className="mt-2 space-y-1">
            {results.recommendedRuns.map((r) => (
              <li key={`${r.day}@${r.startMin}`} className="text-sm font-medium text-zinc-800">
                {fmtDay(r.day)} · {fmtMin(r.startMin)}–{fmtMin(r.endMin)}
                {r.suggestedLocation && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
                    {r.suggestedLocation === "NORTH" ? "North Campus" : "Central Campus"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-2 flex gap-1.5">
        {(
          [
            ["preferred", "First choices"],
            ["union", "All availability"],
          ] as const
        ).map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              view === v ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <div className="inline-block overflow-x-auto">
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
            {event.days.map((d, di) => {
              const s = byKey.get(slotKey(d, t));
              if (!s) return <div key={d} className="h-6 w-28 shrink-0" />;
              const rec = recKeys.has(slotKey(d, t));
              const tip = s.verdicts
                .map((v) => `${names[v.participantId] ?? "?"}: ${verdictText(v, event.travelMin)}`)
                .join("\n");
              const full = s.total > 0 && s.feasible === s.total;
              const everyoneRemote = everyoneRemoteOnly(s);
              // Tooltip opens down for the top rows (would clip above),
              // and aligns to the grid edge for the first/last columns.
              const tipPos =
                (t === times[0] || t === times[1] ? "top-full mt-1 " : "bottom-full mb-1 ") +
                (di === 0
                  ? "left-0"
                  : di === event.days.length - 1
                    ? "right-0"
                    : "left-1/2 -translate-x-1/2");
              return (
                <div key={d} className="group relative h-6 w-28 shrink-0">
                  <div
                    aria-label={`${d} ${fmtMin(t)} — ${tip || "nobody marked"}`}
                    className={`flex h-full w-full items-center justify-center rounded-sm border border-zinc-200 text-[10px] font-bold ${
                      full
                        ? "border-green-700 text-white"
                        : everyoneRemote
                          ? "border-violet-700 text-white"
                          : "text-violet-800"
                    } ${heatClass(s, rec)}`}
                  >
                    {full ? "✓" : everyoneRemote || allRemoteOnly(s) ? "⌂" : ""}
                  </div>
                  <div
                    className={`pointer-events-none absolute z-50 w-44 whitespace-pre-line rounded-md bg-zinc-900 px-2.5 py-1.5 text-left text-[10px] font-normal leading-snug text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${tipPos}`}
                  >
                    {s.verdicts.map((v) => (
                      <div key={v.participantId}>
                        <span className={v.ok ? "text-green-400" : "text-zinc-400"}>
                          {v.ok ? "✓" : "✗"}
                        </span>{" "}
                        <span className="font-semibold">
                          {names[v.participantId] ?? "?"}
                        </span>{" "}
                        — {verdictText(v, event.travelMin)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" /> North
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Central
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Flexible
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" /> Remote
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" /> Everyone remote
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-200" /> Remote marks
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-300" /> Marked, can&apos;t attend
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        <span className="font-bold text-green-700">✓ dark green</span> = works for
        everyone — a meeting candidate. Lighter green = some can make it.
        Blue outline = recommended. Hover a cell to see who and why.
      </p>
      {remoteRuns.length > 0 && (
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
          <p className="text-xs font-semibold text-violet-900">
            ⌂ Remote option{remoteRuns.length > 1 ? "s" : ""} — everyone&apos;s
            available, just not in person:
          </p>
          <ul className="mt-1 space-y-0.5">
            {remoteRuns.map((r) => (
              <li key={`${r.day}@${r.startMin}`} className="text-xs text-violet-800">
                {fmtDay(r.day)} · {fmtMin(r.startMin)}–{fmtMin(r.endMin)}
              </li>
            ))}
          </ul>
          {event.format === "IN_PERSON" && (
            <p className="mt-1 text-xs text-violet-600">
              Switch the event to hybrid to make these work.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
