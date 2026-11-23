function read(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}. See apps/api/.env.example.`);
}

const production = process.env.NODE_ENV === "production";

/** The address people open. Railway provides RAILWAY_PUBLIC_DOMAIN; PUBLIC_URL overrides it. */
const publicUrl = (
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:8787")
).replace(/\/$/, "");

export const env = {
  production,
  port: Number(read("PORT", "8787")),
  publicUrl,
  /** Where the web app runs. In production it's served by this server, so it's the same address. */
  webOrigin: read("WEB_ORIGIN", production ? publicUrl : "http://localhost:5173"),
  dataFile: read("DATA_FILE", "./data/store.json"),
  /** The built web app to serve (apps/web/dist). Empty = API only. */
  webDist: process.env.WEB_DIST ?? "",
  /** Sign-in password. Required in production; when unset in development, sign-in is off. */
  appPassword: process.env.APP_PASSWORD ?? "",
  /** Read lazily so the server can start (and serve the demo) before secrets are configured. */
  encryptionKey: () => read("ENCRYPTION_KEY"),
  google: {
    clientId: () => read("GOOGLE_CLIENT_ID"),
    clientSecret: () => read("GOOGLE_CLIENT_SECRET"),
    redirectUri: () => read("GOOGLE_REDIRECT_URI", `${publicUrl}/api/calendar/google/callback`),
  },
};

/** Refuse to start in production with settings that would leave data exposed or unreadable. */
export function checkProductionEnv(): void {
  if (!production) return;
  const problems: string[] = [];
  if (env.appPassword.length < 12) problems.push("APP_PASSWORD must be set, at least 12 characters.");
  try {
    if (Buffer.from(env.encryptionKey(), "base64").length !== 32) throw new Error();
  } catch {
    problems.push("ENCRYPTION_KEY must be 32 random bytes, base64-encoded.");
  }
  if (problems.length) {
    throw new Error(`Can't start in production:\n- ${problems.join("\n- ")}`);
  }
}
