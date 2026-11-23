import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import type { PlannerInput, PlannerMessage, PlannerResearch, ProposedTask } from "@planner/core";
import { runPlanner } from "../ai/client";
import { db } from "../data/db";
import { createProject, createTask } from "../data/repo";
import { formatDuration } from "../lib/format";
import { useToast } from "../ui/context";
import { PageHeader } from "../ui/Shell";
import { ImportanceDot } from "../ui/TaskRow";
import { IconArrowUp, IconLink, IconMic, IconX } from "../ui/icons";

/** A step in the plan under review. Dependencies point at other steps' keys so removing a step can't shift them. */
type DraftTask = Omit<ProposedTask, "dependsOn"> & { key: string; after: string[] };

interface Draft {
  projectName: string;
  summary: string;
  tasks: DraftTask[];
  caveats: string[];
}

function toDraftTasks(tasks: ProposedTask[]): DraftTask[] {
  const keys: string[] = tasks.map(() => crypto.randomUUID());
  return tasks.map(({ dependsOn, ...task }, i) => ({
    ...task,
    key: keys[i]!,
    after: (dependsOn ?? []).map((n) => keys[n - 1]).filter((k): k is string => Boolean(k)),
  }));
}

/** The plan as the model should see it when asked for changes. */
function toProposed(tasks: DraftTask[]): ProposedTask[] {
  return tasks.map(({ key: _key, after, ...task }) => {
    const dependsOn = after.map((k) => tasks.findIndex((x) => x.key === k) + 1).filter((n) => n > 0);
    return { ...task, ...(dependsOn.length ? { dependsOn } : {}) };
  });
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
  const [research, setResearch] = useState<PlannerResearch | null>(null);
  const [refineText, setRefineText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Every message, typed now or spoken in v1.1, goes through here. */
  async function submit(input: PlannerInput, shown: string) {
    const history = messages;
    setMessages([...history, { role: "user", content: shown }]);
    setText("");
    setBusy(true);
    setError(null);
    const refining = draft ? { research, previousPlan: { projectName: draft.projectName, tasks: toProposed(draft.tasks) } } : { research };
    try {
      const res = await runPlanner(input, history, refining);
      setDemo(res.demo);
      const r = res.result;
      if (r.research !== undefined && r.research !== null) setResearch(r.research);
      if (r.type === "questions") {
        setMessages((m) => [...m, { role: "assistant", content: r.questions.join("\n") }]);
        inputRef.current?.focus();
      } else {
        setDraft({
          projectName: r.projectName,
          summary: r.summary,
          tasks: toDraftTasks(r.tasks),
          caveats: r.caveats ?? [],
        });
        setRefineText("");
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

  function onRefine(e?: FormEvent) {
    e?.preventDefault();
    const value = refineText.trim();
    if (!value || busy || !draft) return;
    void submit({ kind: "text", text: value }, value);
  }

  function reset() {
    setResearch(null);
    setRefineText("");
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
      const before = task.after
        .map((k) => draft.tasks.find((x) => x.key === k)?.name)
        .filter(Boolean)
        .join(", ");
      const notes = [
        task.notes,
        before && t("planner.notesAfter", { names: before }),
        task.sourceUrl && t("planner.notesSource", { url: task.sourceUrl }),
      ]
        .filter(Boolean)
        .join("\n");
      await createTask({
        name: task.name,
        notes: notes || undefined,
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

  const updateTask = (key: string, patch: Partial<DraftTask>) =>
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
            <li className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-accent" />
              {draft ? t("planner.refining") : research || demo ? t("planner.sending") : t("planner.researching")}
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

          {research && (
            <details className="mb-4 rounded-xl border border-line bg-surface-2/50 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {t("planner.researchTitle")}
                <span className="ms-2 font-normal text-muted">
                  {t("planner.sourcesCount", { count: research.sources.length })}
                </span>
              </summary>
              <p dir="auto" className="mt-3 whitespace-pre-line text-muted">
                {research.notes.replace(/\s*\(?https?:\/\/[^\s)]+\)?/g, "")}
              </p>
              {research.sources.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {research.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        dir="auto"
                        className="inline-flex items-center gap-1.5 text-accent hover:underline"
                      >
                        <IconLink size={14} />
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {draft.caveats.length > 0 && (
            <div className="mb-4 rounded-xl border border-medium/40 bg-medium/10 px-4 py-3 text-sm">
              <h3 className="mb-1 font-medium">{t("planner.caveatsTitle")}</h3>
              <ul className="list-disc space-y-1 ps-5" dir="auto">
                {draft.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

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
                  {(task.notes || task.after.length > 0 || task.sourceUrl) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted">
                      {task.after.length > 0 && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5">
                          {t("planner.after", {
                            steps: task.after
                              .map((k) => draft.tasks.findIndex((x) => x.key === k) + 1)
                              .filter((n) => n > 0)
                              .join(", "),
                          })}
                        </span>
                      )}
                      {task.notes && (
                        <span dir="auto" className="min-w-0">
                          {task.notes}
                        </span>
                      )}
                      {task.sourceUrl && (
                        <a
                          href={task.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={task.sourceUrl}
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          <IconLink size={12} />
                          {t("planner.source")}
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() =>
                    setDraft(
                      (d) =>
                        d && {
                          ...d,
                          tasks: d.tasks
                            .filter((x) => x.key !== task.key)
                            .map((x) => ({ ...x, after: x.after.filter((k) => k !== task.key) })),
                        },
                    )
                  }
                  aria-label={`${t("planner.removeTask")}: ${task.name}`}
                  className="self-start rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <IconX size={16} />
                </button>
              </li>
            ))}
          </ol>

          {!demo && (
            <form onSubmit={onRefine} className="mt-4 flex gap-2 border-t border-line pt-4">
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder={t("planner.refinePlaceholder")}
                aria-label={t("planner.refine")}
                dir="auto"
                disabled={busy}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-accent disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!refineText.trim() || busy}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm hover:border-accent disabled:opacity-40"
              >
                {busy ? t("planner.refining") : t("planner.refine")}
              </button>
            </form>
          )}

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
              disabled={draft.tasks.length === 0 || busy}
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
