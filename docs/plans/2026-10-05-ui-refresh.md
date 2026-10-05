# UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every M1 screen to the approved mockup and add per-category icons, without losing any M1 behaviour.

**Architecture:** Data first (icon column + contract/API; summary/ledger totals), then a custom Vuetify 4 theme + self-hosted Inter + a thin global stylesheet, then pure web helpers (date grouping, legend rows, sort options, category avatar), then each screen rebuilt on those pieces. The mockup (`docs/diagrams/nri-ui-mockup.html`) is the visual source of truth for markup and CSS values.

**Tech Stack:** Vue 3.5, Vuetify 4.2, vue-router 5, TanStack Vue Query 5, Chart.js 4 / vue-chartjs 5, `@fontsource-variable/inter`, Hono 4, Drizzle 0.45, zod 4, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-05-ui-refresh-design.md`. Mockup: `docs/diagrams/nri-ui-mockup.html`. M1 spec (behaviour that must not regress): `docs/superpowers/specs/2026-10-05-m1-spending-design.md`.

## Global Constraints

- Every M1 behaviour stays: URL-backed ledger filters/sort/page, debounced search with × clear, per-category quick-add defaults, ₹ entry converted once, Undo via restore, sign-in dialog on 401, safe `?next=`, chart click-through to the ledger, keyboard-reachable rows and chart text lists.
- Existing test hooks stay exactly: `data-testid` = `income`, `spent`, `sent`, `kept`, `cycle-label`, `saved`, `ledger-total`; ids `#email`, `#password`, `#amount`, `#description`, `#search`, `#import-file`, `#new-category`; `aria-label`s "Category", "Payment method", "Need or want", "Add expense", "Previous cycle", "Next cycle"; link names "Dashboard", "Spend". The `ledger-total` text must still contain "N expenses" and the ¥ total.
- Breakpoint: phone layout below 600 px (Vuetify `xs`).
- Theme tokens exactly as spec §2 (light and dark); accent `#f0682e` light / `#f58450` dark.
- Font: Inter from `@fontsource-variable/inter` (CSP allows only `font-src 'self' data:`). No CDN fonts, no external CSS.
- Accessibility (TRD §7): labels on every control, visible focus, colour never the only signal, text contrast ≥ 4.5:1.
- `v-html` and `toISOString` banned. Money as integers; existing `yen`/`rupees` formatters.
- All suites green at every task end: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:scripts`; tasks touching API/DB also `pnpm test:integration`; tasks touching pages also `pnpm test:e2e`.
- Plan-level ruling (ledger at Task 3): page tasks (5–8) specify structure, hooks, behaviour and acceptance, and point at the mockup section for markup/CSS instead of repeating every template line; the mockup is the reference implementation of the look.

## Review Focus

1. Ledger grouping across pages: a day split by the page boundary shows its header on both pages; each header's total is the sum of that day's rows **on this page** and is labelled "on this page", so it is never mistaken for the whole day's total.
2. Theme switching: dark theme follows the system setting at load and when it changes; nothing hard-codes light colours (charts included).
3. Hooks preserved: every hook in Global Constraints still resolves in the e2e suite on phone (412 px) and laptop (1280 px).
4. Icon validation: a string without a pictographic character, longer than 8 characters, or an empty string is refused with 400; `null` clears.
5. Focus visibility on the new tiles/pills/rows in both themes.

---

### Task 1: Category icons — data, contract, API

**Files:**
- Modify: `packages/db/src/schema.ts` (categories), `packages/contracts/src/categories.ts`, `apps/api/src/services/categories.ts`, `apps/api/src/routes/categories.ts`
- Create (generated): `packages/db/migrations/0004_category_icon.sql`
- Test: `packages/contracts/test/m1.test.ts` (append), `apps/api/test/categories.int.test.ts` (append)

**Interfaces:**
- Produces: `categories.icon text null` with check `categories_icon_length`; `CategoryIcon` zod schema; `Category.icon: string | null`; `CategoryCreate.icon?`, `CategoryPatch.icon?` (nullable).

- [ ] **Step 1: Failing tests**

Append to `packages/contracts/test/m1.test.ts`:

```ts
import { CategoryIcon } from '../src'

