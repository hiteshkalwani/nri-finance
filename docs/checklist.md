# NRI Finance — Implementation checklist

The single place to see what is built and what is pending, module by module.
Requirement IDs come from [prd.md](prd.md); milestones from PRD §7. Updated at the end of every task.

Legend: ✅ done · 🟡 partly done (see note) · 🔨 in progress · ⬜ pending

Last updated: 2026-10-05 (M1 spending built locally)

## Progress by milestone

| Milestone | Scope | Status | Done when (PRD §7) |
|---|---|---|---|
| M0 Foundation | Repo, CI, schema + RLS, sign-in, profile, v1 import, deploy | 🟡 code + local stack done; cloud deploy ⬜ | I can sign in on phone and laptop and see my imported data |
| M1 Spending | Ledger, categories, quick-add, basic dashboard | 🟡 built locally; cut-over (re-import, stop using v1) ⬜ | I stop using the v1 app for daily logging |
| M2 Remittances & balances | Remittances, accounts, snapshots, emergency fund | ⬜ | First real cycle review done in v2 |
| M3 Loan & SIP | Loan schedule with actuals, SIP plan / actuals / projection | ⬜ | Payoff month reflects real payments |
| M4 Budgets & review | Budgets, targets, review flow | ⬜ | A full 25th review takes under 5 minutes |
| M5 Reports & polish | Reports, exports, PWA | ⬜ | v1 retired to `legacy/` |

---

## Platform

### Repo, tooling, CI — M0

| Item | Status | Notes |
|---|---|---|
| pnpm monorepo (`apps/web`, `apps/api`, `packages/core`, `contracts`, `db`, `test-utils`) | ✅ | |
| TypeScript, ESLint (`v-html` and `toISOString` banned), Prettier | ✅ | |
| Unit tests (Vitest), integration tests (real Postgres + Auth), e2e (Playwright, phone viewport) | ✅ | 59 unit, 4 script, 25 integration, 1 e2e |
| Private GitHub repo `hiteshkalwani/nri-finance` | ✅ | |
| GitHub Actions CI: typecheck, lint, unit, scripts, production build, `pnpm stack:check` | ✅ | `stack:check` adds e2e; first run on GitHub with the local-stack PR |

### Database — M0

| Item | Status | Notes |
|---|---|---|
| Schema: 12 tables, enums, money as integer ¥ / `numeric(14,2)` ₹ | ✅ | `packages/db/src/schema.ts` |
| Migrations 0000–0002 (init, RLS, positive rate check) | ✅ | |
| Row-level security on every owned table, per-request `authenticated` role | ✅ | Tested via API and direct SQL |
| Same-owner foreign keys (a row can only reference my own category / loan / account) | ✅ | Migration 0003: composite `(user_id, …)` foreign keys on every link between owned tables |
| Revoke Supabase default broad grants (TRUNCATE etc.) from `anon` / `authenticated` | ⬜ | Not reachable today; hardening |

### Local stack (docker compose) — done

Spec: [superpowers/specs/2026-10-05-local-stack-design.md](superpowers/specs/2026-10-05-local-stack-design.md)

| Item | Status | Notes |
|---|---|---|
| Spec written and approved | ✅ | Amended while planning (§13) |
| Implementation plan | ✅ | `docs/plans/2026-10-05-local-stack.md` |
| Spike: GoTrue ES256 keys + Postgres image init + CORS | ✅ | CORS added in the gateway (Auth sends none), only the two local origins |
| `pnpm stack:keys` (local keys, `.env.local`) | ✅ | Replaces `scripts/test-env.mjs` |
| `docker-compose.yml`: db, auth, gateway | ✅ | Migrations run from the Mac in `stack:up` |
| `SUPABASE_AUTH_INTERNAL_URL` (fetch JWKS inside Docker) | ✅ | Production unchanged |
| App image + Vercel-output server (`app` profile on :3000) | ✅ | |
| `pnpm stack:up / stack:check / stack:down / stack:reset` | ✅ | |
| Playwright `E2E_BASE_URL` switch | ✅ | e2e also deletes its test user now |
| CI on `pnpm stack:check` (adds e2e), Supabase CLI removed | ✅ | |
| TRD §2, §9.1, §10, §12.2 updated | ✅ | |

### Cloud deploy — M0 Task 17 (after the local stack)

