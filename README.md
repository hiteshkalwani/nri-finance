# NRI Finance

A personal finance app for someone earning in yen in Japan and sending money home to India. It tracks spending in
billing cycles that run from the 25th to the 24th, money sent home, an emergency fund, the Indian home loan and SIP
investments, on phone and laptop.

v2 is a Vue web app with a Node API, backed by Postgres with Supabase Auth. The original single-file app (v1) lives in
[`legacy/`](legacy/), and its data can be imported into v2.

**Status:** M1 (spending) is built locally. What is built and what is pending, module by module:
[`docs/checklist.md`](docs/checklist.md), or the visual version
[`docs/diagrams/nri-plan-overview.html`](docs/diagrams/nri-plan-overview.html) (open it in a browser).

---

## Quick start

Prerequisites: **Docker Desktop** (running), **Node 22+**, **pnpm 11** (`corepack enable` picks the version pinned in
`package.json`), and **Google Chrome** for the end-to-end test.

```bash
pnpm install
pnpm stack:up     # first run: generates local keys, starts Postgres + Auth in Docker, applies migrations
pnpm dev          # web on http://localhost:5173, API on http://localhost:8787 (hot reload)
```

Then create your local login (sign-ups are closed, as in production, so accounts are created with the admin API):

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"choose-a-password","email_confirm":true}'
```

Open http://localhost:5173, sign in, and go to **Settings → Import from v1** to load a `finance-data.json` exported by
the old app (`legacy/seed-data.json` is a sample). Importing twice does not create duplicates.

When you are done: `pnpm stack:down` (keeps your data) or `pnpm stack:reset` (wipes the local database).

---

## Using the app

- **Dashboard** (`/`) — pick a billing cycle with the arrows (defaults to the current cycle in JST); cards for income,
  spent, sent home and kept; a donut of spend by category and a 12-cycle bar chart, each with a keyboard-reachable
  text list alongside it. Click a category or a bar to open the ledger filtered to it.
- **Spend** (`/spend`) — the ledger, grouped by date with a day total, with cycle, category, payment method,
  need/want and search filters, sort and paging, all kept in the URL so a link or the back button returns to the
  same view. Click a row to edit it (`/spend/:id`); editing offers delete, with an undo.
- **Add expense** (`/spend/new`) — quick-add from the phone's bottom nav. Enter the amount in ¥ or ₹ (converted and
  stored at the planning rate), pick a category (payment method and need/want default from that category's last
  use), and a date that defaults to today in JST unless you change it.
- **Settings** — update your profile, manage categories (add, rename, pick one of 12 colours or an emoji icon,
  reorder with the up/down buttons, archive, or delete when unused), import from v1, and choose the theme under
  Appearance (System, Light or Dark — remembered per device; System follows the OS).

---

## How it fits together

```
Browser (Vue 3 + Vuetify) ──sign-in──▶ Supabase Auth ──▶ access token (ES256 JWT)
        │
        └── /api/* with the token ──▶ Hono API (Node)
                                        │ verify token against Auth's public keys (JWKS)
                                        │ validate input (zod, shared with the web app)
                                        ▼
                                     Postgres — each request runs in one transaction as role
                                     `authenticated` with your user id, so row-level security
                                     lets you see only your own rows
```

- Money is exact: yen are integers; rupees are integer paise in code and `numeric(14,2)` in the database.
- "Today" and billing cycles use the profile's timezone (Asia/Tokyo), never UTC.
- The browser talks to Supabase only for sign-in; it never connects to the database.

In production the web app and API are one Vercel project (static files + one Node function in Tokyo, `hnd1`) and the
database and sign-in are a Supabase project in Tokyo. Locally, the same pieces run like this:

| What | Where | Address |
|---|---|---|
| Web app (dev, hot reload) | your Mac, `pnpm dev` | http://localhost:5173 |
| API (dev) | your Mac, `pnpm dev` | http://localhost:8787 (Vite proxies `/api`) |
| Sign-in (Supabase Auth, via an nginx gateway) | Docker | http://127.0.0.1:54321/auth/v1 |
| Postgres (Supabase image, user `postgres`) | Docker | 127.0.0.1:54322 |
| Built app, production-like (`stack:check` only) | Docker | http://localhost:3000 |

All Docker ports listen on 127.0.0.1 only. Design: [`docs/superpowers/specs/2026-10-05-local-stack-design.md`](docs/superpowers/specs/2026-10-05-local-stack-design.md).

---

## Commands

| Command | What it does |
|---|---|
| `pnpm stack:up` | Start Postgres, Auth and the gateway; wait until healthy; apply migrations. Generates keys on first run. |
| `pnpm dev` | Web + API on your Mac with hot reload (needs `stack:up`). |
| `pnpm stack:check` | The integration check: `stack:up`, build the production app image and serve it on :3000, then run the integration and e2e tests against it. CI runs exactly this. |
| `pnpm stack:down` | Stop everything; keep the database. |
| `pnpm stack:reset` | Stop everything and delete the local database. |
| `pnpm stack:keys` | Generate local keys (`docker/.env.stack.local`) and `.env.local`. Refuses to overwrite; see Troubleshooting. |
| `pnpm typecheck` · `pnpm lint` | TypeScript and ESLint across the workspace. |
| `pnpm test:unit` | Unit tests (core, contracts, web, API). No Docker needed. |
| `pnpm test:scripts` | Tests for the build and stack scripts (`node --test`). |
| `pnpm test:integration` | Database and API tests against the running stack (real Postgres + Auth, row-level security). |
| `pnpm test:e2e` | Playwright smoke test on a phone-sized screen (starts `pnpm dev` if needed). |
| `pnpm db:generate` | Generate a SQL migration from changes to `packages/db/src/schema.ts`. |
| `pnpm db:migrate` | Apply migrations to the database in `.env.local` (`stack:up` does this for you). |
| `pnpm build:vercel` | Production build in Vercel's Build Output format (`.vercel/output`). |

Before pushing, the full local equivalent of CI is:

```bash
pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:scripts && pnpm build:vercel && pnpm stack:check
```

---

## Configuration and secrets

`pnpm stack:keys` (run automatically by the first `stack:up`) writes two files. Both are gitignored, readable only by
you, and only ever used on this machine:

| File | Contents | Read by |
|---|---|---|
| `docker/.env.stack.local` | Postgres password, Auth signing key, `anon` and `service_role` keys | docker compose |
| `.env.local` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | API, tests, migrations, Vite |

`.env.local` is rebuilt from `docker/.env.stack.local` on every `stack:up`, so it is safe to lose or overwrite (for
example by `vercel env pull`). `stack:up` and `stack:check` also pass these values explicitly to migrations and tests,
so a `DATABASE_URL` exported in your shell for the cloud project can never redirect them.

Rules that keep it safe:
- Only `VITE_*` values reach the browser, and both are public by design (the Supabase URL and anon key).
- The API verifies tokens with Auth's public keys; it never reads a JWT secret.
- `SUPABASE_AUTH_INTERNAL_URL` is set only inside Docker (so the containerised API can reach Auth); leave it unset
  everywhere else.
- Never commit `.env*.local`, `finance-data.json` or `.e2e-user.json`.

---

## Testing

| Layer | Where | Runs against |
|---|---|---|
| Calculations (cycles, money, rounding) | `packages/core/test` | nothing (pure) |
| Request/response schemas | `packages/contracts/test` | nothing |
| Web helpers | `apps/web/test` | jsdom |
| API unit (auth, errors, config) | `apps/api/test/*.test.ts` | in-process |
| Row-level security | `packages/db/test` | the stack's Postgres, two real users |
| API integration (profile, v1 import, rollback) | `apps/api/test/*.int.test.ts` | the stack's Postgres + Auth |
| Build/stack scripts | `scripts/*.test.mjs` | nothing / a temp directory |
| End to end | `e2e/` | Vite (`test:e2e`) or the built app on :3000 (`stack:check`) |

Integration and e2e tests create throwaway users and delete them afterwards.

---

## Repository layout

```
apps/web/            Vue 3 + Vite + Vuetify app (pages, router, API client)
apps/api/            Hono API: routes, middleware (auth, per-request transaction), services
packages/core/       Pure calculations: billing cycles, ¥/₹ money maths
packages/contracts/  zod schemas and types shared by web and API
packages/db/         Drizzle schema, SQL migrations (incl. row-level security), db helpers
packages/test-utils/ Test users via the Auth admin API
docker/              Local stack support: db init SQL, nginx gateway, app image
docker-compose.yml   Local stack: Postgres, Auth, gateway, and the app (profile "app")
scripts/             Build for Vercel, serve the build locally, stack commands, key generation
e2e/                 Playwright smoke test
legacy/              v1 single-file app and its tooling
docs/                PRD, TRD, specs, plans, checklist, diagrams
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `stack:up` fails with "port is already allocated" on 54321/54322 | Something else holds the port, often an old Supabase CLI stack: `docker ps`, then stop it (`npx supabase stop` in the old project, or `docker stop <name>`). |
| `stack:keys` says the file already exists | Intended: new keys don't match the existing database. Run `pnpm stack:reset`, then `pnpm stack:keys --force`, then `pnpm stack:up`. |
| `stack:up` says "a local database already exists, but this checkout has no docker/.env.stack.local" | Every checkout of this repo (including git worktrees) shares one local database. Copy `docker/.env.stack.local` from the checkout that created it to keep the data, or `pnpm stack:reset` to start fresh. |
| Auth container unhealthy after changing keys or the password | The database volume still has the old password. `pnpm stack:reset` and `pnpm stack:up`. |
| `... missing — run "pnpm stack:up"` from tests | `.env.local` is missing; `pnpm stack:up` creates it. |
| Sign-in works on :5173 but not on another origin | The gateway only allows `http://localhost:5173` and `http://localhost:3000`; use one of those (not `127.0.0.1:5173`). |
| e2e says Chrome is not found | Install Google Chrome, or `pnpm exec playwright install chrome`. |
| API answers 503 "database unavailable" | The stack is down (`pnpm stack:up`); in production, the free Supabase project may be paused (restore it in the Supabase dashboard). |
| Need to look inside | `docker compose --env-file docker/.env.stack.local logs auth` (or `db`, `gateway`, `app`); `docker compose --env-file docker/.env.stack.local exec db psql -U postgres` |

---

## Documentation

- [`docs/prd.md`](docs/prd.md) — product requirements, requirement IDs (`TXN-1` …) and milestones M0–M5
- [`docs/trd.md`](docs/trd.md) — technical design: architecture, data model, API, security, environments, testing
- [`docs/checklist.md`](docs/checklist.md) — implementation status by module
- [`docs/diagrams/`](docs/diagrams/) — plan overview (WBS, roadmap), system map, cloud architecture, data model, money flow
- [`docs/superpowers/specs/`](docs/superpowers/specs/) and [`docs/plans/`](docs/plans/) — designs and implementation plans per piece of work

## v1 (legacy)

The original app is a single HTML file that reads and writes a local `finance-data.json`. It is kept in `legacy/` until
v2 replaces it (milestone M5). Its data imports into v2 from **Settings → Import from v1**.
