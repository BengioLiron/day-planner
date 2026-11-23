import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_PLANNER_SETTINGS,
  type AiProviderId,
  type CalendarEvent,
  type CalendarProviderId,
  type PlannerSettings,
  type Project,
  type Task,
} from "@planner/core";

export type Language = "en" | "he";
export type ThemePref = "system" | "light" | "dark";

export interface AppSettings {
  key: "app";
  language: Language;
  theme: ThemePref;
  planner: PlannerSettings;
  calendar: {
    /** "demo" = the built-in sample calendar, used until Google or Apple is connected. */
    provider: CalendarProviderId | "demo";
    connected: boolean;
    readCalendarIds: string[];
    /** Where "Add to calendar" writes. */
    writeCalendarId: string | null;
  };
  ai: {
    provider: AiProviderId;
    model: string;
    /** The key itself lives encrypted on the server, never in the browser. */
    connected: boolean;
  };
  sampleData: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  key: "app",
  language: "en",
  theme: "system",
  planner: DEFAULT_PLANNER_SETTINGS,
  calendar: { provider: "demo", connected: false, readCalendarIds: [], writeCalendarId: null },
  ai: { provider: "anthropic", model: "claude-sonnet-5-5", connected: false },
  sampleData: false,
};

/** Per-day choices: tasks the user said "not today" to. */
export interface DayState {
  date: string;
  snoozedTaskIds: string[];
}

/** Local changes waiting to be pushed to the server. */
export interface OutboxEntry {
  seq?: number;
  table: "tasks" | "projects";
  rowId: string;
  op: "put" | "delete";
  at: string;
}

export class PlannerDb extends Dexie {
  tasks!: EntityTable<Task, "id">;
  projects!: EntityTable<Project, "id">;
  events!: EntityTable<CalendarEvent, "id">;
  settings!: EntityTable<AppSettings, "key">;
  dayState!: EntityTable<DayState, "date">;
  outbox!: EntityTable<OutboxEntry, "seq">;

  constructor() {
    super("day-planner");
    this.version(1).stores({
      tasks: "id, dueDate, projectId, doneAt, deletedAt, updatedAt",
      projects: "id, status, deletedAt",
      events: "id, start, origin, taskId",
      settings: "key",
      dayState: "date",
      outbox: "++seq, table, rowId",
    });
  }
}

export const db = new PlannerDb();

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get("app");
  return mergeSettings(s);
}

export function mergeSettings(s: AppSettings | undefined): AppSettings {
  if (!s) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    planner: { ...DEFAULT_SETTINGS.planner, ...s.planner },
    calendar: { ...DEFAULT_SETTINGS.calendar, ...s.calendar },
    ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
  };
}

export async function updateSettings(patch: Partial<Omit<AppSettings, "key">>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, key: "app" });
}
