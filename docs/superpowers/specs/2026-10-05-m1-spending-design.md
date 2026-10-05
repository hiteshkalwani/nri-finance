# M1 Spending — design

Date: 2026-10-05. Status: approved in conversation, pending spec review.
Implements PRD §6.3 (TXN-1..4, CAT-1) and §6.4 DASH-1..3, plus the M0 review items scheduled for M1.
Builds on TRD §4 (tables already exist), §5 (API conventions) and §7 (web app).

## 1. Goal

PRD "done when" for M1: **I stop using the v1 app for daily logging.**

What the user said / chose:
- Logging happens on the **laptop** (local docker compose stack) for now; the cloud deploy comes after M1.
- Quick-add fills payment method and need/want **from the category's last use**.
- Dashboard numbers are computed by `packages/core` from stored rows (approach A), not in SQL.
- The design in conversation was approved as presented ("great").

Assumptions:
- One user (me); ~1,000 transactions a year.
- Cut-over: when M1 is done, re-import the latest v1 `finance-data.json` (idempotent, picks up entries made since the
  M0 import), then log only in v2.

Success criteria:
1. On the laptop I can add an expense in under 10 seconds with quick-add, and it shows on the dashboard immediately.
2. The ledger finds any past expense by cycle, category, payment method, need/want or text, sorted by any column.
3. Dashboard totals for a cycle match a manual sum of that cycle's ledger rows (PRD §8).
4. No API call can read, link to or change another user's rows; tested via the API and via direct SQL.

## 2. Scope

In: TXN-1, TXN-2, TXN-3, TXN-4, CAT-1, DASH-1, DASH-2, DASH-3; same-owner foreign keys; session-expiry dialog
(AUTH-2); clear cache on sign-out; not-found page and safe `?next=`; JWKS failure → 503; read-only accounts list for the
account picker.

Out (later milestones): account management (M2), remittance entry (M2; imported remittances are read for "sent"),
per-cycle income override (M2), budgets (M4), PWA/offline (M5), cloud deploy (separate, after M1), S3 file storage
(separate design).

## 3. Data

No new tables or columns: `transactions` and `categories` (TRD §4.1) already hold every M1 field.

### 3.1 Same-owner foreign keys (migration `0003_same_owner_fks.sql`)

Today a row could reference another user's category, account or loan by id (RLS hides it from reads, but a foreign key
only checks existence). Make Postgres refuse it:

- Add `unique (user_id, id)` to every referenced table: `categories`, `accounts`, `loans`, `sip_plans`.
- Replace each single-column foreign key with a composite one on `(user_id, <col>)` referencing `(user_id, id)`:

| Table | Column(s) | References |
|---|---|---|
| transactions | category_id, account_id | categories, accounts |
| remittances | from_account_id, to_account_id, loan_id | accounts, accounts, loans |
| balance_snapshots | account_id | accounts |
| category_budgets | category_id | categories |
| loan_planned_prepayments | loan_id (keeps `on delete cascade`) | loans |
| sip_allocations | plan_id (keeps `on delete cascade`) | sip_plans |

- Nullable columns (`account_id`, `from/to_account_id`, `loan_id` on remittances) use `MATCH SIMPLE`, so a NULL still
  means "none".
- `schema.ts` mirrors this with Drizzle `foreignKey({ columns: [t.userId, t.categoryId], foreignColumns: [...] })`.
- Tested in `packages/db/test/rls.test.ts`: as user B, inserting a transaction with user A's category id fails with a
  foreign-key violation (23503), for each composite key; existing data (the M0 import) migrates without error.

## 4. API

Conventions from TRD §5.1 (camelCase, `…Jpy` integers, `…Paise` integers, rates as 6-decimal strings, error envelope).
Every handler filters by `userId` explicitly in addition to RLS.

### 4.1 Categories (CAT-1)

| Route | Behaviour |
|---|---|
| `GET /api/categories` | All categories (active and archived), ordered by `sortOrder, name`. Each: `id, name, color, sortOrder, archivedAt, inUse, lastPaymentMethod, lastNeedWant` (last two from my most recent transaction in that category by `occurredOn desc, createdAt desc`; `null` if none). |
| `POST /api/categories` | `{ name (1..40, trimmed), color ("#RRGGBB") }` → 201. Appended at the end (`max(sortOrder)+1`). Duplicate name (case-insensitive) → 409 `CONFLICT`. |
| `PATCH /api/categories/:id` | Any of `name, color, archived (boolean)`. Archiving sets `archivedAt = now()`, unarchiving clears it. 404 if not mine. |
| `PUT /api/categories/order` | `{ ids: uuid[] }` — must be exactly my category ids; sets `sortOrder` 0..n-1 in one transaction. Otherwise 400. |
| `DELETE /api/categories/:id` | 204 if unused. If any transaction or budget uses it → 409 `CONFLICT` with message "Category has transactions — archive it instead". |

Archived categories are hidden from pickers but still name and colour old transactions.

### 4.2 Transactions (TXN-1..4)

