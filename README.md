# Day Planner

A personal task manager that plans your day around your calendar. It reads your Google or Apple calendar, weighs each task's due date and importance, and recommends what fits into today's free time. An AI planner, using your own GPT, Claude or Gemini key, breaks big goals into dated tasks.

## What works now (v1, first slice)

- **My tasks:** add, edit, delete (with undo), and mark done (with undo). Tasks have a name, date and optional time, importance, project, time estimate and notes. Press `Q` anywhere to add a task.
- **Today:** a recommended plan for the rest of the working day, placed between calendar events, with a reason for each pick. *Add to calendar* writes a task into the calendar as a time block. *Not today* sets a task aside.
- **Projects:** create, archive and restore projects, with progress shown for each.
- **AI planner:** describe a goal and review the proposed tasks (edit, remove, re-date) before saving them as a project. It may ask up to 3 clarifying questions first.
- **Settings:** language, theme, working hours, days off, buffer around meetings, unplanned time, calendar connection, AI model and key, export.
- **Hebrew and English,** with full right-to-left layout.
- **Offline-first:** data lives in the app's storage (IndexedDB). Changes are queued and pushed to the server when it's reachable.
- **Three ways to run it:** a Windows desktop app with the server inside, a web app installable on phones, or both.

Without the API server, the web app runs in **local mode**. It uses a built-in sample calendar, and the AI planner falls back to a clearly labelled template.

## Project layout

```
packages/core   Shared types and the planning engine (scoring, free slots, plan fitting),
                AI schemas and prompt, calendar provider interface. Pure functions, unit tested.
apps/web        React + Vite PWA. Tailwind, i18next, Dexie (IndexedDB).
apps/api        Hono on Node. Sign-in, AI calls (Vercel AI SDK), Google and Apple calendar,
                sync. Serves the built web app in production. Secrets use AES-256-GCM.
apps/desktop    Electron app for Windows: the web app and server in one installer,
                tray, global shortcut, automatic updates from GitHub Releases.
Dockerfile      One image for production (Railway, Fly.io, Render or any Docker host).
```

## Run it

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm test                 # core + API tests
pnpm dev:web              # web app only, local mode: http://localhost:5173
```

With the server:

```bash
cp apps/api/.env.example apps/api/.env
# set ENCRYPTION_KEY (the command to generate one is in the file)
pnpm dev                  # web on :5173, API on :8787 (the web dev server proxies /api)
```

Sign-in is off locally while `APP_PASSWORD` is empty. Set it to try the sign-in screen.

### Connect an AI model

Go to Settings → AI model, pick OpenAI, Anthropic or Google, enter a model id and your API key, then choose **Save and test**. The server makes one tiny test call. It stores the key only if the call works, and stores it encrypted.

### Connect Google Calendar (web and Railway)

1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen. Use *External* and *Testing*, and add yourself as a test user.
3. Create an OAuth client of type **Web application**. Add `http://localhost:8787/api/calendar/google/callback` as a redirect URI.
4. Put the client id and secret in `apps/api/.env`, restart, and choose **Connect** in Settings.

In testing mode this works for you right away. Going public later needs Google's app verification for calendar scopes. The desktop app uses a different client type; see below.

### Connect Apple Calendar (iCloud)

Create an app-specific password at appleid.apple.com (Sign-In and Security → App-Specific Passwords). Enter it in Settings with your Apple ID email. It's stored encrypted and used only for CalDAV.

## Windows desktop app

`apps/desktop` packages the whole app, server included, as a Windows program. It needs no hosting, no terminal and no sign-in. Everything stays on your PC: tasks in the app's storage, and AI keys and calendar logins encrypted with Windows' own protection for your user account (DPAPI).

What you get:

- A normal installer (`Day-Planner-Setup-<version>.exe`) with Start menu and desktop entries.
- A tray icon. Closing the window keeps the app running; **Quit** is in the tray menu.
- **Ctrl+Shift+Space** from anywhere opens the add-task window.
- **Start with Windows**, a checkbox in the tray menu. It starts quietly in the tray.
- Automatic updates from GitHub Releases (see below).

Your data lives in `%APPDATA%\Day Planner`. Updating or uninstalling the app doesn't remove it.

### Try it on your PC (development)

```bash
pnpm install
pnpm desktop          # builds the web app and opens it in a desktop window
pnpm desktop:dist     # builds an installer in apps/desktop/release (no automatic updates)
```

### First install

The installer isn't code-signed, so Windows SmartScreen shows **"Windows protected your PC"** the first time. Choose **More info → Run anyway**. Code-signing certificates cost money; you can add one later and the warning goes away.

### Release an update (automatic updates)

One-time setup:

1. Create a **public** GitHub repository and push this folder to it. Secrets never go in the repository: `.env` files are ignored, and the desktop app keeps its keys on your PC.
2. That's it. The workflow in `.github/workflows/release-desktop.yml` already has permission to publish releases.

Each release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions then runs the tests, builds the installer on Windows using the tag as the version, and publishes it as a GitHub Release. Progress shows in the repository's **Actions** tab, and takes about 10 minutes.