describe('category icons', () => {
  it('accepts a single emoji or a short emoji sequence, and null', () => {
    for (const ok of ['🛒', '🍜', '🛍️', '🏠', '👨‍👩‍👧']) expect(CategoryIcon.safeParse(ok).success).toBe(true)
    expect(CategoryCreate.safeParse({ name: 'Food', color: '#4caf50', icon: null }).success).toBe(true)
    expect(CategoryPatch.safeParse({ icon: null }).success).toBe(true)
  })
  it('refuses text, empty strings and over-long values', () => {
    for (const bad of ['', 'A', 'food', '🛒🛒🛒🛒🛒🛒🛒🛒🛒']) expect(CategoryIcon.safeParse(bad).success).toBe(false)
  })
})
```

Append to `apps/api/test/categories.int.test.ts` (inside the describe):

```ts
  it('stores, returns and clears a category icon; refuses non-emoji', async () => {
    const c = await (await call(a, 'POST', '/api/categories', { name: 'Iconic', color: '#4caf50', icon: '🛒' })).json()
    expect(c.icon).toBe('🛒')
    const patched = await (await call(a, 'PATCH', `/api/categories/${c.id}`, { icon: '🍜' })).json()
    expect(patched.icon).toBe('🍜')
    expect((await (await call(a, 'PATCH', `/api/categories/${c.id}`, { icon: null })).json()).icon).toBeNull()
    expect((await call(a, 'PATCH', `/api/categories/${c.id}`, { icon: 'abc' })).status).toBe(400)
    const listed = (await (await call(a, 'GET', '/api/categories')).json()).items.find((x: { id: string }) => x.id === c.id)
    expect(listed).toHaveProperty('icon', null)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @nri/contracts test 2>&1 | tail -4; pnpm --filter @nri/api exec vitest run --project int test/categories.int.test.ts 2>&1 | grep -E "×|Tests "`
Expected: contracts fail (`CategoryIcon` undefined); the API test fails (icon ignored / strict schema rejects `icon`).

- [ ] **Step 3: Implement**

`packages/db/src/schema.ts` categories: add `icon: text('icon'),` after `color`, and to its constraint array `check('categories_icon_length', sql\`${t.icon} is null or char_length(${t.icon}) between 1 and 8\`)`.
Run `pnpm --filter @nri/db exec drizzle-kit generate --name category_icon` and check the SQL adds the column and the check (order: column before check). Apply: `pnpm db:migrate`.

`packages/contracts/src/categories.ts`:

```ts
/** An emoji (or short emoji sequence) shown for a category; null = none (show the initial). */
export const CategoryIcon = z
  .string()
  .min(1)
  .max(8)
  .refine((s) => /\p{Extended_Pictographic}/u.test(s), 'Choose an emoji')
  .refine((s) => !/[\p{L}\p{N}]/u.test(s.replace(/\p{Extended_Pictographic}|‍|️/gu, '')), 'Choose an emoji')
```

Add `icon: CategoryIcon.nullable().optional()` to `CategoryCreate` and to the `CategoryPatch` object (before `.partial()`, as `icon: CategoryIcon.nullable()`), and `icon: z.string().nullable()` to `Category`.

`apps/api/src/services/categories.ts` list query: select `c.icon` (between `c.color` and `c.sort_order`). Routes: `POST` passes `icon: input.icon ?? null`; `PATCH` already spreads `rest` (icon included).

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @nri/contracts test && pnpm test:integration 2>&1 | grep -E "Tests " && pnpm typecheck && pnpm lint`
Expected: all pass (api int +1, contracts +2); clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db packages/contracts apps/api
git commit -m "feat: optional emoji icon per category (migration 0004)"
```

---

### Task 2: Totals for the new cards

**Files:**
- Modify: `packages/core/src/summary.ts`, `packages/core/test/summary.test.ts`, `packages/contracts/src/dashboard.ts`, `packages/contracts/src/transactions.ts`, `apps/api/src/routes/dashboard.ts`, `apps/api/src/services/transactions.ts`
- Test: `apps/api/test/dashboard.int.test.ts`, `apps/api/test/transactions.int.test.ts` (append)

**Interfaces:**
- Produces: `SpendRow.needWant: 'need' | 'want'`; `CycleSummary` + `expenseCount`, `largestJpy`, `needJpy`, `wantJpy`; `Dashboard` + same four; `TransactionPage` + `needJpy`, `wantJpy`.

- [ ] **Step 1: Failing tests**

`packages/core/test/summary.test.ts`: change the helper to `const t = (occurredOn: string, amountJpy: number, categoryId = 'food', needWant: 'need' | 'want' = 'need') => ({ occurredOn, amountJpy, categoryId, needWant })` and add:

```ts
it('reports count, largest, and the needs/wants split for the cycle', () => {
  const rows = [t('2026-09-25', 2000, 'food', 'need'), t('2026-10-01', 500, 'fun', 'want'), t('2026-10-24', 85000, 'rent', 'need'), t('2026-10-25', 9999)]
  expect(summarizeCycle({ transactions: rows, remittances: [], salaryJpy: 100000, cycle: '2026-10', startDay: 25 })).toMatchObject({
    expenseCount: 3, largestJpy: 85000, needJpy: 87000, wantJpy: 500,
  })
  expect(summarizeCycle({ transactions: [], remittances: [], salaryJpy: 1, cycle: '2026-10', startDay: 25 })).toMatchObject({
    expenseCount: 0, largestJpy: 0, needJpy: 0, wantJpy: 0,
  })
})
```

Update the existing `toEqual` expectation in "counts the 25th–24th window only" to include `expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0`.

`apps/api/test/dashboard.int.test.ts`: in the first test's `toMatchObject` add `expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0` (the fixture's transactions are all `need`).

`apps/api/test/transactions.int.test.ts`, in "filters by category, payment method, need/want; totals cover all pages", extend: `expect(byCat).toMatchObject({ needJpy: 90000, wantJpy: 500 })`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @nri/core test 2>&1 | tail -4; pnpm --filter @nri/api exec vitest run --project int test/dashboard.int.test.ts test/transactions.int.test.ts 2>&1 | grep -E "×|Tests "`
Expected: the new/extended assertions fail (fields missing).

- [ ] **Step 3: Implement**

`summary.ts`: `SpendRow` gains `needWant: 'need' | 'want'`; `CycleSummary` gains the four fields; in `summarizeCycle` compute from `spent`:

```ts
    expenseCount: spent.length,
    largestJpy: spent.reduce((m, t) => Math.max(m, t.amountJpy), 0),
    needJpy: sum(spent.filter((t) => t.needWant === 'need').map((t) => t.amountJpy)),
    wantJpy: sum(spent.filter((t) => t.needWant === 'want').map((t) => t.amountJpy)),
```

`contracts/dashboard.ts`: add `expenseCount`, `largestJpy`, `needJpy`, `wantJpy` (all `z.number().int()`). `contracts/transactions.ts` `TransactionPage`: add `needJpy`, `wantJpy`.
`routes/dashboard.ts`: add `needWant: transactions.needWant` to the select.
`services/transactions.ts` totals select: add

```ts
    needJpy: sql<number>`coalesce(sum(${transactions.amountJpy}) filter (where ${transactions.needWant} = 'need'), 0)`.mapWith(Number),
    wantJpy: sql<number>`coalesce(sum(${transactions.amountJpy}) filter (where ${transactions.needWant} = 'want'), 0)`.mapWith(Number),
```

and return them.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test:unit 2>&1 | grep -E "Tests " && pnpm test:integration 2>&1 | grep -E "Tests " && pnpm typecheck`
Expected: all pass; clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/contracts apps/api
git commit -m "feat: expense count, largest, needs/wants totals for the dashboard and ledger"
```

---

### Task 3: Theme, font and shell

**Files:**
- Create: `apps/web/src/theme.ts`, `apps/web/src/styles/app.css`
- Modify: `apps/web/package.json` (+ `@fontsource-variable/inter`), `apps/web/src/main.ts`, `apps/web/src/App.vue`, `apps/web/src/pages/LoginPage.vue`, `apps/web/src/pages/NotFoundPage.vue`, `apps/web/src/components/SignInDialog.vue`
- Test: `apps/web/test/theme.test.ts`

**Interfaces:**
- Produces: `nriLight`, `nriDark` Vuetify theme definitions and `vuetifyOptions` (theme + defaults) exported from `theme.ts`; global CSS classes `eyebrow`, `num` (tabular figures), `day-row`, `card-border`.

- [ ] **Step 1: Failing test** — `apps/web/test/theme.test.ts`:

```ts
import { expect, it } from 'vitest'
import { nriDark, nriLight, vuetifyOptions } from '../src/theme'

it('defines the light and dark palettes from the spec', () => {
  expect(nriLight.colors).toMatchObject({ background: '#f6f4f1', surface: '#ffffff', primary: '#f0682e', success: '#2f9a58', error: '#d64545' })
  expect(nriDark.colors).toMatchObject({ background: '#141413', surface: '#1d1c1a', primary: '#f58450' })
  expect(nriDark.dark).toBe(true)
})

it('follows the system theme and sets the component defaults', () => {
  expect(vuetifyOptions.theme.defaultTheme).toBe('system')
  expect(vuetifyOptions.defaults.VBtn).toMatchObject({ rounded: 'lg' })
  expect(vuetifyOptions.defaults.VTextField).toMatchObject({ variant: 'outlined' })
})
```

Run: `pnpm --filter @nri/web test 2>&1 | grep -E "Failed to resolve|Tests "` → Expected: FAIL (cannot resolve `../src/theme`).

- [ ] **Step 2: Implement theme + font**

Run: `pnpm --filter @nri/web add @fontsource-variable/inter`.

`apps/web/src/theme.ts`:

```ts
import type { ThemeDefinition } from 'vuetify'

export const nriLight: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f6f4f1', surface: '#ffffff', 'surface-variant': '#efece7', 'on-surface-variant': '#1d1d1f',
    primary: '#f0682e', secondary: '#1683b8', success: '#2f9a58', error: '#d64545', warning: '#a56a00', info: '#1683b8',
    'on-background': '#1d1d1f', 'on-surface': '#1d1d1f',
  },
  variables: { 'border-color': '#ebe7e1', 'border-opacity': 1, 'medium-emphasis-opacity': 0.72 },
}

