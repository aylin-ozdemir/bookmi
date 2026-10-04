"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SelectionMap } from "@/lib/types";

interface CalEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string | null;
  included: boolean;
}

interface Status {
  configured: boolean;
  jev?: boolean;
  linked: boolean;
  email: string | null;
  syncedAt: string | null;
  selectionMode: "auto" | "custom";
  calendars: CalEntry[] | null;
}

interface Props {
  slug: string;
  participantId: string;
  /** Server-rewrite of the grids after a sync or unlink. */
  onImported(round2: SelectionMap, round1?: SelectionMap): void;
}

/**
 * Optional Google Calendar link. Hidden entirely unless the server has
 * OAuth credentials configured. After the OAuth round-trip the callback
 * lands back on /e/[slug]?gcal=connected, which triggers one auto-sync.
 */
export default function GoogleCalendarCard({ slug, participantId, onImported }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"sync" | "unlink" | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const didAutoSync = useRef(false);
  // Parent re-renders on every poll; keep the callback stable via ref so the
  // mount effect doesn't refire.
  const onImportedRef = useRef(onImported);
  useEffect(() => {
    onImportedRef.current = onImported;
  }, [onImported]);

  const api = `/api/events/${slug}/participants/${participantId}/calendar`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // leave status as-is; the card is optional
    }
  }, [api]);

  const sync = useCallback(async () => {
    setBusy("sync");
    setMsg(null);
    try {
      const res = await fetch(api, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ text: data.error ?? "Sync failed — try again.", error: true });
        return;
      }
      onImportedRef.current(data.selections, data.preferred);
      const {
        marked = 0,
        study = 0,
        preferred = 0,
        calendars = 1,
        classifier,
      } = data.stats ?? {};
      setMsg({
        text:
          `Filled ${marked} "all available" block${marked === 1 ? "" : "s"} across ` +
          `${calendars === 1 ? "your calendar" : `${calendars} calendars`}` +
          (study ? ` — counted ${study} flexible block${study === 1 ? "" : "s"} as free` : "") +
          (preferred ? ` — ${preferred} marked preferred` : "") +
          "." +
          (classifier === "jev" ? " Events classified by Jev." : ""),
        error: false,
      });
      load();
    } catch {
      setMsg({ text: "Network error — try again.", error: true });
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  useEffect(() => {
    // Consume the OAuth callback hint, then reflect link state / auto-sync.
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal) {
      params.delete("gcal");
      const q = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial status fetch + oauth callback handling
    void load().then(() => {
      if (gcal === "connected" && !didAutoSync.current) {
        didAutoSync.current = true;
        void sync();
      } else if (gcal === "denied") {
        setMsg({ text: "Google sign-in was cancelled.", error: false });
      } else if (gcal === "error") {
        setMsg({ text: "Couldn't link Google — try again.", error: true });
      }
    });
  }, [load, sync]);

  if (!status?.configured) return null;

  const connectHref = `/api/auth/google/start?slug=${encodeURIComponent(
    slug,
  )}&pid=${encodeURIComponent(participantId)}`;

  const unlink = async () => {
    setBusy("unlink");
    setMsg(null);
    try {
      const res = await fetch(api, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onImportedRef.current(data.selections ?? {}, data.preferred ?? {});
        setStatus({
          configured: status.configured,
          jev: status.jev,
          linked: false,
          email: null,
          syncedAt: null,
          selectionMode: "auto",
          calendars: null,
        });
      } else {
        setMsg({ text: data.error ?? "Couldn't unlink — try again.", error: true });
      }
    } catch {
      setMsg({ text: "Network error — try again.", error: true });
    } finally {
      setBusy(null);
    }
  };

  /** Persist the new included-set, then re-sync so the grid reflects it. */
  const applyCalendarChoice = async (ids: string[] | null, next?: CalEntry[]) => {
    if (next) setStatus((s) => (s ? { ...s, calendars: next, selectionMode: "custom" } : s));
    try {
      const res = await fetch(api, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarIds: ids }),
      });
      if (res.ok) void sync();
      else setMsg({ text: "Couldn't save calendar choice.", error: true });
    } catch {
      setMsg({ text: "Network error — try again.", error: true });
    }
  };

  const toggleCalendar = (id: string, checked: boolean) => {
    if (!status?.calendars) return;
    const next = status.calendars.map((c) =>
      c.id === id ? { ...c, included: checked } : c,
    );
    void applyCalendarChoice(
      next.filter((c) => c.included).map((c) => c.id),
      next,
    );
  };

  const resetCalendars = () => void applyCalendarChoice(null);

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-3">
      {status.linked ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-zinc-600">
              <span className="font-semibold text-zinc-800">Google Calendar linked</span>
              {status.email && <span className="text-zinc-400"> · {status.email}</span>}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={sync}
                disabled={busy != null}
                className="rounded-md bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {busy === "sync" ? "Syncing…" : "Sync availability"}
              </button>
              <button
                type="button"
                onClick={unlink}
                disabled={busy != null}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                {busy === "unlink" ? "Unlinking…" : "Unlink"}
              </button>
            </div>
          </div>
          {status.calendars && status.calendars.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs text-zinc-500">
                Counting{" "}
                <span className="font-semibold text-zinc-700">
                  {status.calendars.filter((c) => c.included).length} of{" "}
                  {status.calendars.length}
                </span>{" "}
                calendars
                {status.selectionMode === "custom" && " (custom)"}
              </summary>
              <p className="mt-1 text-[11px] leading-4 text-zinc-400">
                Events you created always count, even on unchecked calendars.
              </p>
              <div className="mt-1.5 max-h-36 space-y-0.5 overflow-y-auto rounded border border-zinc-100 bg-zinc-50 p-2">
                {status.calendars.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-1.5 text-xs text-zinc-600"
                  >
                    <input
                      type="checkbox"
                      checked={c.included}
                      onChange={(e) => toggleCalendar(c.id, e.target.checked)}
                      className="h-3 w-3 accent-blue-700"
                    />
                    <span className="truncate">
                      {c.summary}
                      {c.primary && <span className="text-zinc-400"> (primary)</span>}
                      {!c.primary && c.accessRole && c.accessRole !== "owner" && (
                        <span className="text-zinc-400"> (subscribed)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {status.selectionMode === "custom" && (
                <button
                  type="button"
                  onClick={resetCalendars}
                  className="mt-1 text-xs text-blue-700 hover:underline"
                >
                  Reset to auto (your own calendars)
                </button>
              )}
            </details>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-600">
            <span className="font-semibold text-zinc-800">Optional:</span> link Google
            Calendar to auto-fill your free times — big &quot;study&quot;-style blocks
            count as available.
          </p>
          {/* a link, not a button: it navigates into the OAuth flow */}
          <a
            href={connectHref}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Connect Google Calendar
          </a>
        </div>
      )}
      {msg && (
        <p className={`mt-2 text-xs ${msg.error ? "text-red-600" : "text-emerald-700"}`}>
          {msg.text}
        </p>
      )}
      {status.jev && (
        <p className="mt-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
          Event classification powered by Jev
        </p>
      )}
    </div>
  );
}
