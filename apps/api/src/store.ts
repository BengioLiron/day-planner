import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AiProviderId, CalendarProviderId, Project, Task } from "@planner/core";
import { env } from "./env.js";

/**
 * Storage behind one interface. v1 uses a JSON file for a single user; the
 * Supabase implementation (Postgres + row-level security) replaces it without
 * changing the routes, because every call is scoped by userId.
 */

export interface AiSecret {
  provider: AiProviderId;
  model: string;
  /** Encrypted with crypto.encrypt. */
  apiKey: string;
}

export interface CalendarSecret {
  provider: CalendarProviderId;
  /** Google: encrypted JSON of { access_token, refresh_token, expiry }. Apple: encrypted JSON of { appleId, appPassword }. */
  credentials: string;
  writeCalendarId?: string;
}

export interface UserRecord {
  ai?: AiSecret;
  calendar?: CalendarSecret;
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
}

export interface Store {
  getUser(userId: string): Promise<UserRecord>;
  updateUser(userId: string, fn: (u: UserRecord) => void): Promise<UserRecord>;
}

const empty = (): UserRecord => ({ tasks: {}, projects: {} });

export class JsonFileStore implements Store {
  private data: Record<string, UserRecord> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {}

  private async load(): Promise<Record<string, UserRecord>> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8")) as Record<string, UserRecord>;
    } catch {
      this.data = {};
    }
    return this.data;
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  async getUser(userId: string): Promise<UserRecord> {
    const all = await this.load();
    return all[userId] ?? empty();
  }

  updateUser(userId: string, fn: (u: UserRecord) => void): Promise<UserRecord> {
    // Serialize writes so concurrent requests don't overwrite each other.
    const run = this.queue.then(async () => {
      const all = await this.load();
      const user = (all[userId] ??= empty());
      fn(user);
      await this.save();
      return user;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export const store: Store = new JsonFileStore(env.dataFile);