- **First time:** download `Day-Planner-Setup-1.0.0.exe` from the release and install it. Only installers built this way know where to look for updates.
- **After that:** each new tag (`v1.0.1`, `v1.1.0`, …) is picked up automatically. The app checks when it starts and every 6 hours, downloads the update in the background, and shows **"Version x is ready. Restart to update"**. If you ignore it, the update installs the next time you quit. You can also choose **Check for updates** in the tray menu.

Version numbers must go up (`1.0.0` → `1.0.1` → `1.1.0`), or the app won't see the release as newer.

### Google Calendar in the desktop app

The desktop app signs in to Google in your normal browser, then saves the connection on your PC. It needs a Google client of type **Desktop app**:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen. Use *External* and *Testing*, and add your Google account as a test user.
3. Go to **Credentials → Create credentials → OAuth client ID** and choose type **Desktop app**. No redirect address is needed.
4. In Day Planner → **Settings → Calendar → Google Calendar**, paste the client ID and secret, then choose **Connect**.

Apple Calendar and the AI model connect from Settings as usual.

### How it works

The window loads `app://planner/`. Every request to that address is answered by the API server running inside the app, so no network port is opened and nothing else on the computer can reach your data. The server code is the same as on Railway; only the address is different.

## Deploy to Railway and install on your phone

One Railway service runs everything: the server also serves the app's screens, so the app and its API share one address. Railway builds the included `Dockerfile` automatically.

### 1. Push the code to GitHub

Push this folder to a GitHub repository (the same one as the desktop releases is fine). `.env` files are ignored, so no secrets go to GitHub.

### 2. Create the Railway service

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick the repository. Railway finds the `Dockerfile` and starts a first build. That first deploy is expected to fail, because the variables aren't set yet.
2. Open the service → **Settings → Networking → Generate Domain**. If it asks for a port, enter `8787`. Copy the address, for example `https://day-planner-production.up.railway.app`.

### 3. Add a volume (keeps your data across deploys)

Add a volume to the service (the command palette `⌘K`, or right-click the project canvas → **Volume**) and set its **mount path** to `/data`. Without it, every deploy starts empty.

### 4. Set the variables

In the service → **Variables**, add:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | The address from step 2, with `https://` and no trailing slash |
| `APP_PASSWORD` | Your sign-in password, at least 12 characters |
| `ENCRYPTION_KEY` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste the result |
| `PORT` | `8787` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional, for Google Calendar (see below) |

Save a copy of `ENCRYPTION_KEY` somewhere safe, such as a password manager. If it's lost or changed, your saved AI key and calendar connection have to be entered again.

Railway redeploys when variables change. The server refuses to start in production without a strong `APP_PASSWORD` and a valid `ENCRYPTION_KEY`, and the deploy log says which one is missing.

### 5. Optional: health check

In **Settings → Deploy**, set the health check path to `/api/health`. Railway then switches to a new version only after it answers.

### 6. Install it on your phone

Open the address and sign in. Then:

- **iPhone:** in **Safari**, tap **Share → Add to Home Screen**.
- **Android:** in **Chrome**, tap **⋮ → Install app** (or **Add to Home screen**).

It opens full-screen from its own icon. Your password manager can save the password, and you stay signed in on that device for 90 days.

### Google Calendar on Railway

In Google Cloud Console, add `<PUBLIC_URL>/api/calendar/google/callback` to the web OAuth client's redirect URIs. Keep the localhost one too if you still develop locally. Then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Railway.

### Updating

Push to GitHub and Railway rebuilds and redeploys. Your data stays on the volume. The installed phone app picks up the new version the next time it opens.

### Security notes

- Every API route needs a signed-in session, except the health check, the sign-in itself and the Google return address (which is protected by a one-time code).
- The session cookie can't be read by page scripts and is only sent over HTTPS.
- After 8 wrong passwords, an address is locked out for 15 minutes.
- Changing `APP_PASSWORD` signs out every device.
- Pages are served with a strict content security policy.

## How the daily plan picks tasks

`packages/core/src/plan.ts`:

1. Tasks you already added to the calendar today become fixed blocks.
2. Free time = working hours − calendar events (with the buffer) − fixed blocks − time already passed.
3. Each open task gets a score: importance (high 30, medium 18, low 8) plus urgency (overdue 40+, today 36, tomorrow 26, within 3 days 16, within a week 8).
4. Tasks are placed highest score first, each into the earliest gap long enough for it, until free time minus the unplanned share runs out.

## Built in for later

- **Voice input (v1.1):** every planner message goes through one `PlannerInput` pipeline. The mic button is in place, and the server has a `transcribeAudio` slot that currently answers 501.
- **Accounts:** v1 has one user and a password. Every row carries `userId`, the sign-in check is one middleware (`auth.ts`) to swap for Supabase Auth, and `store.ts` is one interface to swap for Postgres.
- **Mobile store apps:** calendar, notifications and speech sit behind small interfaces, so a Capacitor build can add native versions (including on-device Apple Calendar with no app password).

## Next steps

- Pull sync (server → other devices), so tasks added on the phone appear on the PC.
- Calendar picker: choose which calendars to read and which one to write to.
- Morning notification with the day's plan, and reminders.
- Voice input.
