import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addDays,
  buildDailyPlan,
  dateAtMinutes,
  hhmmToMinutes,
  minutesIntoDay,
  parseDateKey,
  toDateKey,
  type CalendarEvent,
  type PlanItem,
  type Project,
  type Task,
} from "@planner/core";
import { db } from "../data/db";
import { clearSnoozes, snoozeForToday } from "../data/repo";
import { addTaskToCalendar, removeTaskFromCalendar } from "../calendar";
import { formatDuration, formatTime, longToday, reasonText } from "../lib/format";
import { useNow } from "../lib/useNow";
import { useEditor, useSettings, useToast } from "../ui/context";
import { PageHeader } from "../ui/Shell";
import { DoneCheckbox, ImportanceDot, TaskRow } from "../ui/TaskRow";
import { IconCalendarPlus, IconSpark, IconX } from "../ui/icons";

type Row =
  | { kind: "event"; start: number; end: number; event: CalendarEvent }
  | { kind: "task"; start: number; end: number; item: PlanItem; task: Task; eventId?: string }
  | { kind: "free"; start: number; end: number };

export function TodayPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const now = useNow();
  const today = toDateKey(now);
  const editor = useEditor();

  const tasks = useLiveQuery(() => db.tasks.filter((x) => !x.deletedAt).toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const events = useLiveQuery(
    () =>
      db.events
        .where("start")
        .between(dateAtMinutes(addDays(today, -1), 0).toISOString(), dateAtMinutes(addDays(today, 1), 0).toISOString())
        .toArray(),
    [today],
  );
  const dayState = useLiveQuery(() => db.dayState.get(today), [today]);
  const snoozed = dayState?.snoozedTaskIds ?? [];

  const plan = useMemo(() => {
    if (!tasks || !events) return null;
    const todaysEvents = events.filter((e) => {
      const end = minutesIntoDay(today, new Date(e.end));
      const start = minutesIntoDay(today, new Date(e.start));
      return end > 0 && start < 24 * 60;
    });
    return {
      events: todaysEvents,
      ...buildDailyPlan({
        date: today,
        tasks,
        events: todaysEvents,
        settings: settings.planner,
        now,
        excludeTaskIds: snoozed,
      }),
    };
    // `now` changes every minute; recomputing then keeps "time already passed" honest.
  }, [tasks, events, settings.planner, today, now, snoozed]);

  if (!plan || !tasks) return null;

  const taskById = new Map(tasks.map((x) => [x.id, x]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const workStart = hhmmToMinutes(settings.planner.workStart);
  const workEnd = hhmmToMinutes(settings.planner.workEnd);
  const nowMin = minutesIntoDay(today, now);
  const isDayOff = settings.planner.daysOff.includes(parseDateKey(today).getDay());
  const openTasks = tasks.filter((x) => !x.doneAt);
  const suggested = plan.items.length;

  const rows = buildRows(today, plan.events, plan.items, taskById, workStart, workEnd, nowMin);

  const hour = now.getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  let sub: string;
  if (isDayOff) sub = t("today.dayOff");
  else if (nowMin >= workEnd) sub = t("today.afterHours");
  else if (suggested > 0) sub = t("today.summary", { tasks: suggested, free: formatDuration(plan.freeMinutes, t) });
  else sub = t("today.summaryNone");

  return (
    <div>
      <PageHeader
        title={t(`today.greeting_${greeting}`)}
        sub={
          <>
            <span className="text-ink">{longToday(i18n.language)}.</span> {sub}
          </>
        }
      />

      {openTasks.length === 0 ? (
        <EmptyToday onAdd={() => editor.open({ defaults: { dueDate: today } })} />
      ) : (
        <>
          {!isDayOff && (
            <DayBar
              events={plan.events}
              items={plan.items}
              date={today}
              workStart={workStart}
              workEnd={workEnd}
              nowMin={nowMin}
            />
          )}

          <ol className="mt-6 space-y-2" aria-label={t("today.title")}>
            {rows.map((row) =>
              row.kind === "event" ? (
                <EventRow key={`e${row.event.id}`} row={row} />
              ) : row.kind === "free" ? (
                <li key={`f${row.start}`} className="flex items-center gap-3 py-0.5 text-[13px] text-muted">
                  <span className="w-11 shrink-0 sm:w-[86px]" />
                  <span className="h-px flex-1 border-t border-dashed border-line" />
                  <span>{t("today.free", { duration: formatDuration(row.end - row.start, t) })}</span>
                </li>
              ) : (
                <PlanRow
                  key={`t${row.item.taskId}`}
                  row={row}
                  date={today}
                  project={row.task.projectId ? projectById.get(row.task.projectId) : undefined}
                />
              ),
            )}
          </ol>

          {plan.unplaced.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-1 text-sm font-medium text-muted">{t("today.didNotFit")}</h2>
              <ul>
                {plan.unplaced.slice(0, 5).map((u) => {
                  const task = taskById.get(u.taskId)!;
                  return (
                    <TaskRow
                      key={u.taskId}
                      task={task}
                      project={task.projectId ? projectById.get(task.projectId) : undefined}
                    />
                  );
                })}
              </ul>
            </section>
          )}

          {snoozed.length > 0 && (
            <button onClick={() => void clearSnoozes(today)} className="mt-6 text-sm text-accent hover:underline">
              {t("today.bringBack")}
            </button>
          )}

          <p className="mt-10 text-[13px] text-muted">
            {t("today.calendarSource", {
              name:
                settings.calendar.provider === "demo"
                  ? t("today.sampleCalendar")
                  : t(`settings.${settings.calendar.provider}`),
            })}
          </p>
        </>
      )}
    </div>
  );
}

function buildRows(
  date: string,
  events: CalendarEvent[],
  items: PlanItem[],
  taskById: Map<string, Task>,
  workStart: number,
  workEnd: number,
  nowMin: number,
): Row[] {
  const appEventByTask = new Map(events.filter((e) => e.origin === "app" && e.taskId).map((e) => [e.taskId!, e]));
  const out: Row[] = [];

  for (const e of events) {
    if (e.origin === "app" || e.allDay) continue;
    const start = minutesIntoDay(date, new Date(e.start));
    const end = minutesIntoDay(date, new Date(e.end));
    if (end <= workStart - 60 || start >= workEnd + 60) continue; // keep the list about the working day
    out.push({ kind: "event", start, end, event: e });
  }
  for (const item of items) {
    const task = taskById.get(item.taskId);
    if (!task) continue;
    out.push({ kind: "task", start: item.start, end: item.end, item, task, eventId: appEventByTask.get(task.id)?.id });
  }
  out.sort((a, b) => a.start - b.start || (a.kind === "event" ? -1 : 1));

  // Show larger free gaps between rows, but only in the future and inside working hours.
  const withGaps: Row[] = [];
  let cursor = Math.max(workStart, nowMin);
  for (const row of out) {
    const gapStart = cursor;
    const gapEnd = Math.min(row.start, workEnd);
    if (gapEnd - gapStart >= 30 && withGaps.length > 0) withGaps.push({ kind: "free", start: gapStart, end: gapEnd });
    withGaps.push(row);
    cursor = Math.max(cursor, row.end);
  }
  return withGaps;
}

function TimeGutter({ start, end }: { start: number; end: number }) {
  return (
    <div className="ltr-nums w-11 shrink-0 pt-3 text-end text-[13px] text-muted sm:w-[86px]">
      {formatTime(start)}
      <span className="hidden opacity-60 sm:inline">–{formatTime(end)}</span>
    </div>
  );
}

function EventRow({ row }: { row: Extract<Row, { kind: "event" }> }) {
  return (
    <li className="flex gap-3">
      <TimeGutter start={row.start} end={row.end} />
      <div className="busy-hatch flex min-h-11 flex-1 items-center rounded-xl px-4 py-2 text-sm text-busy-ink">
        <span className="rounded bg-surface-2/90 px-1.5" dir="auto">
          {row.event.title}
        </span>
      </div>
    </li>
  );
}

function PlanRow({ row, date, project }: { row: Extract<Row, { kind: "task" }>; date: string; project?: Project }) {
  const { t } = useTranslation();
  const toast = useToast();
  const editor = useEditor();
  const { item, task } = row;
  const accepted = item.state === "accepted";
  const reasons = item.reasons.filter((r) => r.kind !== "fits_gap" || !accepted);

  async function addToCalendar() {
    await addTaskToCalendar(task, dateAtMinutes(date, item.start), dateAtMinutes(date, item.end));
    toast.show(t("today.addedToCalendar"));
  }

  async function removeFromCalendar() {
    if (!row.eventId) return;
    await removeTaskFromCalendar(row.eventId);
    toast.show(t("today.removedFromCalendar"));
  }

  async function notToday() {
    await snoozeForToday(date, task.id);
    toast.show(t("today.setAside"), {
      label: t("common.undo"),
      run: async () => {
        const s = await db.dayState.get(date);
        await db.dayState.put({ date, snoozedTaskIds: (s?.snoozedTaskIds ?? []).filter((id) => id !== task.id) });
      },
    });
  }

  return (
    <li className="flex gap-3">
      <TimeGutter start={item.start} end={item.end} />
      <div
        className={`flex-1 rounded-xl border-s-[3px] px-4 py-3 ${
          accepted ? "border-accent bg-accent-soft" : "border-accent bg-surface shadow-[0_1px_0_var(--line)]"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <DoneCheckbox task={task} />
          </div>
          <button className="min-w-0 flex-1 text-start" onClick={() => editor.open({ taskId: task.id })}>
            <span className="flex items-center gap-2 font-medium">
              <ImportanceDot level={task.importance} />
              <span className="truncate" dir="auto">
                {task.name}
              </span>
            </span>
            <span className="mt-0.5 block text-[13px] text-muted">
              {reasonText(reasons, t)}
              {project && (
                <span className="ms-2 inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="size-1.5 rounded-sm" style={{ background: project.color }} />
                  {project.name}
                </span>
              )}
            </span>
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2 ps-[34px]">
          {accepted ? (
            <button
              onClick={() => void removeFromCalendar()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-accent hover:bg-surface/70"
            >
              <IconCalendarPlus size={16} />
              {t("today.inCalendar")}
              <span className="sr-only">: {t("today.removeFromCalendar")}</span>
              <IconX size={13} className="opacity-60" />
            </button>
          ) : (
            <>
              <button
                onClick={() => void addToCalendar()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[13px] font-medium text-accent-ink hover:opacity-90"
              >
                <IconCalendarPlus size={16} />
                {t("today.addToCalendar")}
              </button>
              <button
                onClick={() => void notToday()}
                className="rounded-lg px-2.5 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink"
              >
                {t("today.notToday")}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** The working day at a glance: meetings hatched, planned tasks in the accent color, a line for now. */
function DayBar({
  events,
  items,
  date,
  workStart,
  workEnd,
  nowMin,
}: {
  events: CalendarEvent[];
  items: PlanItem[];
  date: string;
  workStart: number;
  workEnd: number;
  nowMin: number;
}) {
  const { t } = useTranslation();
  const span = workEnd - workStart;
  if (span <= 0) return null;
  const pos = (m: number) => `${((Math.min(Math.max(m, workStart), workEnd) - workStart) / span) * 100}%`;
  const width = (s: number, e: number) => `${((Math.min(e, workEnd) - Math.max(s, workStart)) / span) * 100}%`;

  const hours: number[] = [];
  for (let h = Math.ceil(workStart / 60) * 60; h <= workEnd; h += 60) hours.push(h);

  const busy = events
    .filter((e) => e.origin === "calendar" && e.busy && !e.allDay)
    .map((e) => ({ id: e.id, s: minutesIntoDay(date, new Date(e.start)), e: minutesIntoDay(date, new Date(e.end)) }))
    .filter((b) => b.e > workStart && b.s < workEnd);

  return (
    <figure aria-label={t("today.timelineLabel")} className="select-none">
      <div className="relative h-11 overflow-hidden rounded-xl border border-line bg-surface">
        {nowMin > workStart && <div className="absolute inset-y-0 start-0 bg-surface-2" style={{ width: pos(nowMin) }} />}
        {busy.map((b) => (
          <div
            key={b.id}
            className="busy-hatch absolute inset-y-1.5 rounded-md"
            style={{ insetInlineStart: pos(b.s), width: width(b.s, b.e) }}
          />
        ))}
        {items.map((i) => (
          <div
            key={i.taskId}
            className={`absolute inset-y-1.5 rounded-md ${i.state === "accepted" ? "bg-accent" : "bg-accent/70"}`}
            style={{ insetInlineStart: pos(i.start), width: `calc(${width(i.start, i.end)} - 2px)` }}
          />
        ))}
        {nowMin > workStart && nowMin < workEnd && (
          <div className="absolute -inset-y-px w-0.5 bg-ink" style={{ insetInlineStart: pos(nowMin) }}>
            <span className="sr-only">{t("today.now")}</span>
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: pos(h) }}>
            <span className="ltr-nums">{formatTime(h).replace(/:00$/, "")}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function EmptyToday({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{t("today.emptyTitle")}</h2>
      <p className="mx-auto mt-2 max-w-sm text-muted">{t("today.emptyBody")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={onAdd} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
          {t("nav.addTask")}
        </button>
        <Link to="/planner" className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm">
          <IconSpark size={17} />
          {t("nav.planner")}
        </Link>
      </div>
    </div>
  );
}
