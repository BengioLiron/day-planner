/**
 * Features the Windows app adds (see apps/desktop/src/preload.ts).
 * Undefined in a browser, so every use is optional.
 */
type Result = { ok: true } | { ok: false; error: string };

export interface DesktopBridge {
  platform: string;
  getVersion(): Promise<string>;
  onQuickAdd(callback: () => void): () => void;
  onUpdateReady(callback: (info: { version: string }) => void): () => void;
  installUpdate(): Promise<void>;
  google: {
    status(): Promise<{ configured: boolean }>;
    setClient(clientId: string, clientSecret: string): Promise<Result>;
    connect(): Promise<Result>;
  };
}

export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop;
