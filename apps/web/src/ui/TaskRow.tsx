import { useTranslation } from "react-i18next";
import type { Importance, Project, Task } from "@planner/core";
import { setTaskDone } from "../data/repo";
import { formatDuration, shortDate } from "../lib/format";
import { useEditor, useToast } from "./context";
import { IconCheck } from "./icons";

export function ImportanceDot({ level, className = "" }: { level: Importance; className?: string }) {
  const { t } = useTranslation();
  const color = { high: "bg-high", medium: "bg-medium", low: "bg-low" }[level];
  return (
    <span
      role="img"
      aria-label={t(`importance.${level}`)}
      title={t(`importance.${level}`)}
      className={`inline-block size-2 shrink-0 rounded-full ${color} ${className}`}
    />
  );
}

export function DoneCheckbox({ task, label }: { task: Task; label?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const done = Boolean(task.doneAt);
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={label ?? `${t("today.markDone")}: ${task.name}`}
      onClick={async (e) => {
        e.stopPropagation();
        await setTaskDone(task.id, !done);
        if (!done) {
          toast.show(t("tasks.completed"), {
            label: t("common.undo"),
            run: () => void setTaskDone(task.id, false),
          });
        }
      }}
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors ${
        done
          ? "border-accent bg-accent text-accent-ink"
          : "border-muted/60 text-transparent hover:border-accent hover:text-accent/60"
      }`}
    >
      <IconCheck size={14} strokeWidth={2.6} />
    </button>
  );
}

export function TaskRow({ task, project, showDate = true }: { task: Task; project?: Project; showDate?: boolean }) {
  const { t, i18n } = useTranslation();
  const editor = useEditor();
  const done = Boolean(task.doneAt);

  const meta: string[] = [];
  if (showDate && task.dueDate)
    meta.push(shortDate(task.dueDate, i18n.language) + (task.dueTime ? ` ${task.dueTime}` : ""));
  if (task.durationMin) meta.push(formatDuration(task.durationMin, t));

  return (
    <li className="group flex items-start gap-3 border-b border-line px-1 py-3 last:border-b-0">
      <div className="pt-0.5">
        <DoneCheckbox task={task} />
      </div>
      <button
        className="min-w-0 flex-1 text-start"
        onClick={() => editor.open({ taskId: task.id })}
        aria-label={`${t("common.edit")}: ${task.name}`}
      >
        <span className={`flex items-center gap-2 ${done ? "text-muted line-through" : ""}`}>
          <ImportanceDot level={task.importance} />
          <span className="truncate" dir="auto">
            {task.name}
          </span>
        </span>
        {(meta.length > 0 || project) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 ps-4 text-[13px] text-muted">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
            {project && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-sm" style={{ background: project.color }} />
                {project.name}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}
