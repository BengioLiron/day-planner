import { addDays, toDateKey, type Importance } from "@planner/core";
import { db, updateSettings, type Language } from "./db";
import { createProject, createTask } from "./repo";

interface SeedTask {
  name: Record<Language, string>;
  day: number | null; // days from today
  importance: Importance;
  durationMin: number | null;
  project?: 0 | 1;
}

const PROJECTS: Record<Language, string>[] = [
  { en: "Portfolio site", he: "אתר תיק עבודות" },
  { en: "Home", he: "בית" },
];

const TASKS: SeedTask[] = [
  { name: { en: "Send invoice to Orly", he: "לשלוח חשבונית לאורלי" }, day: -1, importance: "high", durationMin: 15 },
  { name: { en: "Write the About page", he: "לכתוב את עמוד האודות" }, day: 0, importance: "high", durationMin: 60, project: 0 },
  { name: { en: "Pick a color palette", he: "לבחור פלטת צבעים" }, day: 1, importance: "medium", durationMin: 30, project: 0 },
  { name: { en: "Book the plumber", he: "להזמין אינסטלטור" }, day: 0, importance: "medium", durationMin: 15, project: 1 },
  { name: { en: "Review the lease renewal", he: "לעבור על חידוש החוזה" }, day: 3, importance: "high", durationMin: 45, project: 1 },
  { name: { en: "Export case study images", he: "לייצא תמונות לפרויקטים" }, day: 4, importance: "low", durationMin: 30, project: 0 },
  { name: { en: "Read the React 19 upgrade notes", he: "לקרוא על השדרוג ל־React 19" }, day: null, importance: "low", durationMin: 45 },
  { name: { en: "Renew passport", he: "לחדש דרכון" }, day: 12, importance: "medium", durationMin: 60 },
];

export async function loadSampleData(language: Language): Promise<void> {
  const today = toDateKey(new Date());
  const projects = [];
  for (const p of PROJECTS) projects.push(await createProject(p[language]));
  for (const t of TASKS) {
    await createTask({
      name: t.name[language],
      dueDate: t.day === null ? null : addDays(today, t.day),
      importance: t.importance,
      durationMin: t.durationMin,
      projectId: t.project !== undefined ? projects[t.project]!.id : null,
    });
  }
  await updateSettings({ sampleData: true });
}

/** First launch: optionally start with sample data so the plan has something to show. */
export async function seedOnFirstRun(language: Language, withSamples = true): Promise<void> {
  const existing = await db.settings.get("app");
  if (existing) return;
  await updateSettings({ language });
  if (withSamples) await loadSampleData(language);
}