`TransactionInput` (POST; PATCH accepts any subset):

| Field | Rule |
|---|---|
| `occurredOn` | ISO date (real calendar date) |
| `categoryId` | my category; must be active on POST and when changed on PATCH (400 otherwise) |
| `accountId` | optional; my account |
| `amountJpy` **or** `amountInrPaise` | exactly one; positive integer ≤ `PG_INT_MAX` (TXN-4) |
| `paymentMethod` | `bank \| cash \| credit_card \| ic_card` |
| `needWant` | `need \| want` |
| `description` | ≤ 200 chars, default `''` |
| `notes` | ≤ 2000 chars, default `''` |

₹ entry (TXN-4): the API converts with `jpyFromInrPaise(paise, profile.planningRate)` (half-up to whole yen), stores
`amount_jpy`, `entered_currency = 'INR'`, `amount_inr`, `rate_used`. A PATCH that sets an amount converts at the
**current** planning rate and replaces `rate_used`; a PATCH that does not touch the amount never recomputes it, and
changing the profile's planning rate never rewrites existing rows. A ₹ amount that converts to ¥0 → 400.

`Transaction` (response): `id, occurredOn, cycle, categoryId, accountId, description, amountJpy, enteredCurrency,
amountInrPaise | null, rateUsed | null, paymentMethod, needWant, notes, createdAt, updatedAt`. `cycle` is computed with
the profile's `cycleStartDay`.

| Route | Behaviour |
|---|---|
| `GET /api/transactions` | Query: `cycle` (YYYY-MM), `categoryId`, `paymentMethod`, `needWant`, `q` (≤ 100 chars; case-insensitive match on description and notes, `%`/`_` escaped), `sort` (`occurredOn \| amountJpy \| category \| paymentMethod \| needWant \| description`), `dir` (`asc \| desc`, default `desc` on `occurredOn`), `page` (≥1), `pageSize` (1..200, default 50). Ties broken by `createdAt desc, id`. Returns `{ items, total, page, pageSize, totalJpy }` (`totalJpy` = sum over all matching rows, not just the page). |
| `POST /api/transactions` | 201 with the `Transaction`. |
| `PATCH /api/transactions/:id` | 200; 404 if not mine. |
| `DELETE /api/transactions/:id` | 204; 404 if not mine. |

`cycle` filtering uses `cycleBounds(cycle, startDay)` → `occurred_on between start and end`.

### 4.3 Accounts (picker only)

`GET /api/accounts` → my non-archived accounts `{ id, name, country, currency, type, isEmergencyFund }` ordered by name.
No create/edit until M2.

### 4.4 Dashboard (DASH-1..3)

`GET /api/dashboard?cycle=YYYY-MM` (default: the current cycle from `todayIn(profile.timezone)`):

```
{ cycle, start, end,
  incomeJpy,            // profile salary (per-cycle override arrives in M2)
  spentJpy,             // sum of transactions in the cycle
  sentJpy,              // sum of remittances.jpy_sent in the cycle (fees not included; PRD open question 1)
  feesJpy,              // remittance fees in the cycle, shown separately
  keptJpy,              // income − spent − sent (may be negative)
  savingsRatePct,       // kept / income × 100, one decimal; null when income is 0
  byCategory: [{ categoryId, name, color, spentJpy }],   // spentJpy desc, only categories with spend
  byCycle:    [{ cycle, spentJpy }] }                     // the 12 cycles ending at `cycle`, oldest first, zeros included
```

The handler loads transactions and remittances for the 12-cycle date range (narrow columns) and calls `packages/core`:

- `cycleRange(from, to)` and `previousCycle(cycle)` — new, in `cycles.ts`.
- `summarizeCycle({ transactions, remittances, salaryJpy, cycle, startDay })` → the scalar fields.
- `spendByCategory(transactions, cycle, startDay)` and `spendByCycle(transactions, cycles, startDay)`.

No profile yet → 409 `CONFLICT` "Set up your profile first"; the dashboard shows a card linking to Settings.

### 4.5 Errors added

- Postgres `23503` (foreign key) → 400 `VALIDATION_FAILED` naming the field, never 500.
- Postgres `23505` on category name → 409 `CONFLICT`.
- JWKS fetch failure / timeout in `authMiddleware` (network error, `ERR_JWKS_TIMEOUT`, non-2xx JWKS) → 503 with a
  new error code `AUTH_UNAVAILABLE` (added to `ErrorCode` in `packages/contracts`) "The sign-in service is unreachable
  right now", instead of 401 (which signed the user out). A bad or expired token stays 401.

## 5. Web app

### 5.1 Layout and navigation

- Wide screens: navigation drawer (Dashboard, Spend, Settings) and an "Add expense" button in the app bar.
- Phones (< 600 px): bottom navigation — Dashboard, Spend, **+** (quick-add), More (Settings).
- Routes: `/` dashboard, `/spend` ledger, `/spend/new` quick-add, `/spend/:id` edit, `/settings` (adds a Categories
  section), `/login`, and a catch-all `/:pathMatch(.*)*` → Not found page with a link home.
