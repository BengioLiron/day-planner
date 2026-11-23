import { generateText, Output, stepCountIs, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import {
  BreakdownResultSchema,
  buildBreakdownSystemPrompt,
  buildResearchPrompt,
  NO_RESEARCH,
  ResearchSchema,
  type AiConnection,
  type BreakdownResult,
  type PlannerContext,
  type PlannerInput,
  type PlannerMessage,
  type PlannerResearch,
  type PlanSource,
} from "@planner/core";
import { modelFor, researchToolsFor, transcribeAudio } from "./providers.js";

/**
 * The planner agent, in two steps:
 *
 * 1. Research: when the goal depends on real-world facts (a permit, an
 *    application, a process), the model searches the web with its provider's
 *    built-in search and writes notes with source links. Otherwise it says
 *    NO_RESEARCH and nothing is searched.
 * 2. Plan: the model breaks the goal into dated tasks, using two tools to look
 *    at the user's real free time and existing tasks, and returns a
 *    structured plan with a source link per step.
 *
 * Refinements ("make it lighter") skip research and reuse its notes.
 */

/**
 * The schema the model fills in. Flat (one object, every field present)
 * because that shape works with structured output on all three providers.
 * It is cleaned into the app's BreakdownResult afterwards.
 */
const WireSchema = z.object({
  type: z.enum(["questions", "plan"]),
  questions: z.array(z.string()).describe("Clarifying questions when type is questions, otherwise empty"),
  projectName: z.string().describe("Short project name; empty when type is questions"),
  summary: z.string().describe("One sentence; empty when type is questions"),
  tasks: z
    .array(
      z.object({
        name: z.string(),
        notes: z.string().describe("Useful detail (documents to bring, where to go), or empty"),
        dueDate: z.string().nullable().describe("YYYY-MM-DD or null"),
        importance: z.enum(["high", "medium", "low"]),
        durationMin: z.number().int(),
        sourceUrl: z.string().describe("URL from the research this step is based on, or empty"),
        dependsOn: z.array(z.number().int()).describe("Earlier step numbers (1-based) that must be done first"),
      }),
    )
    .describe("Tasks in order when type is plan, otherwise empty"),
  caveats: z.array(z.string()).describe("Things the user should check because the sources were unclear; may be empty"),
});
type Wire = z.infer<typeof WireSchema>;

const TaskSummarySchema = z.object({
  name: z.string().max(200),
  dueDate: z.string().nullable(),
  importance: z.enum(["high", "medium", "low"]),
  durationMin: z.number().nullable(),
  project: z.string().nullable(),
});

export const PlannerRequestSchema = z.object({
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(4000) }),
    z.object({ kind: z.literal("audio"), mimeType: z.string(), base64: z.string().max(15_000_000) }),
  ]),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) })).max(30),
  context: z.object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    language: z.enum(["he", "en"]),
    dayLoads: z.array(z.object({ date: z.string(), freeMinutes: z.number(), load: z.number() })).max(60),
    existingProjects: z.array(z.string()).max(100),
    freeSlots: z
      .array(z.object({ date: z.string(), slots: z.array(z.string()).max(24), freeMinutes: z.number() }))
      .max(60)
      .default([]),
    openTasks: z.array(TaskSummarySchema).max(150).default([]),
  }),
  /** Research from earlier in this conversation; when present, the agent doesn't search again. */
  research: ResearchSchema.nullable().optional(),
  /** The plan being refined, as the user last saw it. */
  previousPlan: z
    .object({
      projectName: z.string().max(200),
      tasks: z.array(z.record(z.string(), z.unknown())).max(30),
    })
    .nullable()
    .optional(),
});
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;

/** Models used for each step. Tests pass stand-ins; in the app both are the user's model. */
export interface PlannerModels {
  research: LanguageModel;
  plan: LanguageModel;
  researchTools?: ToolSet;
}

/** Single input pipeline: audio becomes text here, then everything follows the text path. */
async function toPlannerText(conn: AiConnection, input: PlannerInput): Promise<string> {
  return input.kind === "text" ? input.text : transcribeAudio(conn, input);
}

export async function breakdownMission(
  conn: AiConnection,
  input: PlannerInput,
  history: PlannerMessage[],
  context: PlannerContext,
  options: {
    research?: PlannerResearch | null;
    previousPlan?: PlannerRequest["previousPlan"];
    models?: PlannerModels;
  } = {},
): Promise<BreakdownResult> {
  const text = await toPlannerText(conn, input);
  const models: PlannerModels = options.models ?? {
    research: modelFor(conn),
    plan: modelFor(conn),
    researchTools: researchToolsFor(conn),
  };
  const refining = Boolean(options.previousPlan);
  const askedAlready = history.some((m) => m.role === "assistant");

  // 1. Research, once per conversation. Refinements and answers to questions reuse it.
  let research = options.research ?? null;
  if (!research && !refining && !askedAlready) {
    research = await researchMission(models, text, context);
  }

  // 2. Plan, with tools for the user's real calendar and workload.
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    {
      role: "user",
      content: options.previousPlan
        ? `Current plan:\n${JSON.stringify(options.previousPlan)}\n\nChange it like this: ${text}`
        : text,
    },
  ];

  const { output } = await generateText({
    model: models.plan,
    system: buildBreakdownSystemPrompt(context, { research, refining, hasTools: true }) +
      (askedAlready && !refining ? '\nThe user has answered your questions. Reply with type "plan" now.' : ""),
    messages,
    tools: planningTools(context),
    stopWhen: stepCountIs(6),
    output: Output.object({ schema: WireSchema }),
    abortSignal: AbortSignal.timeout(120_000),
  });

  return normalize(output, { mustPlan: askedAlready || refining, research });
}