export const nriDark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#141413', surface: '#1d1c1a', 'surface-variant': '#2a2825', 'on-surface-variant': '#efece6',
    primary: '#f58450', secondary: '#5fb6e0', success: '#5cc787', error: '#f07070', warning: '#f0c060', info: '#5fb6e0',
    'on-background': '#efece6', 'on-surface': '#efece6',
  },
  variables: { 'border-color': '#2e2c29', 'border-opacity': 1, 'medium-emphasis-opacity': 0.72 },
}

export const vuetifyOptions = {
  theme: { defaultTheme: 'system', themes: { light: nriLight, dark: nriDark } },
  defaults: {
    VCard: { flat: true, border: true, rounded: 'lg' },
    VBtn: { rounded: 'lg', class: 'text-none', variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VTextarea: { variant: 'outlined', density: 'comfortable' },
    VChip: { rounded: 'pill' },
  },
}
```

(If Vuetify 4.2 names the system option differently — check `node_modules/vuetify` for `'system'` support in `createTheme` — use the supported mechanism to follow `prefers-color-scheme`, including live changes, and ledger the adaptation.)

`apps/web/src/main.ts`: `import '@fontsource-variable/inter'`, `import './styles/app.css'`, and `createVuetify(vuetifyOptions)`.

`apps/web/src/styles/app.css`: set `--v-font-family`/`font-family: 'Inter Variable', system-ui, sans-serif` on `.v-application`; `.num { font-variant-numeric: tabular-nums }`; `.eyebrow` (11.5 px, uppercase, letter-spacing .9px, medium-emphasis, weight 600); `.day-row` (subtle fill, muted 13 px, flex space-between, top border); `.v-card` radius 14 px; focus ring `:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px }`. Values from the mockup's `<style>` block (`.eyebrow`, `.day`, `.card`).

- [ ] **Step 3: Shell (App.vue)** — rebuild per mockup `.side` / `.main` / `.bnav`:
- Wide (`!xs`): `v-navigation-drawer` permanent 232 px, `color="background"`, border right; brand row (orange 28 px rounded square with "¥₹" + "NRI Finance"); `v-list nav` items Dashboard (`mdi-home-outline`), Spend (`mdi-credit-card-outline`), Settings (`mdi-cog-outline`) with the active item rendered as a filled pill (`active-class` using `surface-variant`); Sign out item pinned to the drawer bottom (`#append` slot). No app bar on wide screens; each page renders its own header row.
- Phone (`xs`): compact top bar with the brand mark and page title only; `v-bottom-navigation` with Dashboard, Spend, a raised 42 px orange circular **+** (`aria-label="Add expense"`, links to `/spend/new`), More (→ `/settings`).
- Keep: `qc.clear()` + `undo.pending` clear in sign-out, `SignInDialog`, `signedInPage` logic.
- Add a reusable `PageHeader.vue` (`apps/web/src/components/PageHeader.vue`) with props `title` and a default slot for actions (right-aligned), rendering `<h1 class="text-h5 font-weight-bold">` — used by every page in Tasks 5–8.

