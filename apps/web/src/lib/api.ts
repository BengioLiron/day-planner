/**
 * The API is on the same address as the app (Railway, the desktop app) or
 * behind the dev server's proxy. Without a server the health check fails and
 * the app runs in local mode with the sample calendar and a demo planner.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

/** Absolute URL for links that leave the app, e.g. the Google sign-in redirect. */
export const apiUrl = (path: string) => `${BASE}${path}`;

/** Always try: when the health check fails, the app simply stays in local mode. */
export const serverConfigured = true;

/** Fired when the server answers 401, so the app can show the sign-in screen. */
export const AUTH_REQUIRED_EVENT = "dp:auth-required";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 25_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, "offline");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown, timeoutMs?: number) => request<T>("POST", path, body, timeoutMs),
  del: (path: string) => request<void>("DELETE", path),
};

/** True when the API server answers. Cached for the session. */
let health: Promise<boolean> | null = null;
export function serverAvailable(): Promise<boolean> {
  if (!serverConfigured) return Promise.resolve(false);
  health ??= api
    .get<{ ok: boolean }>("/api/health")
    .then((r) => r?.ok === true)
    .catch(() => false);
  return health;
}

export interface AuthStatus {
  required: boolean;
  signedIn: boolean;
}

export const auth = {
  status: () => api.get<AuthStatus>("/api/auth/status"),
  login: (password: string) => api.post<{ signedIn: boolean }>("/api/auth/login", { password }),
  logout: () => api.post<{ signedIn: boolean }>("/api/auth/logout", {}),
};
