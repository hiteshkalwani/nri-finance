# M2a Accounts, balances and emergency fund — design

Date: 2026-10-06. Status: design approved in conversation (parts 1 and 2: "yes", "yes"), pending spec review.
Sources: PRD §6.4 (DASH-5, DASH-6), §6.6 (ACC-1, BAL-1, BAL-2, EF-1); checklist §6 and the small-fixes queue; mockup
`docs/diagrams/nri-ui-mockup.html` views Accounts and Update balances.
Scope: first half of M2. Remittances (REM-1..5, DASH-4), the per-cycle income override and the rate-decimals item are
M2b, with their own spec.

## 1. Goal

What the user said / chose:
- Split M2 into M2a (accounts + balances + emergency fund + net worth) and M2b (remittances), M2a first.
- Card accounts: enter the **amount owed**; net worth subtracts it.
- Emergency-fund goal: **one ¥ goal in the profile** (v1's value imported); per-cycle targets stay for M4.
- Skipped account on review day: **carry its last balance forward**, marked as stale.
- The mockup's Accounts view is the target screen (recorded earlier).

Success criteria:
1. On review day the user updates every account's balance on one screen (prefilled from last cycle) and saves it in one
   go.
2. Accounts shows net worth (Japan + India at the planning rate) with change since last cycle and a 6 / 12 / All chart,
   accounts grouped by type, assets vs liabilities, and the emergency fund with months covered.
3. The Dashboard shows net worth and the emergency fund.
4. Accounts can be added, edited, archived and unarchived; archived accounts keep their history.
5. Editing an expense whose account was later archived saves again (M1 deferred bug).
6. Re-importing v1 into an existing profile says the settings were kept instead of silently skipping them.

## 2. Data

Migration `0005_accounts_balances.sql`:
- `profiles.emergency_fund_goal_jpy integer null`, check `>= 0`.
- `balance_snapshots`: check `balance_jpy >= 0` and `balance_inr >= 0` (both columns; one is null per the existing
  check). Card balances are stored as the amount owed.
- No other table changes: `accounts` (country/currency check, archive timestamp, emergency-fund flag) and
  `balance_snapshots` (one row per account per cycle, owner FK) already fit.

Rules (pure functions in `packages/core`, unit-tested):
- **Balance for a cycle:** an account's snapshot for that cycle, else its latest snapshot from an earlier cycle (carried,
  with the cycle it came from), else none. Snapshots of archived accounts still count for cycles up to their last
  snapshot; an archived account carries forward only up to the cycle in which it was archived.
- **Sign:** `card` accounts subtract; every other type adds.
- **Totals per cycle:** Japan ¥ total, India ₹ total, combined ¥ = Japan + India × current planning rate (rounded to the
  yen), change since the previous cycle (amount and percent; percent null when the previous total is 0 or absent).
- **Emergency fund:** sum of balances (carried forward) of accounts flagged `isEmergencyFund` as of the selected cycle,
  in ¥ (₹ converted at the planning rate). Cards are never counted even if flagged.
- **Months covered:** emergency fund ÷ average spend of the 3 cycles immediately before the selected cycle, counting
  only cycles on or after the cycle of the user's first expense (so a new user's average uses 1 or 2 cycles). No such
  cycle, or an average of 0 → null (shown as "—"). Rounded to one decimal for display.

## 3. Contracts and API

All routes are owner-scoped (RLS + `userId` filters, same as M1); validation errors use the existing 400 shape.

**Accounts**
- `GET /api/accounts` — active accounts (unchanged for the expense form); `?include=archived` adds archived ones with
  `archivedAt`.
- `POST /api/accounts` — `{ name (1–60, trimmed), country: 'JP'|'IN', type, isEmergencyFund? }`; currency is derived
  from country (JP → JPY, IN → INR) and is not accepted from the client.
- `PATCH /api/accounts/:id` — any of `name`, `type`, `isEmergencyFund`, `archived: boolean`. Country/currency cannot
  change once the account has snapshots (409 with a clear message); otherwise `country` may change.
- Duplicate active names per user are refused (409).

**Balances**
- `GET /api/balances?cycle=YYYY-MM` (default current cycle) → `{ cycle, start, end, rows: [{ accountId, name, country,
  currency, type, isEmergencyFund, amount (in the account's currency: yen or paise), source: 'this'|'carried'|'none',
  fromCycle }] }` for active accounts, ordered Japan then India, then by type and name.
- `PUT /api/balances` — `{ cycle, entries: [{ accountId, amount }] }`; one database transaction; upserts the snapshot
  for each entry (`recorded_on` = today in the profile timezone); every `accountId` must be an active account of the
  user (400 naming the bad entry); amounts are integers ≥ 0 within the column range. Accounts left out are untouched.

**Net worth**
- `GET /api/networth?cycle=YYYY-MM&span=6|12|all` → `{ rate, cycle, current: { japanJpy, indiaPaise, combinedJpy,
  changeJpy, changePct }, series: [{ cycle, label, combinedJpy }], assets: { japanJpy, indiaPaise }, liabilities: {
  japanJpy, indiaPaise }, emergencyFund: { balanceJpy, goalJpy|null, monthsCovered|null, avgSpendJpy|null } }`.
  Series covers the span ending at `cycle`, starting no earlier than the first cycle with a snapshot.

