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

/** What Jev actually said about one block, for display and gating. */
export interface JevVerdict {
  /** Raw model label; null when the block never reached the model. */
  label: JevLabel | null;
  confidence: number | null;
}

export interface JevResult {
  /** Gated classes per block — null = defer to the deterministic rules. */
  classes: (BlockClass | null)[];
  verdicts: JevVerdict[];
}

const LABEL_TO_CLASS: Record<JevLabel, BlockClass> = {
  busy: "busy",
  preferred: "preferred",
  flexible: "study",
  ignore: "ignore",
};

function isJevLabel(x: unknown): x is JevLabel {
  return typeof x === "string" && x in LABEL_TO_CLASS;
}

/** Map one question's answer to a BlockClass, or null to defer to rules. */
export function answerToClass(answer: unknown): BlockClass | null {
  const a = answer as { choice?: string; confidence?: number } | null;
  if (!a || (a.confidence ?? 0) < MIN_CONFIDENCE || !isJevLabel(a.choice)) {
    return null;
  }
  return LABEL_TO_CLASS[a.choice];
}

/** Raw label + confidence for display, regardless of the gate. */
function answerToVerdict(answer: unknown): JevVerdict {
  const a = answer as { choice?: string; confidence?: number } | null;
  return {
    label: a && isJevLabel(a.choice) ? a.choice : null,
    confidence: typeof a?.confidence === "number" ? a.confidence : null,
  };
}

/**
 * Classify blocks with Jev. classes[i] is null where the model was unsure
 * or unreachable — the caller should apply the deterministic classifier
 * there. Transparent blocks never reach the model (they're "ignore" by
 * definition). verdicts[i] keeps the raw answer for display.
 */
export async function classifyBlocks(blocks: CalBlock[]): Promise<JevResult> {
  const classes: (BlockClass | null)[] = blocks.map(() => null);
  const verdicts: JevVerdict[] = blocks.map(() => ({
    label: null,
    confidence: null,
  }));
  const pending: { b: CalBlock; i: number }[] = [];
  blocks.forEach((b, i) => {
    if (b.transparent) classes[i] = "ignore";
    else pending.push({ b, i });
  });

  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { classes, verdicts };

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
        const raw = data.answers?.[`b${start + j}`];
        verdicts[i] = answerToVerdict(raw);
        classes[i] = answerToClass(raw);
      });
    } catch {
      // network/parse failure — those indexes stay null → rule fallback
    }
  }
  return { classes, verdicts };
}