- `?next=` after sign-in is accepted only if it starts with `/` and not `//`; otherwise `/`.

### 5.2 Quick-add (TXN-2) — `/spend/new`

One screen, top to bottom: amount (large numeric input, ¥/₹ toggle; ₹ shows the ¥ conversion preview at the planning
rate), category grid (active categories as coloured chips in `sortOrder`), date (defaults to `todayIn('Asia/Tokyo')`
from the profile), then chips for payment method and need/want pre-filled from the chosen category's
`lastPaymentMethod` / `lastNeedWant` (fallback `bank` / `need`), optional description. **Save** (Enter submits) → toast
"Saved ¥1,280 · Groceries" with **Add another** (clears amount and description, keeps date) and **View in ledger**.

### 5.3 Ledger (TXN-1, TXN-3) — `/spend`

- Cycle picker (default current cycle; "All" option), filter chips (category, payment method, need/want), search box
  (debounced 300 ms), total for the filter.
- Server-side table (`v-data-table-server`): date, category (colour dot), description, amount (¥; ₹ shown beneath when
  entered in ₹), payment, need/want. Sortable columns map to `sort`/`dir`; pages of 50.
- Filters and sort live in the URL query, so back/forward and reload keep them.
- Row click → edit form (`/spend/:id`, same fields as quick-add plus account and notes). Delete from the form →
  back to the ledger with a snackbar "Deleted · Undo" (5 s); Undo re-creates the row from the copy kept client-side
  (new id).

### 5.4 Categories (CAT-1) — Settings

List in `sortOrder` with drag handles (reorder → `PUT /api/categories/order`), inline rename, colour picker from a
fixed palette of 12, archive/unarchive toggle, delete (only offered when `inUse` is false; a 409 shows "archive
instead").

### 5.5 Dashboard (DASH-1..3) — `/`

Cycle picker with previous/next arrows (default current cycle; label "25 Sep – 24 Oct 2026"), four cards: Income,
Spent, Sent home (fees beneath), Kept (with savings rate; negative shown in red **and** with a minus sign). Below:
spend-by-category donut and a 12-cycle spend bar chart (Chart.js 4 via vue-chartjs); clicking a donut slice or bar
opens the ledger filtered to it. Empty cycle shows "No spending recorded in this cycle".

### 5.6 Session and cache (AUTH-2, fix queue)

- A 401 from the API during a session opens a **sign-in dialog** over the current page (component state and form
  inputs stay); after signing in the dialog closes and the user re-submits. Route-guard redirects to `/login` remain for
  navigation without a session.
- Sign-out calls `queryClient.clear()` before navigating to `/login`.

### 5.7 Money display and input

- ¥: `Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' })`; input accepts whole numbers only.
- ₹: `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`; input accepts up to 2 decimals, converted to
  paise with `paiseFromDecimal` before sending.

## 6. Error handling (user-visible)

| Situation | What the user sees |
|---|---|
| Validation error | Field-level messages from the shared zod schema, before sending; server 400 details mapped to fields |
| Category deleted elsewhere / not mine | 404 → "That category no longer exists", pickers refresh |
| Delete category in use | 409 → "Category has transactions — archive it instead" with an Archive button |
| Session expired | Sign-in dialog; form kept |
| Database or sign-in service down | 503 banner "Can't reach the database / sign-in service — retrying when you try again" |
| No profile | Dashboard card "Set up your profile first" → Settings |

## 7. Testing

| Layer | Tests |
|---|---|
| core | `cycleRange`, `previousCycle` (Jan → previous Dec); `summarizeCycle` (24th/25th boundary, Dec→Jan, zero income → null rate, negative kept, fees excluded); `spendByCategory`, `spendByCycle` (zero-filled 12 cycles) |
| contracts | Category/transaction inputs: exactly one amount, limits, colour format, `q` length, sort enum |
| db | Each composite foreign key rejects another user's id (23503); M0 import data still valid after migration |
| api (int) | Every route above, two users: B can't list, patch, delete or link to A's rows (404/400, never 500); ₹ conversion stored and not recomputed after a planning-rate change; filters, sort, paging, `totalJpy`; delete-in-use 409; order endpoint rejects foreign or missing ids; dashboard numbers for a fixture across a cycle boundary; JWKS down → 503 |
| web (unit) | Quick-add defaults from category; ₹ preview; `?next=` sanitising; 401 opens the dialog without navigating |
| e2e | (phone viewport) quick-add an expense → it appears on the dashboard and in the ledger; (laptop viewport) filter ledger, edit amount, delete + undo |

All run in `pnpm stack:check` (CI).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Migration 0003 fails on existing imported rows | All imported rows belong to one user; the migration is tested against an M0-imported database before merge |
| Dashboard load time grows with history | 12 cycles × ~100 rows; narrow column selects; revisit with SQL aggregation only if > 300 ms |
| Undo re-create loses `legacyId` | Acceptable: only matters for rows imported from v1 and deleted by mistake; re-import restores them |
