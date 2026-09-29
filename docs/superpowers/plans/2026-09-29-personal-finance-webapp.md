# Personal Finance Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file, local-only HTML app (`index.html`) that replaces the user's
xlsx workbook for tracking expenses, savings, emergency fund progress, home loan repayment,
and SIP investing, bucketed into a 25th-to-24th billing cycle.

**Architecture:** One self-contained `index.html` with all CSS/JS inline, tab-based
navigation, a pure-function calculation engine, a `Store` data layer backed by the File
System Access API (with a `localStorage` autosave mirror), and Chart.js-driven
visualizations. The calculation engine is developed and unit-tested as a standalone Node
module (`js/calc.js` + `js/calc.test.js`) using only Node's built-in `assert` — zero npm
dependencies — then copied verbatim into `index.html`'s inline script so the shipped file
stays fully self-contained.

**Tech Stack:** Vanilla JS, Bootstrap 5 (CDN), Material Symbols icon font (CDN), Chart.js
(CDN), SheetJS/xlsx (CDN), File System Access API, `localStorage`, Node.js (dev-time testing
only, not part of the shipped app).

**Spec:** `docs/superpowers/specs/2026-09-29-personal-finance-webapp-design.md`

## Global Constraints

- The shipped app is exactly one file, `index.html`. No `<script src>`/`<link>` to local
  files — only CDN URLs for third-party libraries. All other CSS/JS is inline.
- `js/calc.js` is the **tested source of truth** for all calculation logic. It is a dev-time
  file only (never referenced by `index.html`). Whenever it changes: rerun
  `node js/calc.test.js`, confirm `ALL PASS`, then copy its full contents verbatim into
  `index.html`'s `<script id="calc-engine">` block, replacing the previous copy exactly.
- Billing cycle default start day is 25 (configurable in settings, never hardcoded elsewhere).
- Currency: JPY is the native transaction currency for salary; INR is the native currency for
  loan/SIP/targets. Every conversion uses `Calc.jpyToInr`/`Calc.inrToJpy` with the *rate in
  effect at entry time* for historical transactions — never retroactively recomputed.
- Category list is fixed (editable via the Categories tab), not free text. Legacy free-text
  categories from the xlsx are normalized once during migration (Task 6) via
  `Calc.normalizeCategory`.
- Money values in the data model are stored as plain numbers (no currency formatting); all
  formatting for display happens in UI render functions via `Calc.formatCurrency`.

## Review Focus

- Transaction dated exactly on the cycle-start day (25th) vs. the day before (24th) must land
  in different cycles — off-by-one here silently corrupts every monthly report. Tested in
  Task 2.
- Deleting a category that has existing transactions must be blocked (or force reassignment)
  rather than silently orphaning those transactions' `categoryId`. Tested in Task 10.
- Changing the FX rate in Settings must not alter the `amountINR`/`amountJPY` already stored
  on past transactions — only new entries use the new rate. Tested in Task 9.
- A revoked/stale File System Access permission mid-session must not lose in-progress data —
  the app must fall back to the `localStorage` mirror and surface a reconnect prompt instead
  of throwing. Tested in Task 7.
- An extra home-loan prepayment larger than the remaining principal must clamp the closing
  balance at 0 (and stop generating further schedule rows), never go negative. Tested in
  Task 3.

---

## Task 1: Project scaffold — index.html shell, tab navigation, CDN includes

**Files:**
- Create: `index.html`

**Interfaces:**
- Produces: the DOM structure every later task renders into — a `<nav>` with tab buttons
  `data-tab="dashboard|transactions|categories|emergency-fund|home-loan|sip|reports|settings"`,
  and matching `<section id="tab-<name>" class="tab-pane d-none">` containers. Produces a
  global `App.showTab(name)` function that later tasks' nav-click handlers call.

- [ ] **Step 1: Write `index.html` with CDN includes and empty tab shell**

```html
<!DOCTYPE html>
<html lang="en" data-bs-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Personal Finance Tracker</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>
  body { background: #f4f6f9; }
  .material-symbols-outlined { font-variation-settings: 'FILL' 0; vertical-align: middle; }
  .nav-pills .nav-link.active { background-color: #3f51b5; }
  .tab-pane.d-none { display: none !important; }
  .stat-card { border-radius: 12px; }
</style>
</head>
<body>
<div class="container-fluid py-3">
  <div class="d-flex align-items-center mb-3">
    <span class="material-symbols-outlined me-2" style="font-size:28px;color:#3f51b5;">account_balance_wallet</span>
    <h4 class="mb-0">Personal Finance Tracker</h4>
  </div>
  <ul class="nav nav-pills mb-3" id="main-nav">
    <li class="nav-item"><button class="nav-link active" data-tab="dashboard">Dashboard</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="transactions">Transactions</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="categories">Categories</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="emergency-fund">Emergency Fund</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="home-loan">Home Loan</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="sip">SIP</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="reports">Reports</button></li>
    <li class="nav-item"><button class="nav-link" data-tab="settings">Settings</button></li>
  </ul>
  <div id="connect-banner" class="alert alert-warning d-none"></div>
  <section id="tab-dashboard" class="tab-pane"><p>Dashboard coming soon.</p></section>
  <section id="tab-transactions" class="tab-pane d-none"><p>Transactions coming soon.</p></section>
  <section id="tab-categories" class="tab-pane d-none"><p>Categories coming soon.</p></section>
  <section id="tab-emergency-fund" class="tab-pane d-none"><p>Emergency Fund coming soon.</p></section>
  <section id="tab-home-loan" class="tab-pane d-none"><p>Home Loan coming soon.</p></section>
  <section id="tab-sip" class="tab-pane d-none"><p>SIP coming soon.</p></section>
  <section id="tab-reports" class="tab-pane d-none"><p>Reports coming soon.</p></section>
  <section id="tab-settings" class="tab-pane d-none"><p>Settings coming soon.</p></section>
</div>
<script id="calc-engine">
  // Placeholder — Task 17 replaces this block with the verbatim contents of js/calc.js
  window.Calc = window.Calc || {};
</script>
<script>
  const App = {};
  App.showTab = function(name) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('d-none'));
    document.querySelectorAll('#main-nav .nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + name).classList.remove('d-none');
    document.querySelector(`#main-nav [data-tab="${name}"]`).classList.add('active');
  };
  document.querySelectorAll('#main-nav [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => App.showTab(btn.dataset.tab));
  });
</script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: Manually verify in Chrome**

Open `index.html` directly (double-click, `file://` URL). Confirm:
1. The page loads with no console errors (DevTools → Console).
2. Clicking each of the 8 nav pills shows that tab's placeholder text and hides the others.
3. The active pill's background highlights.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: scaffold index.html with tab navigation and CDN includes"
```

---

## Task 2: Calc engine — billing cycles & currency conversion

**Files:**
- Create: `js/calc.js`
- Create: `js/calc.test.js`

**Interfaces:**
- Produces: `Calc.getCycleForDate(dateStr, cycleStartDay=25) -> "YYYY-MM"`,
  `Calc.getCycleBounds(cycleLabel, cycleStartDay=25) -> {start: Date, end: Date}`,
  `Calc.jpyToInr(amountJPY, jpyPerInr) -> number`,
  `Calc.inrToJpy(amountINR, jpyPerInr) -> number`,
  `Calc.formatCurrency(amount, currency) -> string` (currency is `"JPY"` or `"INR"`).

- [ ] **Step 1: Write the failing tests**

```js
// js/calc.test.js
const assert = require('assert');
const Calc = require('./calc.js');

// Cycle boundary tests
assert.strictEqual(Calc.getCycleForDate('2026-08-24'), '2026-08', 'Aug 24 belongs to cycle ending Aug 24');
assert.strictEqual(Calc.getCycleForDate('2026-08-25'), '2026-09', 'Aug 25 starts the cycle ending Sep 24');
assert.strictEqual(Calc.getCycleForDate('2026-09-24'), '2026-09', 'Sep 24 belongs to cycle 2026-09');
assert.strictEqual(Calc.getCycleForDate('2026-09-25'), '2026-10', 'Sep 25 starts cycle 2026-10');
assert.strictEqual(Calc.getCycleForDate('2026-12-25'), '2027-01', 'Dec 25 rolls into next calendar year');

const bounds = Calc.getCycleBounds('2026-09');
assert.strictEqual(bounds.start.getFullYear(), 2026);
assert.strictEqual(bounds.start.getMonth(), 7); // August, zero-indexed
assert.strictEqual(bounds.start.getDate(), 25);
assert.strictEqual(bounds.end.getMonth(), 8); // September
assert.strictEqual(bounds.end.getDate(), 24);

// Currency tests
assert.strictEqual(Calc.jpyToInr(21500, 2.15), 10000);
assert.strictEqual(Calc.inrToJpy(10000, 2.15), 21500);
assert.strictEqual(Calc.formatCurrency(10000, 'INR'), '₹10,000');
assert.strictEqual(Calc.formatCurrency(21500, 'JPY'), '¥21,500');

console.log('calc.test.js: cycles & currency — ALL PASS');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node js/calc.test.js`
Expected: `Error: Cannot find module './calc.js'`

- [ ] **Step 3: Implement `js/calc.js`**

```js
// js/calc.js — pure calculation engine. No DOM access. Tested via calc.test.js,
// then copied verbatim into index.html's #calc-engine script block (see Task 17).
const Calc = {};

Calc.getCycleForDate = function(dateStr, cycleStartDay = 25) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  let month = d.getMonth();
  let year = d.getFullYear();
  if (day >= cycleStartDay) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

Calc.getCycleBounds = function(cycleLabel, cycleStartDay = 25) {
  const [y, m] = cycleLabel.split('-').map(Number);
  const endMonthIndex = m - 1;
  const end = new Date(y, endMonthIndex, cycleStartDay - 1);
  let startMonthIndex = endMonthIndex - 1;
  let startYear = y;
  if (startMonthIndex < 0) { startMonthIndex = 11; startYear -= 1; }
  const start = new Date(startYear, startMonthIndex, cycleStartDay);
  return { start, end };
};

Calc.jpyToInr = function(amountJPY, jpyPerInr) {
  return amountJPY / jpyPerInr;
};

Calc.inrToJpy = function(amountINR, jpyPerInr) {
  return amountINR * jpyPerInr;
};

