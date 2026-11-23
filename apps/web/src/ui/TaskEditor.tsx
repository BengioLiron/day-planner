import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { IMPORTANCE_LEVELS, type Importance } from "@planner/core";
import { db } from "../data/db";
import { createProject, createTask, deleteTask, restoreTask, updateTask } from "../data/repo";
import { formatDuration } from "../lib/format";
import { useEditor, useToast } from "./context";
import { ImportanceDot } from "./TaskRow";
import { IconX } from "./icons";

const DURATIONS = [15, 30, 60, 90, 120];

interface FormState {
  name: string;
  dueDate: string;
  dueTime: string;
  importance: Importance;
  projectId: string;
  durationMin: number | null;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  dueDate: "",
  dueTime: "",
  importance: "medium",
  projectId: "",
  durationMin: null,
  notes: "",
};

export function TaskEditor() {
  const { request, close } = useEditor();
  if (!request) return null;
  return (
    <EditorDialog key={request.taskId ?? "new"} taskId={request.taskId} defaults={request.defaults} onClose={close} />
  );
}

function EditorDialog({
  taskId,
  defaults,
  onClose,
}: {
  taskId?: string;
  defaults?: Partial<FormState> | Record<string, unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const projects = useLiveQuery(() => db.projects.where("status").equals("active").toArray(), []) ?? [];
  const [form, setForm] = useState<FormState>({ ...EMPTY, ...(defaults as Partial<FormState>) });
  const [loaded, setLoaded] = useState(!taskId);
  const [newProject, setNewProject] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (!taskId) return;
    void db.tasks.get(taskId).then((task) => {
      if (!task) return onClose();
      setForm({
        name: task.name,
        dueDate: task.dueDate ?? "",
        dueTime: task.dueTime ?? "",
        importance: task.importance,
        projectId: task.projectId ?? "",
        durationMin: task.durationMin ?? null,
        notes: task.notes ?? "",
      });
      setLoaded(true);
    });
  }, [taskId, onClose]);

  useEffect(() => {
    if (loaded) nameRef.current?.focus();
  }, [loaded]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return nameRef.current?.focus();
    const input = {
      name: form.name,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      importance: form.importance,
      projectId: form.projectId || null,
      durationMin: form.durationMin,
      notes: form.notes,
    };
    if (taskId) {
      await updateTask(taskId, input);
      toast.show(t("editor.saved"));
    } else {
      await createTask(input);
      toast.show(t("editor.added"));
    }
    onClose();
  }

  function onProjectChange(value: string) {
    if (value === "__new") return setNewProject("");
    set("projectId", value);
  }

  async function addProject() {
    const name = newProject?.trim();
    if (!name) return;
    const p = await createProject(name);
    set("projectId", p.id);
    setNewProject(null);
  }

  async function remove() {
    if (!taskId) return;
    await deleteTask(taskId);
    toast.show(t("tasks.deleted"), { label: t("common.undo"), run: () => void restoreTask(taskId) });
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="editor-title"
      className="sheet-in m-0 mt-auto w-full max-w-none rounded-t-2xl bg-surface p-0 text-ink shadow-2xl backdrop:bg-[#0b1220]/45 md:m-auto md:max-w-lg md:rounded-2xl"
    >
      {loaded && (
        <form onSubmit={submit} className="flex max-h-[88dvh] flex-col">
          <header className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 id="editor-title" className="text-base font-semibold">
              {taskId ? t("editor.editTitle") : t("editor.newTitle")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2"
            >
              <IconX size={18} />
            </button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 pt-1 pb-4">
            <label className="block">
              <span className="sr-only">{t("editor.name")}</span>
              <input
                ref={nameRef}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("editor.namePlaceholder")}
                maxLength={200}
                required
                dir="auto"
                className="w-full border-b border-line bg-transparent pb-2 text-lg outline-none placeholder:text-muted/70 focus:border-accent"
              />
            </label>

            <Field label={t("editor.importance")}>
              <div role="radiogroup" className="flex gap-2">
                {IMPORTANCE_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={form.importance === lvl}
                    onClick={() => set("importance", lvl)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      form.importance === lvl ? "border-accent bg-accent-soft font-medium" : "border-line hover:bg-surface-2"
                    }`}
                  >
                    <ImportanceDot level={lvl} />
                    {t(`importance.${lvl}`)}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("editor.date")}>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set("dueDate", e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
              </Field>
              <Field label={t("editor.time")}>
                <input
                  type="time"
                  value={form.dueTime}
                  disabled={!form.dueDate}
                  onChange={(e) => set("dueTime", e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm disabled:opacity-50"
                />
              </Field>
            </div>

            <Field label={t("editor.project")}>
              {newProject !== null ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addProject();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setNewProject(null);
                      }
                    }}
                    placeholder={t("editor.newProjectPrompt")}
                    aria-label={t("editor.newProjectPrompt")}
                    dir="auto"
                    className="min-w-0 flex-1 rounded-lg border border-accent bg-surface px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void addProject()}
                    className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
                  >
                    {t("projects.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProject(null)}
                    className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <select
                  value={form.projectId}
                  onChange={(e) => onProjectChange(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                >
                  <option value="">{t("common.noProject")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__new">{t("editor.newProject")}</option>
                </select>
              )}
            </Field>

            <Field label={t("editor.duration")}>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={form.durationMin === d}
                    onClick={() => set("durationMin", form.durationMin === d ? null : d)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      form.durationMin === d ? "border-accent bg-accent-soft font-medium" : "border-line hover:bg-surface-2"
                    }`}
                  >
                    {formatDuration(d, t)}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("editor.notes")}>
              <textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                dir="auto"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <footer className="flex items-center gap-3 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {taskId && (
              <button type="button" onClick={() => void remove()} className="text-sm text-danger hover:underline">
                {t("common.delete")}
              </button>
            )}
            <div className="ms-auto flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-surface-2">
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
              >
                {taskId ? t("common.save") : t("editor.add")}
              </button>
            </div>
          </footer>
        </form>
      )}
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-muted">{label}</div>
      {children}
    </div>
  );
}
