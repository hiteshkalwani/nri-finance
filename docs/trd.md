# NRI Finance — Technical Requirements (TRD)

Status: Draft for review · Date: 2026-10-02
Companion: [PRD](./prd.md) (requirement IDs like `TXN-1` refer to it) · Diagram: `nri-cloud-architecture.png`

## 1. Architecture

```
Phone / laptop ── Vue 3 PWA (static, Vercel CDN)
      │  Supabase Auth (email+password) → access token (JWT)
      ▼
/api/*  Hono app on a Vercel Node function
      │  verify JWT (Supabase JWKS) → user_id
      │  validate input (zod) → handlers → packages/core (calculations)
      ▼
Supabase Postgres via transaction pooler (port 6543)
      every request runs in a transaction as role `authenticated`
      with the caller's JWT claims set, so row-level security applies
```

- The web app and the API are served from the same Vercel domain (`/` and `/api/*`), so no CORS configuration is needed.
- The browser never connects to Postgres. It uses Supabase only for sign-in (`supabase-js` auth client with the anon key).
- Totals, cycles, schedules and projections are computed by `packages/core` from stored records; nothing derived is stored.

### Corrections to the earlier diagrams

1. Row-level security only applies if queries run as a non-owner role. The API therefore sets `role authenticated` and `request.jwt.claims` per request (§5.2). Connecting as `postgres` would bypass RLS.
2. Supabase's free plan does not include downloadable daily backups. Backups come from the in-app JSON export and a weekly `pg_dump` job (§9.3).

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 22, TypeScript (strict) | Same language across web, API, core |
| Package manager | pnpm workspaces | Monorepo |
| Web | Vue 3 + Vite, Vue Router, Pinia (UI state), TanStack Query for Vue (server state) | |
| UI kit | Vuetify 3 (Material Design) | Matches the Material look of v1; mobile bottom nav |
| Charts | Chart.js 4 + vue-chartjs | |
| PWA | vite-plugin-pwa | App shell cached; data online only |
| API | Hono on Vercel Node runtime | One function handles `/api/*` |
| Validation | zod, shared schemas in `packages/contracts` | Same schema validates the form and the request |
| DB access | Drizzle ORM + postgres.js (`prepare: false` for the pooler) | drizzle-kit for migrations |
| Auth | Supabase Auth; JWT verified with `jose` against the project JWKS | Sign-ups disabled in Supabase settings (AUTH-3) |
| Tests | Vitest (unit + integration), Playwright (e2e smoke) | |
| Lint/format | ESLint + Prettier | |
| CI | GitHub Actions | Vercel deploys from GitHub |

## 3. Repository layout

```
/                         this repository
├── apps/web/             Vue app
│   └── src/{pages,components,composables,stores,api,router}
├── api/[[...route]].ts   Vercel entry → apps/api
├── apps/api/             Hono app: src/{routes,middleware,services}
├── packages/core/        pure calculations, no I/O (port of js/calc.js + tests)
├── packages/contracts/   zod schemas + TS types for every request/response
├── packages/db/          Drizzle schema, migrations, RLS policies, request-scoped db helper
├── docker/               Local stack support: db init SQL, nginx gateway, app image
├── docker-compose.yml    Local stack: Supabase Postgres + Auth, gateway, app (profile)
└── docs/                 prd.md, trd.md, plans/
```

Dependency rule: `core` depends on nothing; `contracts` depends on `core` only for types; `db` depends on `contracts`; `api` depends on all three; `web` depends on `core` and `contracts`, never on `db`.

## 4. Data model

