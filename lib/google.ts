// Google OAuth + Calendar API helpers — plain fetch, no client library.
// The event grid is minutes-from-midnight in one timezone (America/Detroit,
// per IMPLEMENTATION_PLAN §9), so raw events are normalized to CalBlocks in
// that timezone and the calendar query window is padded to cover TZ drift.

import crypto from "node:crypto";
import type { CalBlock } from "./calendarImport";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/{id}/events";
const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALLBACK_PATH = "/api/auth/google/callback";
const LOCAL_TZ = "America/Detroit";
const STATE_TTL_MS = 15 * 60 * 1000;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

// ── OAuth state (tamper-proof slug+participant binding) ─────────────

interface StatePayload {
  slug: string;
  pid: string;
  ts: number;
}

export function signState(payload: { slug: string; pid: string }): string {
  const body: StatePayload = { ...payload, ts: Date.now() };
  const data = b64url(JSON.stringify(body));
  const sig = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET!)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifyState(state: string | null): StatePayload | null {
  if (!state) return null;
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const data = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET!)
    .update(data)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as StatePayload;
    if (!payload.slug || !payload.pid || !Number.isFinite(payload.ts)) return null;
    if (Date.now() - payload.ts > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── OAuth endpoints ──────────────────────────────────────────────────

export function buildAuthUrl(origin: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", origin + CALLBACK_PATH);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  // Consent every time: Google only issues a refresh_token on the first
  // consent otherwise, and a re-link would then leave us unable to refresh.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`google token error ${res.status}: ${data.error ?? "unknown"}`);
  }
  return data as TokenSet;
}

export function exchangeCode(origin: string, code: string): Promise<TokenSet> {
  return tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: origin + CALLBACK_PATH,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

/** Email from the id_token JWT payload (token arrived over TLS from Google). */
export function idTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}

// ── Calendar events ──────────────────────────────────────────────────

interface GcalEvent {
  id?: string;
  status?: string;
  transparency?: string;
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  creator?: { email?: string; self?: boolean };
}

export interface GcalCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  /** owner | writer | reader | freeBusyReader */
  accessRole?: string;
  /** false = unchecked in the user's Google Calendar UI */
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

/**
 * Every calendar the user can see — primary plus secondary, shared, and
 * subscribed calendars (class schedules, team calendars). Hidden/deleted
 * entries are skipped.
 */
export async function listCalendars(
  accessToken: string,
): Promise<GcalCalendarEntry[]> {
  const entries: GcalCalendarEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`calendar list error ${res.status}`);
    const data = await res.json();
    for (const e of (data.items ?? []) as GcalCalendarEntry[])
      if (e.id && !e.hidden && !e.deleted) entries.push(e);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return entries;
}

/**
 * Fetch one calendar's events overlapping the event days. The query
 * window is padded ±14h because day boundaries are America/Detroit-local
 * while the API expects RFC3339 UTC instants; blocks are bucketed to local
 * days afterwards anyway.
 */
export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  days: string[],
): Promise<GcalEvent[]> {
  const sorted = [...new Set(days)].sort();
  const timeMin = new Date(Date.parse(`${sorted[0]}T00:00:00Z`) - 14 * 3600e3);
  const timeMax = new Date(
    Date.parse(`${sorted[sorted.length - 1]}T23:59:59Z`) + 14 * 3600e3,
  );

  const items: GcalEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    // calendarId can contain '#' (e.g. holiday calendars) — encode it.
    const url = new URL(
      EVENTS_URL.replace("{id}", encodeURIComponent(calendarId)),
    );
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`calendar events error ${res.status}`);
    const data = await res.json();
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

// ── Normalization ────────────────────────────────────────────────────

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: LOCAL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instant → local day + minutes-from-midnight in LOCAL_TZ. */
function toLocal(iso: string): { day: string; min: number } {
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    min: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Raw Google events → CalBlocks, dropping cancelled/declined/empty ones. */
export function toCalBlocks(items: GcalEvent[]): CalBlock[] {
  const blocks: CalBlock[] = [];
  for (const it of items) {
    if (it.status === "cancelled") continue;
    const me = it.attendees?.find((a) => a.self);
    if (me?.responseStatus === "declined") continue;

    const transparent = it.transparency === "transparent";
    const summary = it.summary ?? "";
    const location = it.location ?? "";

    if (it.start?.date && it.end?.date && !it.start.dateTime) {
      // All-day: end.date is exclusive, so the diff is exact.
      const durationMin =
        (Date.parse(`${it.end.date}T00:00:00Z`) -
          Date.parse(`${it.start.date}T00:00:00Z`)) /
        60000;
      if (durationMin <= 0) continue;
      blocks.push({
        eventId: it.id,
        summary,
        location,
        startDay: it.start.date,
        startMin: 0,
        durationMin,
        allDay: true,
        transparent,
        selfCreated: it.creator?.self === true,
      });
    } else if (it.start?.dateTime && it.end?.dateTime) {
      const s = toLocal(it.start.dateTime);
      const durationMin =
        (Date.parse(it.end.dateTime) - Date.parse(it.start.dateTime)) / 60000;
      if (durationMin <= 0) continue;
      blocks.push({
        eventId: it.id,
        summary,
        location,
        startDay: s.day,
        startMin: s.min,
        durationMin,
        allDay: false,
        transparent,
        selfCreated: it.creator?.self === true,
      });
    }
  }
  return blocks;
}
