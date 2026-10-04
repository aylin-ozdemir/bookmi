"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridEditor, { Brush } from "@/components/GridEditor";
import GoogleCalendarCard from "@/components/GoogleCalendarCard";
import ResultsPanel from "@/components/ResultsPanel";
import { computeResults } from "@/lib/availability";
import type { EventBundle } from "@/lib/events";
import type { BlockLoc, SelectionMap } from "@/lib/types";
import { slotKey } from "@/lib/types";

const POLL_MS = 4000;
const RETRY_MS = 3000;

export default function EventRoom({ slug }: { slug: string }) {
  const [bundle, setBundle] = useState<EventBundle | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [round, setRound] = useState<1 | 2>(1);
  const [grids, setGrids] = useState<{ 1: SelectionMap; 2: SelectionMap }>({
    1: {},
    2: {},
  });
  const [brush, setBrush] = useState<Brush>("NORTH");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">(
    "saved",
  );

  // Rounds whose local grid differs from the server's; editSeq detects a
  // save resolving after newer edits so it can't clobber them.
  const dirtyRounds = useRef(new Set<1 | 2>());
  const editSeq = useRef(0);
  const retryNonce = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  const me = bundle?.participants.find((p) => p.id === myId);

  const refresh = useCallback(async () => {
    if (notFound) return;
    try {
      const res = await fetch(`/api/events/${slug}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return;
      const b: EventBundle = await res.json();
      setBundle(b);
      // Resync local grids only when there are no pending local edits.
      if (myId && dirtyRounds.current.size === 0) {
        const mine = b.participants.find((p) => p.id === myId);
        if (mine) {
          setGrids({
            1: { ...mine.round1 },
            2: { ...mine.round1, ...mine.round2 }, // preferred ⊆ available
          });
        }
      }
    } catch {
      // transient failure — keep polling
    }
  }, [slug, myId, notFound]);

  useEffect(() => {
    const stored = localStorage.getItem(`bookmi:${slug}:pid`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration
    if (stored) setMyId(stored);
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, slug]);

  // Debounced autosave: any grids change re-arms the timer and every dirty
  // round is saved with its latest map. retryTick re-arms after failures.
  useEffect(() => {
    if (!myId || dirtyRounds.current.size === 0) return;
    const t = setTimeout(() => {
      for (const r of [...dirtyRounds.current]) void save(r, grids[r]);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on grids/myId/retryTick only
  }, [grids, myId, retryTick]);

  async function save(roundToSave: 1 | 2, map: SelectionMap) {
    if (!myId) return;
    const seq = editSeq.current;
    setSaveState("saving");
    try {
      const res = await fetch(
        `/api/events/${slug}/participants/${myId}/selections`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ round: roundToSave, selections: map }),
        },
      );
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      if (editSeq.current !== seq) return; // superseded — pending debounce owns it
      dirtyRounds.current.delete(roundToSave);
      if (dirtyRounds.current.size === 0) setSaveState("saved");
      refresh();
    } catch {
      setSaveState("error");
      retryNonce.current++;
      setTimeout(() => setRetryTick(retryNonce.current), RETRY_MS);
    }
  }

  function onCell(day: string, startMin: number, loc: BlockLoc | null) {
    const key = slotKey(day, startMin);
    editSeq.current++;
    setSaveState("dirty");
    setGrids((g) => {
      const next = { ...g[round] };
      if (loc == null) delete next[key];
      else next[key] = loc;
      let g1 = g[1];
      // Erasing an inherited preferred cell in round 2 also un-preferreds it:
      // a time that doesn't work at all shouldn't stay a first choice.
      if (round === 2 && loc == null && key in g1) {
        g1 = { ...g1 };
        delete g1[key];
        dirtyRounds.current.add(1);
      }
      return { ...g, 1: g1, [round]: next };
    });
    dirtyRounds.current.add(round);
  }

  /** Server-authoritative grids after a calendar sync/unlink. */
  function applyImported(map: SelectionMap, preferred?: SelectionMap) {
    editSeq.current++;
    // The calendar endpoint already persisted both rounds.
    dirtyRounds.current.delete(2);
    if (preferred) dirtyRounds.current.delete(1);
    setSaveState("saved");
    setGrids((g) => ({ ...g, 1: preferred ?? g[1], 2: map }));
    setRound(2); // show the imported marks — they fill the "all available" grid
    refresh();
  }

  function switchRound(r: 1 | 2) {
    if (dirtyRounds.current.has(round)) void save(round, grids[round]);
    setRound(r);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (joinBusy) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/events/${slug}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: joinName }),
      });
      if (!res.ok) {
        setJoinError("Couldn't join — try again.");
        return;
      }
      const { participantId } = await res.json();
      localStorage.setItem(`bookmi:${slug}:pid`, participantId);
      setMyId(participantId);
      refresh();
    } catch {
      setJoinError("Network error — try again.");
    } finally {
      setJoinBusy(false);
    }
  }

  // Instant local results: same engine as the server, with my unsaved
  // edits merged in, so the heatmap reacts while I paint.
  const liveResults = useMemo(() => {
    if (!bundle || !me) return bundle?.results ?? null;
    const merged = bundle.participants.map((p) =>
      p.id === myId ? { ...p, round1: grids[1], round2: grids[2] } : p,
    );
    return computeResults(bundle.event, merged);
  }, [bundle, grids, myId, me]);

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

  const { event, participants } = bundle;
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
              <>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">
                  {locLabel}
                </span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                  {event.travelMin} min bus buffer
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          {copied ? "Copied!" : "Copy invite link"}
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
          {joinError && <p className="mt-2 text-sm text-red-600">{joinError}</p>}
          <button
            disabled={joinBusy}
            className="mt-3 w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {joinBusy ? "Joining…" : "Join"}
          </button>
        </form>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <section>
            <GoogleCalendarCard
              slug={slug}
              participantId={me.id}
              onImported={applyImported}
            />
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
              <span className={`text-xs ${saveState === "error" ? "text-red-500" : "text-zinc-400"}`}>
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "dirty"
                    ? "Unsaved"
                    : saveState === "error"
                      ? "Save failed — retrying"
                      : "Saved"}
              </span>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              {round === 1
                ? "Paint the times you'd most like to meet — everyone's first choice counts first."
                : "Paint every time that could possibly work. Used only if no preferred slot overlaps."}
            </p>
            <GridEditor
              event={event}
              value={round === 1 ? grids[1] : { ...grids[1], ...grids[2] }}
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
            <div className="mb-4 flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <span
                  key={p.id}
                  title={`${p.name} — preferred: ${Object.keys(p.round1).length} blocks, all-available: ${Object.keys(p.round2).length} blocks`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    p.id === myId
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-zinc-200 bg-white text-zinc-600"
                  }`}
                >
                  {p.name}
                  <span className="flex gap-0.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        Object.keys(p.round1).length ? "bg-green-500" : "bg-zinc-300"
                      }`}
                    />
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        Object.keys(p.round2).length ? "bg-green-500" : "bg-zinc-300"
                      }`}
                    />
                  </span>
                </span>
              ))}
            </div>
            {liveResults && (
              <ResultsPanel event={event} results={liveResults} names={names} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
