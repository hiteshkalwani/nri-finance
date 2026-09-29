# Personal Finance Web App — Design Spec

Date: 2026-09-29
Status: Approved for implementation

## 1. Purpose

Replace the spreadsheet `Personal_Financial_Strategy_2026_2036 (1).xlsx` with a single-user,
local-only web app for tracking monthly expenses, savings, emergency fund progress, and home
loan repayment, aligned to the user's actual salary-credit cycle (25th of each month to 24th
of the next) instead of the calendar month the spreadsheet currently uses.

Single user, single machine, Chrome/Edge, opened as a local file — no backend, no hosting.

## 2. Source data (from the existing workbook)

Five sheets, cross-linked:

- **Financial Plan** — global assumptions (salary in JPY, JPY→INR FX rate, emergency fund
  target, home loan principal/rate/EMI/tenure, starting SIP, annual SIP step-up %, extra
  loan prepayment, future reserve) + a month-by-month planned cashflow table.
- **Daily Expenses** — transaction log: Date, Category, Description, Amount JPY, Amount INR
  (auto-converted), Payment Method (Bank/Cash/Credit Card/IC Card), Need/Want, Notes. 57 real
  rows so far. Categories are inconsistent free text with typos/duplicates in the source.
  Currently grouped by calendar month.
- **Home Loan** — EMI amortization: Month #, Regular EMI, Extra Prepayment (irregular,
  manually entered), Opening/Closing Principal, Interest. Payoff currently lands around
  month 36.
- **SIP Projection** — yearly (2027–2036) investment growth: monthly SIP with 10%/year
  step-up, a hardcoded "post-loan redirect" starting 2030, flat 11% return assumption,
  compounding to ~₹4.08 crore by 2036.
- **Dashboard** — static KPI summary, a SIP allocation pie (Nifty50, Flexi Cap, Mid Cap,
  Small Cap, Global Equity, Gold), and hardcoded "recommended strategy" text.

This data is migrated into the app's initial data file (see §5), with categories normalized
to a fixed list and the hardcoded 2030 threshold replaced by a dynamically computed payoff
month.

## 3. Billing cycle

Every date is bucketed into a cycle running **25th of month N → 24th of month N+1**, labeled
by the month it closes into (e.g. Aug 25–Sep 24, 2026 → cycle label "Sep 2026"). All
month-wise views (dashboard, reports, targets, category breakdowns) use this cycle, not the
calendar month. Cycle start day (25) is a configurable setting, not hardcoded, in case it
ever changes.

## 4. Currency handling