- [ ] **Step 4: Sign-in, Not found, session dialog** — restyle: centred 420 px card on the canvas with the brand mark above the title; inputs outlined; full-width primary button. Keep ids and the button name "Sign in".

- [ ] **Step 5: Verify**

Run: `pnpm --filter @nri/web test 2>&1 | grep -E "Tests |FAIL" && pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: web tests pass (+2); clean; e2e 4 passed (links "Dashboard"/"Spend" and "Add expense" still resolve on phone and laptop).

Run `pnpm build:vercel` and confirm the Inter woff2 is in `.vercel/output/static/assets/` (no external font URL in the built CSS: `grep -r "fonts.googleapis" .vercel/output/static || echo none` → `none`).

- [ ] **Step 6: Commit** — ledger the plan-level ruling (page tasks reference the mockup), then:

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Monarch-style theme (light/dark), Inter, new shell"
```

---

### Task 4: Web view helpers

**Files:**
- Create: `apps/web/src/lib/groups.ts`, `apps/web/src/lib/legend.ts`, `apps/web/src/components/CategoryAvatar.vue`, `apps/web/src/components/ExpenseRow.vue`
- Modify: `apps/web/src/lib/ledger.ts` (sort options)
- Test: `apps/web/test/groups.test.ts`, `apps/web/test/legend.test.ts`, `apps/web/test/ledger.test.ts` (append)

