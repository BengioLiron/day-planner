import {
  APP_EVENT_MARKER,
  type CalendarEvent,
  type CalendarInfo,
  type CalendarProvider,
  type NewCalendarBlock,
} from "@planner/core";
import { env } from "../env.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const API = "https://www.googleapis.com/calendar/v3";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when access_token expires. */
  expiry: number;
}

/** `redirectUri` defaults to the server's own callback; the desktop app passes a loopback address. */
export function googleAuthUrl(state: string, redirectUri = env.google.redirectUri()): string {
  const q = new URLSearchParams({
    client_id: env.google.clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // returns a refresh token
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId(),
      client_secret: env.google.clientSecret(),
      ...body,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? res.statusText}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? body.refresh_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(code: string, redirectUri = env.google.redirectUri()): Promise<GoogleTokens> {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: "opaque" | "transparent";
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Google Calendar over its REST API. Refreshes the access token when needed and
 * reports new tokens through onTokens so they can be stored (encrypted).
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google" as const;

  constructor(
    private tokens: GoogleTokens,
    private onTokens: (t: GoogleTokens) => Promise<void>,
  ) {}

  private async token(): Promise<string> {
    if (Date.now() < this.tokens.expiry - 60_000) return this.tokens.access_token;
    if (!this.tokens.refresh_token) throw new Error("Google access expired. Connect the calendar again.");
    this.tokens = await tokenRequest({ refresh_token: this.tokens.refresh_token, grant_type: "refresh_token" });
    await this.onTokens(this.tokens);
    return this.tokens.access_token;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`Google Calendar error ${res.status}: ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const data = await this.call<{
      items: { id: string; summary: string; backgroundColor?: string; accessRole: string; primary?: boolean }[];
    }>("/users/me/calendarList");
    return data.items.map((c) => ({
      id: c.primary ? "primary" : c.id,
      name: c.summary,
      color: c.backgroundColor,
      writable: c.accessRole === "owner" || c.accessRole === "writer",
    }));
  }

  async listEvents(calendarIds: string[], from: Date, to: Date): Promise<CalendarEvent[]> {
    const ids = calendarIds.length ? calendarIds : ["primary"];
    const all = await Promise.all(
      ids.map(async (calId) => {
        const q = new URLSearchParams({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: "true", // expand recurring events
          orderBy: "startTime",
          maxResults: "2500",
        });
        const data = await this.call<{ items: GoogleEvent[] }>(`/calendars/${encodeURIComponent(calId)}/events?${q}`);
        return data.items.filter((e) => e.status !== "cancelled").map(toEvent);
      }),
    );
    return all.flat();
  }

  async createBlock(block: NewCalendarBlock): Promise<CalendarEvent> {
    const created = await this.call<GoogleEvent>(`/calendars/${encodeURIComponent(block.calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        summary: block.title,
        start: { dateTime: block.start },
        end: { dateTime: block.end },
        extendedProperties: { private: { [APP_EVENT_MARKER]: block.taskId } },
      }),
    });
    return toEvent(created);
  }

  async deleteBlock(calendarId: string, eventId: string): Promise<void> {
    await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  }
}

function toEvent(e: GoogleEvent): CalendarEvent {
  const allDay = Boolean(e.start?.date);
  const taskId = e.extendedProperties?.private?.[APP_EVENT_MARKER] ?? null;
  return {
    id: e.id,
    externalId: e.id,
    title: e.summary ?? "(no title)",
    start: allDay ? new Date(`${e.start!.date}T00:00:00`).toISOString() : e.start!.dateTime!,
    end: allDay ? new Date(`${e.end!.date}T00:00:00`).toISOString() : e.end!.dateTime!,
    allDay,
    busy: e.transparency !== "transparent",
    origin: taskId ? "app" : "calendar",
    taskId,
  };
}