| Item | Status | Notes |
|---|---|---|
| Supabase project (Tokyo), sign-ups off, my user created | ⬜ | You, in the Supabase dashboard |
| Migrations applied to the cloud database | ⬜ | |
| Vercel project + env vars (no JWT secret, no service key) | ⬜ | You, in the Vercel dashboard |
| Live checks: `/api/health`, 401 on `/api/me`, CSP header, phone import shows ¥500,000, 503 when paused | ⬜ | |
| TRD §9.1 / §9.2 match the Build Output API deploy | ⬜ | |
| Weekly `pg_dump` backup job (also keeps the free project awake) | ⬜ | TRD §9.3 |

### File storage (S3) — decided, not designed

| Item | Status | Notes |
|---|---|---|
| Use S3 for file storage | ⬜ | Decided 2026-10-05. Needs a short design: which files (receipts, backups, exports?), bucket and region, upload path (presigned URLs), local equivalent in the compose stack (e.g. MinIO), and which milestone |

### API cross-cutting

| Item | Status | Notes |
|---|---|---|
| Health, JWT check via JWKS (ES256), per-request transaction with rollback on error | ✅ | |
| Error mapping: 400 validation, 401, 404, 503 when the database is down or paused | ✅ | |
| JWKS fetch failure → 503 (today it signs you out with 401) | ✅ | A bad/unknown-key token still gets 401; only an unreachable key server is 503 `AUTH_UNAVAILABLE` |
| Exchange rates returned with 6 decimals as the TRD says (today trailing zeros trimmed) | ⬜ | Decide: fix code or TRD |

---

## Product modules

### 1. Sign-in and profile — M0

| ID | Requirement | Status | Notes |
|---|---|---|---|
| AUTH-1 | Sign in with email + password; stay signed in on phone and laptop | 🟡 | Works locally; phone + laptop needs the cloud deploy |
| AUTH-2 | Sign out; session expiry returns to sign-in without losing an unsaved form | ✅ | Expired session opens sign-in in a dialog, so the form underneath is kept; cached data is cleared on sign-out |
| AUTH-3 | Sign-up closed | ✅ | Tested: public sign-up rejected |
| PROF-1 | Profile: salary ¥, planning rate, cycle start day (25), timezone (Asia/Tokyo) | ✅ | Bad values rejected with 400 |

### 2. Import from v1 — M0

| ID | Requirement | Status | Notes |
|---|---|---|---|
| IMP-1 | Import `finance-data.json`: transactions, categories, settings, loan, SIP plan | 🟡 | All imported except the emergency-fund goal (no column until M2); settings skipped if a profile already exists |
| IMP-2 | Family/India rows become remittances (purpose family) | ✅ | |
| IMP-3 | Starter accounts: Japan bank, Japan emergency fund (flagged), India bank | ✅ | |
| IMP-4 | Idempotent: running twice adds nothing | ✅ | |

### 3. Spending ledger and categories — M1

| ID | Requirement | Status | Notes |
|---|---|---|---|
| TXN-1 | Add / edit / delete transaction (date, category, description, ¥, payment method, need/want, account, notes) | ✅ | Edit page adds delete + undo |
| TXN-2 | Quick-add on phone: amount, category, date (today in JST) | ✅ | Per-category defaults for payment method / need-want; date defaults to today in JST unless edited |
| TXN-3 | Filters (cycle, category, payment, need/want, search), sort, pagination | ✅ | URL-backed filters, sort and paging; keyboard-reachable rows |
| TXN-4 | Enter in ₹, converted to ¥ at the planning rate and stored | ✅ | |
| CAT-1 | Add, rename, recolor, reorder, archive categories; delete blocked when in use | ✅ | Colour from 12; reorder with up/down buttons; delete blocked (409) while in use |
| — | UI refresh (mockup look, light/dark, category icons) | ✅ | Matches `docs/diagrams/nri-ui-mockup.html`; theme toggle (System/Light/Dark) in Settings › Appearance; date-grouped Spend list |
| — | Cut-over: re-import the latest v1 `finance-data.json`, then log only in v2 | ⬜ | You |

### 4. Dashboard — M1 basic, extended M2–M4

| ID | Requirement | Status | Milestone |
|---|---|---|---|
| DASH-1 | Cycle picker, default current cycle (JST) | ✅ | M1 |
| DASH-2 | Income, spent, kept, savings rate (¥) | ✅ | M1 |
| DASH-3 | Spending by category (donut), spend per cycle (bar, 12 cycles) | ✅ | M1 |
| DASH-4 | Sent home this cycle: ¥ sent, ₹ received, by purpose | ⬜ | M2 |
| DASH-5 | Net worth: Japan ¥, India ₹, combined, change since last cycle | ⬜ | M2 (P1) |
| DASH-6 | Emergency fund balance, goal, months covered | ⬜ | M2 |
| DASH-7 | Home loan balance and projected payoff month | ⬜ | M3 |
| DASH-8 | SIP paid vs plan; projected corpus 2036 | ⬜ | M3 (P1) |
| DASH-9 | Budget status: categories over or near budget | ⬜ | M4 (P1) |

