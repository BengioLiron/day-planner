import { minutesIntoDay, toDateKey } from "./dates.js";
import { isPlannable, scoreTask } from "./scoring.js";
import { findFreeSlots, intervalLength, mergeIntervals, subtractIntervals, type Interval } from "./slots.js";
import type { CalendarEvent, DailyPlan, PlanItem, PlannerSettings, Task } from "./types.js";

export interface BuildPlanInput {
  date: string;
  tasks: Task[];
  events: CalendarEvent[];
  settings: PlannerSettings;
  /** When planning today, time before `now` is not used. */
  now?: Date;
  /** Tasks the user swapped out or snoozed for this day. */
  excludeTaskIds?: Iterable<string>;
  /** Upper limit on suggestions, so the plan stays readable. */
  maxItems?: number;
}

/**
 * Build the recommended plan for one day.
 *
 * 1. Tasks already placed on the calendar today ("Add to calendar") become fixed, accepted items.
 * 2. Free slots = working hours − calendar events (with buffer) − fixed items − time already passed.
 * 3. Open tasks are ranked by score and placed first-fit, highest score earliest,
 *    until the time budget (free time minus slack) runs out.
 */
export function buildDailyPlan(input: BuildPlanInput): DailyPlan {
  const { date, tasks, events, settings } = input;
  const maxItems = input.maxItems ?? 8;
  const exclude = new Set(input.excludeTaskIds ?? []);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // 1. Fixed items from tasks already added to the calendar for this day.
  const fixed: PlanItem[] = [];
  const fixedIntervals: Interval[] = [];
  for (const e of events) {
    if (e.origin !== "app" || !e.taskId) continue;
    const task = taskById.get(e.taskId);
    if (!task || !isPlannable(task)) continue;
    const start = minutesIntoDay(date, new Date(e.start));
    const end = minutesIntoDay(date, new Date(e.end));
    if (end <= 0 || start >= 24 * 60) continue;
    const { score, reasons } = scoreTask(task, date);
    fixed.push({ taskId: task.id, start, end, score, reasons, state: "accepted" });
    fixedIntervals.push({ start, end });
  }
  const fixedIds = new Set(fixed.map((i) => i.taskId));

  // 2. Free time. Calendar events get the buffer; the user's own blocks don't.
  const calendarEvents = events.filter((e) => e.origin === "calendar");
  const isToday = input.now ? toDateKey(input.now) === date : false;
  const notBefore = isToday && input.now ? minutesIntoDay(date, input.now) : undefined;
  const baseSlots = findFreeSlots(date, calendarEvents, settings, { notBefore, minSlotMin: 0 });
  let slots: Interval[] = [];
  for (const s of baseSlots) slots.push(...subtractIntervals(s, mergeIntervals(fixedIntervals)));
  slots = slots.filter((s) => intervalLength(s) >= 15);

  const freeMinutes = slots.reduce((sum, s) => sum + intervalLength(s), 0);
  const budget = Math.floor(freeMinutes * (1 - clamp(settings.slackRatio, 0, 0.9)));

  // 3. Rank and place.
  const candidates = tasks
    .filter((t) => isPlannable(t) && !exclude.has(t.id) && !fixedIds.has(t.id))
    .map((t) => ({ task: t, ...scoreTask(t, date) }))
    .sort((a, b) => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt));

  const placed: PlanItem[] = [];
  const unplaced: { taskId: string; score: number }[] = [];
  let used = 0;

  for (const c of candidates) {
    const duration = c.task.durationMin ?? settings.defaultDurationMin;
    const fitsBudget = used + duration <= budget;
    const slotIndex =
      fitsBudget && placed.length + fixed.length < maxItems ? slots.findIndex((s) => intervalLength(s) >= duration) : -1;

    if (slotIndex === -1) {
      unplaced.push({ taskId: c.task.id, score: c.score });
      continue;
    }

    const slot = slots[slotIndex]!;
    const gap = { start: slot.start, end: slot.end };
    placed.push({
      taskId: c.task.id,
      start: slot.start,
      end: slot.start + duration,
      score: c.score,
      reasons: [...c.reasons, { kind: "fits_gap", start: gap.start, end: gap.end }],
      state: "suggested",
    });
    used += duration;
    slot.start += duration;
    if (intervalLength(slot) < 15) slots.splice(slotIndex, 1);
  }

  const items = [...fixed, ...placed].sort((a, b) => a.start - b.start);
  return {
    date,
    items,
    unplaced,
    freeMinutes,
    plannedMinutes: items.reduce((sum, i) => sum + (i.end - i.start), 0),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
