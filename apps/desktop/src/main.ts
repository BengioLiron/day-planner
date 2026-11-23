import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
  Tray,
} from "electron";
import { autoUpdater } from "electron-updater";
import { connectGoogle } from "./google.js";
import { SecretStore } from "./secrets.js";

/**
 * Day Planner for Windows.
 *
 * The web app and its API run inside this process. The window loads
 * app://planner/, and every request to that address is answered by the API
 * server's handler directly: no network port is opened, so nothing else on
 * the computer or the network can reach your data.
 */

const SCHEME = "app";
const ORIGIN = `${SCHEME}://planner`;
const USER_ID = "local";
const QUICK_ADD_SHORTCUT = "CommandOrControl+Shift+Space";

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId("com.dayplanner.app");

/* ---------------- Paths ---------------- */

const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..");
const webDist = app.isPackaged ? join(process.resourcesPath, "web") : join(__dirname, "../../web/dist");
const iconFile = (name: string) => join(resources, app.isPackaged ? "icons" : "build", name);
/** Only installers built by GitHub Actions know where releases live (see electron-builder.config.cjs). */
const canUpdate = () => app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));

/* ---------------- State ---------------- */

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let updateReady: { version: string } | null = null;
let server: typeof import("./server.js") | null = null;
const secrets = new SecretStore(join(app.getPath("userData"), "secrets.json"));
const startHidden = process.argv.includes("--hidden");

/* ---------------- Server ---------------- */

async function startServer(): Promise<void> {
  const s = await secrets.load();
  Object.assign(process.env, {
    DATA_FILE: join(app.getPath("userData"), "store.json"),
    WEB_DIST: webDist,
    PUBLIC_URL: ORIGIN,
    WEB_ORIGIN: ORIGIN,
    ENCRYPTION_KEY: s.encryptionKey,
    APP_PASSWORD: "", // no sign-in: the app can only be reached from its own window
  });
  if (s.google) {
    process.env.GOOGLE_CLIENT_ID = s.google.clientId;
    process.env.GOOGLE_CLIENT_SECRET = s.google.clientSecret;
  }
  server = await import("./server.js");
  const handler = server.server;
  protocol.handle(SCHEME, async (request) => {
    const res = await handler.fetch(request);
    // Hand Electron a buffered copy: the file server answers with a Node.js
    // stream, which Electron's protocol handler doesn't accept. Files are small.
    const empty = request.method === "HEAD" || res.status === 204 || res.status === 304;
    const headers = new Headers(res.headers);
    // Web-only headers: Origin-Agent-Cluster crashes Chromium on a custom scheme,
    // and HSTS means nothing here.
    headers.delete("origin-agent-cluster");
    headers.delete("strict-transport-security");
    return new Response(empty ? null : await res.arrayBuffer(), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });
}

/* ---------------- Window ---------------- */

function showWindow(): void {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Day Planner",
    icon: iconFile("icon.png"),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#10151d" : "#eef1f5",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.setMenu(null);
  void win.loadURL(`${ORIGIN}/`);
  win.once("ready-to-show", () => {
    if (!startHidden) win?.show();
  });

  // Links to other sites open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${ORIGIN}/`)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // Closing the window keeps the app in the tray, so the shortcut keeps working.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  win.on("closed", () => {
    win = null;
  });
}

function quickAdd(): void {
  showWindow();
  win?.webContents.send("quick-add");
}

/* ---------------- Tray ---------------- */

function trayMenu(): Menu {
  const login = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: "Open Day Planner", click: showWindow },
    // The shortcut is shown in the label: tray menus don't display accelerators on every system.
    { label: "Add task    Ctrl+Shift+Space", click: quickAdd },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: login.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
      },
    },
    {
      label: updateReady ? `Restart to update to ${updateReady.version}` : "Check for updates",
      click: () => void manualUpdateCheck(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconFile("tray.png"));
  tray = new Tray(image);
  tray.setToolTip("Day Planner");
  tray.setContextMenu(trayMenu());
  tray.on("click", showWindow);
}

function refreshTray(): void {
  tray?.setContextMenu(trayMenu());
}

/* ---------------- Updates ---------------- */

function setupUpdates(): void {
  if (!canUpdate()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = { version: info.version };
    win?.webContents.send("update-ready", updateReady);
    refreshTray();
  });
  autoUpdater.on("error", (err) => console.error("Update check failed:", err.message));
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 6 * 60 * 60_000);
}

function installUpdate(): void {
  quitting = true;
  autoUpdater.quitAndInstall(false, true);
}

async function manualUpdateCheck(): Promise<void> {
  if (updateReady) return installUpdate();
  if (!canUpdate()) {
    void dialog.showMessageBox({
      message: "This copy doesn't update itself.",
      detail: "Install Day Planner from the GitHub release to get automatic updates.",
    });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo.version;
    if (!latest || latest === app.getVersion()) {
      void dialog.showMessageBox({ message: "Day Planner is up to date.", detail: `Version ${app.getVersion()}` });
    } else {
      void dialog.showMessageBox({
        message: `Version ${latest} is downloading.`,
        detail: "You'll be asked to restart when it's ready.",
      });
    }
  } catch (err) {
    void dialog.showMessageBox({
      type: "warning",
      message: "Couldn't check for updates.",
      detail: `${err instanceof Error ? err.message : String(err)}\n\nCheck your internet connection and try again.`,
    });
  }
}

/* ---------------- Bridge to the web app (see preload.ts) ---------------- */

type Result = { ok: true } | { ok: false; error: string };
const fail = (err: unknown): Result => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

function setupIpc(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:status", () => updateReady);
  ipcMain.handle("update:install", () => installUpdate());

  ipcMain.handle("google:client-status", async () => ({ configured: Boolean((await secrets.load()).google) }));

  ipcMain.handle("google:set-client", async (_e, input: unknown): Promise<Result> => {
    const { clientId, clientSecret } = (input ?? {}) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof clientId !== "string" || !clientId.trim().endsWith(".apps.googleusercontent.com")) {
      return { ok: false, error: "The client ID should end with .apps.googleusercontent.com." };
    }
    if (typeof clientSecret !== "string" || clientSecret.trim().length < 10) {
      return { ok: false, error: "Paste the client secret from the same Google client." };
    }
    await secrets.setGoogle({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    process.env.GOOGLE_CLIENT_ID = clientId.trim();
    process.env.GOOGLE_CLIENT_SECRET = clientSecret.trim();
    return { ok: true };
  });

  ipcMain.handle("google:connect", async (): Promise<Result> => {
    if (!server) return { ok: false, error: "The app is still starting. Try again in a moment." };
    if (!(await secrets.load()).google) return { ok: false, error: "Set up the Google client first." };
    try {
      await connectGoogle(server, USER_ID);
      showWindow();
      return { ok: true };
    } catch (err) {
      showWindow();
      return fail(err);
    }
  });
}

/* ---------------- Start ---------------- */

app.on("second-instance", showWindow);

app.on("before-quit", () => {
  quitting = true;
});

// Stay running in the tray when the window is closed.
app.on("window-all-closed", () => undefined);

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

void app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    dialog.showErrorBox(
      "Day Planner couldn't start",
      `${err instanceof Error ? err.message : String(err)}\n\nYour data is in ${app.getPath("userData")}.`,
    );
    app.exit(1);
    return;
  }
  setupIpc();
  createWindow();
  createTray();
  if (!globalShortcut.register(QUICK_ADD_SHORTCUT, quickAdd)) {
    console.warn(`The shortcut ${QUICK_ADD_SHORTCUT} is taken by another app.`);
  }
  setupUpdates();
});
