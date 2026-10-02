# NRI Finance — Product Requirements (PRD)

Status: Draft for review · Owner: Hitesh · Date: 2026-10-02
Companion: [Technical Requirements (TRD)](./trd.md) · Diagrams: `nri-system-map.png`, `nri-cloud-architecture.png`

## 1. Problem

I live and earn in Japan (salary in JPY, credited on the 25th) and most of my spending is in JPY. Part of every salary goes to India: support for my family, savings, SIP investments and my home loan EMI. Today this lives in a spreadsheet and a single-file HTML app on one laptop. I can't log a purchase from my phone, remittances are buried inside "spending", and I can't see in one place how much I spent, kept and sent home each cycle.

## 2. User

One person (me), an NRI in Japan:

- Earns ¥670,000 a month; review cycle runs from the 25th to the 24th.
- Spends day to day in ¥ (rent, groceries, transport, wants), paying by bank, cash, credit card or IC card.
- Keeps a JPY emergency fund (goal ¥1,500,000).
- Sends money to India: family support, India savings, SIP (₹1,00,000/month, +10% a year), home loan (₹20,50,572 at 7.35%, EMI ₹36,557, 69 months left).
- Uses a phone during the day and a laptop for the monthly review.

## 3. Goals

1. Log any expense or remittance from the phone in under 15 seconds.
2. Close a cycle on the 25th in under 5 minutes: see income, spent, kept and sent, update balances, set next cycle's targets.
3. Keep Japan-side money in ¥ and India-side money in ₹; convert only at the remittance, at the rate actually received.
4. See the home-loan payoff date and the SIP projection update from real payments, not only from the plan.
5. Never lose an entry; keep the data exportable at any time.

## 4. Non-goals (v2)

- Multiple users, households or sharing (the schema keeps `user_id` so this can come later).
- Bank or card syncing, receipt scanning, OCR.
- Live FX feeds; the rate comes from my own transfers plus one planning rate in Settings.
- Tax computation (Japanese or Indian), investment fund NAV tracking.
- Native iOS/Android apps; the web app installs to the home screen (PWA).

## 5. Key concepts

| Term | Meaning |
|---|---|
| Cycle | 25th of month N to 24th of month N+1, labeled by the month it closes in (Aug 25 – Sep 24 = `2026-09`). Start day is a setting. |
| Japan side | Money in ¥: salary, spending, JPY accounts, emergency fund. |
| India side | Money in ₹: family support, India accounts, SIP, home loan. |
| Remittance | A transfer from Japan to India. The only place ¥ becomes ₹. Records ¥ sent, ₹ received, fee and purpose. |
| Effective rate | ¥ sent ÷ ₹ received for one remittance. |
| Planning rate | One ¥-per-₹ rate in Settings, used for projections and for a combined net worth figure. |
| Snapshot | An account balance I type in on review day for a given cycle. |

## 6. Features

Priority: **P0** must ship for the milestone to be usable, **P1** should ship in it, **P2** can follow.
Each requirement has an ID used in the TRD, the plan and commit messages.

### 6.1 Sign-in and profile — Milestone 0

| ID | Requirement | Pri |
|---|---|---|
| AUTH-1 | Sign in with email + password (Supabase Auth); stay signed in on phone and laptop. | P0 |
| AUTH-2 | Sign out; session expiry sends me back to sign-in without losing an unsaved form. | P0 |
| AUTH-3 | Sign-up is closed: only my account can sign in. | P0 |
| PROF-1 | Profile holds salary (¥), planning rate (¥ per ₹), cycle start day (default 25), timezone (default Asia/Tokyo). | P0 |

Acceptance: a fresh device reaches the dashboard after one sign-in; a second account cannot be created from the app.

### 6.2 Data import from v1 — Milestone 0

