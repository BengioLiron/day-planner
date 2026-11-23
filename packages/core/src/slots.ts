import { hhmmToMinutes, minutesIntoDay, parseDateKey } from "./dates.js";
import type { CalendarEvent, PlannerSettings } from "./types.js";

/** A half-open interval in minutes from local midnight: [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export function intervalLength(i: Interval): number {
  return Math.max(0, i.end - i.start);
}

/** Merge overlapping or touching intervals. Input order does not matter. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** `window` minus every busy interval. */
export function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

/** Busy intervals for one day, clipped to the day and padded with the buffer. */
export function busyIntervalsForDay(
  date: string,
  events: CalendarEvent[],
  bufferMin: number,
): Interval[] {
  const out: Interval[] = [];
  for (const e of events) {
    if (!e.busy || e.allDay) continue; // all-day events (birthdays, holidays) don't block hours
    const start = minutesIntoDay(date, new Date(e.start));
    const end = minutesIntoDay(date, new Date(e.end));
    if (end <= 0 || start >= 24 * 60) continue;
    out.push({
      start: Math.max(0, start - bufferMin),
      end: Math.min(24 * 60, end + bufferMin),
    });
  }
  return mergeIntervals(out);
}

export interface FreeSlotOptions {
  /** Ignore time before this minute (e.g. "now" when planning the current day). */
  notBefore?: number;
  /** Slots shorter than this are dropped. */
  minSlotMin?: number;
}

/** Free slots inside working hours on `date`. Days off return no slots. */
export function findFreeSlots(
  date: string,
  events: CalendarEvent[],
  settings: PlannerSettings,
  opts: FreeSlotOptions = {},
): Interval[] {
  const weekday = parseDateKey(date).getDay();
  if (settings.daysOff.includes(weekday)) return [];

  const minSlot = opts.minSlotMin ?? 15;
  let start = hhmmToMinutes(settings.workStart);
  const end = hhmmToMinutes(settings.workEnd);
  if (opts.notBefore !== undefined) {
    // Round "now" up to the next 5 minutes so slots start on clean times.
    start = Math.max(start, Math.ceil(opts.notBefore / 5) * 5);
  }
  if (start >= end) return [];

  const busy = busyIntervalsForDay(date, events, settings.bufferMin);
  return subtractIntervals({ start, end }, busy).filter((s) => intervalLength(s) >= minSlot);
}
