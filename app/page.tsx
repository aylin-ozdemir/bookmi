"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
const label = "block text-xs font-semibold uppercase tracking-wide text-zinc-500";

function isoPlus(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30); // every 30 min

function fmtOpt(min: number) {
  const h = Math.floor(min / 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(min % 60).padStart(2, "0")} ${ampm}`;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"VIRTUAL" | "IN_PERSON" | "HYBRID">("IN_PERSON");
  const [location, setLocation] = useState<"NORTH" | "CENTRAL" | "EITHER">("EITHER");
  const [firstDay, setFirstDay] = useState(isoPlus(1));
  const [lastDay, setLastDay] = useState(isoPlus(1));
  const [startMin, setStartMin] = useState(9 * 60);
  const [endMin, setEndMin] = useState(18 * 60);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [travelMin, setTravelMin] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days: string[] = [];
  if (firstDay <= lastDay) {
    const d = new Date(`${firstDay}T12:00:00`);
    const end = new Date(`${lastDay}T12:00:00`);
    while (d <= end && days.length < 14) {
      days.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        format,
        location,
        days,
        startMin,
        endMin,
        slotMinutes,
        travelMin,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't create the event — check your inputs.");
      return;
    }
    const { slug } = await res.json();
    router.push(`/e/${slug}`);
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-900">BookMi</h1>
      <p className="mt-2 text-sm text-zinc-600">
        When2Meet, but it knows about the bus. Pick a time that works and a
        place everyone can actually get to.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className={label}>Event name</label>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team standup"
            required
          />
        </div>

        <div>
          <label className={label}>Format</label>
          <div className="mt-1 flex gap-2">
            {(["IN_PERSON", "HYBRID", "VIRTUAL"] as const).map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => setFormat(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  format === f
                    ? "bg-blue-700 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {f === "IN_PERSON" ? "In person" : f === "HYBRID" ? "Hybrid" : "Virtual"}
              </button>
            ))}
          </div>
        </div>

        {format !== "VIRTUAL" && (
          <div>
            <label className={label}>Location</label>
            <div className="mt-1 flex gap-2">
              {(["NORTH", "CENTRAL", "EITHER"] as const).map((l) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => setLocation(l)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    location === l
                      ? "bg-blue-700 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                  }`}
                >
                  {l === "NORTH"
                    ? "North Campus"
                    : l === "CENTRAL"
                      ? "Central Campus"
                      : "Either / no pref"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>First day</label>
            <input
              type="date"
              className={input}
              value={firstDay}
              onChange={(e) => setFirstDay(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>Last day</label>
            <input
              type="date"
              className={input}
              value={lastDay}
              onChange={(e) => setLastDay(e.target.value)}
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-zinc-500">
          {days.length} day{days.length === 1 ? "" : "s"}: {days.join(", ")}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Earliest</label>
            <select
              className={input}
              value={startMin}
              onChange={(e) => setStartMin(Number(e.target.value))}
            >
              {TIME_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {fmtOpt(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Latest</label>
            <select
              className={input}
              value={endMin}
              onChange={(e) => setEndMin(Number(e.target.value))}
            >
              {TIME_OPTIONS.map((m) => (
                <option key={m} value={m + 30}>
                  {fmtOpt(m + 30)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Slot size</label>
            <select
              className={input}
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(Number(e.target.value))}
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
          <div>
            <label className={label}>Bus buffer</label>
            <select
              className={input}
              value={travelMin}
              onChange={(e) => setTravelMin(Number(e.target.value))}
            >
              <option value={15}>15 min</option>
              <option value={20}>20 min</option>
              <option value={30}>30 min</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || !name.trim() || days.length === 0}
          className="w-full rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create event"}
        </button>
      </form>
    </main>
  );
}