| ID | Requirement | Pri |
|---|---|---|
| IMP-1 | Import `finance-data.json` once: transactions, categories, settings, loan, SIP plan. | P0 |
| IMP-2 | Rows in the "Family/India" category become remittances with purpose `family` (₹ received taken from the stored INR amount). | P0 |
| IMP-3 | Create starter accounts: Japan bank (¥), Japan emergency fund (¥, flagged), India bank (₹). | P0 |
| IMP-4 | Import is idempotent: running it twice does not duplicate rows. | P0 |

Acceptance: after import the dashboard totals for cycles `2026-09` and `2026-10` match the v1 app's figures.

### 6.3 Spending ledger and categories — Milestone 1

| ID | Requirement | Pri |
|---|---|---|
| TXN-1 | Add, edit, delete a transaction: date, category, description, amount in ¥, payment method (Bank, Cash, Credit Card, IC Card), need/want, account, notes. | P0 |
| TXN-2 | Quick-add on phone: amount, category and date (defaulting to today in JST) on one screen. | P0 |
| TXN-3 | List filters: cycle, category, payment method, need/want, text search; sort by any column; paginated. | P0 |
| TXN-4 | A transaction may be entered in ₹ (e.g. while visiting India); the ¥ amount is converted at the planning rate at entry and stored, never recomputed later. | P1 |
| CAT-1 | Add, rename, recolor, reorder, archive categories. Deleting a category with transactions is blocked; archiving hides it from pickers. | P0 |

### 6.4 Dashboard — Milestone 1 (basic), extended in M2–M4

| ID | Requirement | Pri | Milestone |
|---|---|---|---|
| DASH-1 | Cycle picker, defaulting to the current cycle in JST. | P0 | M1 |
| DASH-2 | Income, spent, kept (income − spent − sent), savings rate, all in ¥. | P0 | M1 |
| DASH-3 | Spending by category (donut) and spend per cycle (bar, last 12 cycles). | P0 | M1 |
| DASH-4 | Sent home this cycle: ¥ sent, ₹ received, split by purpose. | P0 | M2 |
| DASH-5 | Net worth: Japan total ¥, India total ₹, combined at planning rate, change since last cycle. | P1 | M2 |
| DASH-6 | Emergency fund balance, goal, months of expenses covered. | P0 | M2 |
| DASH-7 | Home loan balance today and projected payoff month. | P0 | M3 |
| DASH-8 | SIP paid this cycle vs plan; projected corpus in 2036. | P1 | M3 |
| DASH-9 | Budget status: categories over or near budget. | P1 | M4 |

### 6.5 Remittances — Milestone 2

| ID | Requirement | Pri |
|---|---|---|
| REM-1 | Add, edit, delete a remittance: date, ¥ sent, ₹ received, fee (¥), service (Wise, bank, other), from account, to account, purpose, notes. | P0 |
| REM-2 | Purposes: family, India savings, SIP, loan EMI, loan prepayment, other. EMI and prepayment require choosing a loan. | P0 |
| REM-3 | Show the effective rate as I type, and compare it with the planning rate. | P0 |
| REM-4 | List with filters by cycle and purpose; totals per purpose for the selected cycle. | P0 |
| REM-5 | Rate history chart from my own transfers. | P1 |

### 6.6 Accounts and balances — Milestone 2

| ID | Requirement | Pri |
|---|---|---|
| ACC-1 | Add, edit, archive accounts: name, country (JP/IN), currency (¥/₹), type (bank, cash, card, FD, investment), emergency-fund flag. | P0 |
| BAL-1 | On review day, enter a balance per active account for a cycle on one screen; prefilled with last cycle's values. | P0 |
| BAL-2 | Show change since last cycle per account and per side. | P1 |
| EF-1 | Emergency fund = sum of flagged accounts' latest snapshots; months covered = balance ÷ average monthly spend over the last 3 cycles. | P0 |

### 6.7 Home loan — Milestone 3

