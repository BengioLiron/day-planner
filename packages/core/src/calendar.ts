import type { CalendarEvent, CalendarProviderId } from "./types.js";

/** A calendar the user can read from or add tasks to. */
export interface CalendarInfo {
  id: string;
  name: string;
  color?: string;
  /** False for read-only calendars such as holidays or shared calendars. */
  writable: boolean;
}

export interface NewCalendarBlock {
  calendarId: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  /** Task id, stored on the event so the app can match it later. */
  taskId: string;
}

/**
 * One interface for every calendar source.
 * Implementations: Google (OAuth, server), Apple (iCloud CalDAV, server),
 * a demo calendar (browser), and later a native device calendar (Capacitor).
 */
export interface CalendarProvider {
  readonly id: CalendarProviderId | "demo" | "device";
  listCalendars(): Promise<CalendarInfo[]>;
  /** Events overlapping [from, to). */
  listEvents(calendarIds: string[], from: Date, to: Date): Promise<CalendarEvent[]>;
  /** "Add to calendar": write one task block and return the created event. */
  createBlock(block: NewCalendarBlock): Promise<CalendarEvent>;
  deleteBlock(calendarId: string, eventId: string): Promise<void>;
}

/** Marker stored on events the app creates, so sync can recognize them. */
export const APP_EVENT_MARKER = "day-planner-task";
