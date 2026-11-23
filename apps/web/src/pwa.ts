import { desktop } from "./desktop";

/** Register the service worker for offline use and installation. Silently skipped where unsupported. */
export function registerPwa(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  if (desktop) return; // the Windows app ships its files and updates itself
  if (window.self !== window.top) return; // embedded previews can't own a service worker
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => undefined);
}
