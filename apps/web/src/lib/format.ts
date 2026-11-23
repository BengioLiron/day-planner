import type { TFunction } from "i18next";
import { daysBetween, minutesToHhmm, parseDateKey, type PlanReason } from "@planner/core";

export function formatDuration(min: number, t: TFunction): string {
  if (min < 60) return t("common.min", { count: min });
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  if (m === 0 || m === 60) return t("common.hours", { count: m === 60 ? h + 1 : h });
  return t("common.hoursMin", { h, m });
}

export const formatTime = minutesToHhmm;

/** "Due tomorrow, high importance, fits the 14:00–15:30 gap" */
export function reasonText(reasons: PlanReason[], t: TFunction): string {
  const parts = reasons.map((r) => {
    switch (r.kind) {
      case "overdue":
        return t("reason.overdue", { count: r.days });
      case "due_today":
        return t("reason.due_today");
      case "due_tomorrow":
        return t("reason.due_tomorrow");
      case "due_in":
        return t("reason.due_in", { count: r.days });
      case "no_date":
        return t("reason.no_date");
      case "importance":
        return t(`reason.importance_${r.level}`);
      case "fits_gap":
        // Isolate the time range so it keeps its order inside Hebrew text.
        return t("reason.fits_gap", { start: `⁦${formatTime(r.start)}`, end: `${formatTime(r.end)}⁩` });
    }
  });
  return parts.join(", ");
}

/** Short date for task rows: weekday + day + month in the UI language. */
export function shortDate(dateKey: string, lang: string): string {
  return parseDateKey(dateKey).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function longToday(lang: string): string {
  return new Date().toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export type DateGroup = "overdue" | "today" | "tomorrow" | "upcoming" | "noDate";

export function dateGroup(dueDate: string | null | undefined, today: string): DateGroup {
  if (!dueDate) return "noDate";
  const d = daysBetween(today, dueDate);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return "upcoming";
}