Conventions:
- Every table has `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger), except where noted.
- ¥ is `integer` (yen has no minor unit). ₹ is `numeric(14,2)` in the database and **integer paise** in application code and JSON (field names end in `Paise`). No floating-point money anywhere.
- Rates are `numeric(12,6)`, ¥ per ₹ (e.g. `1.694915`).
- Dates are `date` (`YYYY-MM-DD`). "Today" is computed in the profile's timezone (Asia/Tokyo).
- Cycle labels are `char(7)` `YYYY-MM`, checked with `~ '^\d{4}-(0[1-9]|1[0-2])$'`.
- `legacy_id text` on imported tables, unique per user, makes the v1 import idempotent (IMP-4).

### 4.1 Tables

**profiles** (primary key `user_id`)
`salary_jpy integer not null`, `planning_rate_jpy_per_inr numeric(12,6) not null`, `cycle_start_day smallint not null default 25 check (1..28)`, `timezone text not null default 'Asia/Tokyo'`.

**accounts**
`name text not null`, `country country not null` (`JP`,`IN`), `currency currency not null` (`JPY`,`INR`), `type account_type not null` (`bank`,`cash`,`card`,`fd`,`investment`), `is_emergency_fund boolean not null default false`, `archived_at timestamptz`.
Check: `country = 'JP' ⇔ currency = 'JPY'` (v2 assumption; relax later if needed).

**categories**
`name text not null`, `color text not null`, `sort_order integer not null default 0`, `archived_at timestamptz`, `legacy_id text`.
Unique `(user_id, lower(name))`.

**transactions**
`occurred_on date not null`, `category_id uuid not null`, `account_id uuid`, `description text not null default ''`, `amount_jpy integer not null check (> 0)`, `entered_currency currency not null default 'JPY'`, `amount_inr numeric(14,2)` (set when entered in ₹, TXN-4), `rate_used numeric(12,6)` (set when converted), `payment_method payment_method not null` (`bank`,`cash`,`credit_card`,`ic_card`), `need_want need_want not null` (`need`,`want`), `notes text not null default ''`, `legacy_id text`.
Foreign keys: `(user_id, category_id)` → `categories (user_id, id)`; `(user_id, account_id)` → `accounts (user_id, id)` (same-owner composite keys, migration 0003).
Indexes: `(user_id, occurred_on desc)`, `(user_id, category_id)`.

**remittances**
`sent_on date not null`, `jpy_sent integer not null check (> 0)`, `inr_received numeric(14,2) not null check (> 0)`, `fee_jpy integer not null default 0 check (>= 0)`, `service text not null default ''`, `from_account_id uuid references accounts`, `to_account_id uuid references accounts`, `purpose remittance_purpose not null` (`family`,`india_savings`,`sip`,`loan_emi`,`loan_prepayment`,`other`), `loan_id uuid references loans`, `notes text not null default ''`, `legacy_id text`.
Check: `(purpose in ('loan_emi','loan_prepayment')) = (loan_id is not null)` (REM-2).
Index: `(user_id, sent_on desc)`.

**balance_snapshots**
`account_id uuid not null references accounts`, `cycle char(7) not null`, `balance_jpy integer`, `balance_inr numeric(14,2)`, `recorded_on date not null`.
Unique `(account_id, cycle)`. Check: exactly one of `balance_jpy`/`balance_inr` is set, matching the account currency (enforced in the service; DB checks non-null XOR).

**category_budgets**
`category_id uuid not null references categories`, `amount_jpy integer not null check (>= 0)`, `effective_from_cycle char(7) not null`.
Unique `(category_id, effective_from_cycle)`. The budget for cycle C is the row with the greatest `effective_from_cycle <= C` (BUD-1).

**cycle_targets**
`cycle char(7) not null`, `savings_target_jpy integer`, `emergency_fund_target_jpy integer`, `remittance_target_jpy integer`, `prepayment_target_inr numeric(14,2)`.
Unique `(user_id, cycle)`.

**loans**
`name text not null`, `principal_inr numeric(14,2) not null`, `annual_rate_pct numeric(6,3) not null`, `emi_inr numeric(14,2) not null`, `tenure_months smallint not null`, `start_cycle char(7) not null`, `closed_at timestamptz`.

**loan_planned_prepayments**
`loan_id uuid not null references loans on delete cascade`, `month_index smallint not null check (>= 1)`, `amount_inr numeric(14,2) not null check (> 0)`.
Unique `(loan_id, month_index)`.

**sip_plans** (one active per user)
`starting_monthly_inr numeric(14,2) not null`, `step_up_pct numeric(5,2) not null`, `expected_return_pct numeric(5,2) not null`, `start_year smallint not null`, `end_year smallint not null`, `redirect_emi_after_payoff boolean not null default true`.
Unique `(user_id)`.

**sip_allocations**
`plan_id uuid not null references sip_plans on delete cascade`, `fund_name text not null`, `pct numeric(5,2) not null check (> 0 and <= 100)`.
Sum to 100 is enforced in the service (SIP-2).

Every link between owned tables is a composite foreign key on `(user_id, …)`, so a row can never point at another user's row.

### 4.2 Row-level security

For every table: `alter table … enable row level security;` and one policy per operation for role `authenticated`:
`using (user_id = auth.uid()) with check (user_id = auth.uid())`.
Child tables without `user_id` of their own (`loan_planned_prepayments`, `sip_allocations`) still carry `user_id` to keep policies simple.
No policies for `anon`, so Supabase's auto-generated REST API exposes nothing to the anon key.

## 5. API

### 5.1 Conventions

- Base path `/api`, JSON in and out, camelCase fields.
- Auth: `Authorization: Bearer <supabase access token>` on every route except `/api/health`.
- Money in JSON: `…Jpy` integer yen, `…Paise` integer paise. Rates as strings with 6 decimals (`"1.694915"`) to avoid float drift.
- Lists: `?page=1&pageSize=50` (max 200) → `{ items, total, page, pageSize }`.
- Errors: `{ "error": { "code", "message", "details"? } }`
  `400 VALIDATION_FAILED` (details = zod issues), `401 UNAUTHORIZED`, `404 NOT_FOUND`, `409 CONFLICT` (e.g. category in use), `500 INTERNAL`, `503 DATABASE_UNAVAILABLE`, `503 AUTH_UNAVAILABLE` (sign-in key server unreachable; not a sign-out).
- Every request/response body has a zod schema in `packages/contracts`; the web app uses the same schemas for forms.

### 5.2 Request lifecycle

1. `auth` middleware: verify JWT with `jose.jwtVerify` against `createRemoteJWKSet(${SUPABASE_URL}/auth/v1/.well-known/jwks.json)` (keys cached in module scope), require `aud = 'authenticated'` and `iss = ${SUPABASE_URL}/auth/v1`. Put `userId = sub` and the claims on the context.
2. `db` middleware: open a transaction, run `select set_config('request.jwt.claims', $claims, true)` and `set local role authenticated`, expose the transaction as `c.var.db`.
3. Handler: parse input with the contract schema, call a service, return the contract response. Services also filter by `userId` explicitly (defense in depth on top of RLS).
4. Commit, or roll back on any thrown error; the error middleware maps errors to the codes above.

### 5.3 Endpoints

| Method & path | Purpose | Req IDs | Milestone |
|---|---|---|---|
| `GET /api/health` | Liveness, no auth | — | M0 |
| `GET /api/me` · `PUT /api/me` | Profile read / update | PROF-1 | M0 |
| `POST /api/import/v1` | Import v1 `finance-data.json` (idempotent) | IMP-1..4 | M0 |
| `GET /api/categories` · `POST` · `PATCH /:id` · `DELETE /:id` | Categories; delete returns 409 if used | CAT-1 | M1 |
| `PUT /api/categories/order` | Reorder categories | CAT-1 | M1 |
| `GET /api/transactions?cycle&categoryId&paymentMethod&needWant&q&sort&page&pageSize` | List + filters | TXN-3 | M1 |
| `GET /api/transactions/:id` · `POST /api/transactions` · `PATCH /:id` · `DELETE /:id` | Ledger CRUD; single-item `GET` for the edit page | TXN-1,2,4 | M1 |
| `POST /api/transactions/restore` | Undo after delete: re-creates a row with its original ¥/₹/rate verbatim (no re-conversion), archived category allowed | TXN-1 | M1 |
| `GET /api/dashboard?cycle` | Computed cycle summary (sections grow per milestone) | DASH-* | M1→M4 |
| `GET /api/accounts` | List accounts (read-only in M1, for the account picker) | ACC-1 | M1 |
| `POST /api/accounts` · `PATCH /:id` | Create / archive accounts | ACC-1 | M2 |
| `GET /api/remittances?cycle&purpose` · `GET /:id` · `POST` · `PATCH /:id` · `DELETE /:id` | Remittances | REM-1..4 | M2b |
| `GET /api/remittances/rates?limit` | Rate history for the rate chart (last N transfers + planning rate) | REM-5 | M2b |
| `PUT /api/cycles/:cycle/income` | Income override for a cycle, or clear it with `null` | DASH-4 | M2b |
| `GET /api/balances/:cycle` · `PUT /api/balances/:cycle` | Snapshots for a cycle, bulk upsert | BAL-1,2 | M2 |
| `GET /api/loans` | List loans (for the remittance loan picker) | LOAN-1 | M2b |
| `POST /api/loans` · `PATCH /:id` | Create / edit loans | LOAN-1 | M3 |
| `GET /api/loans/:id/schedule` | Planned vs actual schedule, payoff, interest | LOAN-2..4 | M3 |
| `PUT /api/loans/:id/planned-prepayments` | Replace planned extras | LOAN-3 | M3 |
| `GET /api/sip` · `PUT /api/sip` | Plan + allocations | SIP-1,2 | M3 |
| `GET /api/sip/projection` | Yearly projection + actuals | SIP-3,4 | M3 |
| `GET /api/budgets?cycle` | One row per active category, budgeted or not, with spend and near/over state | BUD-1,2, DASH-9 | M4 |
| `PUT /api/budgets` | Upsert the budget at `{cycle, items[]}`; `amountJpy: null` removes that cycle's row | BUD-1 | M4 |
| `GET /api/targets/:cycle` · `PUT /api/targets/:cycle` (full replace) | Per-cycle targets | TGT-1 | M4 |
| `POST /api/targets/:cycle/copy-previous?overwrite` | Copy the previous cycle's targets; 409 without `overwrite` if targets already exist, 400 if the previous cycle has none | TGT-1 | M4 |
| `GET /api/review/:cycle` | Closed-cycle summary, target vs actual, budget alerts, highlights, `balancesDone`/`nextTargetsSet` | REV-1, TGT-2 | M4 |
| `GET /api/reports/cycles?from&to` · `/categories?from&to` · `/fx?from&to` | Report series | REP-1,2, REM-5 | M5 |
| `GET /api/export?format=json\|csv\|xlsx&entity` | Export | EXP-1 | M5 |

## 6. Calculation engine (`packages/core`)

Pure functions, no I/O, 100% branch coverage target. Ported from v1 `js/calc.js` with its tests, adjusted to integer minor units.

| Function | Rule |
|---|---|
| `cycleOf(date, startDay)` | Day ≥ startDay belongs to the next month's cycle; Dec 25 → next year's `-01`. |
| `cycleBounds(cycle, startDay)` | `{ start, end }` inclusive dates. |
| `todayIn(timezone, now?)` | Local calendar date, never UTC (`toISOString` is banned in app code by lint rule). |
| `cycleRange(from, to)` | Ordered list of cycle labels. |
| `effectiveRate(jpySent, inrPaise)` | ¥ per ₹, 6 decimals. |
| `jpyFromInr(paise, rate)` / `inrFromJpy(jpy, rate)` | Rounded half-up to whole yen / whole paise. |
| `summarizeCycle(records, cycle, profile)` | Income, spent, kept, savings rate, sent by purpose. Remittance fees are reported separately, not as spending (PRD open question 1). |
| `emergencyFund(snapshots, spendHistory)` | Balance, months covered (3-cycle average spend). |
| `amortize(loan, actuals, planned)` | Monthly rows; closing clamped at 0; stops at payoff; actual payments override plan for past months. |
| `loanTotals(rows)` / `loanOutcome(loan, actuals, planned)` | Payoff cycle, months and total interest; outcome also reports the plan vs actual-to-date schedule and interest saved. |
| `sipMonthlyFor(plan, year)` / `sipProjection(plan, redirect)` | Planned monthly SIP for a year; yearly rows with an optional EMI redirect starting the cycle after the real payoff. |
| `budgetFor(budgets, categoryId, cycle)` | Latest row with `effective_from_cycle <= cycle`. |

## 7. Web app

- Routes: `/login`, `/` (dashboard), `/spend`, `/spend/new` (quick add), `/spend/:id` (edit), `/remit`, `/accounts`, `/balances/:cycle`, `/loans/:id`, `/sip`, `/budgets`, `/review/:cycle`, `/reports`, `/settings`, and a catch-all for unknown routes (Not found page).
- Layout: bottom navigation on phones (Dashboard, Spend, **+**, Remit, More), side navigation on wider screens.
- Server state through TanStack Query (cache per resource, invalidate on mutation); Pinia only for UI state (selected cycle, filters).
- Forms validate with the shared zod schema before sending; the API validates again.
- Money input: ¥ fields accept whole numbers only; ₹ fields accept two decimals and are converted to paise before sending.
- Session: `supabase-js` handles refresh; an expired session opens sign-in in a dialog so an in-progress form is kept (AUTH-2, implemented).
- Accessibility: labels on every control, visible focus, color never the only signal for over-budget.

## 8. Security

- Secrets: `DATABASE_URL` (pooler) only on the server; the web app gets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only. The service-role key is never used by the app.
- Sign-ups disabled in Supabase Auth; my account is created once from the Supabase dashboard.
- RLS on every table (§4.2) plus explicit `user_id` filters in services.
- Security headers via `vercel.json`: `Content-Security-Policy` (self + Supabase URL), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`.
- Input: zod on every body and query; text fields length-capped (description 200, notes 2000).
- Output: Vue escapes interpolation; `v-html` is banned by lint rule.

