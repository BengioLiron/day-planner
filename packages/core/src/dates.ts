/** Small date helpers that work on local calendar dates (YYYY-MM-DD) and minutes from midnight. */

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  // Use UTC to avoid DST shifts changing the day count.
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** "09:30" → 570 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 570 → "09:30" */
export function minutesToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes from local midnight of `dateKey` for a Date (may be negative or > 1440). */
export function minutesIntoDay(dateKey: string, d: Date): number {
  const midnight = parseDateKey(dateKey).getTime();
  return Math.round((d.getTime() - midnight) / 60_000);
}

/** A Date at `minutes` after local midnight of `dateKey`. */
export function dateAtMinutes(dateKey: string, minutes: number): Date {
  const d = parseDateKey(dateKey);
  d.setMinutes(minutes);
  return d;
}
