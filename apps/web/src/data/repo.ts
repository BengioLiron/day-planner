import type { Importance, Project, Task, TaskSource } from "@planner/core";
import { db, type OutboxEntry } from "./db";

export function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

async function enqueue(table: OutboxEntry["table"], rowId: string, op: OutboxEntry["op"]) {
  await db.outbox.add({ table, rowId, op, at: now() });
}

/* ---------------- Tasks ---------------- */

export interface TaskInput {
  name: string;
  dueDate?: string | null;
  dueTime?: string | null;
  importance: Importance;
  projectId?: string | null;
  durationMin?: number | null;
  notes?: string;
  source?: TaskSource;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const t = now();
  const task: Task = {
    id: newId(),
    name: input.name.trim(),
    dueDate: input.dueDate || null,
    dueTime: input.dueTime || null,
    importance: input.importance,
    projectId: input.projectId || null,
    durationMin: input.durationMin ?? null,
    notes: input.notes?.trim() || undefined,
    source: input.source ?? "manual",
    doneAt: null,
    deletedAt: null,
    createdAt: t,
    updatedAt: t,
  };
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.add(task);
    await enqueue("tasks", task.id, "put");
  });
  return task;
}

export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<void> {
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(id, {
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      updatedAt: now(),
    });
    await enqueue("tasks", id, "put");
  });
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(id, { doneAt: done ? now() : null, updatedAt: now() });
    await enqueue("tasks", id, "put");
  });
}

/** Soft delete: the task stays in Trash for 30 days so it can be restored and synced. */
export async function deleteTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(id, { deletedAt: now(), updatedAt: now() });
    await enqueue("tasks", id, "delete");
  });
}

export async function restoreTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(id, { deletedAt: null, updatedAt: now() });
    await enqueue("tasks", id, "put");
  });
}

/* ---------------- Projects ---------------- */

export const PROJECT_COLORS = ["#3552C9", "#2F8F83", "#B5552F", "#8A4FB8", "#5E8A68", "#B3426E"];

export async function createProject(name: string, color?: string): Promise<Project> {
  const t = now();
  const count = await db.projects.count();
  const project: Project = {
    id: newId(),
    name: name.trim(),
    color: color ?? PROJECT_COLORS[count % PROJECT_COLORS.length]!,
    status: "active",
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  await db.transaction("rw", db.projects, db.outbox, async () => {
    await db.projects.add(project);
    await enqueue("projects", project.id, "put");
  });
  return project;
}

export async function updateProject(id: string, patch: Partial<Pick<Project, "name" | "color" | "status">>) {
  await db.transaction("rw", db.projects, db.outbox, async () => {
    await db.projects.update(id, { ...patch, updatedAt: now() });
    await enqueue("projects", id, "put");
  });
}

/* ---------------- Day state ---------------- */

export async function snoozeForToday(date: string, taskId: string): Promise<void> {
  const current = await db.dayState.get(date);
  const ids = new Set(current?.snoozedTaskIds ?? []);
  ids.add(taskId);
  await db.dayState.put({ date, snoozedTaskIds: [...ids] });
}

export async function clearSnoozes(date: string): Promise<void> {
  await db.dayState.delete(date);
}

/* ---------------- Data ---------------- */

export async function exportAll(): Promise<string> {
  const [tasks, projects, settings] = await Promise.all([
    db.tasks.toArray(),
    db.projects.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify({ exportedAt: now(), version: 1, tasks, projects, settings }, null, 2);
}

export async function eraseAll(): Promise<void> {
  await db.transaction("rw", [db.tasks, db.projects, db.events, db.dayState, db.outbox], async () => {
    await Promise.all([db.tasks.clear(), db.projects.clear(), db.events.clear(), db.dayState.clear(), db.outbox.clear()]);
  });
}
