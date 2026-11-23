import { api, serverAvailable } from "../lib/api";
import { db } from "./db";

/**
 * Push local changes to the server. Each outbox entry names a row; the
 * latest version of that row is sent, so repeated edits collapse into one.
 * The server keeps the newest updatedAt (last write wins per row).
 */
let running = false;

export async function pushOutbox(): Promise<void> {
  if (running || !navigator.onLine || !(await serverAvailable())) return;
  running = true;
  try {
    const entries = await db.outbox.orderBy("seq").limit(200).toArray();
    if (entries.length === 0) return;

    const taskIds = [...new Set(entries.filter((e) => e.table === "tasks").map((e) => e.rowId))];
    const projectIds = [...new Set(entries.filter((e) => e.table === "projects").map((e) => e.rowId))];
    const [tasks, projects] = await Promise.all([db.tasks.bulkGet(taskIds), db.projects.bulkGet(projectIds)]);

    await api.post("/api/sync/push", {
      tasks: tasks.filter(Boolean),
      projects: projects.filter(Boolean),
    });
    await db.outbox.bulkDelete(entries.map((e) => e.seq!));
  } catch {
    // Offline or server error: entries stay queued and go out on the next attempt.
  } finally {
    running = false;
  }
}

export function startSync(): () => void {
  const run = () => void pushOutbox();
  const id = window.setInterval(run, 30_000);
  window.addEventListener("online", run);
  run();
  return () => {
    window.clearInterval(id);
    window.removeEventListener("online", run);
  };
}
