import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";

type ServerModule = typeof import("./server.js");

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#eef1f5;color:#17202e}
main{max-width:28rem;padding:2rem}h1{font-size:1.4rem}</style></head><body><main><h1>${title}</h1><p>${escape(body)}</p></main></body></html>`;

/**
 * Google Calendar sign-in for the desktop app. Google doesn't allow signing in
 * inside an embedded app window, so this opens the system browser and listens
 * on a one-time loopback address (127.0.0.1, random port) for Google's reply.
 * The Google client must be of type "Desktop app", which accepts any loopback port.
 */
export async function connectGoogle(server: ServerModule, userId: string): Promise<void> {
  const state = randomBytes(16).toString("hex");
  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google sign-in timed out. Try again.")), 5 * 60_000);
      http.on("request", async (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const finish = (ok: boolean, message: string) => {
          res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            ok
              ? page("Google Calendar connected", "You can close this tab and go back to Day Planner.")
              : page("Google Calendar wasn't connected", message),
          );
          clearTimeout(timer);
        };
        if (url.searchParams.get("state") !== state || !code) {
          const denied = url.searchParams.get("error") === "access_denied";
          const message = denied
            ? "Access wasn't granted. You can try again from Settings."
            : "The sign-in reply didn't match. Try again from Settings.";
          finish(false, message);
          reject(new Error(message));
          return;
        }
        try {
          await server.saveGoogleConnection(userId, await server.exchangeCode(code, redirectUri));
          finish(true, "");
          resolve();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          finish(false, message);
          reject(new Error(message));
        }
      });
    });
    await shell.openExternal(server.googleAuthUrl(state, redirectUri));
    await done;
  } finally {
    http.close();
  }
}