| ID | Requirement | Pri |
|---|---|---|
| LOAN-1 | Loan: name, principal (₹), annual rate, EMI, tenure, start cycle. More than one loan allowed. | P0 |
| LOAN-2 | Schedule per month: opening, interest, EMI, extra, closing; closing never below 0. | P0 |
| LOAN-3 | Remittances with purpose EMI or prepayment fill the "actual" column; planned extras can be added for what-if. | P0 |
| LOAN-4 | Payoff month and total interest, for the plan and for actual-to-date + plan for the rest; interest saved by prepaying. | P1 |

### 6.8 SIP — Milestone 3

| ID | Requirement | Pri |
|---|---|---|
| SIP-1 | Plan: starting monthly ₹, annual step-up %, expected return %, redirect EMI into SIP after loan payoff (on/off). | P0 |
| SIP-2 | Fund allocation with percentages that must total 100. | P0 |
| SIP-3 | Actual SIP paid per cycle from remittances with purpose SIP, vs planned amount. | P0 |
| SIP-4 | Yearly projection to 2036 using the real payoff year of the loan. | P0 |

### 6.9 Budgets and targets — Milestone 4

| ID | Requirement | Pri |
|---|---|---|
| BUD-1 | Monthly budget per category in ¥; carried forward until changed. | P0 |
| BUD-2 | Remaining budget shown in the ledger and on quick-add. | P1 |
| TGT-1 | Per-cycle targets: savings ¥, emergency fund contribution ¥, remittance ¥, loan prepayment ₹. "Copy last cycle" in one tap. | P0 |
| TGT-2 | Target vs actual for each, on the dashboard and on the review screen. | P0 |

### 6.10 Cycle review — Milestone 4

| ID | Requirement | Pri |
|---|---|---|
| REV-1 | One guided screen for the 25th: summary of the closed cycle → enter balances → set next cycle's targets. | P1 |

### 6.11 Reports and export — Milestone 5

| ID | Requirement | Pri |
|---|---|---|
| REP-1 | Spend per cycle and per category over a chosen range. | P0 |
| REP-2 | Japan vs India flow per cycle: spent, kept, sent. | P1 |
| EXP-1 | Export everything as JSON (re-importable) and transactions/remittances as CSV and XLSX. | P0 |
| PWA-1 | Installable on phone home screen; app shell loads offline; data needs a connection. | P0 |

## 7. Milestones

| Milestone | Contents | Done when |
|---|---|---|
| M0 Foundation | Repo, CI, Vercel + Supabase projects, schema + RLS, sign-in, profile, v1 import | I can sign in on phone and laptop and see my imported data via the API |
| M1 Spending | Ledger, categories, quick-add, basic dashboard (DASH-1..3) | I stop using the v1 app for daily logging |
| M2 Remittances & balances | Remittances, accounts, snapshots, emergency fund, DASH-4..6 | First real cycle review done in v2 |
| M3 Loan & SIP | Loan schedule with actuals, SIP plan/actuals/projection, DASH-7..8 | Payoff month reflects real payments |
| M4 Budgets & review | Budgets, targets, review flow, DASH-9 | A full 25th review takes under 5 minutes |
| M5 Reports & polish | Reports, exports, PWA install, offline shell | v1 retired to `legacy/` |

## 8. Success measures

- Every expense logged within a day (no backfilling at the end of the cycle).
- Cycle review on the 25th takes under 5 minutes.
- Dashboard numbers for a cycle match a manual check of the ledger.
- Zero lost entries; export works at any time.

## 9. Open questions

1. Should remittance fees be charged to a spending category (so they count as "spent") or kept separate? Proposed: separate, shown on the remittance and in reports.
2. Credit-card spending: count when charged (transaction date) or when the bill is paid? Proposed: when charged.
3. Salary is fixed in Settings; should actual salary be recorded per cycle (bonuses, overtime)? Proposed: add an optional per-cycle income override in M2.
