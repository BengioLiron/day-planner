import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "./env.js";

/**
 * Single-user sign-in: one password (APP_PASSWORD) and a signed session cookie.
 * The cookie is HttpOnly, so page scripts can't read it, and SameSite=Lax.
 * Changing APP_PASSWORD signs out every device, because the signing key
 * includes it. Supabase Auth replaces this when the app goes public.
 */

export const SESSION_COOKIE = "dp_session";
const SESSION_DAYS = 90;

export function authEnabled(): boolean {
  return env.appPassword !== "";
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function signingKey(): Buffer {
  // Derived from both secrets: the encryption key keeps it unguessable, the password ties it to the current password.
  return createHmac("sha256", env.encryptionKey()).update(`session:${env.appPassword}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + SESSION_DAYS * 86_400_000 })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function passwordMatches(given: string): boolean {
  // Compare fixed-length digests so the time taken doesn't reveal anything.
  return timingSafeEqual(sha256(given), sha256(env.appPassword));
}

export function setSession(c: Context): void {
  setCookie(c, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: env.production,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function isSignedIn(c: Context): boolean {
  return !authEnabled() || verifySessionToken(getCookie(c, SESSION_COOKIE));
}

/* ---------------- Brute-force protection ---------------- */

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function clientIp(c: Context): string {
  // Railway and most hosts put the real address first in X-Forwarded-For.
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Returns seconds to wait when this address has failed too often, else 0. */
export function lockedFor(ip: string, now = Date.now()): number {
  const a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) return 0;
  return a.count >= MAX_ATTEMPTS ? Math.ceil((a.first + WINDOW_MS - now) / 1000) : 0;
}

export function recordFailure(ip: string, now = Date.now()): void {
  const a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else a.count++;
}

export function clearFailures(ip: string): void {
  attempts.delete(ip);
}

/* ---------------- Middleware ---------------- */

/** Paths that work without signing in. */
const OPEN = new Set(["/api/health", "/api/auth/login", "/api/auth/status", "/api/calendar/google/callback"]);

export const requireSession: MiddlewareHandler = async (c, next) => {
  if (OPEN.has(c.req.path) || isSignedIn(c)) return next();
  return c.json({ error: "Sign in to continue." }, 401);
};