**Interfaces:**
- Produces: `groupByDate<T extends { occurredOn: string; amountJpy: number }>(rows): { date: string; label: string; totalJpy: number; rows: T[] }[]` (order preserved; label like "5 Oct 2026"); `legendRows(byCategory, limit = 9): { categoryId|null, name, color, spentJpy, pct: number }[]` (pct one decimal; when more than `limit` entries, first `limit-1` + "Everything else"); `SORT_OPTIONS: { title, value: 'occurredOn:desc' | … }[]` and `sortValue(route) / sortFromValue(v)`; `<CategoryAvatar :category :size>` rendering icon or initial in a tinted circle (`aria-hidden`; the name is always rendered next to it by callers); `<ExpenseRow :t :category>` — a `router-link` row to `/spend/:id` (description or "(no description)", avatar + category name, payment chip, need/want chip with "Want" tinted, amount ¥ with ₹ beneath, chevron), used by Dashboard (Task 5) and Spend (Task 6).

- [ ] **Step 1: Failing tests**

`apps/web/test/groups.test.ts`:

```ts
import { expect, it } from 'vitest'
import { groupByDate } from '../src/lib/groups'

const r = (occurredOn: string, amountJpy: number, id = occurredOn + amountJpy) => ({ id, occurredOn, amountJpy })

it('groups consecutive rows by date, keeps order, totals each day on this page', () => {
  const g = groupByDate([r('2026-10-05', 1280), r('2026-10-05', 643), r('2026-10-04', 6820), r('2026-10-01', 85000)])
  expect(g.map((d) => [d.date, d.label, d.totalJpy, d.rows.length])).toEqual([
    ['2026-10-05', '5 Oct 2026', 1923, 2], ['2026-10-04', '4 Oct 2026', 6820, 1], ['2026-10-01', '1 Oct 2026', 85000, 1],
  ])
})

it('starts a new group when a date reappears later (ascending sorts, page joins)', () => {
  expect(groupByDate([r('2026-10-01', 1), r('2026-10-02', 2), r('2026-10-02', 3)]).map((d) => d.totalJpy)).toEqual([1, 5])
  expect(groupByDate([])).toEqual([])
})
```

