import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/**
 * The only desktop features the web app can reach: a small, fixed set of
 * calls. The page gets no Node.js or file access.
 */

type Result = { ok: true } | { ok: false; error: string };
type UpdateInfo = { version: string };

const bridge = {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),

  onQuickAdd(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on("quick-add", handler);
    return () => ipcRenderer.removeListener("quick-add", handler);
  },

  onUpdateReady(callback: (info: UpdateInfo) => void): () => void {
    const handler = (_e: IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on("update-ready", handler);
    // An update may have finished downloading before the page subscribed.
    void ipcRenderer.invoke("update:status").then((info: UpdateInfo | null) => info && callback(info));
    return () => ipcRenderer.removeListener("update-ready", handler);
  },

  installUpdate: (): Promise<void> => ipcRenderer.invoke("update:install"),

  google: {
    status: (): Promise<{ configured: boolean }> => ipcRenderer.invoke("google:client-status"),
    setClient: (clientId: string, clientSecret: string): Promise<Result> =>
      ipcRenderer.invoke("google:set-client", { clientId, clientSecret }),
    connect: (): Promise<Result> => ipcRenderer.invoke("google:connect"),
  },
};

export type DesktopBridge = typeof bridge;

contextBridge.exposeInMainWorld("desktop", bridge);