### 5. Remittances — M2

| ID | Requirement | Status | Notes |
|---|---|---|---|
| REM-1 | Add / edit / delete: date, ¥ sent, ₹ received, fee, service, accounts, purpose, notes | ⬜ | Fees kept separate from spending (decided) |
| REM-2 | Purposes; EMI and prepayment require a loan | ⬜ | Auto-link to the loan (decided) |
| REM-3 | Effective rate while typing vs the planning rate | ⬜ | |
| REM-4 | Filters by cycle and purpose; totals per purpose | ⬜ | |
| REM-5 | Rate history chart | ⬜ | P1 |

### 6. Accounts and balances — M2

| ID | Requirement | Status | Notes |
|---|---|---|---|
| ACC-1 | Add / edit / archive accounts (country, currency, type, emergency-fund flag) | ⬜ | Starter accounts already created by import |
| BAL-1 | Review-day balance entry per account, prefilled from last cycle | ⬜ | Snapshots (decided) |
| BAL-2 | Change since last cycle per account and side | ⬜ | P1 |
| EF-1 | Emergency fund total and months covered (3-cycle average spend) | ⬜ | Adds the EF goal column; re-import picks it up |
| — | Per-cycle income override (bonus, overtime) | ⬜ | Decided for M2 (PRD open question 3) |

### 7. Home loan — M3

| ID | Requirement | Status | Notes |
|---|---|---|---|
| LOAN-1 | Loan: principal ₹, rate, EMI, tenure, start cycle; several loans | ⬜ | v1 loan already imported |
| LOAN-2 | Monthly schedule; closing never below 0 | ⬜ | |
| LOAN-3 | EMI / prepayment remittances fill "actual"; planned extras for what-if | ⬜ | |
| LOAN-4 | Payoff month, total interest, interest saved | ⬜ | P1 |

### 8. SIP — M3

| ID | Requirement | Status | Notes |
|---|---|---|---|
| SIP-1 | Plan: monthly ₹, step-up %, return %, redirect EMI after payoff | ⬜ | v1 plan already imported |
| SIP-2 | Fund allocation totalling 100% | ⬜ | v1 allocations already imported |
| SIP-3 | Actual SIP per cycle vs plan | ⬜ | |
| SIP-4 | Yearly projection to 2036 using the real loan payoff year | ⬜ | |

### 9. Budgets and targets — M4

| ID | Requirement | Status | Notes |
|---|---|---|---|
| BUD-1 | Monthly budget per category, carried forward | ⬜ | |
| BUD-2 | Remaining budget in the ledger and quick-add | ⬜ | P1 |
| TGT-1 | Per-cycle targets (savings, EF, remittance, prepayment); copy last cycle | ⬜ | v1 targets already imported |
| TGT-2 | Target vs actual on dashboard and review | ⬜ | |

### 10. Cycle review — M4

| ID | Requirement | Status | Notes |
|---|---|---|---|
| REV-1 | Guided 25th review: summary → balances → next targets | ⬜ | P1 |

### 11. Reports, export, PWA — M5

| ID | Requirement | Status | Notes |
|---|---|---|---|
| REP-1 | Spend per cycle and category over a range | ⬜ | |
| REP-2 | Japan vs India flow per cycle | ⬜ | P1 |
| EXP-1 | Export JSON (re-importable), CSV, XLSX | ⬜ | |
| PWA-1 | Installable; offline app shell | ⬜ | Also add long-term caching for `/assets/*` |

---

## Small fixes queue (from the M0 review)

Picked up in the milestone noted; each moves into the module table above when done.

| Item | When |
|---|---|
| ~~Same-owner foreign keys~~ ✅ | Before M1 |
| ~~Keep unsaved form across re-sign-in; clear cached data on sign-out~~ ✅ | M1 |
| ~~"Not found" page for unknown routes and bad `?next=`~~ ✅ | M1 |
| ~~JWKS fetch failure → 503 instead of sign-out~~ ✅ | M1 |
| ~~e2e deletes its test user; unit test for the 401 → `?next=` redirect~~ ✅ | Local stack |
| Import: warn when the profile already exists instead of silently keeping it | M2 (with EF goal) |
| Rate decimals: code vs TRD wording | M2 (with remittance rate display) |
| Long-term cache header for `/assets/*` | M5 (PWA) |
| Revoke default broad Postgres grants | Before cloud deploy |