`apps/web/test/legend.test.ts`:

```ts
import { expect, it } from 'vitest'
import { legendRows } from '../src/lib/legend'

const c = (n: string, v: number) => ({ categoryId: n, name: n, color: '#000000', spentJpy: v })

it('adds one-decimal percentages of the total', () => {
  expect(legendRows([c('Rent', 85000), c('Food', 15000)]).map((x) => x.pct)).toEqual([85, 15])
  expect(legendRows([c('A', 1), c('B', 2)]).map((x) => x.pct)).toEqual([33.3, 66.7])
})

it('folds the tail into "Everything else" beyond the limit', () => {
  const rows = legendRows(Array.from({ length: 11 }, (_, i) => c(`C${i}`, 100 - i)), 9)
  expect(rows).toHaveLength(9)
  expect(rows[8]).toMatchObject({ categoryId: null, name: 'Everything else', spentJpy: 92 + 91 + 90 })
})
```

Append to `apps/web/test/ledger.test.ts`:

```ts
import { SORT_OPTIONS, sortFromValue, sortValue } from '../src/lib/ledger'

it('maps the friendly sort options onto sort/dir', () => {
  expect(SORT_OPTIONS.map((o) => o.title)).toEqual(['Newest', 'Oldest', 'Amount high→low', 'Amount low→high', 'Category A→Z', 'Description A→Z'])
  expect(sortFromValue('amountJpy:asc')).toEqual({ key: 'amountJpy', order: 'asc' })
  expect(sortValue({ sort: 'category', dir: 'asc' })).toBe('category:asc')
  expect(sortValue({})).toBe('occurredOn:desc')
})
```

Run: `pnpm --filter @nri/web test 2>&1 | grep -E "Failed to resolve|Tests "` → Expected: FAIL (modules/exports missing).

- [ ] **Step 2: Implement**

`groups.ts`: iterate rows; start a new group when `occurredOn` differs from the current group's date; `label` = `${day} ${MONTHS[m-1]} ${year}` (reuse the month names already in `format.ts` — export them from there).
`legend.ts`: total = sum; `pct = Math.round(v * 1000 / total) / 10`; if `rows.length > limit` keep `limit - 1` and append `{ categoryId: null, name: 'Everything else', color: '#c9c3ba', spentJpy: restSum, pct }`.
`ledger.ts`: `SORT_OPTIONS` (values `occurredOn:desc`, `occurredOn:asc`, `amountJpy:desc`, `amountJpy:asc`, `category:asc`, `description:asc`), `sortFromValue`, `sortValue(routeQuery)` built on the existing `sortFromRoute`.
`CategoryAvatar.vue`: props `category: { name, color, icon: string | null }`, `size = 32`; a circle with background `color` at ~13% alpha (`${color}22`), showing `icon` or the uppercase first letter in `color`; `aria-hidden="true"`.
`ExpenseRow.vue`: per the Interfaces line, styled from the mockup's `.row`/`.chip`/`.amt` CSS; on phones (`xs`) only description, category name and amount are shown (mockup `@media (max-width:760px)` rule). Keyboard: the whole row is one link with a visible focus ring.

