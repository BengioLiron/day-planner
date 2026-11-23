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
    expect(r).toMatchObject({
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
    ).toMatchObject({ type: "questions", questions: ["When?", "Budget?"] });
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

describe("the planner agent with stand-in models", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { breakdownMission, normalize } = await import("./ai/planner.js");
  const conn = { provider: "anthropic" as const, model: "test", apiKey: "unused-key" };
  const context = {
    today: "2026-10-18",
    language: "he" as const,
    dayLoads: [],
    existingProjects: [],
    freeSlots: [
      { date: "2026-10-19", slots: ["09:00-10:00"], freeMinutes: 60 },
      { date: "2026-10-20", slots: ["09:00-12:00", "14:00-15:00"], freeMinutes: 240 },
    ],
    openTasks: [{ name: "דוח רבעוני", dueDate: "2026-10-19", importance: "high" as const, durationMin: 120, project: null }],
  };
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  };
  type Content = Awaited<ReturnType<InstanceType<typeof MockLanguageModelV4>["doGenerate"]>>["content"];

  /** A model that answers each call with the next scripted reply, and records what it was sent. */
  function scripted(replies: Content[]) {
    const calls: { system: string; prompt: unknown[] }[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === "system");
        calls.push({ system: typeof sys?.content === "string" ? sys.content : "", prompt: opts.prompt });
        const content = replies[Math.min(calls.length - 1, replies.length - 1)]!;
        const calledTool = content.some((c) => c.type === "tool-call");
        return {
          content,
          finishReason: calledTool ? { unified: "tool-calls", raw: "tool_use" } : { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });
    return { model, calls };
  }
  const text = (t: string) => [{ type: "text" as const, text: t }];
  const plan = {
    type: "plan",
    questions: [],
    projectName: "תו חניה",
    summary: "להוציא תו חניה אזורי",
    tasks: [
      { name: "לבדוק זכאות", notes: "", dueDate: "2026-10-19", importance: "high", durationMin: 20, sourceUrl: "https://www.tel-aviv.gov.il/parking", dependsOn: [] },
      { name: "להגיש בקשה", notes: "צילום רישיון רכב", dueDate: "2026-10-20", importance: "high", durationMin: 30, sourceUrl: "", dependsOn: [1, 2, 7] },
    ],
    caveats: ["האגרה לא צוינה באתר"],
  };

  it("researches a real-world goal, keeps the sources, and plans from them", async () => {
    const research = scripted([
      [
        { type: "source", sourceType: "url", id: "s1", url: "https://www.tel-aviv.gov.il/parking", title: "תו חניה – עיריית תל אביב" },
        ...text("1. בודקים זכאות באתר העירייה https://www.tel-aviv.gov.il/parking\n2. מגישים בקשה מקוונת."),
      ],
    ]);
    const planner = scripted([text(JSON.stringify(plan))]);
    const result = await breakdownMission(conn, { kind: "text", text: "תו חניה לתל אביב" }, [], context, {
      models: { research: research.model, plan: planner.model },
    });

    expect(research.calls).toHaveLength(1);
    expect(planner.calls[0]!.system).toContain("tel-aviv.gov.il/parking");
    expect(planner.calls[0]!.system).toContain("Hebrew");
    expect(result).toMatchObject({
      type: "plan",
      caveats: ["האגרה לא צוינה באתר"],
      research: { sources: [{ url: "https://www.tel-aviv.gov.il/parking", title: "תו חניה – עיריית תל אביב" }] },
      tasks: [{ sourceUrl: "https://www.tel-aviv.gov.il/parking" }, { dependsOn: [1] }],
    });
    expect(result.type === "plan" && result.tasks[1]!.sourceUrl).toBeFalsy();
  });

  it("skips research when the model says it isn't needed", async () => {
    const research = scripted([text("NO_RESEARCH")]);
    const planner = scripted([text(JSON.stringify({ ...plan, caveats: [] }))]);
    const result = await breakdownMission(conn, { kind: "text", text: "לסדר את הארון" }, [], context, {
      models: { research: research.model, plan: planner.model },
    });
    expect(result).toMatchObject({ type: "plan", research: null });
    expect(planner.calls[0]!.system).toContain("never invent links");
  });

  it("looks at real free time with its tools before answering", async () => {
    const planner = scripted([
      [
        { type: "tool-call", toolCallId: "t1", toolName: "find_free_slots", input: JSON.stringify({ from: "2026-10-19", to: "2026-10-25", minMinutes: 120 }) },
        { type: "tool-call", toolCallId: "t2", toolName: "list_open_tasks", input: JSON.stringify({ from: "2026-10-19" }) },
      ],
      text(JSON.stringify(plan)),
    ]);
    await breakdownMission(conn, { kind: "text", text: "תו חניה" }, [], context, {
      models: { research: scripted([text("NO_RESEARCH")]).model, plan: planner.model },
    });
    expect(planner.calls).toHaveLength(2);
    const toolResults = JSON.stringify(planner.calls[1]!.prompt);
    expect(toolResults).toContain("09:00-12:00");
    expect(toolResults).not.toContain("09:00-10:00"); // the 60-minute gap is shorter than asked
    expect(toolResults).toContain("דוח רבעוני");
  });

  it("refines a plan without searching again", async () => {
    const research = scripted([text("should not be called")]);
    const planner = scripted([text(JSON.stringify(plan))]);
    const saved = { notes: "הערות", sources: [{ title: "עירייה", url: "https://www.tel-aviv.gov.il/parking" }] };
    const result = await breakdownMission(
      conn,
      { kind: "text", text: "תזיז הכל לשבוע הבא" },
      [{ role: "user", content: "תו חניה" }, { role: "assistant", content: "תוכנית" }],
      context,
      { research: saved, previousPlan: { projectName: "תו חניה", tasks: [] }, models: { research: research.model, plan: planner.model } },
    );
    expect(research.calls).toHaveLength(0);
    expect(planner.calls[0]!.system).toContain("asking for changes");
    expect(JSON.stringify(planner.calls[0]!.prompt)).toContain("Current plan");
    expect(result).toMatchObject({ research: saved });
  });

  it("cleans links and step numbers it can't trust", () => {
    const result = normalize(
      {
        ...plan,
        tasks: [
          { ...plan.tasks[0]!, sourceUrl: "javascript:alert(1)", durationMin: 3, dueDate: "next week", dependsOn: [1] },
          ...plan.tasks.slice(1),
        ],
      } as never,
      { mustPlan: false },
    );
    expect(result.type === "plan" && result.tasks[0]).toMatchObject({ durationMin: 5, dueDate: null });
    expect(result.type === "plan" && result.tasks[0]!.sourceUrl).toBeFalsy();
    expect(result.type === "plan" && result.tasks[0]!.dependsOn).toBeFalsy();
  });

  it("routes audio through the voice slot, which answers 501 until v1.1", async () => {
    const m = scripted([text("{}")]).model;
    await expect(
      breakdownMission(conn, { kind: "audio", mimeType: "audio/webm", base64: "AAAA" }, [], context, {
        models: { research: m, plan: m },
      }),
    ).rejects.toMatchObject({ status: 501 });
  });
});
