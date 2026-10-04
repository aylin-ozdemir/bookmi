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
            {event.days.map((d) => {
              const s = byKey.get(slotKey(d, t));
              if (!s) return <div key={d} className="h-6 w-28 shrink-0" />;
              const rec = recKeys.has(slotKey(d, t));
              const tip = s.verdicts
                .map((v) => `${names[v.participantId] ?? "?"}: ${verdictText(v, event.travelMin)}`)
                .join("\n");
              return (
                <div
                  key={d}
                  title={tip || "nobody"}
                  className={`flex h-6 w-28 shrink-0 items-center justify-center rounded-sm border border-zinc-200 text-[10px] font-bold text-violet-800 ${heatClass(s, rec)}`}
                >
                  {allRemoteOnly(s) ? "⌂" : ""}
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
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-200" /> All remote-only
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-300" /> Marked, can&apos;t attend
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Darker green = more people can make it. Blue outline = recommended.
        Hover a cell to see who and why.
      </p>
      {remoteRuns.length > 0 && (
        <p className="mt-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800">
          Everyone&apos;s remote-only {remoteRuns.map((r) => `${fmtDay(r.day)} ${fmtMin(r.startMin)}–${fmtMin(r.endMin)}`).join(", ")}
          {event.format === "IN_PERSON" ? " — switch to hybrid to make it work." : "."}
        </p>
      )}
    </div>
  );
}