## 9. Environments, deployment, operations

### 9.1 Environments

| Env | Web + API | Database |
|---|---|---|
| Local (dev) | `pnpm stack:up`, then `pnpm dev` (Vite + Hono on the Mac, hot reload) | docker compose: Supabase Postgres 17 + Auth, nginx gateway on 127.0.0.1:54321 |
| Local (check) | `pnpm stack:check`: the Vercel build output in a container on :3000 | Same compose stack |
| Preview | Vercel preview per pull request | Supabase dev project |
| Production | Vercel production (main branch) | Supabase production project |

### 9.2 Deployment

- GitHub repository connected to Vercel; `vercel.json` builds `apps/web` to static files, routes `/api/*` to `api/[[...route]].ts`, and falls back to `index.html` for client routes.
- Migrations: `drizzle-kit generate` produces SQL in `packages/db/migrations`; RLS policies live in hand-written SQL migrations next to them. Applied with `drizzle-kit migrate` from CI on merge to main, before the Vercel production deploy is promoted.

### 9.3 Backups and free-tier limits

- Weekly GitHub Actions job runs `pg_dump` against production and stores the encrypted dump as a private workflow artifact (90-day retention). Plus in-app JSON export (EXP-1).
- Supabase free projects pause after 7 days without activity; the weekly backup job also keeps the project awake.
- Vercel Hobby function limit: keep each request well under 10 s; heavy work (export, import) streams or batches.
- Free Postgres is 500 MB; at roughly 1,000 rows a year this is not a constraint.

