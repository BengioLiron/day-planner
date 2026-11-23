/**
 * Shared domain types. Every syncable row carries id, timestamps and a
 * soft-delete marker so offline edits can be merged and the schema is
 * ready for many users (userId is filled in by the server).
 */

export type Importance = "high" | "medium" | "low";
export const IMPORTANCE_LEVELS: readonly Importance[] = ["high", "medium", "low"];

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskSource = "manual" | "ai_planner";

export interface SyncMeta {
  id: string;
  userId?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  deletedAt?: string | null;
}

export interface Task extends SyncMeta {
  name: string;
  notes?: string;
  /** Local calendar date, YYYY-MM-DD. */
  dueDate?: string | null;
  /** Optional local time, HH:mm. */
  dueTime?: string | null;
  importance: Importance;
  /** Estimated length in minutes. The plan uses a default when empty. */
  durationMin?: number | null;
  projectId?: string | null;
  doneAt?: string | null;
  source: TaskSource;
  /** Manual sort position within a list. */
  order?: number;
}

export interface Project extends SyncMeta {
  name: string;
  color: string;
  status: "active" | "archived";
}

export type CalendarProviderId = "google" | "apple";

export interface CalendarEvent {
  id: string;
  /** Id in the external calendar, when the event came from or went to one. */
  externalId?: string | null;
  title: string;
  start: string; // ISO timestamp
  end: string; // ISO timestamp
  allDay: boolean;
  /** Free events (e.g. "working elsewhere") do not block planning. */
  busy: boolean;
  /** "calendar" = synced from the provider, "app" = a task the user added to the calendar. */
  origin: "calendar" | "app";
  taskId?: string | null;
}

export interface PlannerSettings {
  /** Working hours, HH:mm in local time. */
  workStart: string;
  workEnd: string;
  /** 0 = Sunday … 6 = Saturday. */
  daysOff: number[];
  /** Minutes kept free before and after each event. */
  bufferMin: number;
  /** Share of free time left unplanned (0–0.9). */
  slackRatio: number;
  /** Used when a task has no estimate. */
  defaultDurationMin: number;
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  workStart: "09:00",
  workEnd: "18:00",
  daysOff: [5, 6], // Friday and Saturday
  bufferMin: 10,
  slackRatio: 0.2,
  defaultDurationMin: 30,
};

/** A machine-readable reason. The UI turns it into a sentence in the user's language. */
export type PlanReason =
  | { kind: "overdue"; days: number }
  | { kind: "due_today" }
  | { kind: "due_tomorrow" }
  | { kind: "due_in"; days: number }
  | { kind: "no_date" }
  | { kind: "importance"; level: Importance }
  | { kind: "fits_gap"; start: number; end: number };

export type PlanItemState = "suggested" | "accepted";

export interface PlanItem {
  taskId: string;
  /** Minutes from local midnight. */
  start: number;
  end: number;
  score: number;
  reasons: PlanReason[];
  state: PlanItemState;
}

export interface DailyPlan {
  date: string; // YYYY-MM-DD
  items: PlanItem[];
  /** Candidates that were worth doing but did not fit today. */
  unplaced: { taskId: string; score: number }[];
  freeMinutes: number;
  plannedMinutes: number;
}
