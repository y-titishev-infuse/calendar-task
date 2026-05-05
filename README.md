# Daily Task Sidebar

A calendar-aware prep and task list for today. Reads your Google Calendar
(read-only), asks short prep questions about each event via Claude, then
synthesizes a focused task list shown in a narrow sidebar with checkboxes.

**Read-only by design.** The app never writes to Google Calendar or Gmail —
only the `calendar.readonly` OAuth scope is requested, and there are no code
paths that call any Google write endpoint.

## Setup

### 1. Install

```bash
npm install
```

### 2. Google Cloud OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Enable the **Google Calendar API** for your project.
3. Create OAuth client ID → Web application.
4. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   (and your production URL when you deploy).
5. Copy the client ID and secret.

### 3. Anthropic API key

Get one at <https://console.anthropic.com/>.

### 4. Environment

Copy `.env.local.example` to `.env.local` and fill in:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=...        # any random string; e.g. `openssl rand -base64 32`
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=...
```

### 5. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with Google, and you should land on
`/today`.

## How it works

1. `/today` server component reads today's events via the Google Calendar API
   (`calendar.events.list`, `singleEvents=true`).
2. Click **Get prep questions** on an event → `POST /api/questions` calls
   Claude with the event details and returns 1–3 short questions.
3. Type answers inline. They persist to `localStorage` per day.
4. Click **Generate today's tasks** → `POST /api/tasks` sends all events plus
   answers to Claude, which returns a structured task list.
5. Tasks appear in the left sidebar with checkboxes. Completion state stays
   in `localStorage`. The state resets when the date rolls over.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- NextAuth v5 (Google provider, `calendar.readonly` scope)
- `@anthropic-ai/sdk` — `claude-sonnet-4-6` with prompt caching on the system
  prompt and `tool_use` for structured output

## Deploy with Docker Compose

The repo ships a multi-stage `Dockerfile` (Next.js standalone output, non-root
user) and a `docker-compose.yml` that runs a single `web` service.

### One-time setup on the server

```bash
git clone <repo> calendar-task-sidebar && cd calendar-task-sidebar
cp .env.production.example .env.production
# edit .env.production — fill in NEXTAUTH_URL, AUTH_SECRET, Google creds, LLM key
```

Generate `AUTH_SECRET` with `openssl rand -base64 32`.

In **Google Cloud Console → Credentials → your OAuth client**, add the
production redirect URI:
`https://your-domain.example.com/api/auth/callback/google`.

### Build and run

```bash
docker compose up -d --build
docker compose logs -f web
```

The container listens on **3000** internally, mapped to host **3000** by
default. Override with `HOST_PORT=8080 docker compose up -d`.

### Behind a reverse proxy

Point your nginx/Caddy/Traefik upstream at `http://<host>:3000`. The compose
file already sets `AUTH_TRUST_HOST=true` so Auth.js v5 honors the forwarded
host. Make sure the proxy forwards `X-Forwarded-Host` and
`X-Forwarded-Proto`, and that `NEXTAUTH_URL` matches the public HTTPS URL.

### Updating

```bash
git pull
docker compose up -d --build
```

The standalone image rebuilds quickly because deps cache by `package.json` /
`package-lock.json`.

### Notes

- `localStorage` lives in the user's browser, so this app is fully stateless
  on the server — no volumes, no DB.
- Google access is read-only by scope; nothing in the container can call
  Google write endpoints.
