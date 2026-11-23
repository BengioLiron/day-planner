import { addDays, toDateKey, dateAtMinutes, type CalendarProvider } from "@planner/core";
import { db, getSettings, type AppSettings } from "../data/db";
import { DemoCalendarProvider } from "./demo";
import { ServerCalendarProvider } from "./server";

/**
 * Picks the calendar implementation. A Capacitor build will add a "device"
 * provider here that reads the phone's calendars natively.
 */
export function calendarProviderFor(settings: AppSettings): CalendarProvider {
  const c = settings.calendar;
  if (c.provider !== "demo" && c.connected) return new ServerCalendarProvider(c.provider);
  return new DemoCalendarProvider(settings.language);
}

/** Pull events for yesterday … two weeks ahead into the local copy. */
export async function refreshCalendar(): Promise<void> {
  const settings = await getSettings();
  const provider = calendarProviderFor(settings);
  const today = toDateKey(new Date());
  const from = dateAtMinutes(addDays(today, -1), 0);
  const to = dateAtMinutes(addDays(today, 15), 0);
  const events = await provider.listEvents(settings.calendar.readCalendarIds, from, to);
  await db.transaction("rw", db.events, async () => {
    // The demo calendar only knows its own events; a real provider also returns the
    // task blocks the user added, so its copy replaces both kinds.
    const stale =
      provider.id === "demo"
        ? await db.events.where("origin").equals("calendar").primaryKeys()
        : await db.events.toCollection().primaryKeys();
    await db.events.bulkDelete(stale);
    await db.events.bulkPut(events);
  });
}

export async function addTaskToCalendar(task: { id: string; name: string }, start: Date, end: Date) {
  const settings = await getSettings();
  const provider = calendarProviderFor(settings);
  const calendarId = settings.calendar.writeCalendarId ?? "primary";
  return provider.createBlock({
    calendarId,
    title: task.name,
    start: start.toISOString(),
    end: end.toISOString(),
    taskId: task.id,
  });
}

export async function removeTaskFromCalendar(eventId: string) {
  const settings = await getSettings();
  const provider = calendarProviderFor(settings);
  await provider.deleteBlock(settings.calendar.writeCalendarId ?? "primary", eventId);
}
