import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { toDateKey, type Task } from "@planner/core";
import { db } from "../data/db";
import { dateGroup, type DateGroup } from "../lib/format";
import { useNow } from "../lib/useNow";
import { PageHeader } from "../ui/Shell";
import { TaskRow } from "../ui/TaskRow";

const GROUPS: DateGroup[] = ["overdue", "today", "tomorrow", "upcoming", "noDate"];
const RANK = { high: 0, medium: 1, low: 2 } as const;

function byDateThenImportance(a: Task, b: Task) {
  const d = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  if (d !== 0) return d;
  const i = RANK[a.importance] - RANK[b.importance];
  return i !== 0 ? i : a.createdAt.localeCompare(b.createdAt);
}

export function MyTasksPage() {
  const { t } = useTranslation();
  const today = toDateKey(useNow());
  const [projectFilter, setProjectFilter] = useState("");
  const [showDone, setShowDone] = useState(false);

  const tasks = useLiveQuery(() => db.tasks.filter((x) => !x.deletedAt).toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  if (!tasks) return null;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const visible = tasks.filter((x) => !projectFilter || x.projectId === projectFilter);
  const open = visible.filter((x) => !x.doneAt).sort(byDateThenImportance);
  const done = visible
    .filter((x) => x.doneAt)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
    .slice(0, 50);

  const grouped = new Map<DateGroup, Task[]>();
  for (const task of open) {
    const g = dateGroup(task.dueDate, today);
    grouped.set(g, [...(grouped.get(g) ?? []), task]);
  }

  return (
    <div>
      <PageHeader
        title={t("tasks.title")}
        action={
          projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label={t("editor.project")}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">{t("tasks.filterAll")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )
        }
      />

      {open.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-muted">{t("tasks.empty")}</p>
      )}

      <div className="space-y-8">
        {GROUPS.filter((g) => grouped.has(g)).map((g) => (
          <section key={g} aria-labelledby={`group-${g}`}>
            <h2
              id={`group-${g}`}
              className={`mb-1 flex items-baseline gap-2 text-sm font-semibold ${g === "overdue" ? "text-high" : ""}`}
            >
              {t(`tasks.${g}`)}
              <span className="font-normal text-muted">{grouped.get(g)!.length}</span>
            </h2>
            <ul className="rounded-xl bg-surface px-3 shadow-[0_1px_0_var(--line)]">
              {grouped.get(g)!.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showDate={g === "upcoming" || g === "overdue"}
                  project={task.projectId ? projectById.get(task.projectId) : undefined}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {done.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowDone((v) => !v)} className="text-sm text-accent hover:underline">
            {showDone ? t("tasks.hideDone") : t("tasks.showDone", { count: done.length })}
          </button>
          {showDone && (
            <ul className="mt-2 rounded-xl bg-surface px-3 shadow-[0_1px_0_var(--line)]">
              {done.map((task) => (
                <TaskRow key={task.id} task={task} project={task.projectId ? projectById.get(task.projectId) : undefined} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
