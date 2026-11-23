import type { CalendarProvider } from "@planner/core";
import { decrypt, encrypt } from "../crypto.js";
import { store } from "../store.js";
import { AppleCalendarProvider, type AppleCredentials } from "./apple.js";
import { GoogleCalendarProvider, type GoogleTokens } from "./google.js";

/** Store a new Google connection (encrypted). Used by the web callback and the desktop app. */
export async function saveGoogleConnection(userId: string, tokens: GoogleTokens): Promise<void> {
  await store.updateUser(userId, (u) => {
    u.calendar = { provider: "google", credentials: encrypt(JSON.stringify(tokens)), writeCalendarId: "primary" };
  });
}

/** The connected calendar for a user, or null when none is connected. */
export async function providerForUser(userId: string): Promise<CalendarProvider | null> {
  const user = await store.getUser(userId);
  const cal = user.calendar;
  if (!cal) return null;

  if (cal.provider === "google") {
    const tokens = JSON.parse(decrypt(cal.credentials)) as GoogleTokens;
    return new GoogleCalendarProvider(tokens, async (fresh) => {
      await store.updateUser(userId, (u) => {
        if (u.calendar) u.calendar.credentials = encrypt(JSON.stringify(fresh));
      });
    });
  }
  return new AppleCalendarProvider(JSON.parse(decrypt(cal.credentials)) as AppleCredentials);
}