## 10. Testing

| Layer | What | Tool |
|---|---|---|
| core | Every function in §6, including cycle boundaries (24th/25th, Dec→Jan), rounding, clamp at zero, JST "today" | Vitest |
| contracts | Schemas accept valid and reject invalid payloads | Vitest |
| API integration | Each route against local Supabase; two test users per suite; asserts user A can never read or change user B's rows (via API and via direct SQL as `authenticated`) | Vitest + docker compose stack |
| Import | v1 `finance-data.json` fixture → expected rows; second run inserts nothing | Vitest |
| Web | Form behaviour (quick add, remittance rate preview) | Vitest + Vue Test Utils |
| End to end | Sign in → add expense → dashboard updates, on a phone-sized viewport; against Vite in dev and the built app in `stack:check` | Playwright |

CI runs typecheck, lint, unit and script tests, the production build, then `pnpm stack:check` (integration and e2e against the built app). E2E also runs against the Vercel preview URL once deploys exist.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Serverless cold starts make quick-add feel slow | Keep the API bundle small (Hono, no heavy deps on the hot path); optimistic UI updates on the phone |
| Connection limits through the pooler | Transaction mode, one short transaction per request, `prepare: false` |
| Supabase project pauses | Weekly job touches the DB; app shows a clear "database waking up" message on 503 |
| Rounding drift between ¥ and ₹ | Integer minor units end to end; conversions only at entry, stored, never recomputed |
| Losing data on the free tier | Weekly `pg_dump` + JSON export; import is idempotent so a restore is safe |

## 12. Decisions to confirm before M0

1. UI kit: Vuetify 3 (Material Design). Alternative: PrimeVue or plain Tailwind.
2. Local development uses a project-owned docker compose stack (needs Docker Desktop on the Mac); see `docs/superpowers/specs/2026-10-05-local-stack-design.md`.
3. A GitHub repository is needed for Vercel deploys and the backup job. Public or private? (Private recommended.)
4. The three PRD open questions (§9 of the PRD).
