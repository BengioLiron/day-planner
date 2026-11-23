import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import {
  BreakdownResultSchema,
  buildBreakdownSystemPrompt,
  type AiConnection,
  type BreakdownPromptContext,
  type BreakdownResult,
  type PlannerInput,
  type PlannerMessage,
} from "@planner/core";
import { modelFor, transcribeAudio } from "./providers.js";

/**
 * The schema the model fills in. It is flat (one object, every field present)
 * because that shape works with structured output on OpenAI, Anthropic and
 * Google alike. It is converted to the app's BreakdownResult afterwards.
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
        notes: z.string().describe("Optional detail, or empty"),
        dueDate: z.string().nullable().describe("YYYY-MM-DD or null"),
        importance: z.enum(["high", "medium", "low"]),
        durationMin: z.number().int(),
      }),
    )
    .describe("Tasks in order when type is plan, otherwise empty"),
});

export const PlannerRequestSchema = z.object({
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(4000) }),
    z.object({ kind: z.literal("audio"), mimeType: z.string(), base64: z.string().max(15_000_000) }),
  ]),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20),
  context: z.object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    language: z.enum(["he", "en"]),
    dayLoads: z.array(z.object({ date: z.string(), freeMinutes: z.number(), load: z.number() })).max(60),
    existingProjects: z.array(z.string()).max(100),
  }),
});

/** Single input pipeline: audio becomes text here, then everything follows the text path. */
async function toPlannerText(conn: AiConnection, input: PlannerInput): Promise<string> {
  return input.kind === "text" ? input.text : transcribeAudio(conn, input);
}

export async function breakdownMission(
  conn: AiConnection,
  input: PlannerInput,
  history: PlannerMessage[],
  context: BreakdownPromptContext,
  model: LanguageModel = modelFor(conn),
): Promise<BreakdownResult> {
  const text = await toPlannerText(conn, input);
  const askedAlready = history.some((m) => m.role === "assistant");

  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: "user", content: text },
  ];

  const { output } = await generateText({
    model,
    system:
      buildBreakdownSystemPrompt(context) +
      (askedAlready ? '\nThe user has answered your questions. Reply with type "plan" now.' : ""),
    messages,
    output: Output.object({ schema: WireSchema }),
    abortSignal: AbortSignal.timeout(60_000),
  });

  return normalize(output, askedAlready);
}

/** Clean the model's answer into a valid BreakdownResult, or fail with a clear message. */
export function normalize(raw: z.infer<typeof WireSchema>, mustPlan: boolean): BreakdownResult {
  if (raw.type === "questions" && !mustPlan && raw.questions.length > 0) {
    return BreakdownResultSchema.parse({ type: "questions", questions: raw.questions.slice(0, 3) });
  }
  const result = BreakdownResultSchema.safeParse({
    type: "plan",
    projectName: raw.projectName.trim().slice(0, 80) || "New project",
    summary: raw.summary.trim().slice(0, 400),
    tasks: raw.tasks.slice(0, 30).map((t) => ({
      name: t.name.trim().slice(0, 200),
      notes: t.notes.trim() ? t.notes.trim().slice(0, 1000) : undefined,
      dueDate: t.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null,
      importance: t.importance,
      durationMin: Math.min(480, Math.max(5, Math.round(t.durationMin / 5) * 5)),
    })),
  });
  if (!result.success)
    throw Object.assign(new Error("The model returned an empty plan. Try rephrasing the goal."), { status: 502 });
  return result.data;
}
