import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

// Isolated store and a throwaway key, set before the app modules load.
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "planner-")), "store.json");
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { app } = await import("./app.js");
const { encrypt, decrypt } = await import("./crypto.js");
const { parseIcs, buildIcsEvent, parseIcsDate } = await import("./calendar/ics.js");
const { normalize } = await import("./ai/planner.js");

describe("crypto", () => {
  it("round-trips and never stores the plain text", () => {
    const sealed = encrypt("sk-secret-key");
    expect(sealed).not.toContain("sk-secret");
    expect(decrypt(sealed)).toBe("sk-secret-key");
  });
});

describe("iCalendar", () => {
  it("parses UTC, zoned and all-day events, with folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a",
      "SUMMARY:Team sync\\, weekly",
      "DTSTART:20261019T070000Z",
      "DTEND:20261019T073000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "SUMMARY:Dentist appoint",
      " ment",
      "DTSTART;TZID=Asia/Jerusalem:20261019T163000",
      "DURATION:PT1H",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:c",
      "SUMMARY:Holiday",
      "DTSTART;VALUE=DATE:20261020",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const [a, b, c] = parseIcs(ics);
    expect(a).toMatchObject({ uid: "a", summary: "Team sync, weekly", busy: true, allDay: false });
    expect(a!.start.toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(b!.summary).toBe("Dentist appointment");
    expect(b!.start.toISOString()).toBe("2026-10-19T13:30:00.000Z"); // Israel is UTC+3 in October
    expect(b!.end.getTime() - b!.start.getTime()).toBe(3_600_000);
    expect(b!.busy).toBe(false);
    expect(c!.allDay).toBe(true);
  });

  it("handles a zone across a DST change", () => {
    // 1 Nov 2026 is after US DST ends: New York is UTC-5.
    expect(parseIcsDate("20261101T090000", "America/New_York").date.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("writes an event the parser reads back with its task id", () => {
    const ics = buildIcsEvent({
      uid: "u1",
      title: "Write, the About page",
      start: new Date("2026-10-19T13:00:00Z"),
      end: new Date("2026-10-19T14:00:00Z"),
      taskId: "task-1",
    });
    expect(parseIcs(ics)[0]).toMatchObject({ uid: "u1", summary: "Write, the About page", taskId: "task-1" });
  });
});

describe("planner output", () => {
  it("cleans the model's answer", () => {
    const r = normalize(
      {
        type: "plan",
        questions: [],
        projectName: "  Portfolio  ",
        summary: "Ship it",
        tasks: [{ name: " Pick a domain ", notes: "", dueDate: "not a date", importance: "high", durationMin: 7 }],
      },
      false,
    );
    expect(r).toEqual({
      type: "plan",
      projectName: "Portfolio",
      summary: "Ship it",
      tasks: [{ name: "Pick a domain", dueDate: null, importance: "high", durationMin: 5 }],
    });
  });

  it("forces a plan after the user answered", () => {
    expect(() =>
      normalize({ type: "questions", questions: ["When?"], projectName: "", summary: "", tasks: [] }, true),
    ).toThrow(/empty plan/);
    expect(
      normalize({ type: "questions", questions: ["When?", "Budget?"], projectName: "", summary: "", tasks: [] }, false),
    ).toEqual({ type: "questions", questions: ["When?", "Budget?"] });
  });
});

describe("routes", () => {
  it("answers health", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refuses planning without a model", async () => {
    const res = await app.request("/api/planner/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { kind: "text", text: "Move apartments" },
        history: [],
        context: { today: "2026-10-18", language: "en", dayLoads: [], existingProjects: [] },
      }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects bad input with 400", async () => {
    const res = await app.request("/api/ai/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "nope", model: "", apiKey: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("keeps the newest version of a pushed task", async () => {
    const task = (updatedAt: string, name: string) => ({
      id: "t1",
      name,
      importance: "high",
      source: "manual",
      createdAt: "2026-10-18T08:00:00Z",
      updatedAt,
    });
    const push = (t: object) =>
      app.request("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: [t], projects: [] }),
      });
    await push(task("2026-10-18T09:00:00Z", "new"));
    await push(task("2026-10-18T08:30:00Z", "old"));
    const pulled = (await (await app.request("/api/sync/pull")).json()) as { tasks: { name: string }[] };
    expect(pulled.tasks.map((t) => t.name)).toEqual(["new"]);
  });
});

describe("breakdownMission with a stand-in model", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { breakdownMission } = await import("./ai/planner.js");
  const conn = { provider: "anthropic" as const, model: "test", apiKey: "unused-key" };
  const context = { today: "2026-10-18", language: "he" as const, dayLoads: [], existingProjects: [] };

  function modelReturning(obj: unknown, seen: { system?: string } = {}) {
    return new MockLanguageModelV4({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === "system");
        seen.system = typeof sys?.content === "string" ? sys.content : "";
        return {
          content: [{ type: "text", text: JSON.stringify(obj) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 10, text: 10, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
  }

  it("turns the model's JSON into a plan and asks for Hebrew", async () => {
    const seen: { system?: string } = {};
    const result = await breakdownMission(
      conn,
      { kind: "text", text: "להשיק אתר" },
      [],
      context,
      modelReturning(
        {
          type: "plan",
          questions: [],
          projectName: "אתר",
          summary: "תוכנית",
          tasks: [{ name: "לבחור דומיין", notes: "", dueDate: "2026-10-20", importance: "high", durationMin: 30 }],
        },
        seen,
      ),
    );
    expect(result).toMatchObject({ type: "plan", projectName: "אתר", tasks: [{ name: "לבחור דומיין" }] });
    expect(seen.system).toContain("Hebrew");
  });

  it("routes audio through the voice slot, which answers 501 until v1.1", async () => {
    await expect(
      breakdownMission(conn, { kind: "audio", mimeType: "audio/webm", base64: "AAAA" }, [], context, modelReturning({})),
    ).rejects.toMatchObject({ status: 501 });
  });
});
