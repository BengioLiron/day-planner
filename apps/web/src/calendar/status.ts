import { getSettings, updateSettings } from "../data/db";
import { api, serverAvailable } from "../lib/api";

/**
 * The server is the source of truth for which calendar is connected (it holds
 * the credentials). Runs on start-up, which also covers coming back from the
 * Google sign-in redirect.
 */
export async function syncCalendarStatus(): Promise<void> {
  if (!(await serverAvailable())) return;
  const status = await api.get<{ provider: "google" | "apple" | null; writeCalendarId: string | null }>(
    "/api/calendar/status",
  );
  const settings = await getSettings();
  const connected = status.provider !== null;
  if (connected === settings.calendar.connected && (status.provider ?? "demo") === settings.calendar.provider) return;
  await updateSettings({
    calendar: {
      ...settings.calendar,
      provider: status.provider ?? "demo",
      connected,
      writeCalendarId: status.writeCalendarId,
    },
  });
}
