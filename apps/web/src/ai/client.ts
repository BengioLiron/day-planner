import {
  addDays,
  BreakdownResultSchema,
  dayLoads,
  freeSlotsAhead,
  parseDateKey,
  toDateKey,
  type BreakdownResult,
  type PlannerInput,
  type PlannerMessage,
  type PlannerResearch,
  type ProposedTask,
} from "@planner/core";
import { db, getSettings, type Language } from "../data/db";
import { api, serverAvailable } from "../lib/api";

export interface PlannerResponse {
  result: BreakdownResult;
  /** True when no model is connected and the local template produced the plan. */
  demo: boolean;
}

/**
 * The single entry point for the AI planner. Text today; in v1.1 the mic
 * button sends { kind: "audio" } through this same function and the server
 * transcribes it before running the usual text path.
 */
export interface RefineState {
  /** Research the agent did earlier in this conversation, so it doesn't search again. */
  research?: PlannerResearch | null;
  /** The plan as the user last saw it, when they ask for changes. */
  previousPlan?: { projectName: string; tasks: ProposedTask[] } | null;
}

export async function runPlanner(
  input: PlannerInput,
  history: PlannerMessage[],
  refine: RefineState = {},
): Promise<PlannerResponse> {
  const settings = await getSettings();
  const today = toDateKey(new Date());

  if (settings.ai.connected && (await serverAvailable())) {
    const events = await db.events.toArray();
    const projects = await db.projects.where("status").equals("active").toArray();
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const open = (await db.tasks.toArray())
      .filter((t) => !t.doneAt && !t.deletedAt)
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
      .slice(0, 100);
    const raw = await api.post<unknown>(
      "/api/planner/breakdown",
      {
        input,
        history,
        context: {
          today,
          language: settings.language,
          dayLoads: dayLoads(today, 30, events, settings.planner),
          existingProjects: projects.map((p) => p.name),
          freeSlots: freeSlotsAhead(today, 45, events, settings.planner),
          openTasks: open.map((t) => ({
            name: t.name.slice(0, 200),
            dueDate: t.dueDate ?? null,
            importance: t.importance,
            durationMin: t.durationMin ?? null,
            project: (t.projectId && projectName.get(t.projectId)) || null,
          })),
        },
        research: refine.research ?? null,
        previousPlan: refine.previousPlan ?? null,
      },
      // Searching the web and planning can take a couple of minutes.
      240_000,
    );
    return { result: BreakdownResultSchema.parse(raw), demo: false };
  }

  if (input.kind !== "text") throw new Error("Voice input needs a connected AI model.");
  return { result: demoBreakdown(input.text, today, settings.language, settings.planner.daysOff), demo: true };
}

/* ------------------------------------------------------------------ */
/* Demo planner: a transparent template, used until a model is set up  */
/* ------------------------------------------------------------------ */

const STEPS: Record<Language, { name: string; importance: "high" | "medium" | "low"; durationMin: number }[]> = {
  en: [
    { name: "Write down what done looks like", importance: "high", durationMin: 30 },
    { name: "List everything the goal needs", importance: "high", durationMin: 45 },
    { name: "Do the first concrete step", importance: "high", durationMin: 60 },
    { name: "Work through the main part", importance: "medium", durationMin: 90 },
    { name: "Review progress and adjust the plan", importance: "medium", durationMin: 30 },
    { name: "Finish the remaining pieces", importance: "medium", durationMin: 90 },
    { name: "Final check and wrap up", importance: "low", durationMin: 30 },
  ],
  he: [
    { name: "לכתוב איך נראית ההצלחה", importance: "high", durationMin: 30 },
    { name: "לרשום את כל מה שהמטרה דורשת", importance: "high", durationMin: 45 },
    { name: "לבצע את הצעד המעשי הראשון", importance: "high", durationMin: 60 },
    { name: "לעבוד על החלק המרכזי", importance: "medium", durationMin: 90 },
    { name: "לבדוק התקדמות ולעדכן את התוכנית", importance: "medium", durationMin: 30 },
    { name: "לסיים את החלקים שנשארו", importance: "medium", durationMin: 90 },
    { name: "בדיקה אחרונה וסגירה", importance: "low", durationMin: 30 },
  ],
};

function demoBreakdown(mission: string, today: string, language: Language, daysOff: number[]): BreakdownResult {
  const steps = STEPS[language];
  const spanDays = 21;
  const projectName = mission.trim().replace(/\s+/g, " ").slice(0, 60);
  const workday = (key: string) => {
    let d = key;
    for (let i = 0; i < 7 && daysOff.includes(parseDateKey(d).getDay()); i++) d = addDays(d, 1);
    return d;
  };
  return {
    type: "plan",
    projectName,
    summary:
      language === "he"
        ? `הנה תוכנית ראשונה ב־${steps.length} צעדים לשלושת השבועות הקרובים.`
        : `Here's a first plan in ${steps.length} steps over the next three weeks.`,
    tasks: steps.map((s, i) => ({
      ...s,
      dueDate: workday(addDays(today, Math.round(((i + 1) * spanDays) / steps.length))),
    })),
  };
}
