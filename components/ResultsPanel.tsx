"use client";

import { useState } from "react";
import type { EventResults, SlotResult } from "@/lib/availability";
import { allRemoteOnly, everyoneMarked, everyoneRemoteOnly, fmtDay, fmtMin, heatClass, verdictText } from "@/lib/format";
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
  // The view follows the tier that produced the recommendation — first
  // choices when one works for everyone, all availability otherwise —
  // until the user picks a view manually, which then sticks.
  const [manual, setManual] = useState<"preferred" | "union" | null>(null);
  const view = manual ?? (results.tier === "preferred" ? "preferred" : "union");
  const setView = (v: "preferred" | "union") => setManual(v);
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

  // Alternative times — every usable-but-not-recommended slot from the union,
  // grouped into the WIDEST possible runs:
  //   · "flex" runs: fully workable slots where every campus works
  //   · per-campus runs: the whole span each campus works, kept only when it
  //     covers ground the flexible runs don't
  //   · blocked runs: everyone marked but can't all attend (remote-only,
  //     travel/campus-blocked)
  const preferredByKey = new Map<string, SlotResult>();
  for (const s of results.preferred) preferredByKey.set(slotKey(s.day, s.startMin), s);
  const unionByKey = new Map<string, SlotResult>();
  for (const s of results.union) unionByKey.set(slotKey(s.day, s.startMin), s);
  const altRuns: {
    day: string;
    startMin: number;
    endMin: number;
    allRemote: boolean;
    inPerson: boolean;
    notPref: boolean;
    loc?: SlotResult["suggestedLocation"];
  }[] = [];
  const campuses =
    event.location === "EITHER"
      ? (["NORTH", "CENTRAL"] as const)
      : ([] as const);
  for (const d of event.days) {
    const sAt = (t: number) => unionByKey.get(slotKey(d, t));
    const pAt = (t: number) => preferredByKey.get(slotKey(d, t));
    const full = (t: number) => {
      const s = sAt(t);
      return !!s && s.feasible === s.total;
    };
    const isAlt = (t: number) => {
      const s = sAt(t);
      if (!s) return false;
      const p = pAt(t);
      const prefFull = !!p && p.feasible === p.total;
      return (full(t) && !prefFull) || (!full(t) && everyoneMarked(s));
    };
    const anyIn = (a: number, b: number, f: (t: number) => boolean) =>
      times.some((t) => t >= a && t < b && f(t));
    const allIn = (a: number, b: number, f: (t: number) => boolean) =>
      !anyIn(a, b, (t) => !f(t));
    const notPref = (a: number, b: number) =>
      anyIn(a, b, (t) => !(pAt(t) && everyoneMarked(pAt(t)!)));
    const anyInPerson = (a: number, b: number) =>
      anyIn(a, b, (t) =>
        sAt(t)!.verdicts.some((v) => v.ok && v.mode === "in-person"),
      );
    const collect = (sig: (t: number) => string | null) => {
      const out: { startMin: number; endMin: number }[] = [];
      let rs: number | null = null;
      let cs = "";
      for (const t of [...times, event.endMin]) {
        const s = t < event.endMin ? sig(t) : null;
        if (rs !== null && s !== cs) {
          out.push({ startMin: rs, endMin: t });
          rs = null;
        }
        if (s !== null && rs === null) {
          rs = t;
          cs = s;
        }
      }
      return out;
    };

    // Blocked-but-marked runs (split on type/resolved campus).
    for (const r of collect((t) => {
      const s = sAt(t);
      return s && isAlt(t) && !full(t)
        ? `${everyoneRemoteOnly(s)}|${s.suggestedLocation ?? ""}`
        : null;
    })) {
      let loc: SlotResult["suggestedLocation"];
      for (const t of times)
        if (t >= r.startMin && t < r.endMin) loc ??= sAt(t)?.suggestedLocation;
      altRuns.push({
        day: d,
        startMin: r.startMin,
        endMin: r.endMin,
        allRemote: allIn(r.startMin, r.endMin, (t) => everyoneRemoteOnly(sAt(t)!)),
        inPerson: false,
        notPref: notPref(r.startMin, r.endMin),
        loc,
      });
    }

    // Flexible runs: fully workable on every campus (or single-campus event).
    for (const r of collect((t) => {
      const s = sAt(t);
      return s && isAlt(t) && full(t) && (!s.allFeasible || s.allFeasible.length > 1)
        ? "flex"
        : null;
    })) {
      const ip = anyInPerson(r.startMin, r.endMin);
      altRuns.push({
        day: d,
        startMin: r.startMin,
        endMin: r.endMin,
        allRemote: !ip,
        inPerson: ip,
        notPref: notPref(r.startMin, r.endMin),
        loc: undefined,
      });
    }

    // Per-campus widest runs — kept only when they cover slots the flexible
    // runs don't (e.g. Central works 6–8 even though either works 6–6:30).
    for (const L of campuses) {
      for (const r of collect((t) => {
        const s = sAt(t);
        return s && isAlt(t) && full(t) && s.allFeasible?.includes(L)
          ? L
          : null;
      })) {
        if (
          allIn(r.startMin, r.endMin, (t) => (sAt(t)?.allFeasible?.length ?? 0) > 1)
        )
          continue; // entirely covered by a flexible run
        const ip = anyInPerson(r.startMin, r.endMin);
        altRuns.push({
          day: d,
          startMin: r.startMin,
          endMin: r.endMin,
          allRemote: !ip,
          inPerson: ip,
          notPref: notPref(r.startMin, r.endMin),
          loc: L,
        });
      }
    }
  }
  altRuns.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.startMin - b.startMin ||
      (a.loc ? 1 : 0) - (b.loc ? 1 : 0),
  );

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
                    {s.suggestedLocation ? (
                      <div className="mb-0.5 font-semibold text-zinc-200">
                        Meeting would be on{" "}
                        {s.suggestedLocation === "NORTH" ? "North" : "Central"}{" "}
                        Campus
                      </div>
                    ) : (
                      event.location === "EITHER" &&
                      s.feasible > 0 && (
                        <div className="mb-0.5 font-semibold text-zinc-200">
                          Works on either campus
                        </div>
                      )
                    )}
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
      {results.recommendedRuns.length > 0 && (
        <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2">
          <p className="text-xs font-semibold text-green-900">
            ✓ Best time{results.recommendedRuns.length > 1 ? "s" : ""} — works
            for everyone:
          </p>
          <ul className="mt-1 space-y-0.5">
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
        </div>
      )}
      {altRuns.length > 0 && (
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
          <p className="text-xs font-semibold text-violet-900">
            ⌂ Alternative{altRuns.length > 1 ? "s" : ""} — everyone&apos;s
            available, just not ideal:
          </p>
          <ul className="mt-1 space-y-0.5">
            {altRuns.map((r) => (
              <li
                key={`${r.day}@${r.startMin}-${r.endMin}-${r.loc ?? "any"}-${r.inPerson ? "i" : r.allRemote ? "r" : "b"}`}
                className="text-xs text-violet-800"
              >
                {fmtDay(r.day)} · {fmtMin(r.startMin)}–{fmtMin(r.endMin)}
                {r.inPerson && (
                  <span className="ml-2 rounded bg-green-200 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">
                    in person
                  </span>
                )}
                {r.loc && !r.allRemote && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                    {r.loc === "NORTH" ? "North Campus" : "Central Campus"}
                  </span>
                )}
                {r.allRemote && (
                  <span className="ml-2 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                    remote-only
                  </span>
                )}
                {r.notPref && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    not preferred
                  </span>
                )}
              </li>
            ))}
          </ul>
          {event.format === "IN_PERSON" && altRuns.some((r) => r.allRemote) && (
            <p className="mt-1 text-xs text-violet-600">
              Switch the event to hybrid to make the remote-only times work.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
