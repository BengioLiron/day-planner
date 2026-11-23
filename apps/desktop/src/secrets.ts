import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

/**
 * Secrets the desktop app keeps for itself: the key that encrypts saved AI
 * keys and calendar logins, and the Google sign-in client. On Windows,
 * safeStorage uses DPAPI, so the file is only readable by this Windows user.
 */

interface SecretsFile {
  version: 1;
  /** "dpapi" = encrypted with safeStorage; "plain" only where the OS offers no keychain (some Linux setups). */
  sealing: "dpapi" | "plain";
  encryptionKey: string;
  google?: { clientId: string; clientSecret: string };
}

export interface Secrets {
  encryptionKey: string;
  google?: { clientId: string; clientSecret: string };
}

function seal(value: string, sealing: SecretsFile["sealing"]): string {
  return sealing === "dpapi" ? safeStorage.encryptString(value).toString("base64") : value;
}

function unseal(value: string, sealing: SecretsFile["sealing"]): string {
  return sealing === "dpapi" ? safeStorage.decryptString(Buffer.from(value, "base64")) : value;
}

export class SecretStore {
  private cache: Secrets | null = null;

  constructor(private file: string) {}

  private sealing(): SecretsFile["sealing"] {
    return safeStorage.isEncryptionAvailable() ? "dpapi" : "plain";
  }

  async load(): Promise<Secrets> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as SecretsFile;
      this.cache = {
        encryptionKey: unseal(raw.encryptionKey, raw.sealing),
        google: raw.google && {
          clientId: raw.google.clientId,
          clientSecret: unseal(raw.google.clientSecret, raw.sealing),
        },
      };
    } catch (err) {
      // An existing file that can't be read (copied from another Windows user, damaged) is kept aside, never overwritten.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        await rename(this.file, `${this.file}.unreadable-${Date.now()}`).catch(() => undefined);
      }
      // First launch: create a new random key.
      this.cache = { encryptionKey: randomBytes(32).toString("base64") };
      await this.save();
    }
    return this.cache;
  }

  async setGoogle(google: Secrets["google"]): Promise<void> {
    const current = await this.load();
    this.cache = { ...current, google };
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    const sealing = this.sealing();
    const out: SecretsFile = {
      version: 1,
      sealing,
      encryptionKey: seal(this.cache.encryptionKey, sealing),
      google: this.cache.google && {
        clientId: this.cache.google.clientId,
        clientSecret: seal(this.cache.google.clientSecret, sealing),
      },
    };
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}
