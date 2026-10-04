// TypeSafe "Jev" classification for calendar blocks. One Choice question
// per event, fanned out in a single request per chunk — the model judges
// semantic intent (is "Advising hold" a real obligation? is "Gym" movable?)
// that the STUDY_RE heuristic can't. Deterministic rules still own what
// they can: transparent events are ignored without a round trip, and any
// unanswered or low-confidence block falls back to lib/calendarImport's
// regex classifier.

import type { BlockClass, CalBlock } from "./calendarImport";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
/** Events per request — questions fan out over shared state in one call. */
const CHUNK = 30;
/** Below this, trust the deterministic classifier instead of the answer. */
const MIN_CONFIDENCE = 0.5;

export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

interface JevEvent {
  i: number;
  title: string;
  location: string;
  /** Local wall-clock time, e.g. "2026-10-05 13:30 for 90 min" */
  when: string;
  allDay: boolean;
  createdByUser: boolean;
}

function toJevEvent(b: CalBlock, i: number): JevEvent {
  const hh = String(Math.floor(b.startMin / 60)).padStart(2, "0");
  const mm = String(b.startMin % 60).padStart(2, "0");
  return {
    i,
    title: b.summary,
    location: b.location,
    when: `${b.startDay} ${hh}:${mm} for ${b.durationMin} min`,
    allDay: b.allDay,
    createdByUser: Boolean(b.selfCreated),
  };
}

const CRITERIA = {
  busy: "A real commitment occupying this time — class, work shift, appointment, meeting, social plan, travel. The person is NOT free.",
  preferred:
    "Time the person deliberately set aside to study or do focused work — a strong candidate for scheduling group work. Prefer substantial blocks; a token 15-minute 'study' reminder is just flexible.",
  flexible:
    "Movable or low-commitment personal time (chores, gym, errands, casual holds). The person could yield this slot to a group meeting.",
  ignore:
    "Not scheduling-relevant — reminder, birthday, holiday, all-day note, or noise from a subscribed calendar that doesn't reflect the person's own commitments.",
} as const;

type JevLabel = keyof typeof CRITERIA;

/** Request body for one chunk of blocks. Exported for tests. */
export function buildClassifyRequest(blocks: CalBlock[], offset = 0) {
  const questions: Record<string, unknown> = {};
  blocks.forEach((b, j) => {
    questions[`b${offset + j}`] = {
      type: "choice",
      instructions: `How should the calendar event \`events[${j}]\` be treated when computing this person's availability for a group meeting?`,
      criteria: CRITERIA,
    };
  });
  return {
    model: JEV_MODEL,
    state: {
      context:
        "Classifying a university student's own Google Calendar events to fill their availability grid for group scheduling.",
      events: blocks.map(toJevEvent),
    },
    questions,
  };
}

/** Map one question's answer to a BlockClass, or null to defer to rules. */
export function answerToClass(answer: unknown): BlockClass | null {
  const a = answer as { choice?: string; confidence?: number } | null;
  if (!a || (a.confidence ?? 0) < MIN_CONFIDENCE) return null;
  switch (a.choice as JevLabel) {
    case "busy":
      return "busy";
    case "preferred":
      return "preferred";
    case "flexible":
      return "study";
    case "ignore":
      return "ignore";
    default:
      return null;
  }
}

/**
 * Classify blocks with Jev. Result indexes match `blocks`; entries are null
 * where the model was unsure or unreachable — the caller should apply the
 * deterministic classifier there. Transparent blocks never reach the model
 * (they're "ignore" by definition).
 */
export async function classifyBlocks(
  blocks: CalBlock[],
): Promise<(BlockClass | null)[]> {
  const out: (BlockClass | null)[] = blocks.map(() => null);
  const pending: { b: CalBlock; i: number }[] = [];
  blocks.forEach((b, i) => {
    if (b.transparent) out[i] = "ignore";
    else pending.push({ b, i });
  });

  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return out;

  for (let start = 0; start < pending.length; start += CHUNK) {
    const chunk = pending.slice(start, start + CHUNK);
    try {
      const res = await fetch(JEV_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildClassifyRequest(chunk.map((c) => c.b), start)),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { answers?: Record<string, unknown> };
      chunk.forEach(({ i }, j) => {
        out[i] = answerToClass(data.answers?.[`b${start + j}`]);
      });
    } catch {
      // network/parse failure — those indexes stay null → rule fallback
    }
  }
  return out;
}
