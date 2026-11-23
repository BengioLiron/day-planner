import { z } from "zod";
import { addDays, hhmmToMinutes, minutesToHhmm } from "./dates.js";
import { findFreeSlots, intervalLength } from "./slots.js";
import type { CalendarEvent, Importance, PlannerSettings } from "./types.js";

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
export type PlannerInput = { kind: "text"; text: string } | { kind: "audio"; mimeType: string; base64: string };

export interface PlannerMessage {
  role: "user" | "assistant";
  content: string;
}

/* ------------------------------------------------------------------ */
/* Mission breakdown: the result the planner returns                   */
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
  /** The page this step comes from (an official site, when research was done). */
  sourceUrl: z.string().url().nullable().optional(),
  /** Earlier steps (1-based) that must be finished first. */
  dependsOn: z.array(z.number().int().min(1)).optional(),
});
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const SourceSchema = z.object({
  title: z.string().max(300),
  url: z.string().url(),
});
export type PlanSource = z.infer<typeof SourceSchema>;

/** What the research step found. Sent back by the client so refinements don't search again. */
export const ResearchSchema = z.object({
  notes: z.string().max(6000),
  sources: z.array(SourceSchema).max(12),
});
export type PlannerResearch = z.infer<typeof ResearchSchema>;

export const BreakdownResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("questions"),
    /** Up to 3 short clarifying questions, in the user's language. */
    questions: z.array(z.string()).min(1).max(3),
    research: ResearchSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("plan"),
    projectName: z.string().min(1).max(80),
    summary: z.string().max(400),
    tasks: z.array(ProposedTaskSchema).min(1).max(30),
    /** Things the user should check or decide; the planner wasn't sure. */
    caveats: z.array(z.string().max(300)).max(6).optional(),
    research: ResearchSchema.nullable().optional(),
  }),
]);
export type BreakdownResult = z.infer<typeof BreakdownResultSchema>;

/* ------------------------------------------------------------------ */
/* Calendar and workload context for the planner                       */
/* ------------------------------------------------------------------ */

export interface DayLoad {
  date: string;
  freeMinutes: number;
  /** 0 = empty working day, 1 = fully booked or a day off. */
  load: number;
}

export function dayLoads(from: string, days: number, events: CalendarEvent[], settings: PlannerSettings): DayLoad[] {
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

/** Free time per day as the user sees it (local "HH:MM–HH:MM"), computed on the device so time zones never drift. */
export interface DayFreeSlots {
  date: string;
  slots: string[];
  freeMinutes: number;
}

export function freeSlotsAhead(
  from: string,
  days: number,
  events: CalendarEvent[],
  settings: PlannerSettings,
): DayFreeSlots[] {
  const out: DayFreeSlots[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const slots = findFreeSlots(date, events, settings);
    out.push({
      date,
      slots: slots.map((s) => `${minutesToHhmm(s.start)}-${minutesToHhmm(s.end)}`),
      freeMinutes: slots.reduce((sum, s) => sum + intervalLength(s), 0),
    });
  }
  return out;
}

/** An open task as the planner sees it: enough to judge workload, nothing more. */
export interface PlannerTaskSummary {
  name: string;
  dueDate: string | null;
  importance: Importance;
  durationMin: number | null;
  project: string | null;
}

export interface BreakdownPromptContext {
  today: string;
  language: "he" | "en";
  dayLoads: DayLoad[];
  existingProjects: string[];
}

/** Everything the agent may look at while planning. */
export interface PlannerContext extends BreakdownPromptContext {
  freeSlots: DayFreeSlots[];
  openTasks: PlannerTaskSummary[];
}

const languageName = (l: "he" | "en") => (l === "he" ? "Hebrew" : "English");

/* ------------------------------------------------------------------ */
/* Prompts, shared by every provider                                   */
/* ------------------------------------------------------------------ */

/** Marker the research step answers with when the goal needs no outside facts. */
export const NO_RESEARCH = "NO_RESEARCH";

/** Step 1: find out how the goal is really done, from current sources. */
export function buildResearchPrompt(ctx: Pick<BreakdownPromptContext, "today" | "language">): string {
  return [
    "You are the research step of a personal task planner. You do not write the plan; you gather the facts it needs.",
    `Today is ${ctx.today}.`,
    "Decide whether this goal depends on real-world facts that change or vary by place: official procedures, applications, permits, eligibility, required documents, fees, deadlines, opening hours, or a specific institution, city or country.",
    `If it does not (for example studying, writing, cleaning, personal habits), reply with exactly ${NO_RESEARCH} and nothing else.`,
    "If it does, use web search. Prefer official sources (government, municipality, the institution itself) over forums and blogs. For Israeli topics also search in Hebrew. Open the most relevant official page when you can.",
    `Then write concise research notes in ${languageName(ctx.language)}:`,
    "- the official steps in order, and where each is done (website, office, phone)",
    "- eligibility conditions and required documents",
    "- fees, processing times and deadlines, if stated",
    "- anything unclear, outdated or contradictory between sources",
    "Put the URL of the page right after each fact it supports. Do not invent steps, links or numbers; if a source doesn't say, write that it doesn't say.",
  ].join("\n");
}

/** Step 2: turn the goal (and research, if any) into dated tasks that fit the user's real calendar. */
export function buildBreakdownSystemPrompt(
  ctx: BreakdownPromptContext,
  extra: { research?: PlannerResearch | null; refining?: boolean; hasTools?: boolean } = {},
): string {
  const lang = languageName(ctx.language);
  const busyDays = ctx.dayLoads.filter((d) => d.load >= 0.85).map((d) => d.date);
  return [
    "You are the planner inside a personal task manager.",
    "The user describes a mission. Break it into small, concrete tasks that each take 15 minutes to 3 hours.",
    `Today is ${ctx.today}. Write every task name, note, question, caveat and summary in ${lang}.`,
    "If the mission is too vague to plan (no clear outcome, or a deadline that matters is missing), reply with type \"questions\" and at most 3 short questions. Ask at most once; after the user answers, always reply with a plan.",
    "Otherwise reply with type \"plan\": a short project name, a one-sentence summary, and the tasks in the order they should be done.",
    "Give each task a dueDate that spreads the work sensibly before the deadline, an importance (high for blockers and deadline-critical steps), and a realistic durationMin.",
    "When a task can't start before others are done, list those earlier step numbers (1-based) in dependsOn.",
    extra.hasTools
      ? "Before choosing dates, call find_free_slots for the period you plan in, and list_open_tasks to see what the user already has. Put tasks on days with enough free time for them and avoid days that are already full."
      : busyDays.length
        ? `Do not put due dates on these fully booked days: ${busyDays.join(", ")}.`
        : "",
    extra.research
      ? [
          "Research notes about how this is really done (from current sources):",
          "<research>",
          extra.research.notes,
          "</research>",
          "Base the steps on these notes, in their order, including required documents and where each step is done. Put the matching source URL in each task's sourceUrl (only URLs that appear in the notes or this list).",
          `Sources: ${extra.research.sources.map((s) => s.url).join(" ")}`,
          "If something in the notes is uncertain or missing, add a short caveat instead of guessing.",
        ].join("\n")
      : "No research was done for this mission. Leave sourceUrl empty; never invent links.",
    extra.refining
      ? "The user is asking for changes to the plan you made. Apply their request to that plan and return the full updated plan, keeping everything they didn't ask to change."
      : "",
    ctx.existingProjects.length
      ? `Existing projects (reuse a name only if the mission clearly belongs there): ${ctx.existingProjects.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
