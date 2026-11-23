import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "./plan.js";
import { scoreTask } from "./scoring.js";
import { findFreeSlots, mergeIntervals, subtractIntervals } from "./slots.js";
import { BreakdownResultSchema, dayLoads } from "./ai.js";
import { dateAtMinutes, daysBetween, hhmmToMinutes } from "./dates.js";
import { DEFAULT_PLANNER_SETTINGS, type CalendarEvent, type Task } from "./types.js";

// Monday 19 Oct 2026 — a working day under the default settings (Fri/Sat off).
const DAY = "2026-10-19";
const settings = { ...DEFAULT_PLANNER_SETTINGS, slackRatio: 0 };

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    name: partial.id,
    importance: "medium",
    source: "manual",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  };
}

function event(start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `${start}-${end}`,
    title: "Meeting",
    start: dateAtMinutes(DAY, hhmmToMinutes(start)).toISOString(),
    end: dateAtMinutes(DAY, hhmmToMinutes(end)).toISOString(),
    allDay: false,
    busy: true,
    origin: "calendar",
    ...extra,
  };
}

describe("dates", () => {
  it("counts days across month boundaries", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-10-19", "2026-10-17")).toBe(-2);
  });
});

describe("intervals", () => {
  it("merges overlapping and touching intervals", () => {
    expect(
      mergeIntervals([
        { start: 60, end: 120 },
        { start: 10, end: 30 },
        { start: 100, end: 200 },
        { start: 30, end: 40 },
      ]),
    ).toEqual([
      { start: 10, end: 40 },
      { start: 60, end: 200 },
    ]);
  });

  it("subtracts busy time from a window", () => {
    expect(
      subtractIntervals({ start: 0, end: 100 }, [
        { start: 10, end: 20 },
        { start: 90, end: 150 },
      ]),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 90 },
    ]);
  });
});

describe("findFreeSlots", () => {
  it("returns working hours minus padded events", () => {
    const slots = findFreeSlots(DAY, [event("10:00", "11:00")], settings);
    expect(slots).toEqual([
      { start: hhmmToMinutes("09:00"), end: hhmmToMinutes("09:50") },
      { start: hhmmToMinutes("11:10"), end: hhmmToMinutes("18:00") },
    ]);
  });

  it("ignores free and all-day events", () => {
    const slots = findFreeSlots(
      DAY,
      [event("10:00", "11:00", { busy: false }), event("00:00", "23:59", { allDay: true })],
      settings,
    );
    expect(slots).toEqual([{ start: 540, end: 1080 }]);
  });

  it("has no slots on a day off", () => {
    expect(findFreeSlots("2026-10-23", [], settings)).toEqual([]); // Friday
  });

  it("starts after now, rounded up to 5 minutes", () => {
    const slots = findFreeSlots(DAY, [], settings, { notBefore: hhmmToMinutes("13:02") });
    expect(slots[0]?.start).toBe(hhmmToMinutes("13:05"));
  });
});

describe("scoreTask", () => {
  it("ranks overdue above due today above tomorrow at equal importance", () => {
    const overdue = scoreTask(task({ id: "a", dueDate: "2026-10-17" }), DAY).score;
    const today = scoreTask(task({ id: "b", dueDate: DAY }), DAY).score;
    const tomorrow = scoreTask(task({ id: "c", dueDate: "2026-10-20" }), DAY).score;
    expect(overdue).toBeGreaterThan(today);
    expect(today).toBeGreaterThan(tomorrow);
  });

  it("lets a high task due tomorrow beat a low task due today", () => {
    const high = scoreTask(task({ id: "a", importance: "high", dueDate: "2026-10-20" }), DAY).score;
    const low = scoreTask(task({ id: "b", importance: "low", dueDate: DAY }), DAY).score;
    expect(high).toBeGreaterThan(low);
  });
});

describe("buildDailyPlan", () => {
  it("places the highest-scored task first and avoids meetings", () => {
    const plan = buildDailyPlan({
      date: DAY,
      settings,
      events: [event("09:00", "12:00")],
      tasks: [
        task({ id: "later", importance: "low", dueDate: "2026-11-30", durationMin: 60 }),
        task({ id: "urgent", importance: "high", dueDate: DAY, durationMin: 60 }),
      ],
    });
    expect(plan.items.map((i) => i.taskId)).toEqual(["urgent", "later"]);
    expect(plan.items[0]?.start).toBe(hhmmToMinutes("12:10"));
    expect(plan.items[0]?.reasons).toContainEqual({ kind: "due_today" });
  });

  it("skips done, deleted and excluded tasks", () => {
    const plan = buildDailyPlan({
      date: DAY,
      settings,
      events: [],
      excludeTaskIds: ["snoozed"],
      tasks: [
        task({ id: "done", doneAt: "2026-10-18T10:00:00Z" }),
        task({ id: "deleted", deletedAt: "2026-10-18T10:00:00Z" }),
        task({ id: "snoozed" }),
        task({ id: "open" }),
      ],
    });
    expect(plan.items.map((i) => i.taskId)).toEqual(["open"]);
  });

  it("keeps tasks already added to the calendar as accepted items", () => {
    const plan = buildDailyPlan({
      date: DAY,
      settings,
      events: [event("14:00", "15:00", { origin: "app", taskId: "booked" })],
      tasks: [task({ id: "booked", durationMin: 60 }), task({ id: "other", durationMin: 30 })],
    });
    const booked = plan.items.find((i) => i.taskId === "booked");
    expect(booked).toMatchObject({ state: "accepted", start: 840, end: 900 });
    expect(plan.items.filter((i) => i.taskId === "booked")).toHaveLength(1);
  });

  it("leaves slack unplanned and reports what did not fit", () => {
    const plan = buildDailyPlan({
      date: DAY,
      settings: { ...settings, workStart: "09:00", workEnd: "11:00", slackRatio: 0.5 },
      events: [],
      tasks: [task({ id: "a", importance: "high", durationMin: 60 }), task({ id: "b", durationMin: 60 })],
    });
    expect(plan.freeMinutes).toBe(120);
    expect(plan.items.map((i) => i.taskId)).toEqual(["a"]);
    expect(plan.unplaced.map((u) => u.taskId)).toEqual(["b"]);
  });

  it("does not schedule into time that has already passed", () => {
    const plan = buildDailyPlan({
      date: DAY,
      settings,
      events: [],
      now: dateAtMinutes(DAY, hhmmToMinutes("16:30")),
      tasks: [task({ id: "x", durationMin: 30 })],
    });
    expect(plan.items[0]?.start).toBe(hhmmToMinutes("16:30"));
  });
});

describe("AI planner helpers", () => {
  it("marks a fully booked day as load 1", () => {
    const loads = dayLoads(DAY, 1, [event("08:00", "19:00")], settings);
    expect(loads[0]?.load).toBe(1);
  });

  it("validates a breakdown result", () => {
    const ok = BreakdownResultSchema.safeParse({
      type: "plan",
      projectName: "Portfolio site",
      summary: "Launch by December",
      tasks: [{ name: "Pick a domain", dueDate: "2026-10-20", importance: "high", durationMin: 30 }],
    });
    expect(ok.success).toBe(true);
    const bad = BreakdownResultSchema.safeParse({ type: "plan", projectName: "x", summary: "", tasks: [] });
    expect(bad.success).toBe(false);
  });
});
