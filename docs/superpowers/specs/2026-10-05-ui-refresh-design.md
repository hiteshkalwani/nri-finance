# UI refresh — design

Date: 2026-10-05. Status: approved in conversation ("go ahead" after reviewing the mockup), pending spec review.
Design reference: `docs/diagrams/nri-ui-mockup.html` (views Dashboard, Spend, Phone — and Settings for categories).
Scope: restyle every M1 screen to the mockup and add category icons. M2–M5 screens in the mockup are design targets for
their own milestones, not part of this work.

## 1. Goal

What the user said / chose:
- "make ui better like this, so its visually apealing" (Monarch-style reference screenshots).
- Reviewed the full mockup, then "go ahead". Taken as: the look as designed, **category icons**, and a **date-grouped
  ledger**.
- The Accounts view is the M2 target (recorded; not built here).

Success criteria:
1. Dashboard, Spend, quick-add, edit, Settings, sign-in and Not found match the mockup's look at 1280 px and on a phone
   (390–412 px): warm canvas, white rounded cards, outline-icon sidebar with active pill, orange accent, Inter font.
2. Nothing the M1 spec requires is lost (every M1 behaviour, filter, URL state, keyboard path and label stays).
3. All existing unit, integration and e2e tests pass; existing test hooks (`data-testid`s, ids, aria-labels) stay.
4. Light and dark themes both readable; a theme toggle (System / Light / Dark, default System) is remembered per device.

## 2. Visual system

| Token | Light | Dark |
|---|---|---|
| background (canvas) | `#f6f4f1` | `#141413` |
| surface (cards) | `#ffffff` | `#1d1c1a` |
| border | `#ebe7e1` | `#2e2c29` |
| subtle fill (day headers, active pill) | `#f2efea` / `#efece7` | `#262421` / `#2a2825` |
| text / muted | `#1d1d1f` / `#6e6a64` | `#efece6` / `#a8a29a` |
| primary (accent) | `#f0682e` | `#f58450` |
| link | `#1683b8` | `#5fb6e0` |
| success / error | `#2f9a58` / `#d64545` | `#5cc787` / `#f07070` |

- Implemented as a custom Vuetify 4 theme (`light` + `dark`, default follows `prefers-color-scheme`), plus a small global
  stylesheet `apps/web/src/styles/app.css` for the few things the theme can't express (card border/radius, tabular
  numerals, day-header rows, eyebrow labels).
- Font: **Inter**, self-hosted via `@fontsource-variable/inter` (the production CSP only allows `font-src 'self' data:`, so
  no Google Fonts).
- Component defaults (Vuetify `defaults`): `VCard` flat with 1 px border and 14 px radius; `VBtn` no uppercase, 10 px radius,
  `flat`; text fields `variant="outlined"`, `density="comfortable"`.
- Numbers use tabular figures; money keeps the existing formatters (`yen`, `rupees`).

## 3. Shell

- Wide (≥ 600 px): left sidebar (232 px) with the brand mark "¥₹ NRI Finance", outline icons
  (`mdi-home-outline`, `mdi-credit-card-outline`, `mdi-cog-outline`), active item as a filled pill; Sign out at the bottom.
  Only screens that exist are listed (no placeholders for M2–M5).
- Page header row inside the content: page title on the left, page actions on the right (cycle picker, primary
  "Add expense" button).
- Phone (< 600 px): bottom navigation Dashboard · Spend · raised orange **+** (Add expense, keeps aria-label) · More; no
  sidebar.
- Session dialog, Not found and sign-in restyled with the same cards/buttons.
- **Theme toggle** (added 2026-10-05 at the user's request): preference System / Light / Dark, default System (follows
  `prefers-color-scheme`, live), stored per device in `localStorage` (`nri.theme`; falls back to System if storage is
  unavailable). Quick toggle at the bottom of the sidebar (phones: compact top bar) that cycles the three values with an
  accessible label ("Theme: Dark"); an Appearance segmented control in Settings.

## 4. Screens

### 4.1 Dashboard (`/`)
- Header: title, cycle picker (‹ label ›, existing prev/next behaviour), "Add expense".
- Four KPI cards: Income; Spent (+ "x% of income" and a thin orange bar); Sent home (₹ received is not in the M1 API —
  show fees beneath, as today); Kept (savings rate in green or red + thin bar). Existing `data-testid`s on the values.
- **Spending by category** card: eyebrow + cycle date range; donut with the cycle total in the centre; legend in 3
  columns (2 on tablets, 1 on phones) with dot, name, amount and percentage (one decimal); hovering/focusing a legend item
  or slice highlights it; each legend item is a link to the ledger filtered by that category (the existing
  click-through). More than 9 categories → first 8 plus "Everything else" with "Show all categories" to expand.
