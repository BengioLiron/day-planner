import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { refreshCalendar } from "./calendar";
import { syncCalendarStatus } from "./calendar/status";
import { startSync } from "./data/sync";
import { applyLanguage } from "./i18n";
import { AUTH_REQUIRED_EVENT, auth, serverAvailable } from "./lib/api";
import { EditorProvider, ToastProvider, useSettings } from "./ui/context";
import { Shell } from "./ui/Shell";
import { TodayPage } from "./pages/Today";
import { MyTasksPage } from "./pages/MyTasks";
import { PlannerPage } from "./pages/Planner";
import { ProjectsPage } from "./pages/Projects";
import { SettingsPage } from "./pages/Settings";
import { SignInPage } from "./pages/SignIn";

function useAppearance() {
  const { language, theme } = useSettings();

  useEffect(() => applyLanguage(language), [language]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

type Gate = "checking" | "signIn" | "open";

/**
 * Decide whether to show the sign-in screen. Only a server that answers and
 * says "sign in" blocks the app; offline, the app opens with the data on this
 * device, so it keeps working on the go.
 */
function useSignInGate(): [Gate, () => void] {
  const [gate, setGate] = useState<Gate>("checking");

  useEffect(() => {
    let alive = true;
    void (async () => {
      let next: Gate = "open";
      if (await serverAvailable()) {
        try {
          const s = await auth.status();
          if (s.required && !s.signedIn) next = "signIn";
        } catch {
          /* unreachable: open in local mode */
        }
      }
      if (alive) setGate(next);
    })();
    const onRequired = () => setGate("signIn");
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => {
      alive = false;
      window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
    };
  }, []);

  return [gate, () => setGate("open")];
}

export function App() {
  useAppearance();
  const [gate, signedIn] = useSignInGate();

  if (gate === "checking") return null;
  if (gate === "signIn") return <SignInPage onSignedIn={signedIn} />;
  return <SignedInApp />;
}

function SignedInApp() {
  useEffect(() => {
    void syncCalendarStatus()
      .catch(() => undefined) // offline or no server: keep the last known status
      .then(refreshCalendar)
      .catch(() => undefined);
    const id = window.setInterval(() => void refreshCalendar().catch(() => undefined), 5 * 60_000);
    const stopSync = startSync();
    return () => {
      window.clearInterval(id);
      stopSync();
    };
  }, []);

  return (
    <HashRouter>
      <ToastProvider>
        <EditorProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/tasks" element={<MyTasksPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </EditorProvider>
      </ToastProvider>
    </HashRouter>
  );
}
