import { daysBetween } from "./dates.js";
import type { Importance, PlanReason, Task } from "./types.js";

const IMPORTANCE_POINTS: Record<Importance, number> = {
  high: 30,
  medium: 18,
  low: 8,
};

export interface TaskScore {
  score: number;
  reasons: PlanReason[];
}

/**
 * How much a task deserves a place in today's plan.
 * Importance and urgency are added, so an overdue low task can outrank a
 * high task due next month, but a high task due tomorrow beats both.
 */
export function scoreTask(task: Task, today: string): TaskScore {
  const reasons: PlanReason[] = [];
  let urgency: number;

  if (!task.dueDate) {
    urgency = 0;
    reasons.push({ kind: "no_date" });
  } else {
    const days = daysBetween(today, task.dueDate);
    if (days < 0) {
      const late = -days;
      urgency = 40 + Math.min(late, 7) * 2;
      reasons.push({ kind: "overdue", days: late });
    } else if (days === 0) {
      urgency = 36;
      reasons.push({ kind: "due_today" });
    } else if (days === 1) {
      urgency = 26;
      reasons.push({ kind: "due_tomorrow" });
    } else if (days <= 3) {
      urgency = 16;
      reasons.push({ kind: "due_in", days });
    } else if (days <= 7) {
      urgency = 8;
      reasons.push({ kind: "due_in", days });
    } else {
      urgency = 2;
      reasons.push({ kind: "due_in", days });
    }
  }

  reasons.push({ kind: "importance", level: task.importance });
  return { score: IMPORTANCE_POINTS[task.importance] + urgency, reasons };
}

/** Open tasks that the daily plan may consider. */
export function isPlannable(task: Task): boolean {
  return !task.doneAt && !task.deletedAt;
}