- **Recent expenses** card: the latest 5 expenses of the cycle, grouped by date with daily totals; "View all" → ledger.
- **Summary** card: expenses this cycle, largest expense, average expense, needs / wants split (percent).
- **Spend per cycle** card: the 12 bars, current cycle in orange, others light orange; bars and their text list open the
  ledger for that cycle (existing behaviour).
- No "Change vs last cycle" toggle and no export link (not in M1).

### 4.2 Spend (`/spend`)
- Header: title, cycle picker, "Add expense".
- Card with a filter row: category, payment method, need/want (selects styled as outlined pills), search box, sort select
  ("Newest", "Oldest", "Amount high→low", "Amount low→high", "Category A→Z", "Description A→Z" — mapped onto the existing
  `sort`/`dir`); a totals line: count, total, needs total, wants total.
- Rows: description, category (icon or dot + name), payment chip, need/want chip ("Want" tinted), amount (¥; ₹ beneath),
  chevron. Each row is a link/button to the edit page (keyboard reachable, as today).
- **Grouping**: when sorted by date, rows are grouped under date headers with the day's total; any other sort shows a
  flat list. Paging stays server-side (50 per page) with a pager at the bottom; a date group can continue across pages.
- Filters, sort and page remain in the URL; search keeps its debounce and × clear.

### 4.3 Quick-add (`/spend/new`)
- Amount card: large amount input, ¥/₹ segmented toggle, the ₹→¥ preview and "Today · <weekday> <d> <Mon>" hint.
- Category tiles in a grid (3 per row on phones, 6 on wide), each with the icon (or initial) in a tinted circle and the
  name; the selected tile has an orange outline (+ `aria-checked`).
- "Paid with" and "Need/Want" chip rows, labelled "last used for <category>" when pre-filled.
- Optional description, then a full-width orange **Save**; toast "✓ Saved ¥… · Category" with "Add another" and "View in
  ledger".
- Existing ids/labels kept (`#amount`, chip groups with `aria-label="Category"` etc., `#description`, `data-testid="saved"`).

### 4.4 Edit (`/spend/:id`)
Same form styling as quick-add (amount card, category select with icons, account select, notes), Save / Cancel / Delete;
delete → ledger with "Deleted · Undo" snackbar (unchanged behaviour).

### 4.5 Settings (`/settings`)
- Profile card (two-column form on wide screens).
- Categories card: rows with the icon tile, name, colour dot, ↑ ↓, Rename (inline, with Save/Cancel), colour menu,
  **icon menu** (grid of 24 emoji + "No icon"), Archive/Unarchive, Delete when unused.
- Import card as a drop zone ("Drop finance-data.json here, or choose a file"), keeping the file input (`#import-file`).
- Account card: signed-in email and Sign out.

## 5. Category icons (data)

- Migration `0004_category_icon.sql`: `categories.icon text null`, check `icon is null or char_length(icon) between 1 and 8`.
- Contracts: `Category.icon: string | null`; `CategoryCreate` and `CategoryPatch` accept optional `icon` (nullable; 1–8
  characters, must contain at least one pictographic character — `/\p{Extended_Pictographic}/u`).
- API: categories list/get return `icon`; create/patch store it; `null` clears it.
- v1 import: no icons (v1 has none) → `null`.
- Display rule everywhere: icon if set, otherwise the first letter of the name on the category colour (tinted circle).

## 6. API additions for the new cards

- `GET /api/dashboard`: add `expenseCount`, `largestJpy`, `needJpy`, `wantJpy` for the cycle (computed in
  `packages/core`'s `summarizeCycle` from the same rows; `SpendRow` gains `needWant`).
- `GET /api/transactions`: add `needJpy` and `wantJpy` to the page totals (over all matching rows, like `totalJpy`).
- Both covered by integration tests; existing fields unchanged.

## 7. Accessibility

Unchanged rules (TRD §7): labels on every control, visible focus ring in the accent colour, colour never the only signal
(over/negative amounts also carry a sign or word; selected tiles/chips carry a check or `aria-checked`), charts keep their
keyboard-reachable text lists, contrast ≥ 4.5:1 for text in both themes.

## 8. Testing

- Unit: `groupByDate` (ledger grouping, day totals, page boundaries), legend percentages (one decimal; "Everything
  else" bucket), summary stats in core, category icon validation in contracts.
- Integration: icon create/patch/clear and validation; dashboard and list totals.
- E2E: the existing 4 tests pass unchanged (hooks preserved); add one assertion that the Spend list shows a date header
  when sorted by date.
- Visual: screenshots at 1280 px and 390 px of Dashboard, Spend, quick-add and Settings in light and dark, checked
  against the mockup before merge.

## 9. Out of scope

M2–M5 screens (Remittances, balances, Accounts, loan, SIP, budgets, review, reports), "change vs last cycle", exports,
drag-to-reorder, custom icon upload.
