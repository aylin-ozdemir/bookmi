import { z } from "zod";
import { BLOCK_LOCS, EVENT_LOCATIONS, FORMATS } from "./types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const minuteOfDay = z.number().int().min(0).max(24 * 60);

export const createEventSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    format: z.enum(FORMATS),
    location: z.enum(EVENT_LOCATIONS),
    days: z.array(isoDate).min(1).max(14),
    startMin: minuteOfDay,
    endMin: minuteOfDay,
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
    travelMin: z.number().int().min(0).max(120).default(20),
  })
  .refine((d) => d.startMin < d.endMin, {
    message: "startMin must be before endMin",
  });

export const joinSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const calendarSelectionSchema = z.object({
  // explicit id list = custom mode; null = back to auto defaults
  calendarIds: z.array(z.string().min(1).max(300)).max(200).nullable(),
});

export const calendarPatchSchema = z.object({
  calendarIds: z
    .array(z.string().min(1).max(300))
    .max(200)
    .nullable()
    .optional(),
  // event id → label correction; null removes the override
  eventOverrides: z
    .record(
      z.string().min(1).max(500),
      z.enum(["busy", "study", "preferred", "ignore"]).nullable(),
    )
    .optional(),
});

export const saveSelectionsSchema = z.object({
  round: z.union([z.literal(1), z.literal(2)]),
  selections: z
    .record(z.string(), z.enum(BLOCK_LOCS))
    .refine((m) => Object.keys(m).length <= 2000, { message: "too many selections" }),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
