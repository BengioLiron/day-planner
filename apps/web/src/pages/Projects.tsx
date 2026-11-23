import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project, Task } from "@planner/core";
import { db } from "../data/db";
import { createProject, PROJECT_COLORS, updateProject } from "../data/repo";
import { useEditor } from "../ui/context";
import { PageHeader } from "../ui/Shell";
import { TaskRow } from "../ui/TaskRow";
import { IconChevron, IconPlus } from "../ui/icons";

export function ProjectsPage() {
  const { t } = useTranslation();
  const projects = useLiveQuery(() => db.projects.filter((p) => !p.deletedAt).toArray(), []);
  const tasks = useLiveQuery(() => db.tasks.filter((x) => !x.deletedAt).toArray(), []);
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("open"),
  );
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]!);

  if (!projects || !tasks) return null;

  const active = projects.filter((p) => p.status === "active");
  const archived = projects.filter((p) => p.status === "archived");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await createProject(name, color);
    setName("");
    setOpenId(p.id);
  }

  return (
    <div>
      <PageHeader title={t("projects.title")} />

      <form onSubmit={submit} className="mb-8 flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("projects.namePlaceholder")}
          aria-label={t("projects.new")}
          dir="auto"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        <div role="radiogroup" aria-label="Color" className="flex gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`size-6 rounded-full ring-offset-2 ring-offset-bg ${color === c ? "ring-2 ring-ink" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
          <IconPlus size={16} />
          {t("projects.create")}
        </button>
      </form>

      {active.length === 0 && <p className="text-muted">{t("projects.empty")}</p>}

      <ul className="space-y-3">
        {active.map((p) => (
          <ProjectItem
            key={p.id}
            project={p}
            tasks={tasks.filter((x) => x.projectId === p.id)}
            open={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
          />
        ))}
      </ul>

      {archived.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-medium text-muted">{t("projects.archived")}</h2>
          <ul className="space-y-1">
            {archived.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm text-muted">
                <span className="size-2 rounded-sm" style={{ background: p.color }} />
                {p.name}
                <button
                  onClick={() => void updateProject(p.id, { status: "active" })}
                  className="ms-auto text-accent hover:underline"
                >
                  {t("projects.unarchive")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ProjectItem({
  project,
  tasks,
  open,
  onToggle,
}: {
  project: Project;
  tasks: Task[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const editor = useEditor();
  const done = tasks.filter((x) => x.doneAt).length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );

  return (
    <li className="rounded-xl bg-surface shadow-[0_1px_0_var(--line)]">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3.5 text-start">
        <span className="size-3 shrink-0 rounded" style={{ background: project.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" dir="auto">
            {project.name}
          </span>
          <span className="text-[13px] text-muted">{t("projects.progress", { done, total })}</span>
        </span>
        <span className="hidden w-32 sm:block" aria-hidden="true">
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: project.color }} />
          </span>
        </span>
        <IconChevron
          size={18}
          className={`shrink-0 text-muted transition-transform rtl:-scale-x-100 ${open ? "rotate-90 rtl:-rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          {sorted.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted">{t("projects.noTasks")}</p>
          ) : (
            <ul>
              {sorted.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
          <div className="flex items-center gap-4 px-1 pt-2">
            <button
              onClick={() => editor.open({ defaults: { projectId: project.id } })}
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <IconPlus size={16} />
              {t("nav.addTask")}
            </button>
            <button
              onClick={() => void updateProject(project.id, { status: "archived" })}
              className="ms-auto text-sm text-muted hover:text-ink"
            >
              {t("projects.archive")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
