import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { desktop } from "../desktop";
import { useEditor } from "./context";
import { IconFolder, IconGear, IconList, IconPlus, IconSpark, IconToday } from "./icons";
import { TaskEditor } from "./TaskEditor";

const NAV = [
  { to: "/", key: "today", Icon: IconToday },
  { to: "/tasks", key: "tasks", Icon: IconList },
  { to: "/planner", key: "planner", Icon: IconSpark },
  { to: "/projects", key: "projects", Icon: IconFolder },
  { to: "/settings", key: "settings", Icon: IconGear },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const editor = useEditor();

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-line px-4 py-6 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="./icon.svg" alt="" className="size-7" />
          <span className="font-semibold">{t("app.name")}</span>
        </div>
        <button
          onClick={() => editor.open()}
          className="mb-5 flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          <IconPlus size={18} />
          {t("nav.addTask")}
          <kbd className="ms-auto rounded border border-accent-ink/30 px-1.5 text-[11px] opacity-80">Q</kbd>
        </button>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? "bg-surface font-medium text-ink shadow-[0_1px_0_var(--line)]"
                    : "text-muted hover:bg-surface/60 hover:text-ink"
                }`
              }
            >
              <Icon size={19} />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-36 md:px-10 md:pt-10 md:pb-16">
        <UpdateBanner />
        {children}
      </main>

      {/* Mobile: add button + bottom bar */}
      <button
        onClick={() => editor.open()}
        aria-label={t("nav.addTask")}
        className="fixed end-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-2xl bg-accent text-accent-ink shadow-lg shadow-accent/30 md:hidden"
      >
        <IconPlus size={26} />
      </button>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "text-accent" : "text-muted"}`
            }
          >
            <Icon size={22} />
            <span className="truncate">{t(`nav.${key}`)}</span>
          </NavLink>
        ))}
      </nav>

      <TaskEditor />
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** Windows app: a new version has downloaded in the background. */
function UpdateBanner() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => desktop?.onUpdateReady((info) => setVersion(info.version)), []);
  if (!version) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">
      <span className="flex-1">{t("update.ready", { version })}</span>
      <button
        onClick={() => void desktop?.installUpdate()}
        className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink hover:opacity-90"
      >
        {t("update.restart")}
      </button>
    </div>
  );
}
