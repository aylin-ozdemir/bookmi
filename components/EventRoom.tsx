"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GridEditor, { Brush } from "@/components/GridEditor";
import ResultsPanel from "@/components/ResultsPanel";
import type { EventBundle } from "@/lib/events";
import type { BlockLoc, SelectionMap } from "@/lib/types";
import { slotKey } from "@/lib/types";

const POLL_MS = 4000;

export default function EventRoom({ slug }: { slug: string }) {
  const [bundle, setBundle] = useState<EventBundle | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [round, setRound] = useState<1 | 2>(1);
  const [grids, setGrids] = useState<{ 1: SelectionMap; 2: SelectionMap }>({
    1: {},
    2: {},
  });
  const [brush, setBrush] = useState<Brush>("NORTH");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");

  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const me = bundle?.participants.find((p) => p.id === myId);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${slug}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const b: EventBundle = await res.json();
    setBundle(b);
    // Sync local grids from server unless mid-edit for that round.
    if (myId) {
      const mine = b.participants.find((p) => p.id === myId);
      if (mine && !dirty.current) {
        setGrids({
          1: { ...mine.round1 },
          2: { ...mine.round1, ...mine.round2 }, // preferred ⊆ available
        });
      }
    }
  }, [slug, myId]);

  useEffect(() => {
    const stored = localStorage.getItem(`bookmi:${slug}:pid`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration
    if (stored) setMyId(stored);
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, slug]);

  // Debounced autosave: any grids change re-arms the timer; the save only
  // fires if the change came from local edits (dirty flag set in onCell).
  useEffect(() => {
    saveTimer.current = setTimeout(() => {
      if (dirty.current && myId) void save(round, grids[round]);
    }, 800);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on grids/round/myId only
  }, [grids, round, myId]);

  async function save(roundToSave: 1 | 2, map: SelectionMap) {
    if (!myId) return;
    setSaveState("saving");
    const res = await fetch(
      `/api/events/${slug}/participants/${myId}/selections`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ round: roundToSave, selections: map }),
      },
    );
    setSaveState(res.ok ? "saved" : "dirty");
    if (res.ok) {
      dirty.current = false;
      refresh();
    }
  }

  function onCell(day: string, startMin: number, loc: BlockLoc | null) {
    dirty.current = true;
    setSaveState("dirty");
    setGrids((g) => {
      const next = { ...g[round] };
      if (loc == null) delete next[slotKey(day, startMin)];
      else next[slotKey(day, startMin)] = loc;
      return { ...g, [round]: next };
    });
  }

  function switchRound(r: 1 | 2) {
    if (dirty.current) save(round, grids[round]);
    setRound(r);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/events/${slug}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: joinName }),
    });
    if (!res.ok) return;
    const { participantId } = await res.json();
    localStorage.setItem(`bookmi:${slug}:pid`, participantId);
    setMyId(participantId);
    refresh();
  }

  if (notFound)
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-zinc-900">Event not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          This link may be wrong or the event was deleted.
        </p>
      </main>
    );
  if (!bundle) return <main className="p-16 text-center text-zinc-400">Loading…</main>;

  const { event, participants, results } = bundle;
  const names = Object.fromEntries(participants.map((p) => [p.id, p.name]));
  const formatLabel =
    event.format === "IN_PERSON" ? "In person" : event.format === "HYBRID" ? "Hybrid" : "Virtual";
  const locLabel =
    event.location === "EITHER"
      ? "Either campus"
      : event.location === "NORTH"
        ? "North Campus"
        : "Central Campus";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{event.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-medium text-white">
              {formatLabel}
            </span>
            {event.format !== "VIRTUAL" && (
              <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">
                {locLabel}
              </span>
            )}
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
              {event.travelMin} min bus buffer
            </span>
          </div>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(window.location.href)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Copy invite link
        </button>
      </header>

      {!me ? (
        <form onSubmit={join} className="mx-auto max-w-sm rounded-lg border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">Join this event</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {participants.length} {participants.length === 1 ? "person has" : "people have"} joined so far.
          </p>
          <input
            className="mt-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Your name"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            required
          />
          <button className="mt-3 w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            Join
          </button>
        </form>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-1.5">
                {([1, 2] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => switchRound(r)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      round === r ? "bg-blue-700 text-white" : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {r === 1 ? "① Preferred" : "② All available"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-zinc-400">
                {saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : "Saved"}
              </span>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              {round === 1
                ? "Paint the times you'd most like to meet — everyone's first choice counts first."
                : "Paint every time that could possibly work. Used only if no preferred slot overlaps."}
            </p>
            <GridEditor
              event={event}
              value={grids[round]}
              onCell={onCell}
              brush={brush}
              setBrush={setBrush}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">
              Group results · {participants.length}{" "}
              {participants.length === 1 ? "person" : "people"}
            </h2>
            <ResultsPanel event={event} results={results} names={names} />
          </section>
        </div>
      )}
    </main>
  );
}
