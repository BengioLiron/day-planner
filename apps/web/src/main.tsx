import "./zod-setup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./i18n";
import { applyLanguage } from "./i18n";
import { getSettings } from "./data/db";
import { seedOnFirstRun } from "./data/seed";
import { registerPwa } from "./pwa";
import { App } from "./App";
import { desktop } from "./desktop";

async function boot() {
  try {
    const guess = navigator.language.toLowerCase().startsWith("he") ? "he" : "en";
    // The installed Windows app starts empty; the web preview starts with sample tasks.
    await seedOnFirstRun(guess, !desktop);
    applyLanguage((await getSettings()).language);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the app still renders.
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  registerPwa();
}

void boot();