**Profile and import**
- Profile GET/PUT gain `emergencyFundGoalJpy: number | null`.
- v1 import: when it creates the profile, `settings.emergencyFundTargetJPY` → `emergency_fund_goal_jpy`. When a profile
  already exists, the result includes `profileKept: true` and Settings shows "Profile kept: settings from the file were
  not imported."

**M1 fix**
- `updateTransaction` checks the account only when `accountId` is present **and differs** from the stored one (same
  rule the category check already uses). The edit page's account select also lists the expense's current account when
  it is archived (labelled "archived") so the field doesn't show blank.

## 4. Screens

Navigation: sidebar order Dashboard · Spend · **Accounts** · Settings. Phones: bottom nav keeps Dashboard · Spend · + ·
More; More opens a menu with Accounts and Settings.

### 4.1 Accounts (`/accounts`) — mockup Accounts view
- Header: title; **In ¥ / In ₹** segmented control (re-expresses totals and secondary amounts at the planning rate;
  remembered per device); **Update balances**; primary **Add account** (hidden on phones; phones get an "Add account"
  button at the end of the list).
- Net worth card: eyebrow "Net worth · Japan + India at ¥<rate> per ₹1"; total; change since last cycle with ↑/↓ and
  percent (colour plus arrow); area chart with 6 cycles / 12 cycles / All (theme-aware, default 12); a compact
  keyboard-reachable list of the series values.
- Account groups (cards): Bank, Cash, FD, Investment, Cards. Row: name, "JP"/"IN" tag, latest balance in its currency
  with the other-currency value beneath, change since last cycle, "updated <Mon YYYY>" when carried, "Emergency fund"
  badge, ⋮ menu (Edit, Archive). Card rows read "owed".
- "Archived (n)" collapsed section with Unarchive.
- Summary card: Assets (Japan, India) and Liabilities (cards) with **Totals / Percent**; Emergency fund: balance "of
  <goal> goal", progress bar, "Covers <n.n> months of spending (3-cycle average ¥…)", pencil to edit the goal (or "Set
  a goal").
- Empty states: no accounts → "No accounts yet." + Add account; accounts but no balances → "Update balances to start
  your net worth."

### 4.2 Add / edit account
Dialog on wide screens, full-screen on phones: name, country (JP/IN; currency shown, derived), type, "Counts toward
emergency fund" switch. Field-level errors; country is disabled with a note once the account has balances.

### 4.3 Update balances (`/accounts/balances`) — mockup Update balances view
- Header: "Update balances", "Review day · cycle <Mon YYYY> (<range>)", cycle picker (backfill earlier cycles).
- Rows grouped Japan then India: label "Balance for <name>", amount field in the account's currency, prefilled; hint
  "from <Mon>" while carried and unchanged; card rows say "owed"; ₹ rows show the ¥ value at the planning rate as typed.
- Sticky footer: "Net worth after saving ¥… ↑/↓ ¥… since last cycle" (live), **Copy last cycle** (resets fields to the
  prefilled values), **Save balances** (PUT; back to Accounts with "Balances saved for <Mon YYYY>").
- Leaving with unsaved changes asks to confirm.

### 4.4 Dashboard
- Right column above Summary: **Net worth** card (total, change, "View accounts") and **Emergency fund** card (balance
  of goal, months covered, bar). Phones: after the KPI cards. No balances yet → "Update balances to see this."

### 4.5 Settings
- Profile: "Emergency-fund goal (¥)" (optional).
- Import result shows the profile-kept message.

## 5. Accessibility and look
Same rules as the UI refresh: theme tokens only (light/dark), text ≥ 4.5:1, focus ring ≥ 3:1, colour never the only
signal (↑/↓, "owed", badges with text), charts with text lists, per-row accessible names ("Balance for MUFG savings",
"More actions for MUFG savings"), no ripple on selected segmented controls, phone breakpoint `xs` (< 600 px).

## 6. Testing
- Unit (core): carry-forward, archived carry limit, card subtraction, ₹ conversion and rounding, change and percent,
  emergency fund (flags, cards excluded), months covered (0–3 prior cycles).
- Unit (contracts): account create/patch, balances PUT shape and limits, profile goal.
- Integration (API + DB): account CRUD, duplicate names, country lock after snapshots, ownership (another user's
  account → 404/400), balances GET prefill sources, PUT upsert in one transaction (one bad entry → nothing saved),
  networth numbers on a fixture, import goal + profileKept, the archived-account expense edit.
- E2E (phone 412 px + laptop 1280 px): add an account, update balances, see net worth on Accounts and the Dashboard;
  existing 4 tests unchanged. Unit tests must pass without `.env.local` (CI).
- Screenshots via `pnpm ui:screens` (add `/accounts` and `/accounts/balances`), light and dark, 1280 and 390.

## 7. Out of scope
Remittances and DASH-4 (M2b), per-cycle income override (M2b), rate decimals (M2b), historical exchange rates
(net worth uses today's planning rate), account reordering, multi-currency accounts, bank syncing.
