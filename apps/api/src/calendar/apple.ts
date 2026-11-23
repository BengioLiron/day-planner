import { randomUUID } from "node:crypto";
import { DAVClient, type DAVCalendar } from "tsdav";
import type { CalendarEvent, CalendarInfo, CalendarProvider, NewCalendarBlock } from "@planner/core";
import { buildIcsEvent, parseIcs } from "./ics.js";

export interface AppleCredentials {
  appleId: string;
  /** An app-specific password from appleid.apple.com, not the Apple ID password. */
  appPassword: string;
}

/**
 * iCloud Calendar over CalDAV. Apple has no OAuth for web apps, so the user
 * gives an app-specific password, which is stored encrypted. The native
 * Capacitor build can replace this with on-device calendar access.
 */
export class AppleCalendarProvider implements CalendarProvider {
  readonly id = "apple" as const;
  private client: DAVClient;
  private ready: Promise<void> | null = null;
  private calendars: DAVCalendar[] = [];

  constructor(creds: AppleCredentials) {
    this.client = new DAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: creds.appleId, password: creds.appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

  private connect(): Promise<void> {
    this.ready ??= (async () => {
      await this.client.login();
      this.calendars = (await this.client.fetchCalendars()).filter(
        (c) => !c.components || c.components.includes("VEVENT"),
      );
    })();
    return this.ready;
  }

  /** Used when connecting, so a wrong password fails right away with a clear message. */
  async verify(): Promise<void> {
    try {
      await this.connect();
    } catch {
      this.ready = null;
      throw Object.assign(new Error("Apple rejected the sign-in. Check the Apple ID and the app-specific password."), {
        status: 400,
      });
    }
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    await this.connect();
    return this.calendars.map((c) => ({
      id: c.url,
      name: typeof c.displayName === "string" ? c.displayName : "Calendar",
      color: c.calendarColor,
      writable: true,
    }));
  }

  private pick(ids: string[]): DAVCalendar[] {
    return ids.length ? this.calendars.filter((c) => ids.includes(c.url)) : this.calendars;
  }

  async listEvents(calendarIds: string[], from: Date, to: Date): Promise<CalendarEvent[]> {
    await this.connect();
    const lists = await Promise.all(
      this.pick(calendarIds).map(async (calendar) => {
        const objects = await this.client.fetchCalendarObjects({
          calendar,
          timeRange: { start: from.toISOString(), end: to.toISOString() },
          expand: true, // the server expands recurring events into instances
        });
        return objects.flatMap((o) =>
          typeof o.data === "string"
            ? parseIcs(o.data).map<CalendarEvent>((e) => ({
                id: `${e.uid}:${e.start.getTime()}`,
                externalId: e.uid,
                title: e.summary,
                start: e.start.toISOString(),
                end: e.end.toISOString(),
                allDay: e.allDay,
                busy: e.busy,
                origin: e.taskId ? "app" : "calendar",
                taskId: e.taskId,
              }))
            : [],
        );
      }),
    );
    return lists.flat().filter((e) => new Date(e.end) > from && new Date(e.start) < to);
  }

  async createBlock(block: NewCalendarBlock): Promise<CalendarEvent> {
    await this.connect();
    const calendar = this.calendars.find((c) => c.url === block.calendarId) ?? this.calendars[0];
    if (!calendar) throw new Error("No writable iCloud calendar found.");
    const uid = randomUUID();
    const start = new Date(block.start);
    const end = new Date(block.end);
    const res = await this.client.createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: buildIcsEvent({ uid, title: block.title, start, end, taskId: block.taskId }),
    });
    if (!res.ok) throw new Error(`iCloud refused the event (${res.status}).`);
    return {
      id: `${uid}:${start.getTime()}`, // same id listEvents produces, so syncs don't duplicate it
      externalId: uid,
      title: block.title,
      start: block.start,
      end: block.end,
      allDay: false,
      busy: true,
      origin: "app",
      taskId: block.taskId,
    };
  }

  async deleteBlock(calendarId: string, eventId: string): Promise<void> {
    await this.connect();
    const calendar = this.calendars.find((c) => c.url === calendarId) ?? this.calendars[0];
    if (!calendar) return;
    const uid = eventId.split(":")[0];
    await this.client.deleteCalendarObject({
      calendarObject: { url: new URL(`${uid}.ics`, calendar.url).href, etag: "" },
    });
  }
}
