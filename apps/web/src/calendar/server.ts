import type {
  CalendarEvent,
  CalendarInfo,
  CalendarProvider,
  CalendarProviderId,
  NewCalendarBlock,
} from "@planner/core";
import { api } from "../lib/api";
import { db } from "../data/db";

/**
 * Google or Apple, reached through the API server (tokens and app passwords
 * never touch the browser). The browser keeps a local copy of events so the
 * plan still renders offline.
 */
export class ServerCalendarProvider implements CalendarProvider {
  constructor(readonly id: CalendarProviderId) {}

  listCalendars(): Promise<CalendarInfo[]> {
    return api.get<CalendarInfo[]>("/api/calendar/calendars");
  }

  listEvents(calendarIds: string[], from: Date, to: Date): Promise<CalendarEvent[]> {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      calendars: calendarIds.join(","),
    });
    return api.get<CalendarEvent[]>(`/api/calendar/events?${q}`);
  }

  async createBlock(block: NewCalendarBlock): Promise<CalendarEvent> {
    const event = await api.post<CalendarEvent>("/api/calendar/blocks", block);
    await db.events.put({ ...event, origin: "app", taskId: block.taskId });
    return event;
  }

  async deleteBlock(calendarId: string, eventId: string): Promise<void> {
    await api.del(`/api/calendar/blocks/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`);
    await db.events.delete(eventId);
  }
}
