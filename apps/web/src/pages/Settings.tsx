import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROVIDERS, SUGGESTED_MODELS, type AiProviderId, type CalendarProviderId } from "@planner/core";
import { updateSettings, type AppSettings, type Language, type ThemePref } from "../data/db";
import { eraseAll, exportAll } from "../data/repo";
import { loadSampleData } from "../data/seed";
import { refreshCalendar } from "../calendar";
import { syncCalendarStatus } from "../calendar/status";
import { desktop } from "../desktop";
import { api, apiUrl, auth, serverAvailable } from "../lib/api";
import { useSettings, useToast } from "../ui/context";
import { PageHeader } from "../ui/Shell";

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  openai: "OpenAI (GPT)",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
};

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  const toast = useToast();
  const [server, setServer] = useState<boolean | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [signInRequired, setSignInRequired] = useState(false);

  useEffect(() => {
    void serverAvailable().then(async (up) => {
      setServer(up);
      if (up) setSignInRequired((await auth.status().catch(() => null))?.required ?? false);
    });
  }, []);

  const planner = settings.planner;
  const setPlanner = (patch: Partial<AppSettings["planner"]>) => void updateSettings({ planner: { ...planner, ...patch } });

  async function download() {
    const blob = new Blob([await exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `day-planner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <PageHeader title={t("settings.title")} />

      <div className="space-y-10">
        <Section title={t("settings.general")}>
          <Row label={t("settings.language")}>
            <Segmented<Language>
              value={settings.language}
              onChange={(language) => void updateSettings({ language }).then(refreshCalendar)}
              options={[
                ["en", "English"],
                ["he", "עברית"],
              ]}
            />
          </Row>
          <Row label={t("settings.theme")}>
            <Segmented<ThemePref>
              value={settings.theme}
              onChange={(theme) => void updateSettings({ theme })}
              options={[
                ["system", t("settings.themeSystem")],
                ["light", t("settings.themeLight")],
                ["dark", t("settings.themeDark")],
              ]}
            />
          </Row>
        </Section>

        <Section title={t("settings.planning")}>
          <Row label={t("settings.workHours")}>
            <div className="ltr-nums flex items-center gap-2">
              <input
                type="time"
                value={planner.workStart}
                onChange={(e) => e.target.value && setPlanner({ workStart: e.target.value })}
                aria-label={t("settings.from")}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                value={planner.workEnd}
                onChange={(e) => e.target.value && setPlanner({ workEnd: e.target.value })}
                aria-label={t("settings.to")}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              />
            </div>
          </Row>
          <Row label={t("settings.daysOff")}>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const on = planner.daysOff.includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() =>
                      setPlanner({ daysOff: on ? planner.daysOff.filter((x) => x !== d) : [...planner.daysOff, d] })
                    }
                    className={`min-w-10 rounded-lg border px-2 py-1.5 text-sm ${
                      on ? "border-accent bg-accent-soft font-medium" : "border-line"
                    }`}
                  >
                    {t(`weekday.${d}`)}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label={t("settings.buffer")}>
            <select
              value={planner.bufferMin}
              onChange={(e) => setPlanner({ bufferMin: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
            >
              {[0, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {t("common.min", { count: m })}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settings.slack")} help={t("settings.slackHelp")}>
            <select
              value={planner.slackRatio}
              onChange={(e) => setPlanner({ slackRatio: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
            >
              {[0, 0.1, 0.2, 0.3, 0.4].map((r) => (
                <option key={r} value={r}>
                  {Math.round(r * 100)}%
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <CalendarSection settings={settings} server={server} />
        <AiSection settings={settings} server={server} />

        {signInRequired && (
          <Section title={t("auth.account")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">{t("auth.signedInHere")}</span>
              <button
                onClick={async () => {
                  await auth.logout().catch(() => undefined);
                  window.location.reload();
                }}
                className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm hover:border-accent"
              >
                {t("auth.signOut")}
              </button>
            </div>
          </Section>
        )}

        <Section title={t("settings.data")}>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void download()}
              className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm hover:border-accent"
            >
              {t("settings.export")}
            </button>
            <button
              onClick={async () => {
                await loadSampleData(settings.language);
                toast.show(t("settings.sampleLoaded"));
              }}
              className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm hover:border-accent"
            >
              {t("settings.loadSample")}
            </button>
            {confirmErase ? (
              <span className="flex flex-wrap items-center gap-2 rounded-lg bg-high/10 px-3 py-1.5 text-sm">
                {t("settings.eraseConfirm")}
                <button
                  onClick={async () => {
                    await eraseAll();
                    await updateSettings({ sampleData: false });
                    await refreshCalendar();
                    setConfirmErase(false);
                    toast.show(t("settings.erased"));
                  }}
                  className="rounded-md bg-danger px-2.5 py-1 font-medium text-white"
                >
                  {t("settings.eraseYes")}
                </button>
                <button onClick={() => setConfirmErase(false)} className="rounded-md px-2.5 py-1 hover:bg-surface">
                  {t("common.cancel")}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmErase(true)}
                className="rounded-lg px-3.5 py-2 text-sm text-danger hover:bg-high/10"
              >
                {t("settings.erase")}
              </button>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function CalendarSection({ settings, server }: { settings: AppSettings; server: boolean | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const cal = settings.calendar;
  const [choice, setChoice] = useState<CalendarProviderId>(cal.provider === "apple" ? "apple" : "google");
  const [appleId, setAppleId] = useState("");
  const [applePw, setApplePw] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function connectApple(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/calendar/apple/connect", { appleId, appPassword: applePw });
      await updateSettings({ calendar: { ...cal, provider: "apple", connected: true } });
      await refreshCalendar();
      setApplePw("");
      toast.show(t("settings.connected"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    await api.post("/api/calendar/disconnect", {}).catch(() => undefined);
    await updateSettings({ calendar: { ...cal, provider: "demo", connected: false } });
    await refreshCalendar();
  }

  return (
    <Section title={t("settings.calendar")} intro={t("settings.calendarHelp")}>
      {cal.connected && cal.provider !== "demo" ? (
        <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 shadow-[0_1px_0_var(--line)]">
          <span className="text-sm">
            <span className="me-2 inline-block size-2 rounded-full bg-low" />
            {t(`settings.${cal.provider}`)}
          </span>
          <button onClick={() => void disconnect()} className="text-sm text-muted hover:text-ink">
            {t("settings.disconnect")}
          </button>
        </div>
      ) : (
        <>
          <Segmented<CalendarProviderId>
            value={choice}
            onChange={setChoice}
            options={[
              ["google", t("settings.google")],
              ["apple", t("settings.apple")],
            ]}
          />
          {server === false ? (
            <p className="text-sm text-muted">{t("settings.needsServer")}</p>
          ) : choice === "google" && desktop ? (
            <DesktopGoogleConnect />
          ) : choice === "google" ? (
            <a
              href={apiUrl("/api/calendar/google/auth")}
              className="inline-block rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
            >
              {t("settings.connect")}
            </a>
          ) : (
            <form onSubmit={connectApple} className="space-y-2">
              <p className="text-sm text-muted">{t("settings.appleHelp")}</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  required
                  value={appleId}
                  onChange={(e) => setAppleId(e.target.value)}
                  placeholder={t("settings.appleId")}
                  aria-label={t("settings.appleId")}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  required
                  value={applePw}
                  onChange={(e) => setApplePw(e.target.value)}
                  placeholder={t("settings.applePassword")}
                  aria-label={t("settings.applePassword")}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
                <button className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
                  {t("settings.connect")}
                </button>
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
            </form>
          )}
          <p className="text-[13px] text-muted">{t("settings.usingSample")}</p>
        </>
      )}
    </Section>
  );
}

function AiSection({ settings, server }: { settings: AppSettings; server: boolean | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [provider, setProvider] = useState<AiProviderId>(settings.ai.provider);
  const [model, setModel] = useState(settings.ai.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/ai/connection", { provider, model, apiKey });
      await updateSettings({ ai: { provider, model, connected: true } });
      setApiKey("");
      toast.show(t("settings.aiConnected", { provider: PROVIDER_LABEL[provider], model }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("settings.ai")} intro={t(desktop ? "settings.aiHelpDesktop" : "settings.aiHelp")}>
      {settings.ai.connected && (
        <p className="text-sm">
          <span className="me-2 inline-block size-2 rounded-full bg-low" />
          {t("settings.aiConnected", { provider: PROVIDER_LABEL[settings.ai.provider], model: settings.ai.model })}
        </p>
      )}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("settings.provider")}</span>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as AiProviderId;
              setProvider(p);
              setModel(SUGGESTED_MODELS[p][0]!);
            }}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("settings.model")}</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="model-suggestions"
            required
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
          />
          <datalist id="model-suggestions">
            {SUGGESTED_MODELS[provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-muted">{t("settings.apiKey")}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            autoComplete="off"
            disabled={server === false}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 disabled:opacity-50"
          />
        </label>
        <div className="sm:col-span-2">
          {server === false ? (
            <p className="text-sm text-muted">{t("settings.needsServer")}</p>
          ) : (
            <button
              disabled={busy}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {t("settings.connectAi")}
            </button>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      </form>
    </Section>
  );
}

/**
 * Google Calendar in the Windows app: sign-in happens in the default browser.
 * Each install uses your own Google client (type "Desktop app"), entered once.
 */
function DesktopGoogleConnect() {
  const { t } = useTranslation();
  const toast = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void desktop?.google.status().then((s) => setConfigured(s.configured));
  }, []);

  if (!desktop || configured === null) return null;
  const bridge = desktop;

  async function saveClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await bridge.google.setClient(clientId, clientSecret);
    if (!res.ok) return setError(res.error);
    setConfigured(true);
    setEditing(false);
    setClientSecret("");
  }

  async function connect() {
    setBusy(true);
    setError(null);
    const res = await bridge.google.connect();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await syncCalendarStatus();
    await refreshCalendar().catch(() => undefined);
    toast.show(t("settings.connected"));
  }

  if (!configured || editing) {
    return (
      <form onSubmit={saveClient} className="space-y-2">
        <p className="max-w-prose text-sm text-muted">{t("settings.googleClientHelp")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={t("settings.googleClientId")}
            aria-label={t("settings.googleClientId")}
            autoComplete="off"
            className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={t("settings.googleClientSecret")}
            aria-label={t("settings.googleClientSecret")}
            autoComplete="off"
            className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">{t("common.save")}</button>
          {configured && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-3.5 py-2 text-sm hover:bg-surface-2"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void connect()}
          disabled={busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {busy ? t("settings.googleWaiting") : t("settings.connect")}
        </button>
        <button onClick={() => setEditing(true)} className="text-sm text-muted hover:text-ink">
          {t("settings.googleChangeClient")}
        </button>
      </div>
      {busy && <p className="text-sm text-muted">{t("settings.googleBrowserNote")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro && <p className="mt-1 max-w-prose text-sm text-muted">{intro}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-[13px] text-muted">{help}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div role="radiogroup" className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === v ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