Calc.formatCurrency = function(amount, currency) {
  const symbol = currency === 'JPY' ? '¥' : '₹';
  const rounded = Math.round(amount);
  return symbol + rounded.toLocaleString('en-IN');
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Calc;
}
if (typeof window !== 'undefined') {
  window.Calc = Calc;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node js/calc.test.js`
Expected: `calc.test.js: cycles & currency — ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add js/calc.js js/calc.test.js
git commit -m "feat: add cycle-bucketing and currency conversion to calc engine"
```

---

## Task 3: Calc engine — home loan amortization

**Files:**
- Modify: `js/calc.js`
- Modify: `js/calc.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Calc.buildAmortizationSchedule({principal, annualRatePct, emi, tenureMonths, extras}) -> [{month, opening, interest, emi, extra, closing}]`,
  `Calc.getPayoffMonth(schedule) -> number|null`.

- [ ] **Step 1: Write the failing tests**

Append to `js/calc.test.js` (before the final `console.log` line, update that line too):

```js
// Amortization tests
const schedule = Calc.buildAmortizationSchedule({
  principal: 100000, annualRatePct: 12, emi: 10000, tenureMonths: 12, extras: {}
});
assert.strictEqual(schedule[0].opening, 100000);
assert.strictEqual(schedule[0].interest, 1000); // 100000 * (12/100/12)
assert.strictEqual(schedule[0].closing, 91000); // 100000 + 1000 - 10000

// Overpay clamp: huge extra prepayment must not go negative
const clampSchedule = Calc.buildAmortizationSchedule({
  principal: 5000, annualRatePct: 12, emi: 1000, tenureMonths: 12,
  extras: { 1: 999999 }
});
assert.strictEqual(clampSchedule[0].closing, 0, 'closing balance clamps at 0, never negative');
assert.strictEqual(clampSchedule.length, 1, 'schedule stops once principal hits 0');

assert.strictEqual(Calc.getPayoffMonth(clampSchedule), 1);
assert.strictEqual(Calc.getPayoffMonth([{month: 1, closing: 500}]), null);
```

Change the final line to: `console.log('calc.test.js: cycles, currency & amortization — ALL PASS');`

- [ ] **Step 2: Run to verify it fails**

Run: `node js/calc.test.js`
Expected: `TypeError: Calc.buildAmortizationSchedule is not a function`

- [ ] **Step 3: Implement in `js/calc.js`** (append before the `module.exports` block)

```js
Calc.buildAmortizationSchedule = function({ principal, annualRatePct, emi, tenureMonths, extras = {} }) {
  const monthlyRate = annualRatePct / 100 / 12;
  const rows = [];
  let opening = principal;
  for (let m = 1; m <= tenureMonths && opening > 0; m++) {
    const interest = opening * monthlyRate;
    const extra = extras[m] || 0;
    const closing = Math.max(0, opening + interest - emi - extra);
    rows.push({ month: m, opening, interest, emi, extra, closing });
    opening = closing;
  }
  return rows;
};

Calc.getPayoffMonth = function(schedule) {
  const row = schedule.find(r => r.closing === 0);
  return row ? row.month : null;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node js/calc.test.js`
Expected: `calc.test.js: cycles, currency & amortization — ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add js/calc.js js/calc.test.js
git commit -m "feat: add home loan amortization schedule to calc engine"
```

---

## Task 4: Calc engine — SIP projection with dynamic payoff-linked redirect

**Files:**
- Modify: `js/calc.js`
- Modify: `js/calc.test.js`

**Interfaces:**
- Consumes: `Calc.getPayoffMonth` result (a month index, 1-based) as `payoffMonth` input.
- Produces: `Calc.buildSipProjection({startingMonthlyINR, annualStepUpPct, estimatedReturnPct, startYear, endYear, payoffMonth, postLoanMonthlyRedirectINR}) -> [{year, monthlySip, annualBase, postLoanRedirect, totalAnnual, opening, growth, closing}]`.

- [ ] **Step 1: Write the failing test**

Append to `js/calc.test.js`:

```js
// SIP projection tests
const sip = Calc.buildSipProjection({
  startingMonthlyINR: 100000, annualStepUpPct: 10, estimatedReturnPct: 11,
  startYear: 2027, endYear: 2029, payoffMonth: 15, postLoanMonthlyRedirectINR: 78500
});
assert.strictEqual(sip.length, 3);
assert.strictEqual(sip[0].monthlySip, 100000); // year 0, no step-up yet
assert.strictEqual(sip[0].postLoanRedirect, 0); // payoff at month 15 = year 2028, not yet in 2027
assert.strictEqual(Math.round(sip[1].monthlySip), 110000); // year 1: +10%
assert.strictEqual(sip[1].postLoanRedirect, 78500); // month 15 falls in year offset 1 -> 2028
assert.strictEqual(sip[0].opening, 0);
assert.ok(sip[1].opening > 0, 'opening balance carries forward from prior year closing');
```

Update the final `console.log` to mention "SIP projection".

- [ ] **Step 2: Run to verify it fails**

Run: `node js/calc.test.js`
Expected: `TypeError: Calc.buildSipProjection is not a function`

- [ ] **Step 3: Implement in `js/calc.js`**

```js
Calc.buildSipProjection = function({
  startingMonthlyINR, annualStepUpPct, estimatedReturnPct,
  startYear, endYear, payoffMonth, postLoanMonthlyRedirectINR
}) {
  const rows = [];
  let opening = 0;
  const payoffYearOffset = payoffMonth != null ? Math.floor((payoffMonth - 1) / 12) : null;
  for (let year = startYear; year <= endYear; year++) {
    const yearsElapsed = year - startYear;
    const monthlySip = startingMonthlyINR * Math.pow(1 + annualStepUpPct / 100, yearsElapsed);
    const redirect = (payoffYearOffset !== null && yearsElapsed >= payoffYearOffset)
      ? postLoanMonthlyRedirectINR : 0;
    const annualBase = monthlySip * 12;
    const postLoanRedirect = redirect * 12;
    const totalAnnual = annualBase + postLoanRedirect;
    const growth = (opening + totalAnnual / 2) * (estimatedReturnPct / 100);
    const closing = opening + totalAnnual + growth;
    rows.push({ year, monthlySip, annualBase, postLoanRedirect, totalAnnual, opening, growth, closing });
    opening = closing;
  }
  return rows;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node js/calc.test.js`
Expected: all assertions pass, final console.log prints.

- [ ] **Step 5: Commit**

```bash
git add js/calc.js js/calc.test.js
git commit -m "feat: add SIP projection with dynamic payoff-linked redirect to calc engine"
```

---

## Task 5: Calc engine — category normalization, transaction filter/sort/aggregate

**Files:**
- Modify: `js/calc.js`
- Modify: `js/calc.test.js`

**Interfaces:**
- Produces: `Calc.CATEGORY_NORMALIZATION_MAP` (object), `Calc.normalizeCategory(rawCategory) -> string`,
  `Calc.filterTransactions(transactions, {cycle, categoryId, paymentMethod, needWant, search}) -> array`,
  `Calc.sortTransactions(transactions, sortBy, direction='asc') -> array`,
  `Calc.aggregateByCycle(transactions) -> {[cycle]: {totalINR, byCategory: {[categoryId]: number}}}`.

- [ ] **Step 1: Write the failing tests**

Append to `js/calc.test.js`:

```js
// Category normalization
assert.strictEqual(Calc.normalizeCategory('Eating out'), 'Eating Out');
assert.strictEqual(Calc.normalizeCategory('Groceries (Costco)'), 'Groceries');
assert.strictEqual(Calc.normalizeCategory('some unknown label'), 'Other');

// Filter/sort
const txns = [
  { id: 'a', date: '2026-08-26', categoryId: 'groceries', amountINR: 500, description: 'Milk', paymentMethod: 'Cash', needWant: 'Need', notes: '' },
  { id: 'b', date: '2026-09-01', categoryId: 'wants', amountINR: 2000, description: 'Massage', paymentMethod: 'Credit Card', needWant: 'Want', notes: '' },
  { id: 'c', date: '2026-09-20', categoryId: 'groceries', amountINR: 300, description: 'Veg', paymentMethod: 'Cash', needWant: 'Need', notes: '' }
];
const filtered = Calc.filterTransactions(txns, { categoryId: 'groceries' });
assert.strictEqual(filtered.length, 2);

const searched = Calc.filterTransactions(txns, { search: 'massage' });
assert.strictEqual(searched.length, 1);
assert.strictEqual(searched[0].id, 'b');

const sortedAsc = Calc.sortTransactions(txns, 'amountINR', 'asc');
assert.deepStrictEqual(sortedAsc.map(t => t.id), ['c', 'a', 'b']);
const sortedDesc = Calc.sortTransactions(txns, 'amountINR', 'desc');
assert.deepStrictEqual(sortedDesc.map(t => t.id), ['b', 'a', 'c']);

// Aggregate
const agg = Calc.aggregateByCycle(txns);
assert.strictEqual(agg['2026-09'].totalINR, 2300); // Aug26->cycle 2026-09, Sep1&Sep20 same cycle
assert.strictEqual(agg['2026-09'].byCategory['groceries'], 800);
```

Update the final `console.log` message.

- [ ] **Step 2: Run to verify it fails**

Run: `node js/calc.test.js`
Expected: `TypeError: Calc.normalizeCategory is not a function`

- [ ] **Step 3: Implement in `js/calc.js`**

```js
Calc.CATEGORY_NORMALIZATION_MAP = {
  'Wants (Massage, shopping, hobbies, gifts, etc.)': 'Wants',
  'Fixed obligations (Home loan, rent, utilities, insurance, etc.)': 'Fixed Obligations',
  'Family / India (Transfers to India, parents, wife, etc.)': 'Family/India',
  'Eating out': 'Eating Out',
  'Groceries (Costco, Hanamasa, Welcia, etc.)': 'Groceries',
  'Groceries (Costco)': 'Groceries'
};

Calc.normalizeCategory = function(rawCategory) {
  return Calc.CATEGORY_NORMALIZATION_MAP[rawCategory] || 'Other';
};

Calc.filterTransactions = function(transactions, filters = {}) {
  const { cycle, categoryId, paymentMethod, needWant, search } = filters;
  return transactions.filter(t => {
    if (cycle && Calc.getCycleForDate(t.date) !== cycle) return false;
    if (categoryId && t.categoryId !== categoryId) return false;
    if (paymentMethod && t.paymentMethod !== paymentMethod) return false;
    if (needWant && t.needWant !== needWant) return false;
    if (search) {
      const hay = `${t.description} ${t.notes}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
};

Calc.sortTransactions = function(transactions, sortBy, direction = 'asc') {
  const sorted = [...transactions].sort((a, b) => {
    let av = a[sortBy], bv = b[sortBy];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
};

Calc.aggregateByCycle = function(transactions) {
  const map = {};
  for (const t of transactions) {
    const cycle = Calc.getCycleForDate(t.date);
    if (!map[cycle]) map[cycle] = { totalINR: 0, byCategory: {} };
    map[cycle].totalINR += t.amountINR;
    map[cycle].byCategory[t.categoryId] = (map[cycle].byCategory[t.categoryId] || 0) + t.amountINR;
  }
  return map;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node js/calc.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/calc.js js/calc.test.js
git commit -m "feat: add category normalization and transaction filter/sort/aggregate to calc engine"
```

---

## Task 6: Data migration — convert the xlsx workbook into seed-data.json

**Files:**
- Create: `scripts/migrate-xlsx.js`
- Create: `seed-data.json` (generated output, committed)

**Interfaces:**
- Consumes: `Calc.normalizeCategory` (via `require('../js/calc.js')`).
- Produces: `seed-data.json` matching the JSON document shape in the spec §5, used by Task 17
  to pre-populate a newly created data file.

- [ ] **Step 1: Write `scripts/migrate-xlsx.js`**

```js
// scripts/migrate-xlsx.js — one-off script, run manually, output committed as seed-data.json.
// Requires: npm install xlsx  (dev-time only, not part of the shipped app)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const Calc = require('../js/calc.js');

const SOURCE = process.argv[2] || '/Users/hitesh/Downloads/Personal_Financial_Strategy_2026_2036 (1).xlsx';
const wb = XLSX.readFile(SOURCE);

const CATEGORY_LIST = [
  { id: 'groceries', name: 'Groceries', color: '#4caf50' },
  { id: 'eating-out', name: 'Eating Out', color: '#ff9800' },
  { id: 'fixed-obligations', name: 'Fixed Obligations', color: '#3f51b5' },
  { id: 'family-india', name: 'Family/India', color: '#9c27b0' },
  { id: 'wants', name: 'Wants', color: '#e91e63' },
  { id: 'transport', name: 'Transport', color: '#00bcd4' },
  { id: 'utilities', name: 'Utilities', color: '#607d8b' },
  { id: 'rent', name: 'Rent', color: '#795548' },
  { id: 'other', name: 'Other', color: '#9e9e9e' }
];
const nameToId = Object.fromEntries(CATEGORY_LIST.map(c => [c.name, c.id]));

const expensesSheet = wb.Sheets['Daily Expenses'];
const rows = XLSX.utils.sheet_to_json(expensesSheet, { range: 3, defval: '' });

const transactions = rows
  .filter(r => r.Date)
  .map((r, i) => {
    const normalizedName = Calc.normalizeCategory(String(r.Category || '').trim());
    const date = XLSX.SSF.format('yyyy-mm-dd', r.Date);
    return {
      id: `migrated-${i + 1}`,
      date,
      categoryId: nameToId[normalizedName] || 'other',
      description: String(r.Description || ''),
      amountJPY: Number(r['Amount JPY']) || 0,
      amountINR: Number(r['Amount INR']) || 0,
      paymentMethod: String(r['Payment Method'] || 'Cash'),
      needWant: String(r['Need/Want'] || 'Need'),
      notes: String(r.Notes || '')
    };
  });

const planSheet = wb.Sheets['Financial Plan'];
const cell = (ref) => planSheet[ref] ? planSheet[ref].v : 0;

const earliestDate = transactions.length ? transactions.map(t => t.date).sort()[0] : new Date().toISOString().slice(0, 10);
const homeLoanStartCycle = Calc.getCycleForDate(earliestDate, 25);

const seed = {
  settings: {
    salaryJPY: cell('E3'),
    jpyPerInr: cell('E4'),
    cycleStartDay: 25,
    emergencyFundTargetJPY: cell('E8'),
    homeLoan: {
      principalINR: cell('E9'),
      annualRatePct: cell('E10') * 100,
      emiINR: cell('E11'),
      tenureMonths: cell('E12'),
      startCycle: homeLoanStartCycle
    },
    sip: {
      startingMonthlyINR: cell('E13'),
      annualStepUpPct: cell('E17') * 100,
      estimatedReturnPct: 11,
      allocation: { Nifty50: 40, FlexiCap: 20, MidCap: 15, SmallCap: 10, GlobalEquity: 10, Gold: 5 }
    }
  },
  categories: CATEGORY_LIST,
  transactions,
  cycleTargets: [],
  homeLoanExtras: []
};

fs.writeFileSync(path.join(__dirname, '..', 'seed-data.json'), JSON.stringify(seed, null, 2));
console.log(`Migrated ${transactions.length} transactions to seed-data.json`);
```

- [ ] **Step 2: Run it**

Run: `cd /Users/hitesh/projects/personal-finance-html && npm install xlsx --no-save && node scripts/migrate-xlsx.js`
Expected: `Migrated 57 transactions to seed-data.json` (count may vary slightly; confirm it's
close to the 57 real rows noted in the spec, not 0 and not thousands).

- [ ] **Step 3: Sanity-check the output**

Open `seed-data.json` and confirm: `transactions` is a non-empty array with real dates in
2026, `categoryId` values are all one of the 9 ids in `CATEGORY_LIST` (no `undefined`), and
`settings.homeLoan.principalINR` / `settings.sip.startingMonthlyINR` are non-zero numbers
matching the workbook's Financial Plan sheet.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-xlsx.js seed-data.json
git commit -m "feat: migrate xlsx workbook data into seed-data.json"
```

---

## Task 7: Persistence layer — File System Access API + localStorage mirror

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `seed-data.json` (fetched via `fetch('./seed-data.json')` — only works when
  `index.html` is served from the same folder; this fetch is same-origin `file://` read of a
  sibling file, which Chrome permits for reading, unlike write access).
- Produces: `Store.data` (in-memory doc), `Store.ready` (bool), `Store.mutate(fn)`,
  `Store.subscribe(fn)`, `FileStorage.connectOrCreate()`, `FileStorage.reconnect()`,
  `FileStorage.isConnected()`.

- [ ] **Step 1: Add the persistence script block to `index.html`** (before the closing
  `</body>`, after the calc-engine script block)

```html
<script>
  const LocalMirror = {
    KEY: 'finance-app-data-v1',
    save(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); },
    load() {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    }
  };

  const FileStorage = {
    handle: null,
    DB_NAME: 'finance-app-fs', STORE_NAME: 'handles', KEY: 'data-file',

    async _openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(this.STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async _persistHandle(handle) {
      const db = await this._openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        tx.objectStore(this.STORE_NAME).put(handle, this.KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async _loadSavedHandle() {
      const db = await this._openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const req = tx.objectStore(this.STORE_NAME).get(this.KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    isConnected() { return !!this.handle; },

    async hasSavedHandle() {
      const h = await this._loadSavedHandle();
      return !!h;
    },

    async reconnect() {
      const h = await this._loadSavedHandle();
      if (!h) return false;
      const perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
      this.handle = h;
      return true;
    },

    async connectOrCreate() {
      let handle;
      try {
        [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Finance data', accept: { 'application/json': ['.json'] } }]
        });
      } catch (e) {
        handle = await window.showSaveFilePicker({
          suggestedName: 'finance-data.json',
          types: [{ description: 'Finance data', accept: { 'application/json': ['.json'] } }]
        });
      }
      this.handle = handle;
      await this._persistHandle(handle);
      return handle;
    },

    async readData() {
      const file = await this.handle.getFile();
      const text = await file.text();
      return text ? JSON.parse(text) : null;
    },

    async writeData(data) {
      const writable = await this.handle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
    }
  };

  const Store = {
    data: null,
    ready: false,
    listeners: [],

    subscribe(fn) { this.listeners.push(fn); },
    _notify() { this.listeners.forEach(fn => fn(this.data)); },

    async _persist() {
      LocalMirror.save(this.data);
      if (FileStorage.isConnected()) {
        try {
          await FileStorage.writeData(this.data);
          document.getElementById('connect-banner').classList.add('d-none');
        } catch (e) {
          document.getElementById('connect-banner').textContent =
            'Could not save to the data file — reconnect from Settings. Your edits are safe in this browser for now.';
          document.getElementById('connect-banner').classList.remove('d-none');
        }
      }
    },

    async mutate(fn) {
      fn(this.data);
      this._notify();
      await this._persist();
    },

    async initFromFile() {
      let fileData = null;
      try { fileData = await FileStorage.readData(); } catch (e) { /* fall through */ }
      if (!fileData) {
        const seedResp = await fetch('./seed-data.json').catch(() => null);
        fileData = seedResp && seedResp.ok ? await seedResp.json() : {
          settings: { salaryJPY: 0, jpyPerInr: 1, cycleStartDay: 25, emergencyFundTargetJPY: 0,
            homeLoan: { principalINR: 0, annualRatePct: 0, emiINR: 0, tenureMonths: 0 },
            sip: { startingMonthlyINR: 0, annualStepUpPct: 0, estimatedReturnPct: 11, allocation: {} } },
          categories: [], transactions: [], cycleTargets: [], homeLoanExtras: []
        };
        await FileStorage.writeData(fileData);
      }
      this.data = fileData;
      this.ready = true;
      this._notify();
    },

    initFromLocalMirror() {
      this.data = LocalMirror.load();
      this.ready = !!this.data;
      this._notify();
    }
  };
</script>
```

- [ ] **Step 2: Wire the connect/reconnect UI into the dashboard tab placeholder**

```html
<!-- Replace the tab-dashboard section's placeholder content in index.html -->
<section id="tab-dashboard" class="tab-pane">
  <div id="storage-gate" class="text-center py-5">
    <p>Connect your finance data file to get started.</p>
    <button id="btn-connect" class="btn btn-primary">Create / Open Data File</button>
    <button id="btn-reconnect" class="btn btn-outline-primary d-none">Reconnect to finance-data.json</button>
  </div>
  <div id="dashboard-content" class="d-none"><p>Dashboard content coming in Task 11.</p></div>
</section>
```

```html
<script>
  async function bootStorage() {
    const hasSaved = await FileStorage.hasSavedHandle();
    if (hasSaved) {
      document.getElementById('btn-reconnect').classList.remove('d-none');
      document.getElementById('btn-connect').classList.add('d-none');
    }
  }
  document.getElementById('btn-connect').addEventListener('click', async () => {
    await FileStorage.connectOrCreate();
    await Store.initFromFile();
    document.getElementById('storage-gate').classList.add('d-none');
    document.getElementById('dashboard-content').classList.remove('d-none');
  });
  document.getElementById('btn-reconnect').addEventListener('click', async () => {
    const ok = await FileStorage.reconnect();
    if (ok) {
      await Store.initFromFile();
      document.getElementById('storage-gate').classList.add('d-none');
      document.getElementById('dashboard-content').classList.remove('d-none');
    } else {
      Store.initFromLocalMirror();
      if (Store.ready) {
        document.getElementById('storage-gate').classList.add('d-none');
        document.getElementById('dashboard-content').classList.remove('d-none');
      }
    }
  });
  bootStorage();
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Serve the folder locally so `fetch('./seed-data.json')` works (`file://` fetch of JSON is
blocked by CORS in Chrome): run `npx http-server -p 8080` (or `python3 -m http.server 8080`)
in the project folder, then open `http://localhost:8080/index.html`. Confirm:
1. Click "Create / Open Data File" → save picker appears → save as `finance-data.json` in
   the project folder → the storage gate hides and "Dashboard content coming in Task 11"
   shows.
2. Open `finance-data.json` in a text editor — confirm it contains the seeded transactions
   from `seed-data.json`.
3. Reload the page → "Reconnect to finance-data.json" button appears instead of "Create /
   Open Data File" → click it → grant permission → dashboard content shows again.
4. In DevTools console, run `Store.mutate(d => d.settings.salaryJPY = 999999)` → check
   `finance-data.json` on disk updates to `999999` within ~1 second.
5. In DevTools → Application → Local Storage, confirm a `finance-app-data-v1` key exists and
   mirrors the same data.

Note: once the app is finished (Task 17), running via `http-server` is still recommended for
this file-fetch reason during development; the spec's "open as a local file" for end use
still works because after the *first* successful create/open, all data lives in the picked
file and localStorage — `seed-data.json` is only read once, on first-ever setup. If the user
truly always opens via double-click (`file://`), document this in Task 17's final README-less
note inside the Settings tab: first-time setup should be done once via `http-server`, or the
user starts with "Create Data File" (skips the seed fetch, starts empty) and Task 6's
migration can alternatively be pasted in manually. Confirm this tradeoff is acceptable by
manually testing both paths above.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add File System Access persistence layer with localStorage mirror"
```

---

## Task 8: Reusable UI components — stat card, data table, modal form, chart wrapper

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `UI.statCard({icon, label, value, sub}) -> HTMLElement`,
  `UI.dataTable({columns, rows, sortBy, sortDir, onSort}) -> HTMLElement` (columns is
  `[{key, label, sortable}]`), `UI.chart(canvasEl, config) -> Chart` (thin wrapper that
  destroys any prior Chart instance on that canvas before creating a new one, so re-render
  doesn't leak canvases), `UI.modal({title, bodyHtml, onSave}) -> {show(), hide()}`.

- [ ] **Step 1: Add the components script block to `index.html`**

```html
<script>
  const UI = {};

  UI.statCard = function({ icon, label, value, sub }) {
    const el = document.createElement('div');
    el.className = 'card stat-card shadow-sm p-3 h-100';
    el.innerHTML = `
      <div class="d-flex align-items-center gap-2 text-muted small">
        <span class="material-symbols-outlined">${icon}</span><span>${label}</span>
      </div>
      <div class="fs-4 fw-bold mt-1">${value}</div>
      ${sub ? `<div class="small text-muted">${sub}</div>` : ''}
    `;
    return el;
  };

  UI.dataTable = function({ columns, rows, sortBy, sortDir, onSort }) {
    const table = document.createElement('table');
    table.className = 'table table-hover align-middle bg-white';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label + (sortBy === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      if (col.sortable) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => onSort(col.key));
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        td.innerHTML = col.render ? col.render(row) : (row[col.key] ?? '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  };

  UI._chartInstances = new WeakMap();
  UI.chart = function(canvasEl, config) {
    const existing = UI._chartInstances.get(canvasEl);
    if (existing) existing.destroy();
    const instance = new Chart(canvasEl, config);
    UI._chartInstances.set(canvasEl, instance);
    return instance;
  };

  UI.modal = function({ title, bodyHtml, onSave }) {
    let modalEl = document.getElementById('shared-modal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'shared-modal';
      modalEl.className = 'modal';
      modalEl.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="shared-modal-title"></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="shared-modal-body"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="shared-modal-save">Save</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modalEl);
    }
    document.getElementById('shared-modal-title').textContent = title;
    document.getElementById('shared-modal-body').innerHTML = bodyHtml;
    const bsModal = new bootstrap.Modal(modalEl);
    const saveBtn = document.getElementById('shared-modal-save');
    const saveHandler = () => { onSave(); bsModal.hide(); };
    saveBtn.replaceWith(saveBtn.cloneNode(true)); // strip old listeners
    document.getElementById('shared-modal-save').addEventListener('click', saveHandler);
    return { show: () => bsModal.show(), hide: () => bsModal.hide() };
  };
</script>
```

- [ ] **Step 2: Manually verify in Chrome DevTools console**

With the app open (post Task 7's connect flow), run in the console:
```js
document.body.appendChild(UI.statCard({icon: 'savings', label: 'Test', value: '₹1,000'}));
```
Confirm a card renders at the bottom of the page with the right icon/label/value, then
remove it (`.remove()` on the returned element, or reload).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add reusable UI components (stat card, data table, chart wrapper, modal)"
```

---

## Task 9: Transactions tab — CRUD, filter, sort, search, dual-currency entry

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.transactions`, `Store.mutate`, `Calc.filterTransactions`,
  `Calc.sortTransactions`, `Calc.jpyToInr`/`inrToJpy`, `Calc.formatCurrency`, `UI.dataTable`,
  `UI.modal`.
- Produces: `Tabs.transactions.render()`, called by `App.showTab('transactions')` and on
  every `Store` update while that tab is active.

- [ ] **Step 1: Replace the `tab-transactions` section markup**

```html
<section id="tab-transactions" class="tab-pane d-none">
  <div class="d-flex flex-wrap gap-2 mb-3 align-items-end">
    <div>
      <label class="form-label small mb-0">Category</label>
      <select id="txn-filter-category" class="form-select form-select-sm"><option value="">All</option></select>
    </div>
    <div>
      <label class="form-label small mb-0">Payment</label>
      <select id="txn-filter-payment" class="form-select form-select-sm">
        <option value="">All</option><option>Bank</option><option>Cash</option>
        <option>Credit Card</option><option>IC Card</option>
      </select>
    </div>
    <div>
      <label class="form-label small mb-0">Need/Want</label>
      <select id="txn-filter-needwant" class="form-select form-select-sm">
        <option value="">All</option><option>Need</option><option>Want</option>
      </select>
    </div>
    <div>
      <label class="form-label small mb-0">Search</label>
      <input id="txn-filter-search" class="form-control form-control-sm" placeholder="description/notes">
    </div>
    <button id="btn-add-txn" class="btn btn-primary btn-sm ms-auto">+ Add Transaction</button>
  </div>
  <div id="txn-table-container"></div>
</section>
```

- [ ] **Step 2: Add `Tabs.transactions` render logic**

```html
<script>
  window.Tabs = window.Tabs || {};
  Tabs.transactions = { sortBy: 'date', sortDir: 'desc' };

  Tabs.transactions.render = function() {
    if (!Store.ready) return;
    const catSelect = document.getElementById('txn-filter-category');
    if (catSelect.options.length <= 1) {
      Store.data.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        catSelect.appendChild(opt);
      });
    }
    const filters = {
      categoryId: document.getElementById('txn-filter-category').value,
      paymentMethod: document.getElementById('txn-filter-payment').value,
      needWant: document.getElementById('txn-filter-needwant').value,
      search: document.getElementById('txn-filter-search').value
    };
    const catById = Object.fromEntries(Store.data.categories.map(c => [c.id, c]));
    let rows = Calc.filterTransactions(Store.data.transactions, filters);
    rows = Calc.sortTransactions(rows, this.sortBy, this.sortDir);

    const table = UI.dataTable({
      columns: [
        { key: 'date', label: 'Date', sortable: true },
        { key: 'categoryId', label: 'Category', sortable: true, render: r => catById[r.categoryId]?.name || 'Other' },
        { key: 'description', label: 'Description', sortable: true },
        { key: 'amountINR', label: 'Amount (INR)', sortable: true, render: r => Calc.formatCurrency(r.amountINR, 'INR') },
        { key: 'amountJPY', label: 'Amount (JPY)', sortable: false, render: r => Calc.formatCurrency(r.amountJPY, 'JPY') },
        { key: 'paymentMethod', label: 'Payment', sortable: true },
        { key: 'needWant', label: 'Need/Want', sortable: true },
        { key: 'actions', label: '', render: r => `<button class="btn btn-sm btn-outline-secondary edit-txn" data-id="${r.id}">Edit</button>
                                                     <button class="btn btn-sm btn-outline-danger del-txn" data-id="${r.id}">Delete</button>` }
      ],
      rows,
      sortBy: this.sortBy, sortDir: this.sortDir,
      onSort: (key) => {
        Tabs.transactions.sortDir = (Tabs.transactions.sortBy === key && Tabs.transactions.sortDir === 'asc') ? 'desc' : 'asc';
        Tabs.transactions.sortBy = key;
        Tabs.transactions.render();
      }
    });
    const container = document.getElementById('txn-table-container');
    container.innerHTML = '';
    container.appendChild(table);

    container.querySelectorAll('.edit-txn').forEach(btn =>
      btn.addEventListener('click', () => Tabs.transactions.openForm(btn.dataset.id)));
    container.querySelectorAll('.del-txn').forEach(btn =>
      btn.addEventListener('click', () => Tabs.transactions.remove(btn.dataset.id)));
  };

  Tabs.transactions.remove = function(id) {
    Store.mutate(d => { d.transactions = d.transactions.filter(t => t.id !== id); });
  };

  Tabs.transactions.openForm = function(id) {
    const existing = id ? Store.data.transactions.find(t => t.id === id) : null;
    const catOptions = Store.data.categories.map(c =>
      `<option value="${c.id}" ${existing?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    const bodyHtml = `
      <div class="row g-2">
        <div class="col-6"><label class="form-label small">Date</label>
          <input type="date" id="f-date" class="form-control" value="${existing?.date || new Date().toISOString().slice(0,10)}"></div>
        <div class="col-6"><label class="form-label small">Category</label>
          <select id="f-category" class="form-select">${catOptions}</select></div>
        <div class="col-12"><label class="form-label small">Description</label>
          <input id="f-description" class="form-control" value="${existing?.description || ''}"></div>
        <div class="col-6"><label class="form-label small">Amount (INR)</label>
          <input type="number" id="f-amount-inr" class="form-control" value="${existing?.amountINR ?? ''}"></div>
        <div class="col-6"><label class="form-label small">Amount (JPY)</label>
          <input type="number" id="f-amount-jpy" class="form-control" value="${existing?.amountJPY ?? ''}"></div>
        <div class="col-6"><label class="form-label small">Payment Method</label>
          <select id="f-payment" class="form-select">
            ${['Bank','Cash','Credit Card','IC Card'].map(p => `<option ${existing?.paymentMethod===p?'selected':''}>${p}</option>`).join('')}
          </select></div>
        <div class="col-6"><label class="form-label small">Need/Want</label>
          <select id="f-needwant" class="form-select">
            ${['Need','Want'].map(p => `<option ${existing?.needWant===p?'selected':''}>${p}</option>`).join('')}
          </select></div>
        <div class="col-12"><label class="form-label small">Notes</label>
          <input id="f-notes" class="form-control" value="${existing?.notes || ''}"></div>
      </div>`;
    const modal = UI.modal({
      title: existing ? 'Edit Transaction' : 'Add Transaction',
      bodyHtml,
      onSave: () => {
        const jpyPerInr = Store.data.settings.jpyPerInr;
        let amountINR = parseFloat(document.getElementById('f-amount-inr').value) || 0;
        let amountJPY = parseFloat(document.getElementById('f-amount-jpy').value) || 0;
        if (amountINR && !amountJPY) amountJPY = Calc.inrToJpy(amountINR, jpyPerInr);
        if (amountJPY && !amountINR) amountINR = Calc.jpyToInr(amountJPY, jpyPerInr);
        const record = {
          id: existing ? existing.id : 'txn-' + Date.now(),
          date: document.getElementById('f-date').value,
          categoryId: document.getElementById('f-category').value,
          description: document.getElementById('f-description').value,
          amountINR, amountJPY,
          paymentMethod: document.getElementById('f-payment').value,
          needWant: document.getElementById('f-needwant').value,
          notes: document.getElementById('f-notes').value
        };
        Store.mutate(d => {
          const idx = d.transactions.findIndex(t => t.id === record.id);
          if (idx >= 0) d.transactions[idx] = record; else d.transactions.push(record);
        });
      }
    });
    modal.show();
  };

  document.getElementById('btn-add-txn').addEventListener('click', () => Tabs.transactions.openForm(null));
  ['txn-filter-category','txn-filter-payment','txn-filter-needwant','txn-filter-search'].forEach(id =>
    document.getElementById(id).addEventListener('input', () => Tabs.transactions.render()));
  Store.subscribe(() => { if (!document.getElementById('tab-transactions').classList.contains('d-none')) Tabs.transactions.render(); });
</script>
```

Also update `App.showTab` (from Task 1) to call the active tab's render function:

```js
App.showTab = function(name) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('d-none'));
  document.querySelectorAll('#main-nav .nav-link').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.remove('d-none');
  document.querySelector(`#main-nav [data-tab="${name}"]`).classList.add('active');
  const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (Tabs[camel] && Tabs[camel].render) Tabs[camel].render();
};
```

- [ ] **Step 3: Manually verify in Chrome**

With the app connected to a data file: go to Transactions tab, confirm the seeded 57 rows
render, sorted by date descending. Click a column header to sort by amount, confirm order
flips on second click. Filter by category, confirm row count drops accordingly. Click "+ Add
Transaction", fill only the INR field, save, confirm the row appears with a JPY amount
auto-computed. Edit that row, change the amount, save, confirm the table updates. Delete it,
confirm it's gone. Reload the page (reconnect), confirm the deletion persisted to
`finance-data.json`.

- [ ] **Step 4: Regression test — FX rate change must not alter historical transactions**

In DevTools console: note an existing transaction's `amountINR`/`amountJPY`, then run
`Store.mutate(d => d.settings.jpyPerInr = 999)`. Reload the Transactions tab and confirm that
existing transaction's stored amounts are unchanged (only new transactions created after this
point would use the new rate).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Transactions tab with CRUD, filter, sort, search, dual-currency entry"
```

---

## Task 10: Categories tab — manage category list, block deletion when in use

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.categories`, `Store.data.transactions`, `Store.mutate`, `UI.dataTable`, `UI.modal`.
- Produces: `Tabs.categories.render()`.

- [ ] **Step 1: Replace the `tab-categories` section markup**

```html
<section id="tab-categories" class="tab-pane d-none">
  <button id="btn-add-cat" class="btn btn-primary btn-sm mb-3">+ Add Category</button>
  <div id="cat-table-container"></div>
</section>
```

- [ ] **Step 2: Add `Tabs.categories` render logic**

```html
<script>
  Tabs.categories = {};

  Tabs.categories.render = function() {
    if (!Store.ready) return;
    const usageCount = {};
    Store.data.transactions.forEach(t => { usageCount[t.categoryId] = (usageCount[t.categoryId] || 0) + 1; });
    const table = UI.dataTable({
      columns: [
        { key: 'color', label: '', render: r => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${r.color}"></span>` },
        { key: 'name', label: 'Name' },
        { key: 'usage', label: 'Transactions', render: r => usageCount[r.id] || 0 },
        { key: 'actions', label: '', render: r => `<button class="btn btn-sm btn-outline-secondary edit-cat" data-id="${r.id}">Edit</button>
                                                     <button class="btn btn-sm btn-outline-danger del-cat" data-id="${r.id}">Delete</button>` }
      ],
      rows: Store.data.categories
    });
    const container = document.getElementById('cat-table-container');
    container.innerHTML = '';
    container.appendChild(table);
    container.querySelectorAll('.edit-cat').forEach(btn => btn.addEventListener('click', () => Tabs.categories.openForm(btn.dataset.id)));
    container.querySelectorAll('.del-cat').forEach(btn => btn.addEventListener('click', () => Tabs.categories.remove(btn.dataset.id, usageCount)));
  };

  Tabs.categories.remove = function(id, usageCount) {
    if ((usageCount[id] || 0) > 0) {
      alert(`Cannot delete this category — ${usageCount[id]} transaction(s) still use it. Reassign them in the Transactions tab first.`);
      return;
    }
    Store.mutate(d => { d.categories = d.categories.filter(c => c.id !== id); });
  };

  Tabs.categories.openForm = function(id) {
    const existing = id ? Store.data.categories.find(c => c.id === id) : null;
    const bodyHtml = `
      <div class="row g-2">
        <div class="col-8"><label class="form-label small">Name</label>
          <input id="f-cat-name" class="form-control" value="${existing?.name || ''}"></div>
        <div class="col-4"><label class="form-label small">Color</label>
          <input type="color" id="f-cat-color" class="form-control" value="${existing?.color || '#9e9e9e'}"></div>
      </div>`;
    const modal = UI.modal({
      title: existing ? 'Edit Category' : 'Add Category',
      bodyHtml,
      onSave: () => {
        const name = document.getElementById('f-cat-name').value.trim();
        if (!name) return;
        const record = {
          id: existing ? existing.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name, color: document.getElementById('f-cat-color').value
        };
        Store.mutate(d => {
          const idx = d.categories.findIndex(c => c.id === record.id);
          if (idx >= 0) d.categories[idx] = record; else d.categories.push(record);
        });
      }
    });
    modal.show();
  };

  document.getElementById('btn-add-cat').addEventListener('click', () => Tabs.categories.openForm(null));
  Store.subscribe(() => { if (!document.getElementById('tab-categories').classList.contains('d-none')) Tabs.categories.render(); });
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Go to Categories tab, confirm the 9 seeded categories list with correct "Transactions" usage
counts matching what's in the Transactions tab. Try deleting "Groceries" (in use) — confirm
the alert blocks it. Add a new unused category, delete it — confirm it's removed immediately.
Edit a category's color, confirm it saves.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Categories tab with usage-guarded deletion"
```

---

## Task 11: Dashboard tab — KPIs, emergency fund progress, home loan/SIP snapshot, category donut

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.aggregateByCycle`, `Calc.getCycleForDate`, `Calc.buildAmortizationSchedule`,
  `Calc.getPayoffMonth`, `Calc.buildSipProjection`, `Calc.formatCurrency`, `UI.statCard`, `UI.chart`.
- Produces: `Tabs.dashboard.render()`.

- [ ] **Step 1: Replace the `dashboard-content` div content** (inside the `tab-dashboard`
  section added in Task 7 — keep the `storage-gate` div above it as-is)

```html
<div id="dashboard-content" class="d-none">
  <div class="row g-3 mb-3" id="dash-stat-cards"></div>
  <div class="row g-3">
    <div class="col-md-6"><div class="card p-3"><canvas id="chart-category-donut"></canvas></div></div>
    <div class="col-md-6"><div class="card p-3"><canvas id="chart-cycle-trend"></canvas></div></div>
  </div>
</div>
```

- [ ] **Step 2: Add `Tabs.dashboard` render logic**

```html
<script>
  Tabs.dashboard = {};

  Tabs.dashboard.render = function() {
    if (!Store.ready) return;
    const d = Store.data;
    const currentCycle = Calc.getCycleForDate(new Date().toISOString().slice(0, 10), d.settings.cycleStartDay);
    const agg = Calc.aggregateByCycle(d.transactions);
    const currentAgg = agg[currentCycle] || { totalINR: 0, byCategory: {} };
    const incomeINR = Calc.jpyToInr(d.settings.salaryJPY, d.settings.jpyPerInr);
    const savingsRate = incomeINR > 0 ? Math.round((1 - currentAgg.totalINR / incomeINR) * 100) : 0;

    const extras = Object.fromEntries((d.homeLoanExtras || []).map(e => [e.monthIndex, e.extraPrepaymentINR]));
    const schedule = Calc.buildAmortizationSchedule({
      principal: d.settings.homeLoan.principalINR, annualRatePct: d.settings.homeLoan.annualRatePct,
      emi: d.settings.homeLoan.emiINR, tenureMonths: d.settings.homeLoan.tenureMonths, extras
    });
    const payoffMonth = Calc.getPayoffMonth(schedule);
    const currentBalance = schedule.length ? schedule[schedule.length - 1].closing : d.settings.homeLoan.principalINR;

    const sip = Calc.buildSipProjection({
      startingMonthlyINR: d.settings.sip.startingMonthlyINR, annualStepUpPct: d.settings.sip.annualStepUpPct,
      estimatedReturnPct: d.settings.sip.estimatedReturnPct, startYear: 2027, endYear: 2036,
      payoffMonth, postLoanMonthlyRedirectINR: d.settings.homeLoan.emiINR
    });
    const corpus2036 = sip.length ? sip[sip.length - 1].closing : 0;

    const cycleTarget = d.cycleTargets.find(t => t.cycle === currentCycle) || {};
    const savingsTarget = cycleTarget.savingsTargetINR || 0;
    const savingsActual = incomeINR - currentAgg.totalINR;
    const emergencyTarget = cycleTarget.emergencyFundTargetINR || 0;

    const cardsContainer = document.getElementById('dash-stat-cards');
    cardsContainer.innerHTML = '';
    [
      { icon: 'payments', label: `Spend (${currentCycle})`, value: Calc.formatCurrency(currentAgg.totalINR, 'INR'), sub: `Savings rate: ${savingsRate}%` },
      { icon: 'account_balance', label: 'Savings — Target vs Actual', value: Calc.formatCurrency(savingsActual, 'INR'), sub: `Target: ${Calc.formatCurrency(savingsTarget, 'INR')}` },
      { icon: 'savings', label: 'Emergency Fund Target (cycle)', value: Calc.formatCurrency(emergencyTarget, 'INR') },
      { icon: 'home', label: 'Home Loan Balance', value: Calc.formatCurrency(currentBalance, 'INR'), sub: payoffMonth ? `Payoff in month ${payoffMonth}` : 'Payoff beyond schedule' },
      { icon: 'trending_up', label: '2036 SIP Corpus (est.)', value: Calc.formatCurrency(corpus2036, 'INR') }
    ].forEach(cfg => {
      const col = document.createElement('div');
      col.className = 'col-6 col-lg'; // col-lg with no number = equal-width flex column, so 5 cards share the row evenly
      col.appendChild(UI.statCard(cfg));
      cardsContainer.appendChild(col);
    });

    const catById = Object.fromEntries(d.categories.map(c => [c.id, c]));
    const labels = Object.keys(currentAgg.byCategory);
    UI.chart(document.getElementById('chart-category-donut'), {
      type: 'doughnut',
      data: {
        labels: labels.map(id => catById[id]?.name || 'Other'),
        datasets: [{ data: labels.map(id => currentAgg.byCategory[id]), backgroundColor: labels.map(id => catById[id]?.color || '#9e9e9e') }]
      },
      options: { plugins: { title: { display: true, text: `Spend by category — ${currentCycle}` } } }
    });

    const cycles = Object.keys(agg).sort();
    UI.chart(document.getElementById('chart-cycle-trend'), {
      type: 'bar',
      data: { labels: cycles, datasets: [{ label: 'Total spend (INR)', data: cycles.map(c => agg[c].totalINR), backgroundColor: '#3f51b5' }] },
      options: { plugins: { title: { display: true, text: 'Spend by cycle' } } }
    });
  };

  Store.subscribe(() => { if (!document.getElementById('tab-dashboard').classList.contains('d-none')) Tabs.dashboard.render(); });
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Reload, connect/reconnect to the data file. Confirm the dashboard shows 5 stat cards with
non-placeholder numbers, a category donut chart for the current cycle, and a bar chart across
all cycles present in the seeded data. Add a new transaction in the Transactions tab, switch
back to Dashboard, confirm the numbers and charts update.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Dashboard tab with KPI cards and cycle/category charts"
```

---

## Task 12: Emergency Fund tab — target vs actual by cycle

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.cycleTargets`, `Calc.aggregateByCycle`, `UI.dataTable`, `UI.chart`, `UI.modal`.
- Produces: `Tabs.emergencyFund.render()`.

- [ ] **Step 1: Replace the `tab-emergency-fund` section markup**

```html
<section id="tab-emergency-fund" class="tab-pane d-none">
  <button id="btn-set-ef-target" class="btn btn-primary btn-sm mb-3">Set Target for Current Cycle</button>
  <div class="card p-3 mb-3"><canvas id="chart-ef-progress"></canvas></div>
  <div id="ef-table-container"></div>
</section>
```

- [ ] **Step 2: Add `Tabs.emergencyFund` render logic**

Emergency fund contributions are tracked as transactions whose `categoryId` is
`'fixed-obligations'` is too broad — instead, emergency fund contributions are entered as
transactions in a dedicated category `'emergency-fund'`. Add this category during migration
review, and treat its cycle totals as the "actual" contribution.

```html
<script>
  Tabs.emergencyFund = {};

  Tabs.emergencyFund.render = function() {
    if (!Store.ready) return;
    const d = Store.data;
    const agg = Calc.aggregateByCycle(d.transactions);
    const cycles = Array.from(new Set([...Object.keys(agg), ...d.cycleTargets.map(t => t.cycle)])).sort();
    const rows = cycles.map(cycle => {
      const target = (d.cycleTargets.find(t => t.cycle === cycle) || {}).emergencyFundTargetINR || 0;
      const actual = (agg[cycle] && agg[cycle].byCategory['emergency-fund']) || 0;
      return { cycle, target, actual, variance: actual - target };
    });

    const table = UI.dataTable({
      columns: [
        { key: 'cycle', label: 'Cycle' },
        { key: 'target', label: 'Target (INR)', render: r => Calc.formatCurrency(r.target, 'INR') },
        { key: 'actual', label: 'Actual (INR)', render: r => Calc.formatCurrency(r.actual, 'INR') },
        { key: 'variance', label: 'Variance', render: r => Calc.formatCurrency(r.variance, 'INR') }
      ],
      rows
    });
    const container = document.getElementById('ef-table-container');
    container.innerHTML = '';
    container.appendChild(table);

    UI.chart(document.getElementById('chart-ef-progress'), {
      type: 'line',
      data: {
        labels: rows.map(r => r.cycle),
        datasets: [
          { label: 'Target', data: rows.map(r => r.target), borderColor: '#9e9e9e', fill: false },
          { label: 'Actual', data: rows.map(r => r.actual), borderColor: '#4caf50', fill: false }
        ]
      },
      options: { plugins: { title: { display: true, text: 'Emergency fund: target vs actual by cycle' } } }
    });
  };

  document.getElementById('btn-set-ef-target').addEventListener('click', () => {
    const currentCycle = Calc.getCycleForDate(new Date().toISOString().slice(0, 10), Store.data.settings.cycleStartDay);
    const existing = Store.data.cycleTargets.find(t => t.cycle === currentCycle);
    const bodyHtml = `
      <p class="small text-muted">Sets all three targets for this cycle at once — shown on Dashboard (Savings), here (Emergency Fund), and on the Home Loan tab (Prepayment).</p>
      <div class="row g-2">
        <div class="col-12"><label class="form-label small">Savings Target (INR)</label>
          <input type="number" id="f-savings-target" class="form-control" value="${existing?.savingsTargetINR || ''}"></div>
        <div class="col-12"><label class="form-label small">Emergency Fund Target (INR)</label>
          <input type="number" id="f-ef-target" class="form-control" value="${existing?.emergencyFundTargetINR || ''}"></div>
        <div class="col-12"><label class="form-label small">Loan Prepayment Target (INR)</label>
          <input type="number" id="f-loan-target" class="form-control" value="${existing?.loanPrepaymentTargetINR || ''}"></div>
      </div>`;
    const modal = UI.modal({
      title: `Set Cycle Targets — ${currentCycle}`,
      bodyHtml,
      onSave: () => {
        const savingsValue = parseFloat(document.getElementById('f-savings-target').value) || 0;
        const efValue = parseFloat(document.getElementById('f-ef-target').value) || 0;
        const loanValue = parseFloat(document.getElementById('f-loan-target').value) || 0;
        Store.mutate(d => {
          let target = d.cycleTargets.find(t => t.cycle === currentCycle);
          if (!target) { target = { cycle: currentCycle, savingsTargetINR: 0, emergencyFundTargetINR: 0, loanPrepaymentTargetINR: 0 }; d.cycleTargets.push(target); }
          target.savingsTargetINR = savingsValue;
          target.emergencyFundTargetINR = efValue;
          target.loanPrepaymentTargetINR = loanValue;
        });
      }
    });
    modal.show();
  });
  Store.subscribe(() => { if (!document.getElementById('tab-emergency-fund').classList.contains('d-none')) Tabs.emergencyFund.render(); });
</script>
```

- [ ] **Step 3: Update Task 6's `CATEGORY_LIST` to include an `emergency-fund` category**

In `scripts/migrate-xlsx.js`, add `{ id: 'emergency-fund', name: 'Emergency Fund', color: '#009688' }`
to `CATEGORY_LIST`, rerun `node scripts/migrate-xlsx.js`, and commit the regenerated
`seed-data.json` as part of this task's commit (not Task 6's, since the need only became
clear here).

- [ ] **Step 4: Manually verify in Chrome**

Set targets for the current cycle (savings, emergency fund, loan prepayment together), add a
transaction categorized "Emergency Fund", confirm the table and line chart both reflect
emergency-fund target vs actual for that cycle. Switch to Dashboard and confirm the Savings
stat card shows the same savings target you just set. This cycle's loan prepayment target is
verified from the Home Loan tab in Task 13.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/migrate-xlsx.js seed-data.json
git commit -m "feat: add Emergency Fund tab with target vs actual tracking"
```

---

## Task 13: Home Loan tab — amortization schedule, editable extras, payoff ETA, prepayment target

**Files:**
- Modify: `index.html`
- Modify: `js/calc.js`
- Modify: `js/calc.test.js`

**Interfaces:**
- Consumes: `Store.data.homeLoanExtras`, `Store.data.settings.homeLoan` (including
  `startCycle`, set during migration in Task 6), `Store.data.cycleTargets`,
  `Calc.buildAmortizationSchedule`, `Calc.getPayoffMonth`, `UI.dataTable`, `UI.chart`.
- Produces: `Tabs.homeLoan.render()`, `Calc.cycleToLoanMonth(cycle, startCycle) -> number`
  (added to `js/calc.js` in this task — maps a billing cycle to its 1-based loan-month index,
  assuming loan month 1 falls in `startCycle`).

- [ ] **Step 1: Add `Calc.cycleToLoanMonth` to the calc engine, with tests**

Append to `js/calc.test.js` (update the final `console.log` message too):

```js
// Cycle-to-loan-month mapping
assert.strictEqual(Calc.cycleToLoanMonth('2026-09', '2026-09'), 1, 'start cycle is loan month 1');
assert.strictEqual(Calc.cycleToLoanMonth('2026-10', '2026-09'), 2);
assert.strictEqual(Calc.cycleToLoanMonth('2027-09', '2026-09'), 13, 'wraps across a calendar year');
```

Run `node js/calc.test.js`, confirm it fails with `Calc.cycleToLoanMonth is not a function`,
then append this to `js/calc.js` (before the `module.exports` block):

```js
Calc.cycleToLoanMonth = function(cycle, startCycle) {
  const [sy, sm] = startCycle.split('-').map(Number);
  const [cy, cm] = cycle.split('-').map(Number);
  return (cy - sy) * 12 + (cm - sm) + 1;
};
```

Run `node js/calc.test.js` again, confirm all pass, then commit:

```bash
git add js/calc.js js/calc.test.js
git commit -m "feat: add cycle-to-loan-month mapping to calc engine"
```

- [ ] **Step 2: Replace the `tab-home-loan` section markup**

```html
<section id="tab-home-loan" class="tab-pane d-none">
  <div id="hl-summary" class="mb-3 fw-bold"></div>
  <div id="hl-prepay-target" class="mb-3"></div>
  <div class="card p-3 mb-3"><canvas id="chart-hl-breakdown"></canvas></div>
  <div id="hl-table-container"></div>
</section>
```

- [ ] **Step 3: Add `Tabs.homeLoan` render logic**

```html
<script>
  Tabs.homeLoan = {};

  Tabs.homeLoan.render = function() {
    if (!Store.ready) return;
    const d = Store.data;
    const extras = Object.fromEntries((d.homeLoanExtras || []).map(e => [e.monthIndex, e.extraPrepaymentINR]));
    const schedule = Calc.buildAmortizationSchedule({
      principal: d.settings.homeLoan.principalINR, annualRatePct: d.settings.homeLoan.annualRatePct,
      emi: d.settings.homeLoan.emiINR, tenureMonths: d.settings.homeLoan.tenureMonths, extras
    });
    const payoffMonth = Calc.getPayoffMonth(schedule);
    document.getElementById('hl-summary').textContent = payoffMonth
      ? `Projected payoff: month ${payoffMonth} (~${Math.ceil(payoffMonth / 12)} years)`
      : 'Loan does not reach zero within the configured tenure — increase extra prepayments or tenure.';

    const currentCycle = Calc.getCycleForDate(new Date().toISOString().slice(0, 10), d.settings.cycleStartDay);
    const currentLoanMonth = Calc.cycleToLoanMonth(currentCycle, d.settings.homeLoan.startCycle);
    const prepayTarget = (d.cycleTargets.find(t => t.cycle === currentCycle) || {}).loanPrepaymentTargetINR || 0;
    const prepayActual = extras[currentLoanMonth] || 0;
    document.getElementById('hl-prepay-target').innerHTML =
      `<span class="badge bg-light text-dark border">Extra Prepayment this cycle (loan month ${currentLoanMonth}): ` +
      `${Calc.formatCurrency(prepayActual, 'INR')} / target ${Calc.formatCurrency(prepayTarget, 'INR')}</span>`;

    UI.chart(document.getElementById('chart-hl-breakdown'), {
      type: 'bar',
      data: {
        labels: schedule.map(r => r.month),
        datasets: [
          { label: 'Interest', data: schedule.map(r => r.interest), backgroundColor: '#e91e63' },
          { label: 'EMI + Extra', data: schedule.map(r => r.emi + r.extra), backgroundColor: '#3f51b5' }
        ]
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { title: { display: true, text: 'Monthly principal reduction vs interest' } } }
    });

    const table = UI.dataTable({
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'opening', label: 'Opening', render: r => Calc.formatCurrency(r.opening, 'INR') },
        { key: 'interest', label: 'Interest', render: r => Calc.formatCurrency(r.interest, 'INR') },
        { key: 'emi', label: 'EMI', render: r => Calc.formatCurrency(r.emi, 'INR') },
        { key: 'extra', label: 'Extra Prepayment', render: r => `<input type="number" class="form-control form-control-sm hl-extra-input" data-month="${r.month}" value="${r.extra || ''}">` },
        { key: 'closing', label: 'Closing', render: r => Calc.formatCurrency(r.closing, 'INR') }
      ],
      rows: schedule
    });
    const container = document.getElementById('hl-table-container');
    container.innerHTML = '';
    container.appendChild(table);
    container.querySelectorAll('.hl-extra-input').forEach(input => {
      input.addEventListener('change', () => {
        const month = parseInt(input.dataset.month, 10);
        const value = parseFloat(input.value) || 0;
        Store.mutate(d => {
          const existing = d.homeLoanExtras.find(e => e.monthIndex === month);
          if (existing) existing.extraPrepaymentINR = value;
          else d.homeLoanExtras.push({ monthIndex: month, extraPrepaymentINR: value });
        });
      });
    });
  };

  Store.subscribe(() => { if (!document.getElementById('tab-home-loan').classList.contains('d-none')) Tabs.homeLoan.render(); });
</script>
```

- [ ] **Step 4: Manually verify in Chrome**

Open Home Loan tab, confirm the schedule renders with a computed payoff month, not a
hardcoded one. Confirm the badge above the chart shows the current cycle's loan month, extra
prepayment actual, and target (set in Task 12) side by side. Edit an "Extra Prepayment" cell
for the current loan month to a value at or above the target, confirm the badge's actual
figure updates to match once you tab away. Edit the same cell to a much larger value to
verify the table re-renders with a shorter schedule and updated payoff month, and that no row
shows a negative closing balance.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Home Loan tab with live-recalculating amortization schedule and prepayment target"
```

---

## Task 14: SIP tab — yearly projection, allocation editor, corpus chart

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.settings.sip`, `Calc.buildSipProjection`, `Calc.buildAmortizationSchedule`,
  `Calc.getPayoffMonth`, `UI.dataTable`, `UI.chart`.
- Produces: `Tabs.sip.render()`.

- [ ] **Step 1: Replace the `tab-sip` section markup**

```html
<section id="tab-sip" class="tab-pane d-none">
  <div class="row g-3 mb-3">
    <div class="col-md-6">
      <div class="card p-3">
        <h6>Allocation (%)</h6>
        <div id="sip-allocation-inputs"></div>
        <div id="sip-allocation-total" class="small mt-2"></div>
      </div>
    </div>
    <div class="col-md-6"><div class="card p-3"><canvas id="chart-sip-allocation"></canvas></div></div>
  </div>
  <div class="card p-3 mb-3"><canvas id="chart-sip-growth"></canvas></div>
  <div id="sip-table-container"></div>
</section>
```

- [ ] **Step 2: Add `Tabs.sip` render logic**

```html
<script>
  Tabs.sip = {};

  Tabs.sip.render = function() {
    if (!Store.ready) return;
    const d = Store.data;
    const allocation = d.settings.sip.allocation;
    const allocContainer = document.getElementById('sip-allocation-inputs');
    allocContainer.innerHTML = Object.entries(allocation).map(([key, val]) => `
      <div class="d-flex align-items-center gap-2 mb-1">
        <label class="small flex-grow-1">${key}</label>
        <input type="number" class="form-control form-control-sm sip-alloc-input" data-key="${key}" value="${val}" style="width:80px">
      </div>`).join('');
    const total = Object.values(allocation).reduce((a, b) => a + b, 0);
    const totalEl = document.getElementById('sip-allocation-total');
    totalEl.textContent = `Total: ${total}%`;
    totalEl.className = 'small mt-2 ' + (total === 100 ? 'text-success' : 'text-danger fw-bold');

    UI.chart(document.getElementById('chart-sip-allocation'), {
      type: 'pie',
      data: { labels: Object.keys(allocation), datasets: [{ data: Object.values(allocation) }] }
    });

    const extras = Object.fromEntries((d.homeLoanExtras || []).map(e => [e.monthIndex, e.extraPrepaymentINR]));
    const schedule = Calc.buildAmortizationSchedule({
      principal: d.settings.homeLoan.principalINR, annualRatePct: d.settings.homeLoan.annualRatePct,
      emi: d.settings.homeLoan.emiINR, tenureMonths: d.settings.homeLoan.tenureMonths, extras
    });
    const payoffMonth = Calc.getPayoffMonth(schedule);
    const sip = Calc.buildSipProjection({
      startingMonthlyINR: d.settings.sip.startingMonthlyINR, annualStepUpPct: d.settings.sip.annualStepUpPct,
      estimatedReturnPct: d.settings.sip.estimatedReturnPct, startYear: 2027, endYear: 2036,
      payoffMonth, postLoanMonthlyRedirectINR: d.settings.homeLoan.emiINR
    });

    UI.chart(document.getElementById('chart-sip-growth'), {
      type: 'line',
      data: { labels: sip.map(r => r.year), datasets: [{ label: 'Closing corpus (INR)', data: sip.map(r => r.closing), borderColor: '#3f51b5', fill: true, backgroundColor: 'rgba(63,81,181,0.15)' }] },
      options: { plugins: { title: { display: true, text: `SIP corpus projection (payoff-linked redirect: month ${payoffMonth || 'n/a'})` } } }
    });

    const table = UI.dataTable({
      columns: [
        { key: 'year', label: 'Year' },
        { key: 'monthlySip', label: 'Monthly SIP', render: r => Calc.formatCurrency(r.monthlySip, 'INR') },
        { key: 'postLoanRedirect', label: 'Post-Loan Redirect (monthly)', render: r => Calc.formatCurrency(r.postLoanRedirect, 'INR') },
        { key: 'totalAnnual', label: 'Total Annual', render: r => Calc.formatCurrency(r.totalAnnual, 'INR') },
        { key: 'growth', label: 'Growth', render: r => Calc.formatCurrency(r.growth, 'INR') },
        { key: 'closing', label: 'Closing Corpus', render: r => Calc.formatCurrency(r.closing, 'INR') }
      ],
      rows: sip
    });
    const container = document.getElementById('sip-table-container');
    container.innerHTML = '';
    container.appendChild(table);

    allocContainer.querySelectorAll('.sip-alloc-input').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.key;
        const value = parseFloat(input.value) || 0;
        Store.mutate(d => { d.settings.sip.allocation[key] = value; });
      });
    });
  };

  Store.subscribe(() => { if (!document.getElementById('tab-sip').classList.contains('d-none')) Tabs.sip.render(); });
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Open SIP tab, confirm allocation total shows green at 100% (or red if the seeded data doesn't
sum to 100 — adjust one input until it does, confirming the color/validation reacts live).
Confirm the growth chart's title references the same payoff month shown on the Home Loan tab.
Go back to Home Loan, add a large extra prepayment, return to SIP tab, confirm the projection
and payoff-month reference update to reflect the earlier payoff.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add SIP tab with allocation editor and payoff-linked corpus projection"
```

---

## Task 15: Reports tab — cross-cycle comparisons + CSV/XLSX export

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.transactions`, `Calc.aggregateByCycle`, `UI.chart`, global `XLSX`
  (SheetJS, already loaded via CDN in Task 1).
- Produces: `Tabs.reports.render()`, `Tabs.reports.exportCsv()`, `Tabs.reports.exportXlsx()`.

- [ ] **Step 1: Replace the `tab-reports` section markup**

```html
<section id="tab-reports" class="tab-pane d-none">
  <div class="d-flex gap-2 mb-3">
    <button id="btn-export-csv" class="btn btn-outline-secondary btn-sm">Export CSV</button>
    <button id="btn-export-xlsx" class="btn btn-outline-secondary btn-sm">Export XLSX</button>
  </div>
  <div class="row g-3">
    <div class="col-md-6"><div class="card p-3"><canvas id="chart-report-monthwise"></canvas></div></div>
    <div class="col-md-6"><div class="card p-3"><canvas id="chart-report-categorywise"></canvas></div></div>
  </div>
</section>
```

- [ ] **Step 2: Add `Tabs.reports` render + export logic**

```html
<script>
  Tabs.reports = {};

  Tabs.reports.render = function() {
    if (!Store.ready) return;
    const d = Store.data;
    const agg = Calc.aggregateByCycle(d.transactions);
    const cycles = Object.keys(agg).sort();
    UI.chart(document.getElementById('chart-report-monthwise'), {
      type: 'bar',
      data: { labels: cycles, datasets: [{ label: 'Total spend (INR)', data: cycles.map(c => agg[c].totalINR), backgroundColor: '#3f51b5' }] },
      options: { plugins: { title: { display: true, text: 'Month-wise (cycle) spend' } } }
    });

    const catById = Object.fromEntries(d.categories.map(c => [c.id, c]));
    const totals = {};
    d.transactions.forEach(t => { totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amountINR; });
    const catIds = Object.keys(totals);
    UI.chart(document.getElementById('chart-report-categorywise'), {
      type: 'doughnut',
      data: { labels: catIds.map(id => catById[id]?.name || 'Other'), datasets: [{ data: catIds.map(id => totals[id]), backgroundColor: catIds.map(id => catById[id]?.color || '#9e9e9e') }] },
      options: { plugins: { title: { display: true, text: 'All-time category-wise spend' } } }
    });
  };

  Tabs.reports.exportCsv = function() {
    const d = Store.data;
    const catById = Object.fromEntries(d.categories.map(c => [c.id, c]));
    const rows = d.transactions.map(t => ({
      Date: t.date, Category: catById[t.categoryId]?.name || 'Other', Description: t.description,
      'Amount INR': t.amountINR, 'Amount JPY': t.amountJPY, 'Payment Method': t.paymentMethod,
      'Need/Want': t.needWant, Notes: t.notes
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transactions-export.csv';
    a.click();
  };

  Tabs.reports.exportXlsx = function() {
    const d = Store.data;
    const catById = Object.fromEntries(d.categories.map(c => [c.id, c]));
    const rows = d.transactions.map(t => ({
      Date: t.date, Category: catById[t.categoryId]?.name || 'Other', Description: t.description,
      'Amount INR': t.amountINR, 'Amount JPY': t.amountJPY, 'Payment Method': t.paymentMethod,
      'Need/Want': t.needWant, Notes: t.notes
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Transactions');
    XLSX.writeFile(wb, 'transactions-export.xlsx');
  };

  document.getElementById('btn-export-csv').addEventListener('click', Tabs.reports.exportCsv);
  document.getElementById('btn-export-xlsx').addEventListener('click', Tabs.reports.exportXlsx);
  Store.subscribe(() => { if (!document.getElementById('tab-reports').classList.contains('d-none')) Tabs.reports.render(); });
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Open Reports tab, confirm both charts render across all cycles/categories present in the
data. Click "Export CSV", confirm a `transactions-export.csv` downloads and opens correctly
in a spreadsheet app with all seeded rows. Click "Export XLSX", confirm the same for
`transactions-export.xlsx`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Reports tab with cross-cycle charts and CSV/XLSX export"
```

---

## Task 16: Settings tab — assumptions form, cycle-start-day, backup/restore

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Store.data.settings`, `Store.mutate`, `FileStorage.connectOrCreate`.
- Produces: `Tabs.settings.render()`, JSON backup export/import.

- [ ] **Step 1: Replace the `tab-settings` section markup**

```html
<section id="tab-settings" class="tab-pane d-none">
  <form id="settings-form" class="row g-3">
    <div class="col-md-4"><label class="form-label small">Salary (JPY)</label><input type="number" id="s-salary" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">JPY per INR (FX rate)</label><input type="number" id="s-fx" class="form-control" step="0.01"></div>
    <div class="col-md-4"><label class="form-label small">Cycle Start Day</label><input type="number" id="s-cycle-day" class="form-control" min="1" max="28"></div>
    <div class="col-md-4"><label class="form-label small">Emergency Fund Target (JPY)</label><input type="number" id="s-ef-target" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">Home Loan Principal (INR)</label><input type="number" id="s-hl-principal" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">Home Loan Annual Rate (%)</label><input type="number" id="s-hl-rate" class="form-control" step="0.01"></div>
    <div class="col-md-4"><label class="form-label small">Home Loan EMI (INR)</label><input type="number" id="s-hl-emi" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">Loan Tenure (months)</label><input type="number" id="s-hl-tenure" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">Starting SIP (INR/month)</label><input type="number" id="s-sip-start" class="form-control"></div>
    <div class="col-md-4"><label class="form-label small">SIP Annual Step-up (%)</label><input type="number" id="s-sip-stepup" class="form-control" step="0.1"></div>
    <div class="col-md-4"><label class="form-label small">SIP Estimated Return (%)</label><input type="number" id="s-sip-return" class="form-control" step="0.1"></div>
    <div class="col-12"><button type="submit" class="btn btn-primary btn-sm">Save Settings</button></div>
  </form>
  <hr>
  <h6>Data File</h6>
  <button id="btn-settings-reconnect" class="btn btn-outline-secondary btn-sm">Reconnect / Switch Data File</button>
  <hr>
  <h6>Backup</h6>
  <button id="btn-backup-export" class="btn btn-outline-secondary btn-sm">Export JSON Backup</button>
  <label class="btn btn-outline-secondary btn-sm">Import JSON Backup<input type="file" id="btn-backup-import" accept="application/json" class="d-none"></label>
  <div id="last-backup-indicator" class="small text-muted mt-2"></div>
</section>
```

- [ ] **Step 2: Add `Tabs.settings` render + save + backup logic**

```html
<script>
  Tabs.settings = {};

  Tabs.settings.render = function() {
    if (!Store.ready) return;
    const s = Store.data.settings;
    document.getElementById('s-salary').value = s.salaryJPY;
    document.getElementById('s-fx').value = s.jpyPerInr;
    document.getElementById('s-cycle-day').value = s.cycleStartDay;
    document.getElementById('s-ef-target').value = s.emergencyFundTargetJPY;
    document.getElementById('s-hl-principal').value = s.homeLoan.principalINR;
    document.getElementById('s-hl-rate').value = s.homeLoan.annualRatePct;
    document.getElementById('s-hl-emi').value = s.homeLoan.emiINR;
    document.getElementById('s-hl-tenure').value = s.homeLoan.tenureMonths;
    document.getElementById('s-sip-start').value = s.sip.startingMonthlyINR;
    document.getElementById('s-sip-stepup').value = s.sip.annualStepUpPct;
    document.getElementById('s-sip-return').value = s.sip.estimatedReturnPct;
    const lastBackup = localStorage.getItem('finance-app-last-backup');
    document.getElementById('last-backup-indicator').textContent = lastBackup
      ? `Last manual backup: ${lastBackup}` : 'No manual backup taken yet — consider exporting one.';
  };

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    Store.mutate(d => {
      d.settings.salaryJPY = parseFloat(document.getElementById('s-salary').value) || 0;
      d.settings.jpyPerInr = parseFloat(document.getElementById('s-fx').value) || 1;
      d.settings.cycleStartDay = parseInt(document.getElementById('s-cycle-day').value, 10) || 25;
      d.settings.emergencyFundTargetJPY = parseFloat(document.getElementById('s-ef-target').value) || 0;
      d.settings.homeLoan.principalINR = parseFloat(document.getElementById('s-hl-principal').value) || 0;
      d.settings.homeLoan.annualRatePct = parseFloat(document.getElementById('s-hl-rate').value) || 0;
      d.settings.homeLoan.emiINR = parseFloat(document.getElementById('s-hl-emi').value) || 0;
      d.settings.homeLoan.tenureMonths = parseInt(document.getElementById('s-hl-tenure').value, 10) || 0;
      d.settings.sip.startingMonthlyINR = parseFloat(document.getElementById('s-sip-start').value) || 0;
      d.settings.sip.annualStepUpPct = parseFloat(document.getElementById('s-sip-stepup').value) || 0;
      d.settings.sip.estimatedReturnPct = parseFloat(document.getElementById('s-sip-return').value) || 0;
    });
  });

  document.getElementById('btn-settings-reconnect').addEventListener('click', async () => {
    await FileStorage.connectOrCreate();
    await Store.initFromFile();
  });

  document.getElementById('btn-backup-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Store.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    localStorage.setItem('finance-app-last-backup', new Date().toLocaleString());
    Tabs.settings.render();
  });

  document.getElementById('btn-backup-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    await Store.mutate(d => Object.assign(d, imported));
  });

  Store.subscribe(() => { if (!document.getElementById('tab-settings').classList.contains('d-none')) Tabs.settings.render(); });
</script>
```

- [ ] **Step 3: Manually verify in Chrome**

Open Settings, confirm all fields pre-fill from the seeded data. Change the FX rate, save,
confirm a new transaction created afterward uses the new rate (per Task 9's regression test,
old transactions stay unchanged). Click "Export JSON Backup", confirm a timestamped file
downloads and the "Last manual backup" indicator updates. Click "Import JSON Backup" and pick
that same file, confirm the app reloads the same data without error.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Settings tab with assumptions form and JSON backup/restore"
```

---

## Task 17: Final integration — inline the calc engine, end-to-end verification

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: the final contents of `js/calc.js` (all functions from Tasks 2–5).
- Produces: a fully self-contained `index.html` with no external file dependencies besides
  CDN libraries.

- [ ] **Step 1: Rerun the full calc engine test suite**

Run: `node js/calc.test.js`
Expected: the final `console.log('... ALL PASS')` line prints with no assertion errors.

- [ ] **Step 2: Replace the `#calc-engine` placeholder script block**

Open `js/calc.js`, copy its entire contents, and replace the placeholder inside
`index.html`'s `<script id="calc-engine">...</script>` block (added in Task 1) with that
exact code — including the `if (typeof window !== 'undefined') { window.Calc = Calc; }` line,
but the `module.exports` guard is harmless to keep since `module` is undefined in the browser
and that branch is simply skipped.

- [ ] **Step 3: Confirm no other file references remain**

Run: `grep -n 'src="js/\|src="\./\|href="\./' index.html`
Expected: no matches other than the CDN `https://` URLs already present — i.e. no reference
to `js/calc.js` or any other local file.

- [ ] **Step 4: Full end-to-end manual verification**

Serve the folder (`npx http-server -p 8080` or `python3 -m http.server 8080`) and open
`http://localhost:8080/index.html` fresh (clear IndexedDB/localStorage for this origin first
via DevTools → Application → Clear site data, to simulate a first-time user):

1. Create a new data file, confirm the seeded 57+ transactions and all assumptions load.
2. Add, edit, delete a transaction in Transactions; confirm Dashboard, Reports, and Emergency
   Fund all reflect the change after switching tabs.
3. Confirm a transaction dated the 24th and one dated the 25th of the same month land in
   different cycles everywhere (Dashboard cycle label, Reports month-wise chart, Transactions
   filter by cycle).
4. Edit a Home Loan extra prepayment large enough to zero the balance early; confirm the SIP
   tab's payoff-linked redirect year shifts earlier accordingly.
5. Try deleting an in-use category; confirm it's blocked with a clear message.
6. Change the FX rate in Settings; confirm past transactions' amounts are unchanged and only
   new ones use the new rate.
7. Export CSV and XLSX from Reports; open both to confirm valid, complete data.
8. Export a JSON backup, then reload the page and use "Reconnect" instead of Import; confirm
   the live data file's data (not the backup) is what loads, proving the primary
   File-System-Access flow is independent of and doesn't get confused with manual backups.
9. Reload the page one more time without touching anything; confirm "Reconnect to
   finance-data.json" appears and restores the exact same state with zero data loss.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: inline the tested calc engine into index.html for a fully self-contained app"
```