Salary is in JPY; loan, SIP, and most targets are tracked in INR. Every transaction supports
entry in either JPY or INR (auto-converting the other via the configured FX rate, matching
the original sheet's behavior). The FX rate is a single editable setting; historical
transactions store whichever amount was entered plus the computed conversion at entry time
(not re-converted retroactively when the rate later changes), so past records stay accurate
to what actually happened.

## 5. Storage strategy

**Primary store: a real local JSON file, via the File System Access API** (Chrome/Edge only).

- First run: user clicks "Create / Open Data File". They either create a new
  `finance-data.json` (pre-populated by converting the xlsx data described in §2) or open an
  existing one from a prior session.
- The resulting `FileSystemFileHandle` is persisted in IndexedDB. On subsequent loads, the app
  detects the saved handle and shows a one-click "Reconnect to finance-data.json" button
  (Chrome requires an explicit user gesture to re-grant file permission — this cannot be fully
  automatic).
- Every mutation (add/edit/delete transaction, settings change, loan extra-prepayment edit,
  category edit) triggers a debounced write of the full JSON document back to that file via
  `handle.createWritable()`.
- **Autosave mirror:** every mutation is also immediately written to `localStorage`. If a file
  write fails (permission revoked, handle stale) the app keeps working against the
  localStorage mirror and shows a non-blocking banner asking the user to reconnect the file;
  no data entry is ever lost, only the on-disk sync is paused.
- **Secondary export:** a separate "Export" action (Settings tab and Reports tab) produces a
  standalone CSV or XLSX snapshot via SheetJS, independent of the live JSON data file — for
  sharing or point-in-time backup.

### JSON document shape

```json
{
  "settings": {
    "salaryJPY": 0, "fxRateJpyToInr": 0, "cycleStartDay": 25,
    "emergencyFundTargetJPY": 0,
    "homeLoan": { "principalINR": 0, "annualRatePct": 0, "emiINR": 0, "tenureMonths": 0 },
    "sip": { "startingMonthlyINR": 0, "annualStepUpPct": 0, "estimatedReturnPct": 11,
              "allocation": { "Nifty50": 0, "FlexiCap": 0, "MidCap": 0, "SmallCap": 0,
                               "GlobalEquity": 0, "Gold": 0 } }
  },
  "categories": [
    { "id": "groceries", "name": "Groceries", "color": "#..." }
  ],
  "transactions": [
    { "id": "uuid", "date": "2026-08-26", "categoryId": "groceries", "description": "",
      "amountJPY": 0, "amountINR": 0, "paymentMethod": "Cash", "needWant": "Need",
      "notes": "" }
  ],
  "cycleTargets": [
    { "cycle": "2026-09", "savingsTargetINR": 0, "emergencyFundTargetINR": 0,
      "loanPrepaymentTargetINR": 0 }
  ],
  "homeLoanExtras": [
    { "monthIndex": 1, "extraPrepaymentINR": 0 }
  ]
}
```

All derived values (cycle actuals, amortization schedule, SIP projection, payoff month) are
computed at render time from this document — never stored redundantly.

## 6. Modules (tabs)

One `index.html`, Bootstrap 5 (CDN) + Material Symbols icon font (CDN) for look/feel,
Chart.js (CDN) for charts, SheetJS (CDN) for CSV/XLSX export/import, all CSS and JS inline in
the file. Internally organized as independent JS render-modules (one object/function set per
tab) sharing a single in-memory data store + the persistence layer from §5 — reusable
components (stat card, data table with sort/filter, modal form, chart wrapper) shared across
tabs rather than duplicated per tab.

1. **Dashboard** — current-cycle KPI cards (income, spend, savings rate), emergency fund
   progress bar (target vs actual), home loan balance + computed payoff ETA, SIP corpus
   trajectory snapshot, category donut chart for the current cycle, cycle-over-cycle trend
   sparkline.
2. **Transactions** — full CRUD (add/edit/delete via modal form), filter by cycle / category /
   payment method / need-want, sort by any column, text search, dual JPY/INR entry with
   live auto-convert, pagination for long lists.
3. **Categories** — manage the fixed category list (add/rename/delete, assign chart color);
   deleting a category in use requires reassigning its transactions first.
4. **Emergency Fund** — target vs actual by cycle (table + progress chart), contribution
   history, running balance capped at target.
5. **Home Loan** — amortization schedule table recomputed live from settings +
   `homeLoanExtras`, inline-editable extra-prepayment per month, principal-vs-interest
   stacked chart, payoff ETA (computed, not hardcoded).
6. **SIP / Investments** — yearly projection table 2027–2036 (auto-escalating SIP, post-loan
   redirect starting at the *computed* payoff month rather than a hardcoded year), editable
   allocation percentages (must sum to 100%), corpus growth line chart.
7. **Reports** — month-wise (cycle-wise) and category-wise comparison charts across all
   cycles on record; the CSV/XLSX export action lives here too.
8. **Settings** — all assumptions from §5, cycle-start-day config, data file
   connect/reconnect controls, last-saved indicator, manual backup export/import.

## 7. Non-goals

- No multi-user support, no auth, no server/backend, no hosting.
- No support for browsers without the File System Access API (Safari/Firefox) — out of scope
  per user's confirmed browser choice (Chrome/Edge).
- No real-time bank sync or OCR receipt import.

## 8. Testing approach

Manual verification in Chrome after each module is built: create/open a data file, add/edit/
delete transactions, confirm cycle bucketing at the 24th/25th boundary, confirm home loan
schedule recalculates when an extra prepayment is edited, confirm SIP payoff-linked redirect
year updates when loan terms change, confirm charts update after data changes, confirm
export produces a valid CSV/XLSX, confirm reconnecting to the data file after a reload
restores all data.
