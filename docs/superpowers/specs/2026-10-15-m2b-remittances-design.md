# M2b Remittances — design and build order

Date: 2026-10-15. Sources: PRD §6.5 (REM-1..5), DASH-4, open questions 1 and 3; TRD §5.3; mockup view Remittances.
Keep it small: reuse M1/M2a patterns (ledger list, quick-add form, undo, cycle picker, NetWorthChart).

## Decisions
- **Fee is inside ¥ sent** (user chose A). ¥ sent = total that left the Japan account; fee is a breakdown, not extra.
  Kept = income − spent − sent stays as is. Effective rate = ¥ sent ÷ ₹ received.
- Loan link: EMI / prepayment need a loan. One open loan → picked automatically; several → a select; none → those two
  purposes are disabled with "No loan yet". Loan create/edit stays M3.
- Rates in JSON always have 6 decimals (`formatRate` pads); the UI shows 4. Closes the checklist "rate decimals" item.
- Undo after delete re-POSTs the deleted row (values are stored verbatim, nothing is re-converted) — no restore route.
- No pagination: a cycle has a handful of transfers.

## Data — migration `0006_remittances_income.sql`
- New `cycle_incomes`: `user_id`, `cycle char(7)`, `income_jpy integer not null check (>= 0)`, unique (user_id,
  cycle), RLS same as other owned tables.
- `remittances` unchanged.

## Core (`packages/core`, unit-tested)
- `summarizeCycle` takes `incomeJpy` (override or salary) instead of `salaryJpy`; adds `receivedPaise` and
  `sentByPurpose: [{ purpose, jpySent, inrPaise, count }]` (largest first).
- `rateVsPlan(jpySent, inrPaise, planningRate)` → `{ rate, diffPct, inrDiffPaise }`; `inrDiffPaise` = ₹ received − ₹ you
  would get at the planning rate (positive = better than plan).

## API
- `GET /api/loans` — `[{ id, name, closedAt }]` (read-only, for the picker).
- `GET /api/remittances?cycle&purpose` → `{ cycle, start, end, items: [{ id, sentOn, jpySent, inrPaise, feeJpy,
  service, fromAccountId, toAccountId, purpose, loanId, notes, rate }], totals: { jpySent, inrPaise, feesJpy, count,
  avgRate|null, byPurpose } }`. Totals honour the purpose filter.
- `GET /api/remittances/:id`, `POST`, `PATCH /:id`, `DELETE /:id`. Body: `{ sentOn, jpySent (>0), inrPaise (>0), feeJpy
  (0..jpySent), service: 'wise'|'bank'|'other', fromAccountId?, toAccountId?, purpose, loanId?, notes }`. Loan rule
  checked in the contract (400) and the DB. From must be a JP account, to an IN account (400). Accounts/loan must be
  the user's (400).
- `GET /api/remittances/rates?limit=12` → `{ planningRate, points: [{ sentOn, rate }] }` oldest → newest.
- `PUT /api/cycles/:cycle/income` `{ incomeJpy: number | null }` — null removes the override.
- `GET /api/dashboard` adds `salaryJpy`, `incomeOverridden`, `receivedPaise`, `sentByPurpose`.

## Screens
- Nav: sidebar Dashboard · Spend · **Remit** · Accounts · Settings. Phone bottom nav: Dashboard · Spend · + · **Remit**
  · More.
- **Remittances `/remit`** (mockup): cycle picker, purpose filter chips, KPIs (Sent, Received, Average rate vs plan,
  Fees "not counted as spending"), "Sent by purpose" rows, transfers grouped by day (service, from → to, purpose, ¥, ₹,
  fee, rate; click to edit), rate-history chart (last 12 transfers + dashed planning line, with a text list), primary
  **Record transfer**.
- **Record / edit `/remit/new`, `/remit/:id`** (one form component, full page like quick-add): date, service, ¥ sent,
  ₹ received, fee, from, to, purpose chips, loan (when needed), notes. Live panel: "Effective rate ¥1.6949 per ₹1" and
  "vs planning ±x.xx% · ₹n more/less" (word + colour). Edit page has Delete with undo.
- **Dashboard**: Sent home KPI shows "₹… received · fees ¥…"; a "Sent home by purpose" card (hidden when nothing sent).
  Income KPI gets a pencil → small dialog "Income for <Mon YYYY>" (amount, "Use salary" to clear); shows "override"
  when set.

## Testing
Unit (core: summary with override + byPurpose, rateVsPlan, formatRate padding; contracts: remittance body rules; web:
form live rate + loan auto-pick). Integration: CRUD, ownership, loan rule, JP/IN account rule, filters + totals, rates,
income override on dashboard. One e2e: record a transfer on phone + laptop, see it on Dashboard. Screens via
`pnpm ui:screens` (add `/remit`). Unit tests must pass without `.env.local`.

## Build order (each task: tests first, commit)
1. Core + contracts: `formatRate` padding, `summarizeCycle` changes, `rateVsPlan`, remittance/loan/income contracts.
2. DB + API: migration 0006, `/loans`, `/remittances` CRUD + list + rates, `/cycles/:cycle/income`, dashboard fields.
3. Web: Remit list page, record/edit form, nav, Dashboard changes, income dialog.
4. E2E, screenshots, checklist + TRD updates, PR.

## Out of scope
Loan screens and schedules (M3), SIP actuals (M3), CSV/XLSX export (M5), historical planning rates.