- [ ] **Step 3: Verify GREEN** — `pnpm --filter @nri/web test && pnpm --filter @nri/web typecheck && pnpm lint` → all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib apps/web/src/components/CategoryAvatar.vue apps/web/test
git commit -m "feat(web): date grouping, legend rows, sort options, category avatar"
```

---

### Task 5: Dashboard restyle

**Files:** Modify `apps/web/src/pages/DashboardPage.vue`, `apps/web/src/lib/charts.ts` (theme-aware colours).

Reference: mockup section `<!-- DASHBOARD -->` and its CSS (`.kpis`, `.kpi`, `.bar-mini`, `.spend`, `.donut`, `.legend`, `.lg`, `.grid2`, `.summary`, `.bars`).

Build (spec §4.1):
- `PageHeader` "Dashboard" with the cycle picker (bordered pill: ‹ `data-testid="cycle-label"` › with the existing aria-labels) and primary "Add expense" (hidden on phones; the bottom-nav + covers it).
- KPI row: 4 cards (2×2 below 1100 px): label, value (`num`, 22 px bold, existing testids), sub-line; Spent "x% of income" + thin primary bar; Kept savings rate in success/error colour with a sign + thin bar; Sent home with "fees ￥…" sub-line when fees > 0.
- Spending-by-category card: eyebrow "Spending by category", date range (from the API `start`/`end`, formatted "25 Sep – 24 Oct 2026" via `cycleLabel`), Doughnut (cutout ~70%, no Chart.js legend) with the cycle total centred over it, and `legendRows(d.byCategory)` rendered as a 3/2/1-column grid of **router-links** (dot + name + `￥… (x.x%)`) to `/spend?cycle=…&categoryId=…` ("Everything else" links to the cycle without a category); hovering/focusing a legend link highlights its slice (Chart.js `setActiveElements`). Empty cycle: "No spending recorded in this cycle."
- Recent expenses card: query `/api/transactions?cycle=<cycle>&pageSize=5`, render with `groupByDate` + `ExpenseRow` (Task 4); "View all" → `/spend?cycle=…`.
- Summary card: "Expenses this cycle" (`expenseCount`), "Largest expense", "Average expense" (`spentJpy / expenseCount`, rounded; "—" when 0), "Needs / wants" (`needJpy`/`wantJpy` as whole percentages).
- Spend-per-cycle card: Bar chart, current cycle bar in primary, others primary at 35% opacity; keep the keyboard text list (visually compact, one row of links) and click-through to `/spend?cycle=`.
- Charts read colours from the active theme (`useTheme()`), so dark mode is correct.

Acceptance: web unit tests for `charts.ts` updated to the new signature (theme colours passed in) and passing; `pnpm test:e2e` 4 passed; screenshot at 1280 and 390 px light/dark compared with the mockup's Dashboard (layout, spacing, colours) — record the screenshot paths in the report.

Commit: `feat(web): dashboard in the new design`.

---

### Task 6: Spend (ledger) restyle with date grouping

**Files:** Modify `apps/web/src/pages/LedgerPage.vue` (uses `ExpenseRow`, `groupByDate`, `SORT_OPTIONS` from Task 4).

Reference: mockup `<!-- SPEND / LEDGER -->` (`.filters`, `.sel`, `.search`, `.totbar`, `.day`, `.row`, `.chip`, `.chip.want`, `.amt`).

Build (spec §4.2):
- `PageHeader` "Spend" with cycle picker (the existing cycle select styled as a pill, "All cycles" kept) and "Add expense".
- One card: filter row (category / payment / need-want selects, `#search` with clearable + debounce unchanged, sort select from `SORT_OPTIONS` wired through `sortValue`/`sortFromValue` → `push({ sort, page: 1 })`); totals line `data-testid="ledger-total"` keeping the "N expenses · ￥X" text and adding "Needs ￥… · Wants ￥…" after it (from `needJpy`/`wantJpy`).
- List replaces `v-data-table-server`: when sort key is `occurredOn` render `groupByDate(items)` with a `.day-row` header (date label + "￥… on this page" total) followed by `ExpenseRow`s; otherwise a flat list of `ExpenseRow`s.
- Pager at the bottom (`v-pagination`, total pages from `total/pageSize`) bound to the URL `page`.
- Empty state: "No expenses match these filters."
- Undo snackbar and restore error unchanged.
- The e2e test clicks a row by its description text: the description must be visible text inside the row link.

Acceptance: e2e 4 passed; add to `e2e/smoke.spec.ts` laptop test, after the search, `await expect(page.locator('.day-row').first()).toBeVisible()` (default sort is date); screenshots 1280/390 light/dark vs mockup Spend.

Commit: `feat(web): spend list grouped by date in the new design`.

---

### Task 7: Quick-add and edit restyle

**Files:** Modify `apps/web/src/pages/QuickAddPage.vue`, `apps/web/src/pages/EditTransactionPage.vue`.

Reference: mockup phone quick-add (`.amount`, `.cur`, `.lbl`, `.cats`, `.cat`, `.chips`, `.c2`, `.save`, `.toast`).

