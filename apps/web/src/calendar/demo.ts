import {
  addDays,
  dateAtMinutes,
  hhmmToMinutes,
  toDateKey,
  type CalendarEvent,
  type CalendarInfo,
  type CalendarProvider,
  type NewCalendarBlock,
} from "@planner/core";
import { db, type Language } from "../data/db";

interface DemoSlot {
  days: number[]; // weekdays, 0 = Sunday
  start: string;
  end: string;
  title: { en: string; he: string };
  busy?: boolean;
}

const WEEK: DemoSlot[] = [
  { days: [0, 1, 2, 3, 4], start: "09:30", end: "09:50", title: { en: "Team stand-up", he: "סטנדאפ צוות" } },
  { days: [0, 3], start: "11:00", end: "12:30", title: { en: "Design review", he: "סקירת עיצוב" } },
  { days: [1], start: "10:30", end: "12:00", title: { en: "Client workshop", he: "סדנה עם לקוח" } },
  { days: [0, 1, 2, 3, 4], start: "13:00", end: "13:45", title: { en: "Lunch", he: "ארוחת צהריים" } },
  { days: [0, 2], start: "15:00", end: "16:00", title: { en: "1:1 with Dana", he: "פגישה אישית עם דנה" } },
  { days: [2], start: "10:00", end: "12:00", title: { en: "Quarterly planning", he: "תכנון רבעוני" } },
  { days: [4], start: "16:30", end: "17:30", title: { en: "Dentist", he: "רופא שיניים" } },
  { days: [1, 3], start: "17:00", end: "17:30", title: { en: "Gym", he: "חדר כושר" }, busy: true },
];

/**
 * A built-in sample calendar so the daily plan works before Google or Apple is connected.
 * Its events are generated; blocks the user adds are stored locally with origin "app".
 */
export class DemoCalendarProvider implements CalendarProvider {
  readonly id = "demo" as const;
  constructor(private language: Language) {}

  async listCalendars(): Promise<CalendarInfo[]> {
    return [{ id: "demo", name: this.language === "he" ? "יומן לדוגמה" : "Sample calendar", writable: true }];
  }

  async listEvents(_calendarIds: string[], from: Date, to: Date): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    for (let key = toDateKey(from); key < toDateKey(to); key = addDays(key, 1)) {
      const weekday = dateAtMinutes(key, 0).getDay();
      for (const slot of WEEK) {
        if (!slot.days.includes(weekday)) continue;
        out.push({
          id: `demo:${key}:${slot.start}`,
          externalId: null,
          title: slot.title[this.language],
          start: dateAtMinutes(key, hhmmToMinutes(slot.start)).toISOString(),
          end: dateAtMinutes(key, hhmmToMinutes(slot.end)).toISOString(),
          allDay: false,
          busy: slot.busy ?? true,
          origin: "calendar",
        });
      }
    }
    return out;
  }

  async createBlock(block: NewCalendarBlock): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: `app:${crypto.randomUUID()}`,
      externalId: null,
      title: block.title,
      start: block.start,
      end: block.end,
      allDay: false,
      busy: true,
      origin: "app",
      taskId: block.taskId,
    };
    await db.events.put(event);
    return event;
  }

  async deleteBlock(_calendarId: string, eventId: string): Promise<void> {
    await db.events.delete(eventId);
  }
}
