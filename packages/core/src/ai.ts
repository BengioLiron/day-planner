import { z } from "zod";
import { addDays, hhmmToMinutes } from "./dates.js";
import { findFreeSlots, intervalLength } from "./slots.js";
import type { CalendarEvent, PlannerSettings } from "./types.js";

/* ------------------------------------------------------------------ */
/* Providers: bring your own model                                     */
/* ------------------------------------------------------------------ */

export const AI_PROVIDERS = ["openai", "anthropic", "google"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Suggested models per provider. The user can type any model id their key allows. */
export const SUGGESTED_MODELS: Record<AiProviderId, string[]> = {
  openai: ["gpt-5.5", "gpt-5.4-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  google: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
};

export const AiConnectionSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1),
  apiKey: z.string().min(8),
});
export type AiConnection = z.infer<typeof AiConnectionSchema>;

/* ------------------------------------------------------------------ */
/* Planner input pipeline                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything the AI planner receives goes through this one shape.
 * v1 sends text. v1.1 adds "audio": the server transcribes it first and
 * then runs the exact same text path, so nothing downstream changes.
 */
export type PlannerInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; mimeType: string; base64: string };

export interface PlannerMessage {
  role: "user" | "assistant";
  content: string;
}

/* ------------------------------------------------------------------ */
/* Mission breakdown: the structured output the model must return      */
/* ------------------------------------------------------------------ */

export const ProposedTaskSchema = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe("YYYY-MM-DD, or null when no date makes sense"),
  importance: z.enum(["high", "medium", "low"]),
  durationMin: z.number().int().min(5).max(480),
});
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const BreakdownResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("questions"),
    /** Up to 3 short clarifying questions, in the user's language. */
    questions: z.array(z.string()).min(1).max(3),
  }),
  z.object({
    type: z.literal("plan"),
    projectName: z.string().min(1).max(80),
    summary: z.string().max(400),
    tasks: z.array(ProposedTaskSchema).min(1).max(30),
  }),
]);
export type BreakdownResult = z.infer<typeof BreakdownResultSchema>;

/* ------------------------------------------------------------------ */
/* Calendar context for the planner (F18: avoid fully booked days)    */
/* ------------------------------------------------------------------ */

export interface DayLoad {
  date: string;
  freeMinutes: number;
  /** 0 = empty working day, 1 = fully booked or a day off. */
  load: number;
}

export function dayLoads(
  from: string,
  days: number,
  events: CalendarEvent[],
  settings: PlannerSettings,
): DayLoad[] {
  const workMinutes = hhmmToMinutes(settings.workEnd) - hhmmToMinutes(settings.workStart);
  const out: DayLoad[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const free = findFreeSlots(date, events, settings).reduce((s, x) => s + intervalLength(x), 0);
    out.push({
      date,
      freeMinutes: free,
      load: workMinutes > 0 ? Math.round((1 - free / workMinutes) * 100) / 100 : 1,
    });
  }
  return out;
}

export interface BreakdownPromptContext {
  today: string;
  language: "he" | "en";
  dayLoads: DayLoad[];
  existingProjects: string[];
}

/** System prompt shared by every provider, so behaviour is the same whichever model the user picks. */
export function buildBreakdownSystemPrompt(ctx: BreakdownPromptContext): string {
  const lang = ctx.language === "he" ? "Hebrew" : "English";
  const busyDays = ctx.dayLoads.filter((d) => d.load >= 0.85).map((d) => d.date);
  return [
    "You are the planner inside a personal task manager.",
    "The user describes a mission. Break it into small, concrete tasks that each take 15 minutes to 3 hours.",
    `Today is ${ctx.today}. Write every task name, note, question and summary in ${lang}.`,
    "If the mission is too vague to plan (no clear outcome, or a deadline that matters is missing), reply with type \"questions\" and at most 3 short questions. Ask at most once; after the user answers, always reply with a plan.",
    "Otherwise reply with type \"plan\": a short project name, a one-sentence summary, and the tasks in the order they should be done.",
    "Give each task a dueDate that spreads the work evenly before the deadline, an importance (high for blockers and deadline-critical steps), and a realistic durationMin.",
    busyDays.length ? `Do not put due dates on these fully booked days: ${busyDays.join(", ")}.` : "",
    ctx.existingProjects.length
      ? `Existing projects (reuse a name only if the mission clearly belongs there): ${ctx.existingProjects.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