Build (spec §4.3–4.4):
- Amount card: `#amount` as a large (38 px bold) borderless input inside a bordered card; ¥/₹ as a two-button segmented toggle (selected = primary fill, `aria-pressed`); ₹ preview + "Today · Mon 5 Oct" hint line (from the form's date).
- Category: label "Category"; tiles grid (3 per row on phones, 6 on wide) — each tile is a chip-group item (keep `v-chip-group` with `aria-label="Category"` and `role="radiogroup"`, each tile `role="radio"`/`aria-checked`) showing `CategoryAvatar` + name; selected tile: primary outline + check mark (not colour only).
- "Paid with" chips (keep `aria-label="Payment method"`) with "· last used for <category>" when defaulted; "Need or want" chips (keep aria-label); selected chip = dark fill + check.
- `#description`, `#date` kept; full-width primary Save (name "Save"); toast keeps `data-testid="saved"` text "Saved ￥… · Category" (a leading ✓ icon is fine outside that text node).
- Edit page: same amount card and chip styling; category select shows avatars; Save / Cancel / Delete buttons (names unchanged).

Acceptance: web tests pass; e2e 4 passed on phone + laptop; screenshots 390/1280 light/dark vs mockup Phone view.

Commit: `feat(web): quick-add and edit in the new design`.

---

### Task 8: Settings restyle with the icon picker

**Files:** Modify `apps/web/src/pages/SettingsPage.vue`, `apps/web/src/components/CategoriesSettings.vue`.

Reference: mockup `<!-- SETTINGS -->` (`.form .fgrid`, `.crow`, `.drop`).

Build (spec §4.5):
- `PageHeader` "Settings". Two-column grid on wide (Profile + Categories left; Import + Account right), stacked on phones.
- Profile card: two-column form (salary, planning rate, start day, timezone), "Save profile".
- Categories card: header with `#new-category` input + colour + **icon** picker + Add; rows: `CategoryAvatar`, name, colour dot, actions (↑ ↓, rename with Save/Cancel, colour menu, **icon menu**: a `v-menu` with a 6×4 grid of these emoji — 🏠 🛒 🍜 ☕ 🚃 🚕 ✈️ 💡 📱 💊 🏥 🛍️ 👕 🎁 🎬 🎮 📚 🎓 🐶 💼 🧾 💸 🏦 ⭐ — plus "No icon"; each choice is a button with `aria-label` = the emoji's name in words (e.g. "House", "Shopping cart") and `aria-checked` for the current one), archive/unarchive, delete when unused. PATCH `{ icon }` / `{ icon: null }`.
- Import card: dashed drop zone ("Drop **finance-data.json** here, or choose a file"); dropping a file or choosing via the existing `#import-file` input both call the existing `onFile`; success/error alerts unchanged.
- Account card: "Signed in as <email>" + Sign out (same handler as the shell).

Acceptance: web tests pass; e2e 4 passed (import via `#import-file` still works; Categories card refresh assertion still passes); screenshots vs mockup Settings.

Commit: `feat(web): settings in the new design with category icons`.

---

### Task 9: Visual check, docs

**Files:** Create `scripts/ui-screens.mjs` (dev aid, not a test); modify `docs/checklist.md`, `docs/diagrams/nri-plan-overview.html`, `README.md`.

- [ ] **Step 1:** `scripts/ui-screens.mjs`: signs in with the e2e user (reads `.e2e-user.json` after running `pnpm test:e2e` once, or creates a user with `@nri/test-utils`), visits `/`, `/spend`, `/spend/new`, `/settings` at 1280×900 and 390×844, in `colorScheme: 'light'` and `'dark'`, saving PNGs under `.superpowers/ui-screens/` (gitignored), and fails on any console error. Add `"ui:screens": "node scripts/ui-screens.mjs"`.
- [ ] **Step 2:** Run it; compare each screen with the mockup; fix any mismatch in the owning page (note fixes in the report).
- [ ] **Step 3:** Docs: checklist — new row "UI refresh (mockup look, light/dark, category icons)" ✅; plan page WBS adds `{c:'4.8', n:'UI refresh: new look, icons, date-grouped ledger', s:'done'}` under module 4; README "Using the app" mentions category icons, dark mode and the date-grouped Spend list.
- [ ] **Step 4:** Full verification: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:scripts && pnpm test:integration && pnpm test:e2e && pnpm stack:check` → all green.
- [ ] **Step 5: Commit** `docs: UI refresh — checklist, plan page, README; screenshot helper`.
