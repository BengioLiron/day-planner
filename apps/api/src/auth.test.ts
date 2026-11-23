import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

// Sign-in turned on, with an isolated store. Set before the app modules load.
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "planner-auth-")), "store.json");
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.APP_PASSWORD = "correct-horse-battery";

const { app } = await import("./app.js");
const { createSessionToken, verifySessionToken, lockedFor, recordFailure } = await import("./auth.js");

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...extra },
  body: JSON.stringify(body),
});

function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0] ?? "";
}

describe("sign-in", () => {
  it("keeps health and status open, everything else closed", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
    expect(await (await app.request("/api/auth/status")).json()).toEqual({ required: true, signedIn: false });
    expect((await app.request("/api/sync/pull")).status).toBe(401);
    expect((await app.request("/api/calendar/status")).status).toBe(401);
    expect((await app.request("/api/planner/breakdown", json({}))).status).toBe(401);
  });

  it("rejects a wrong password and sets no cookie", async () => {
    const res = await app.request("/api/auth/login", json({ password: "nope" }, { "x-forwarded-for": "10.0.0.1" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("signs in, opens protected routes, and signs out", async () => {
    const res = await app.request(
      "/api/auth/login",
      json({ password: "correct-horse-battery" }, { "x-forwarded-for": "10.0.0.2" }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = cookieFrom(res);

    expect((await app.request("/api/sync/pull", { headers: { cookie } })).status).toBe(200);
    expect(await (await app.request("/api/auth/status", { headers: { cookie } })).json()).toEqual({
      required: true,
      signedIn: true,
    });

    const out = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("refuses tampered and expired sessions", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
    const [payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, iat: 0, exp: Date.now() * 2 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${mac}`)).toBe(false);
    expect(verifySessionToken(`${payload}.${mac}x`)).toBe(false);
    expect(verifySessionToken(token, Date.now() + 91 * 86_400_000)).toBe(false);
  });

  it("locks an address out after repeated failures", async () => {
    const ip = "10.0.0.9";
    for (let i = 0; i < 8; i++) {
      await app.request("/api/auth/login", json({ password: "guess" }, { "x-forwarded-for": ip }));
    }
    const res = await app.request(
      "/api/auth/login",
      json({ password: "correct-horse-battery" }, { "x-forwarded-for": ip }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // Other addresses are unaffected.
    expect(lockedFor("10.0.0.10")).toBe(0);
  });

  it("forgets failures after the 15-minute window", () => {
    const ip = "10.0.0.20";
    const t0 = Date.now();
    for (let i = 0; i < 8; i++) recordFailure(ip, t0);
    expect(lockedFor(ip, t0)).toBeGreaterThan(0);
    expect(lockedFor(ip, t0 + 16 * 60_000)).toBe(0);
  });
});
