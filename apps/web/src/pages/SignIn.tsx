import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, auth } from "../lib/api";

export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(password);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t("auth.wrong"));
      else if (err instanceof ApiError && err.status === 429) setError(err.message);
      else setError(t("auth.offline"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm">
        <img src="./icon.svg" alt="" className="mb-6 size-12" />
        <h1 className="text-[28px] leading-tight font-semibold">{t("auth.title")}</h1>
        <p className="mt-2 text-muted">{t("auth.help")}</p>

        <label htmlFor="password" className="mt-8 mb-1.5 block text-[13px] font-medium text-muted">
          {t("auth.password")}
        </label>
        {/* A username field (hidden) lets phone password managers save the password for this site. */}
        <input type="text" name="username" autoComplete="username" value="day-planner" readOnly hidden />
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 focus:border-accent"
        />
        {error && (
          <p id="signin-error" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button
          disabled={busy || !password}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("auth.signingIn") : t("auth.submit")}
        </button>
      </form>
    </main>
  );
}
