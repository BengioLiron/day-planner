import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { AiConnectionSchema, type Project, type Task } from "@planner/core";
import { breakdownMission, PlannerRequestSchema } from "./ai/planner.js";
import { testConnection } from "./ai/providers.js";
import {
  authEnabled,
  clearFailures,
  clearSession,
  clientIp,
  isSignedIn,
  lockedFor,
  passwordMatches,
  recordFailure,
  requireSession,
  setSession,
} from "./auth.js";
import { AppleCalendarProvider } from "./calendar/apple.js";
import { exchangeCode, googleAuthUrl } from "./calendar/google.js";
import { providerForUser, saveGoogleConnection } from "./calendar/index.js";
import { decrypt, encrypt } from "./crypto.js";
import { env } from "./env.js";
import { store } from "./store.js";

type Vars = { Variables: { userId: string } };

export const app = new Hono<Vars>();

app.use(
  "*",
  secureHeaders({
    // The app loads its own files plus Google Fonts; API calls stay on this address.
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// Only needed when the web app runs on another address (local development).
if (env.webOrigin !== env.publicUrl) app.use("/api/*", cors({ origin: env.webOrigin, credentials: true }));

/** Password check on every API route except the few that must stay open (see auth.ts). */
app.use("/api/*", requireSession);

/**
 * Who is calling. v1 has one user. Supabase Auth replaces this when the app
 * goes public: verify the session and set that user's id.
 */
app.use("/api/*", async (c, next) => {
  c.set("userId", "local");
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
  const status = (err as { status?: number }).status;
  console.error(err);
  return c.json({ error: err.message || "Server error" }, (status ?? 500) as 400);
});

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return schema.parse(await c.req.json());
}

/* ---------------- Health and sign-in ---------------- */

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/auth/status", (c) => c.json({ required: authEnabled(), signedIn: isSignedIn(c) }));

app.post("/api/auth/login", async (c) => {
  const ip = clientIp(c);
  const wait = lockedFor(ip);
  if (wait > 0) {
    c.header("Retry-After", String(wait));
    throw new HTTPException(429, { message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` });
  }
  const { password } = await body(c, z.object({ password: z.string().max(200) }));
  if (!authEnabled() || !passwordMatches(password)) {
    recordFailure(ip);
    throw new HTTPException(401, { message: "Wrong password." });
  }
  clearFailures(ip);
  setSession(c);
  return c.json({ signedIn: true });
});

app.post("/api/auth/logout", (c) => {
  clearSession(c);
  return c.json({ signedIn: false });
});

/* ---------------- AI: bring your own model ---------------- */

app.post("/api/ai/connection", async (c) => {
  const conn = await body(c, AiConnectionSchema);
  try {
    await testConnection(conn);
  } catch (e) {
    const name = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" }[conn.provider];
    throw new HTTPException(400, { message: `The ${name} key or model didn't work: ${(e as Error).message}` });
  }
  await store.updateUser(c.get("userId"), (u) => {
    u.ai = { provider: conn.provider, model: conn.model, apiKey: encrypt(conn.apiKey) };
  });
  return c.json({ provider: conn.provider, model: conn.model, connected: true });
});

app.delete("/api/ai/connection", async (c) => {
  await store.updateUser(c.get("userId"), (u) => {
    delete u.ai;
  });
  return c.body(null, 204);
});

app.post("/api/planner/breakdown", async (c) => {
  const req = await body(c, PlannerRequestSchema);
  const user = await store.getUser(c.get("userId"));
  if (!user.ai) throw new HTTPException(409, { message: "No AI model is connected." });
  const conn = { provider: user.ai.provider, model: user.ai.model, apiKey: decrypt(user.ai.apiKey) };
  return c.json(
    await breakdownMission(conn, req.input, req.history, req.context, {
      research: req.research ?? null,
      previousPlan: req.previousPlan ?? null,
    }),
  );
});

/* ---------------- Calendar ---------------- */

/** Pending Google sign-ins: state → userId. Short-lived, in memory. */
const oauthStates = new Map<string, { userId: string; at: number }>();

app.get("/api/calendar/google/auth", (c) => {
  const state = randomBytes(16).toString("hex");
  oauthStates.set(state, { userId: c.get("userId"), at: Date.now() });
  return c.redirect(googleAuthUrl(state));
});

app.get("/api/calendar/google/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  const back = new URL(env.webOrigin);
  back.pathname = "/";
  back.hash = "/settings";
  if (!pending || Date.now() - pending.at > 10 * 60_000 || !c.req.query("code")) {
    back.searchParams.set("calendar", "error");
    return c.redirect(back.href);
  }
  await saveGoogleConnection(pending.userId, await exchangeCode(c.req.query("code")!));
  back.searchParams.set("calendar", "google");
  return c.redirect(back.href);
});

app.post("/api/calendar/apple/connect", async (c) => {
  const creds = await body(c, z.object({ appleId: z.email(), appPassword: z.string().min(8).max(64) }));
  const apple = new AppleCalendarProvider(creds);
  await apple.verify();
  const first = (await apple.listCalendars())[0];
  await store.updateUser(c.get("userId"), (u) => {
    u.calendar = { provider: "apple", credentials: encrypt(JSON.stringify(creds)), writeCalendarId: first?.id };
  });
  return c.json({ connected: true });
});

app.post("/api/calendar/disconnect", async (c) => {
  await store.updateUser(c.get("userId"), (u) => {
    delete u.calendar;
  });
  return c.json({ connected: false });
});

async function calendarOrThrow(userId: string) {
  const p = await providerForUser(userId);
  if (!p) throw new HTTPException(409, { message: "No calendar is connected." });
  return p;
}

app.get("/api/calendar/status", async (c) => {
  const user = await store.getUser(c.get("userId"));
  return c.json({ provider: user.calendar?.provider ?? null, writeCalendarId: user.calendar?.writeCalendarId ?? null });
});

app.get("/api/calendar/calendars", async (c) => c.json(await (await calendarOrThrow(c.get("userId"))).listCalendars()));

app.get("/api/calendar/events", async (c) => {
  const q = z
    .object({ from: z.iso.datetime(), to: z.iso.datetime(), calendars: z.string().optional() })
    .parse(c.req.query());
  const ids = q.calendars ? q.calendars.split(",").filter(Boolean) : [];
  const provider = await calendarOrThrow(c.get("userId"));
  return c.json(await provider.listEvents(ids, new Date(q.from), new Date(q.to)));
});

app.post("/api/calendar/blocks", async (c) => {
  const block = await body(
    c,
    z.object({
      calendarId: z.string(),
      title: z.string().min(1).max(200),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      taskId: z.string(),
    }),
  );
  const user = await store.getUser(c.get("userId"));
  const calendarId = user.calendar?.writeCalendarId ?? block.calendarId;
  const provider = await calendarOrThrow(c.get("userId"));
  return c.json(await provider.createBlock({ ...block, calendarId }), 201);
});

app.delete("/api/calendar/blocks/:calendarId/:eventId", async (c) => {
  const user = await store.getUser(c.get("userId"));
  const calendarId = user.calendar?.writeCalendarId ?? c.req.param("calendarId");
  await (await calendarOrThrow(c.get("userId"))).deleteBlock(calendarId, c.req.param("eventId"));
  return c.body(null, 204);
});

/* ---------------- Sync ---------------- */

/** Push local rows; the newest updatedAt wins per row. */
app.post("/api/sync/push", async (c) => {
  const { tasks, projects } = await body(
    c,
    z.object({
      tasks: z.array(z.record(z.string(), z.unknown())).max(500),
      projects: z.array(z.record(z.string(), z.unknown())).max(500),
    }),
  );
  const user = await store.updateUser(c.get("userId"), (u) => {
    for (const t of tasks as unknown as Task[]) {
      const cur = u.tasks[t.id];
      if (!cur || cur.updatedAt <= t.updatedAt) u.tasks[t.id] = { ...t, userId: c.get("userId") };
    }
    for (const p of projects as unknown as Project[]) {
      const cur = u.projects[p.id];
      if (!cur || cur.updatedAt <= p.updatedAt) u.projects[p.id] = { ...p, userId: c.get("userId") };
    }
  });
  return c.json({ tasks: Object.keys(user.tasks).length, projects: Object.keys(user.projects).length });
});

app.get("/api/sync/pull", async (c) => {
  const since = c.req.query("since") ?? "";
  const user = await store.getUser(c.get("userId"));
  return c.json({
    tasks: Object.values(user.tasks).filter((t) => t.updatedAt > since),
    projects: Object.values(user.projects).filter((p) => p.updatedAt > since),
  });
});

/* ---------------- The web app ---------------- */

/**
 * In production this server also serves the built web app, so the app and
 * its API share one address (no CORS, cookies just work). The app uses
 * hash-based routes, so every page is index.html.
 */
if (env.webDist) {
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    // The service worker and the page must never be cached, or updates would stall.
    if (c.req.path === "/" || c.req.path.endsWith(".html") || c.req.path === "/sw.js") {
      c.header("Cache-Control", "no-cache");
    } else if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable"); // file names carry a content hash
    }
    await next();
  });
  const files = serveStatic({ root: env.webDist });
  const page = serveStatic({ root: env.webDist, path: "index.html" });
  app.use("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : files(c, next)));
  app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : page(c, next)));
}

app.notFound((c) => c.json({ error: "Not found" }, 404));
