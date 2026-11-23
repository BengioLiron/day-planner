import { APP_EVENT_MARKER } from "@planner/core";

/** The few iCalendar fields the planner needs, parsed from a VCALENDAR string. */
export interface IcsEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  allDay: boolean;
  busy: boolean;
  taskId: string | null;
}

const ICS_MARKER = `X-${APP_EVENT_MARKER.toUpperCase()}`;

/** Lines may be folded (continued with a leading space or tab). */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** Offset in ms of `timeZone` from UTC at the given instant. */
function tzOffset(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - at.getTime();
}

export function parseIcsDate(value: string, tzid?: string): { date: Date; allDay: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) throw new Error(`Bad iCalendar date: ${value}`);
  const [, y, mo, d, h, mi, s, z] = m;
  const fields = [Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)] as const;
  if (h === undefined) return { date: new Date(...fields), allDay: true };
  const naive = Date.UTC(...fields);
  if (z || !tzid) return { date: new Date(naive), allDay: false };
  // Local time in a named zone: shift by that zone's offset (checked twice around DST changes).
  let guess = naive - tzOffset(tzid, new Date(naive));
  guess = naive - tzOffset(tzid, new Date(guess));
  return { date: new Date(guess), allDay: false };
}

function parseDuration(v: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, w, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return ((((w! * 7 + d!) * 24 + h!) * 60 + mi!) * 60 + s!) * 1000;
}

export function parseIcs(ics: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;

  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      const ds = cur.DTSTART;
      if (ds) {
        const start = parseIcsDate(ds.value, ds.params.TZID);
        let end: Date;
        if (cur.DTEND) end = parseIcsDate(cur.DTEND.value, cur.DTEND.params.TZID).date;
        else if (cur.DURATION) end = new Date(start.date.getTime() + parseDuration(cur.DURATION.value));
        else end = new Date(start.date.getTime() + (start.allDay ? 86_400_000 : 0));
        out.push({
          uid: cur.UID?.value ?? `${start.date.getTime()}`,
          summary: unescape(cur.SUMMARY?.value ?? "(no title)"),
          start: start.date,
          end,
          allDay: start.allDay,
          busy: cur.TRANSP?.value !== "TRANSPARENT",
          taskId: cur[ICS_MARKER]?.value ?? null,
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const [name, ...paramParts] = line.slice(0, idx).split(";");
      const params: Record<string, string> = {};
      for (const p of paramParts) {
        const [k, v] = p.split("=");
        if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
      }
      cur[name!.toUpperCase()] = { value: line.slice(idx + 1), params };
    }
  }
  return out;
}

function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcsEvent(e: { uid: string; title: string; start: Date; end: Date; taskId: string }): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Day Planner//EN",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(e.start)}`,
    `DTEND:${icsUtc(e.end)}`,
    `SUMMARY:${escape(e.title)}`,
    `${ICS_MARKER}:${e.taskId}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