/** Step 1. Returns null when the model decides the goal needs no outside facts. */
export async function researchMission(
  models: PlannerModels,
  mission: string,
  context: Pick<PlannerContext, "today" | "language">,
): Promise<PlannerResearch | null> {
  const result = await generateText({
    model: models.research,
    system: buildResearchPrompt(context),
    prompt: mission,
    tools: models.researchTools,
    stopWhen: stepCountIs(8),
    abortSignal: AbortSignal.timeout(120_000),
  });
  const notes = result.text.trim();
  if (!notes || notes.startsWith(NO_RESEARCH)) return null;

  // Sources the provider reports, then any other links written in the notes.
  const found: PlanSource[] = [];
  for (const s of result.sources) {
    if (s.sourceType === "url") found.push({ title: s.title ?? hostOf(s.url), url: s.url });
  }
  for (const url of notes.match(/https?:\/\/[^\s)<>"'\]]+/g) ?? []) {
    const clean = url.replace(/[.,;:]+$/, "");
    found.push({ title: hostOf(clean), url: clean });
  }
  return {
    notes: notes.slice(0, 6000),
    sources: dedupeSources(found).slice(0, 12),
  };
}

/** Step 2's tools: they only read what the app sent with the request. */
export function planningTools(context: PlannerContext) {
  return {
    find_free_slots: tool({
      description:
        "Free time in the user's working hours, per day, after calendar events. Use it to choose due dates the user can actually do.",
      inputSchema: z.object({
        from: z.string().describe("First day, YYYY-MM-DD"),
        to: z.string().describe("Last day, YYYY-MM-DD (at most 31 days after from)"),
        minMinutes: z.number().int().optional().describe("Only list gaps at least this long"),
      }),
      execute: async ({ from, to, minMinutes }) => {
        const days = context.freeSlots.filter((d) => d.date >= from && d.date <= to).slice(0, 31);
        if (days.length === 0) return { days: [], note: "No calendar data for those dates; plan by spreading work evenly." };
        return {
          days: days.map((d) => ({
            date: d.date,
            freeMinutes: d.freeMinutes,
            slots: minMinutes ? d.slots.filter((s) => slotMinutes(s) >= minMinutes) : d.slots,
          })),
        };
      },
    }),
    list_open_tasks: tool({
      description:
        "Tasks the user already has and hasn't finished, with due dates and estimates. Use it to avoid overloading days.",
      inputSchema: z.object({
        from: z.string().optional().describe("Only tasks due on or after this day, YYYY-MM-DD"),
        to: z.string().optional().describe("Only tasks due on or before this day, YYYY-MM-DD"),
      }),
      execute: async ({ from, to }) => {
        const tasks = context.openTasks.filter(
          (t) => (!from || (t.dueDate && t.dueDate >= from)) && (!to || (t.dueDate && t.dueDate <= to)),
        );
        return { count: tasks.length, tasks: tasks.slice(0, 60) };
      },
    }),
  };
}

/** Clean the model's answer into a valid BreakdownResult, or fail with a clear message. */
export function normalize(
  raw: Wire | (Omit<Wire, "caveats" | "tasks"> & { caveats?: string[]; tasks: Partial<Wire["tasks"][number]>[] }),
  opts: { mustPlan: boolean; research?: PlannerResearch | null } | boolean,
): BreakdownResult {
  const { mustPlan, research = null } = typeof opts === "boolean" ? { mustPlan: opts } : opts;
  if (raw.type === "questions" && !mustPlan && raw.questions.length > 0) {
    return BreakdownResultSchema.parse({ type: "questions", questions: raw.questions.slice(0, 3), research });
  }
  const tasks = raw.tasks.slice(0, 30);
  const result = BreakdownResultSchema.safeParse({
    type: "plan",
    projectName: raw.projectName.trim().slice(0, 80) || "New project",
    summary: raw.summary.trim().slice(0, 400),
    tasks: tasks.map((t, i) => {
      const dependsOn = [...new Set((t.dependsOn ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= i))];
      const sourceUrl = cleanUrl(t.sourceUrl);
      const notes = (t.notes ?? "").trim();
      return {
        name: (t.name ?? "").trim().slice(0, 200),
        ...(notes ? { notes: notes.slice(0, 1000) } : {}),
        dueDate: t.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null,
        importance: t.importance ?? "medium",
        durationMin: Math.min(480, Math.max(5, Math.round((t.durationMin ?? 30) / 5) * 5)),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(dependsOn.length ? { dependsOn } : {}),
      };
    }),
    ...(raw.caveats?.length ? { caveats: raw.caveats.map((c) => c.trim().slice(0, 300)).filter(Boolean).slice(0, 6) } : {}),
    research,
  });
  if (!result.success)
    throw Object.assign(new Error("The model returned an empty plan. Try rephrasing the goal."), { status: 502 });
  return result.data;
}

/* ---------------- helpers ---------------- */

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function dedupeSources(list: PlanSource[]): PlanSource[] {
  const seen = new Set<string>();
  const out: PlanSource[] = [];
  for (const s of list) {
    const url = cleanUrl(s.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: (s.title || hostOf(url)).slice(0, 300), url });
  }
  return out;
}

function slotMinutes(slot: string): number {
  const [a, b] = slot.split("-");
  const m = (t?: string) => {
    const [h, mm] = (t ?? "0:0").split(":").map(Number);
    return (h ?? 0) * 60 + (mm ?? 0);
  };
  return m(b) - m(a);
}
