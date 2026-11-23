import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import type { PlannerInput, PlannerMessage, ProposedTask } from "@planner/core";
import { runPlanner } from "../ai/client";
import { db } from "../data/db";
import { createProject, createTask } from "../data/repo";
import { formatDuration } from "../lib/format";
import { useToast } from "../ui/context";
import { PageHeader } from "../ui/Shell";
import { ImportanceDot } from "../ui/TaskRow";
import { IconArrowUp, IconMic, IconX } from "../ui/icons";

interface Draft {
  projectName: string;
  summary: string;
  tasks: (ProposedTask & { key: string })[];
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

export function PlannerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const projects = useLiveQuery(() => db.projects.where("status").equals("active").toArray(), []) ?? [];

  const [messages, setMessages] = useState<PlannerMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState<string>("new");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Every message, typed now or spoken in v1.1, goes through here. */
  async function submit(input: PlannerInput, shown: string) {
    const history = messages;
    setMessages([...history, { role: "user", content: shown }]);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const res = await runPlanner(input, history);
      setDemo(res.demo);
      const r = res.result;
      if (r.type === "questions") {
        setMessages((m) => [...m, { role: "assistant", content: r.questions.join("\n") }]);
        inputRef.current?.focus();
      } else {
        setDraft({
          projectName: r.projectName,
          summary: r.summary,
          tasks: r.tasks.map((x) => ({ ...x, key: crypto.randomUUID() })),
        });
        setMessages((m) => [...m, { role: "assistant", content: r.summary }]);
      }
    } catch (e) {
      setError(t("planner.error", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    void submit({ kind: "text", text: value }, value);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  function reset() {
    setMessages([]);
    setDraft(null);
    setError(null);
    setDemo(false);
    setTarget("new");
    inputRef.current?.focus();
  }

  async function save() {
    if (!draft || draft.tasks.length === 0) return;
    const project =
      target === "new"
        ? await createProject(draft.projectName || t("planner.title"))
        : projects.find((p) => p.id === target);
    if (!project) return;
    for (const task of draft.tasks) {
      await createTask({
        name: task.name,
        notes: task.notes,
        dueDate: task.dueDate,
        importance: task.importance,
        durationMin: task.durationMin,
        projectId: project.id,
        source: "ai_planner",
      });
    }
    toast.show(t("planner.saved", { count: draft.tasks.length, project: project.name }));
    navigate(`/projects?open=${project.id}`);
  }

  const updateTask = (key: string, patch: Partial<ProposedTask>) =>
    setDraft((d) => d && { ...d, tasks: d.tasks.map((x) => (x.key === key ? { ...x, ...patch } : x)) });

  const started = messages.length > 0;

  return (
    <div>
      <PageHeader
        title={t("planner.title")}
        sub={!started ? t("planner.intro") : undefined}
        action={
          started && (
            <button onClick={reset} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink">
              {t("planner.startOver")}
            </button>
          )
        }
      />

      {started && (
        <ol className="mb-6 space-y-3">
          {messages.map((m, i) => (
            <li key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                dir="auto"
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-line ${
                  m.role === "user" ? "bg-accent text-accent-ink" : "bg-surface shadow-[0_1px_0_var(--line)]"
                }`}
              >
                {m.content}
              </div>
            </li>
          ))}
          {busy && (
            <li className="text-sm text-muted" aria-live="polite">
              {t("planner.sending")}
            </li>
          )}
        </ol>
      )}

      {demo && draft && (
        <p className="mb-4 rounded-xl border border-medium/40 bg-medium/10 px-4 py-3 text-sm">{t("planner.demoNotice")}</p>
      )}
      {error && <p className="mb-4 rounded-xl border border-high/40 bg-high/10 px-4 py-3 text-sm">{error}</p>}

      {draft ? (
        <section aria-labelledby="review-title" className="rounded-2xl bg-surface p-4 shadow-[0_1px_0_var(--line)] md:p-5">
          <h2 id="review-title" className="mb-4 font-semibold">
            {t("planner.reviewTitle")}
          </h2>

          <ol className="divide-y divide-line">
            {draft.tasks.map((task, i) => (
              <li key={task.key} className="flex gap-3 py-3">
                <span className="w-5 shrink-0 pt-2 text-end text-sm text-muted tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    value={task.name}
                    onChange={(e) => updateTask(task.key, { name: e.target.value })}
                    aria-label={t("editor.name")}
                    dir="auto"
                    className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 font-medium hover:border-line focus:border-accent"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="date"
                      value={task.dueDate ?? ""}
                      onChange={(e) => updateTask(task.key, { dueDate: e.target.value || null })}
                      aria-label={t("editor.date")}
                      className="rounded-md border border-line bg-surface px-2 py-1"
                    />
                    <label className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1">
                      <ImportanceDot level={task.importance} />
                      <select
                        value={task.importance}
                        onChange={(e) =>
                          updateTask(task.key, { importance: e.target.value as ProposedTask["importance"] })
                        }
                        aria-label={t("editor.importance")}
                        className="bg-transparent"
                      >
                        {(["high", "medium", "low"] as const).map((l) => (
                          <option key={l} value={l}>
                            {t(`importance.${l}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <select
                      value={task.durationMin}
                      onChange={(e) => updateTask(task.key, { durationMin: Number(e.target.value) })}
                      aria-label={t("editor.duration")}
                      className="rounded-md border border-line bg-surface px-2 py-1"
                    >
                      {[...new Set([...DURATIONS, task.durationMin])]
                        .sort((a, b) => a - b)
                        .map((d) => (
                          <option key={d} value={d}>
                            {formatDuration(d, t)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => setDraft((d) => d && { ...d, tasks: d.tasks.filter((x) => x.key !== task.key) })}
                  aria-label={`${t("planner.removeTask")}: ${task.name}`}
                  className="self-start rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <IconX size={16} />
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label={t("editor.project")}
                className="rounded-lg border border-line bg-surface px-3 py-2"
              >
                <option value="new">{t("planner.saveAsNew")}</option>
                {projects.length > 0 && (
                  <optgroup label={t("planner.saveInto")}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {target === "new" && (
                <input
                  value={draft.projectName}
                  onChange={(e) => setDraft({ ...draft, projectName: e.target.value })}
                  aria-label={t("planner.projectName")}
                  placeholder={t("planner.projectName")}
                  dir="auto"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2"
                />
              )}
            </div>
            <button
              onClick={() => void save()}
              disabled={draft.tasks.length === 0}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40 sm:w-auto"
            >
              {t("planner.saveTasks", { count: draft.tasks.length })}
            </button>
          </div>
        </section>
      ) : (
        <>
          <form onSubmit={onSubmit} className="rounded-2xl border border-line bg-surface p-2 focus-within:border-accent">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={started ? 2 : 3}
              placeholder={started ? t("planner.answerPlaceholder") : t("planner.placeholder")}
              aria-label={t("planner.placeholder")}
              dir="auto"
              className="w-full resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/70"
              autoFocus
            />
            <div className="flex items-center justify-between">
              {/* Voice: the slot is here; v1.1 records audio and sends { kind: "audio" } through submit(). */}
              <button
                type="button"
                disabled
                title={t("planner.voiceSoon")}
                aria-label={t("planner.voiceSoon")}
                className="grid size-9 place-items-center rounded-lg text-muted opacity-50"
              >
                <IconMic size={19} />
              </button>
              <button
                type="submit"
                disabled={!text.trim() || busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-40"
              >
                {busy ? t("planner.sending") : t("planner.send")}
                <IconArrowUp size={16} />
              </button>
            </div>
          </form>

          {!started && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm text-muted">{t("planner.examples")}</h2>
              <div className="flex flex-wrap gap-2">
                {(["example1", "example2", "example3"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      setText(t(`planner.${k}`));
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent"
                  >
                    {t(`planner.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
