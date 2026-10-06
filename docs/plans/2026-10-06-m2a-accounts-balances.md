# M2a Accounts, balances and emergency fund — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage accounts, record review-day balances per cycle, and show net worth and the emergency fund on a new Accounts screen and the Dashboard.

**Architecture:** Net-worth rules are pure functions in `packages/core` (carry-forward, card subtraction, ₹→¥ at the planning rate, emergency fund, months covered). The API fetches the user's accounts and snapshots (small) and calls them; contracts in `packages/contracts` (zod 4) define every request/response. Web adds `/accounts` and `/accounts/balances` in the UI-refresh design system, plus two Dashboard cards.

**Tech Stack:** pnpm 11 monorepo · Hono 4 · Drizzle 0.45 + Postgres 17 (local docker Supabase stack) · zod 4 · Vue 3.5 + Vuetify 4.2 + vue-router 5 + TanStack Vue Query 5 · Chart.js 4 / vue-chartjs 5 · Vitest · Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-06-m2a-accounts-balances-design.md`

## Global Constraints

- Money: yen as integer `…Jpy`; rupees as integer paise `…Paise` in JSON (DB stores `numeric(14,2)` rupees; convert with `paiseFromDecimal` / `decimalFromPaise`). Rates are strings with up to 6 decimals; convert ₹→¥ only with `jpyFromInrPaise(paise, rate)` (half-up, non-negative inputs).
- Yen amounts ≤ `PG_INT_MAX` (2,147,483,647); paise amounts ≤ 99,999,999,999,999 (fits `numeric(14,2)` and is a safe integer).
- Every route is owner-scoped: each request already runs in one transaction as the caller (`apps/api/src/middleware/db.ts`, RLS); still filter by `userId` in every query, as M1 does.
- Errors use `ApiError(status, code, message, details?)` from `apps/api/src/errors.ts`; 400 `VALIDATION_FAILED`, 404 `NOT_FOUND`, 409 `CONFLICT`.
- Card accounts (`type = 'card'`) store the amount **owed** (≥ 0) and subtract from net worth; cards never count toward the emergency fund.
- Carry-forward: a cycle with no snapshot for an account uses that account's latest earlier snapshot; an archived account carries forward only through the cycle it was archived in.
- Net worth converts ₹ at the **current** planning rate (`profiles.planning_rate_jpy_per_inr`), and the response says which rate.
- Web: theme tokens only (`rgb(var(--v-theme-…))`), text ≥ 4.5:1 and focus ring ≥ 3:1 in light and dark; colour never the only signal; per-row accessible names; `:ripple="false"` on selected segmented controls; phone = Vuetify `xs` (< 600 px); lint bans `v-html` and `toISOString`.
- Existing hooks keep working (e2e): testids `income`, `spent`, `sent`, `kept`, `cycle-label`, `saved`, `ledger-total`; ids `#email`, `#password`, `#amount`, `#description`, `#search`, `#import-file`, `#new-category`; nav link names "Dashboard", "Spend"; accessible name "Add expense".
- Web unit tests must pass **without `.env.local`** (CI): any test importing `src/lib/supabase` (directly or via `lib/session`/`lib/api`) must `vi.mock('../src/lib/supabase', …)`. Check with `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vitest run` in `apps/web`.
- Git in this worktree: plain commands, one per call (no `git -C`, no `&&` chains); never bare `git stash`.

## Review Focus

1. Saving balances twice for the same cycle (correcting a typo) updates the rows — no duplicate, no 409 — and the second value wins (Task 4 test).
2. Backfilling an older cycle when newer cycles already have balances changes only the gap it fills; newer cycles keep their own values (Task 2 test).
3. ₹ balances with paise (`12345.67`) and large ₹ values (> ₹21,474,836.47, i.e. above int32 paise) round-trip exactly (Task 4 test).
4. Archiving an emergency-fund account removes it from the emergency fund and net worth from the cycle after archiving, while earlier cycles keep it (Task 2 test).
5. Changing the planning rate re-expresses the whole net-worth series at the new rate and the response reports that rate (Task 5 test).

---

### Task 1: Profile emergency-fund goal, snapshot checks, import goal + "profile kept"

**Files:**
- Create: `packages/db/migrations/0005_accounts_balances.sql` (+ drizzle meta via `pnpm --filter @nri/db generate`)
- Modify: `packages/db/src/schema.ts` (profiles, balanceSnapshots), `packages/contracts/src/profile.ts`, `packages/contracts/src/importV1.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/services/importV1.ts`
- Test: `packages/contracts/test/profile.test.ts` (create or append), `apps/api/test/me.int.test.ts`, `apps/api/test/import.int.test.ts`

**Interfaces:**
- Produces: `Profile.emergencyFundGoalJpy: number | null`; `ProfileInput.emergencyFundGoalJpy?: number | null` (omitted → unchanged; `null` → cleared); `ImportResult.profileKept: boolean`.

- [ ] **Step 1: Failing tests**

Contracts (`packages/contracts/test/profile.test.ts`):

```ts
import { expect, it } from 'vitest'
import { ProfileInput } from '../src/profile'

const base = { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }

it('accepts an optional emergency-fund goal, null to clear', () => {
  expect(ProfileInput.parse(base).emergencyFundGoalJpy).toBeUndefined()
  expect(ProfileInput.parse({ ...base, emergencyFundGoalJpy: 2400000 }).emergencyFundGoalJpy).toBe(2400000)
  expect(ProfileInput.parse({ ...base, emergencyFundGoalJpy: null }).emergencyFundGoalJpy).toBeNull()
  expect(ProfileInput.safeParse({ ...base, emergencyFundGoalJpy: -1 }).success).toBe(false)
  expect(ProfileInput.safeParse({ ...base, emergencyFundGoalJpy: 1.5 }).success).toBe(false)
})
```

API (`apps/api/test/me.int.test.ts`, append):

```ts
it('stores the emergency-fund goal and keeps it when a later PUT omits it', async () => {
  const put = (body: unknown) => app.request('/api/me', json(u.accessToken, 'PUT', body))
  const base = { salaryJpy: 600000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
  expect((await (await put({ ...base, emergencyFundGoalJpy: 2400000 })).json()).profile.emergencyFundGoalJpy).toBe(2400000)
  expect((await (await put(base)).json()).profile.emergencyFundGoalJpy).toBe(2400000)
  expect((await (await put({ ...base, emergencyFundGoalJpy: null })).json()).profile.emergencyFundGoalJpy).toBeNull()
})
```

(Use the file's existing user/app variables; if it has none, create a user with `createTestUser('me-goal')` in `beforeAll` and delete it in `afterAll`, as `categories.int.test.ts` does.)

API (`apps/api/test/import.int.test.ts`, append — reuse the file's v1 fixture builder):

```ts
it('imports the v1 emergency-fund goal into a new profile and reports profileKept on a re-import', async () => {
  const doc = { ...fixture, settings: { ...fixture.settings, emergencyFundTargetJPY: 1000000 } }
  const first = await (await app.request('/api/import/v1', json(fresh.accessToken, 'POST', doc))).json()
  expect(first.profileKept).toBe(false)
  const me = await (await app.request('/api/me', json(fresh.accessToken, 'GET'))).json()
  expect(me.profile.emergencyFundGoalJpy).toBe(1000000)
  const again = await (await app.request('/api/import/v1', json(fresh.accessToken, 'POST', doc))).json()
  expect(again.profileKept).toBe(true)
})

it('treats a v1 goal of 0 as no goal', async () => {
  // new user, settings.emergencyFundTargetJPY: 0 → profile.emergencyFundGoalJpy === null
})
```

Write the second test fully in the file's style (new user, import with `emergencyFundTargetJPY: 0`, assert `null`).

Run: `pnpm --filter @nri/contracts test` → FAIL (`emergencyFundGoalJpy` not in schema). API tests need the stack (`pnpm stack:up`); run `pnpm --filter @nri/api test:int` → FAIL.

- [ ] **Step 2: Schema + migration**

In `schema.ts`: `profiles` gains `emergencyFundGoalJpy: integer('emergency_fund_goal_jpy')` and check `profiles_ef_goal` `${t.emergencyFundGoalJpy} is null or ${t.emergencyFundGoalJpy} >= 0`; `balanceSnapshots` gains check `balance_snapshots_non_negative` `coalesce(${t.balanceJpy}, 0) >= 0 and coalesce(${t.balanceInr}, 0) >= 0`. Run `pnpm --filter @nri/db generate`, rename the generated file to `0005_accounts_balances.sql` (and its journal `tag`) to match the repo's naming, and check the SQL contains exactly the column add and the two checks.

- [ ] **Step 3: Contracts**

```ts
// profile.ts
const Goal = z.number().int().nonnegative().max(PG_INT_MAX)
export const ProfileInput = z.object({
  salaryJpy: z.number().int().nonnegative().max(PG_INT_MAX),
  planningRateJpyPerInr: RateString,
  cycleStartDay: z.number().int().min(1).max(28),
  timezone: TimeZoneString,
  emergencyFundGoalJpy: Goal.nullable().optional(),
})
export const Profile = ProfileInput.extend({ emergencyFundGoalJpy: Goal.nullable() })
```

`importV1.ts`: `ImportResult = z.object({ inserted: ImportCounts, skippedRows: z.array(z.string()), profileKept: z.boolean() })`.

- [ ] **Step 4: API**

`me.ts`: `toProfile` adds `emergencyFundGoalJpy: r.emergencyFundGoalJpy`; PUT builds `set` from input and leaves `emergencyFundGoalJpy` out of the update when it is `undefined` (insert uses `?? null`).
`importV1.ts`: before the profile insert, `const kept = (await getProfileRow(tx, userId)) !== null` (import from `./profile`); insert adds `emergencyFundGoalJpy: doc.settings.emergencyFundTargetJPY > 0 ? Math.round(doc.settings.emergencyFundTargetJPY) : null`; return `{ inserted, skippedRows, profileKept: kept }`.

- [ ] **Step 5: Verify** — `pnpm --filter @nri/contracts test`, `pnpm --filter @nri/api test:int` (stack up; `pnpm db:migrate` first) → PASS; `pnpm typecheck` clean (fix the web Settings page type use of `Profile` if needed — the field is new and nullable).

- [ ] **Step 6: Commit** — `git add packages/db packages/contracts apps/api` then `git commit -m "feat: emergency-fund goal in the profile, non-negative balances, import reports a kept profile"`.

---

### Task 2: Net-worth rules in core

**Files:**
- Create: `packages/core/src/networth.ts`, `packages/core/test/networth.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from './networth'`)

**Interfaces:**
- Consumes: `Cycle`, `previousCycle` (`cycles.ts`); `jpyFromInrPaise` (`money.ts`).
- Produces (exact):

```ts
export type AccountType = 'bank' | 'cash' | 'card' | 'fd' | 'investment'
export type NwAccount = {
  id: string
  country: 'JP' | 'IN'           // JP ⇔ JPY, IN ⇔ INR
  type: AccountType
  isEmergencyFund: boolean
  archivedCycle: Cycle | null    // cycle in which it was archived (inclusive end of carry-forward)
}
export type Snapshot = { accountId: string; cycle: Cycle; amount: number } // yen for JP, paise for IN; ≥ 0
export type BalanceAt = { amount: number; fromCycle: Cycle; carried: boolean }
export type Side = { japanJpy: number; indiaPaise: number }
export type NetWorth = {
  japanJpy: number; indiaPaise: number; combinedJpy: number   // signed: assets − liabilities
  assets: Side; liabilities: Side                              // both ≥ 0
}

export function balanceAt(snaps: Snapshot[], account: NwAccount, cycle: Cycle): BalanceAt | null
export function netWorthAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): NetWorth
export function changeSince(current: number, previous: number | null): { changeJpy: number | null; changePct: number | null }
export function emergencyFundAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): number
export function monthsCovered(efJpy: number, priorSpendJpy: number[]): { monthsCovered: number | null; avgSpendJpy: number | null }
```

- [ ] **Step 1: Failing tests** (`packages/core/test/networth.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { balanceAt, changeSince, emergencyFundAt, monthsCovered, netWorthAt, type NwAccount, type Snapshot } from '../src/networth'

const RATE = '1.7' // ¥1.7 per ₹1
const jp: NwAccount = { id: 'jp', country: 'JP', type: 'bank', isEmergencyFund: false, archivedCycle: null }
const ef: NwAccount = { id: 'ef', country: 'JP', type: 'bank', isEmergencyFund: true, archivedCycle: null }
const inr: NwAccount = { id: 'in', country: 'IN', type: 'bank', isEmergencyFund: true, archivedCycle: null }
const card: NwAccount = { id: 'card', country: 'JP', type: 'card', isEmergencyFund: true, archivedCycle: null }
const s = (accountId: string, cycle: string, amount: number): Snapshot => ({ accountId, cycle, amount })

describe('balanceAt', () => {
  const snaps = [s('jp', '2026-08', 100), s('jp', '2026-10', 300)]
  it('uses this cycle, else carries the latest earlier one, else null', () => {
    expect(balanceAt(snaps, jp, '2026-10')).toEqual({ amount: 300, fromCycle: '2026-10', carried: false })
    expect(balanceAt(snaps, jp, '2026-09')).toEqual({ amount: 100, fromCycle: '2026-08', carried: true })
    expect(balanceAt(snaps, jp, '2026-07')).toBeNull()
  })
  it('backfilling an older cycle fills only the gap; newer cycles keep their own values', () => {
    const backfilled = [...snaps, s('jp', '2026-09', 200)]
    expect(balanceAt(backfilled, jp, '2026-09')!.amount).toBe(200)
    expect(balanceAt(backfilled, jp, '2026-10')!.amount).toBe(300)
    expect(balanceAt(backfilled, jp, '2026-11')).toEqual({ amount: 300, fromCycle: '2026-10', carried: true })
  })
  it('stops carrying an archived account after its archive cycle', () => {
    const archived = { ...ef, archivedCycle: '2026-09' }
    const snapsEf = [s('ef', '2026-08', 500)]
    expect(balanceAt(snapsEf, archived, '2026-09')!.amount).toBe(500)
    expect(balanceAt(snapsEf, archived, '2026-10')).toBeNull()
  })
})

describe('netWorthAt', () => {
  it('adds assets, subtracts cards, converts ₹ at the rate', () => {
    const snaps = [s('jp', '2026-10', 100000), s('card', '2026-10', 42000), s('in', '2026-10', 1000000)] // ₹10,000.00
    expect(netWorthAt([jp, card, inr], snaps, '2026-10', RATE)).toEqual({
      japanJpy: 58000, indiaPaise: 1000000, combinedJpy: 58000 + 17000,
      assets: { japanJpy: 100000, indiaPaise: 1000000 }, liabilities: { japanJpy: 42000, indiaPaise: 0 },
    })
  })
  it('is all zeros with no snapshots', () => {
    expect(netWorthAt([jp], [], '2026-10', RATE).combinedJpy).toBe(0)
  })
})

describe('emergencyFundAt', () => {
  it('sums flagged non-card accounts, ₹ converted, carried forward', () => {
    const snaps = [s('ef', '2026-09', 300000), s('in', '2026-10', 1000000), s('card', '2026-10', 5000), s('jp', '2026-10', 1)]
    expect(emergencyFundAt([jp, ef, inr, card], snaps, '2026-10', RATE)).toBe(300000 + 17000)
  })
  it('drops an emergency-fund account after it is archived, keeps it for earlier cycles', () => {
    const archived = { ...ef, archivedCycle: '2026-09' }
    const snaps = [s('ef', '2026-08', 300000)]
    expect(emergencyFundAt([archived], snaps, '2026-09', RATE)).toBe(300000)
    expect(emergencyFundAt([archived], snaps, '2026-10', RATE)).toBe(0)
  })
})

describe('changeSince / monthsCovered', () => {
  it('reports amount and one-decimal percent; null percent without a positive base', () => {
    expect(changeSince(1429069, 1216769)).toEqual({ changeJpy: 212300, changePct: 17.4 })
    expect(changeSince(500, null)).toEqual({ changeJpy: null, changePct: null })
    expect(changeSince(500, 0)).toEqual({ changeJpy: 500, changePct: null })
    expect(changeSince(-100, -200)).toEqual({ changeJpy: 100, changePct: 50 })
  })
  it('divides by the average of the prior cycles given, one decimal; null without data', () => {
    expect(monthsCovered(2000000, [300000, 327000, 354000])).toEqual({ monthsCovered: 6.1, avgSpendJpy: 327000 })
    expect(monthsCovered(100000, [50000])).toEqual({ monthsCovered: 2, avgSpendJpy: 50000 })
    expect(monthsCovered(100000, [])).toEqual({ monthsCovered: null, avgSpendJpy: null })
    expect(monthsCovered(100000, [0, 0])).toEqual({ monthsCovered: null, avgSpendJpy: 0 })
  })
})
```

Run: `pnpm --filter @nri/core test` → FAIL (module missing).

- [ ] **Step 2: Implement** (`packages/core/src/networth.ts`)

```ts
import type { Cycle } from './cycles'
import { jpyFromInrPaise } from './money'

// (types exactly as in Interfaces above)

export function balanceAt(snaps: Snapshot[], account: NwAccount, cycle: Cycle): BalanceAt | null {
  if (account.archivedCycle !== null && cycle > account.archivedCycle) return null
  let best: Snapshot | null = null
  for (const sn of snaps) {
    if (sn.accountId !== account.id || sn.cycle > cycle) continue
    if (!best || sn.cycle > best.cycle) best = sn
  }
  return best ? { amount: best.amount, fromCycle: best.cycle, carried: best.cycle !== cycle } : null
}

export function netWorthAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): NetWorth {
  const assets = { japanJpy: 0, indiaPaise: 0 }
  const liabilities = { japanJpy: 0, indiaPaise: 0 }
  for (const a of accounts) {
    const b = balanceAt(snaps, a, cycle)
    if (!b) continue
    const side = a.type === 'card' ? liabilities : assets
    if (a.country === 'JP') side.japanJpy += b.amount
    else side.indiaPaise += b.amount
  }
  const japanJpy = assets.japanJpy - liabilities.japanJpy
  const indiaPaise = assets.indiaPaise - liabilities.indiaPaise
  const combinedJpy = japanJpy + jpyFromInrPaise(assets.indiaPaise, rate) - jpyFromInrPaise(liabilities.indiaPaise, rate)
  return { japanJpy, indiaPaise, combinedJpy, assets, liabilities }
}

export function changeSince(current: number, previous: number | null) {
  if (previous === null) return { changeJpy: null, changePct: null }
  const changeJpy = current - previous
  const base = Math.abs(previous)
  return { changeJpy, changePct: base > 0 ? Math.round((changeJpy * 1000) / base) / 10 : null }
}

export function emergencyFundAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): number {
  let jpy = 0
  let paise = 0
  for (const a of accounts) {
    if (!a.isEmergencyFund || a.type === 'card') continue
    const b = balanceAt(snaps, a, cycle)
    if (!b) continue
    if (a.country === 'JP') jpy += b.amount
    else paise += b.amount
  }
  return jpy + jpyFromInrPaise(paise, rate)
}

export function monthsCovered(efJpy: number, priorSpendJpy: number[]) {
  if (priorSpendJpy.length === 0) return { monthsCovered: null, avgSpendJpy: null }
  const avgSpendJpy = Math.round(priorSpendJpy.reduce((a, b) => a + b, 0) / priorSpendJpy.length)
  return { monthsCovered: avgSpendJpy > 0 ? Math.round((efJpy * 10) / avgSpendJpy) / 10 : null, avgSpendJpy }
}
```

- [ ] **Step 3: Verify** — `pnpm --filter @nri/core test` → PASS; `pnpm typecheck`.
- [ ] **Step 4: Commit** — `git add packages/core` then `git commit -m "feat(core): net worth, carry-forward, emergency fund and months covered"`.

---

### Task 3: Accounts API (create, edit, archive, list with archived)

**Files:**
- Create: `apps/api/src/services/accounts.ts`, `apps/api/test/accounts.int.test.ts`, `packages/contracts/test/accounts.test.ts`
- Modify: `packages/contracts/src/accounts.ts`, `apps/api/src/routes/accounts.ts`

**Interfaces:**
- Produces:

```ts
// contracts
export const AccountType = z.enum(['bank', 'cash', 'card', 'fd', 'investment'])
export const Country = z.enum(['JP', 'IN'])
export const Account = z.object({
  id: z.uuid(), name: z.string(), country: Country, currency: z.enum(['JPY', 'INR']), type: AccountType,
  isEmergencyFund: z.boolean(), archived: z.boolean(), hasBalances: z.boolean(),
})
export const AccountList = z.object({ items: z.array(Account) })
const AccountName = z.string().trim().min(1, 'Name is required').max(60)
export const AccountCreate = z.strictObject({ name: AccountName, country: Country, type: AccountType, isEmergencyFund: z.boolean().optional() })
export const AccountPatch = z
  .strictObject({ name: AccountName, country: Country, type: AccountType, isEmergencyFund: z.boolean(), archived: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export const currencyFor = (country: 'JP' | 'IN') => (country === 'JP' ? 'JPY' : 'INR') as 'JPY' | 'INR'
```

- API: `GET /api/accounts[?include=archived]`, `POST /api/accounts` (201), `PATCH /api/accounts/:id`. Service: `listAccounts(tx, userId, { includeArchived })`, `getAccount(tx, userId, id)`.

- [ ] **Step 1: Failing tests**

Contracts: `AccountCreate` rejects a `currency` key (strict), empty/61-char names, unknown type; `AccountPatch` rejects `{}`; `currencyFor('IN') === 'INR'`.

Integration (`accounts.int.test.ts`, two users `a`, `b`, same scaffolding as `categories.int.test.ts`):

```ts
it('creates an account with currency derived from country', async () => {
  const res = await call(a, 'POST', '/api/accounts', { name: 'HDFC savings', country: 'IN', type: 'bank', isEmergencyFund: true })
  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({ name: 'HDFC savings', country: 'IN', currency: 'INR', isEmergencyFund: true, archived: false, hasBalances: false })
})
it('refuses a duplicate active name (case-insensitive) with 409, allows reusing an archived name', async () => { /* … */ })
it('renames, retypes, flags and archives; list hides archived unless include=archived', async () => { /* … */ })
it('locks country once the account has balances (409), allows it before', async () => {
  // create JP account; PATCH { country: 'IN' } → 200 and currency 'INR'; insert a balance_snapshots row via withUser(db…);
  // PATCH { country: 'JP' } → 409 'This account has balances; add a new account instead'
})
it("never shows or edits another user's account (404)", async () => {
  // b PATCHes a's account → 404; b's GET lists none of a's
})
```

Write each body fully (pattern: `call(u, method, path, body)` then status/json asserts; direct inserts via `withUser(db, { sub: a.id }, (tx) => tx.insert(balanceSnapshots).values({...}))`).

Run: `pnpm --filter @nri/api test:int -- accounts` → FAIL.

- [ ] **Step 2: Implement**

`services/accounts.ts`: `listAccounts` selects accounts plus `hasBalances` (`exists (select 1 from balance_snapshots s where s.account_id = accounts.id)`), `archived: archived_at is not null`, ordered by `country`, `type`, `lower(name)`; active only unless `includeArchived`. `assertUniqueName(tx, userId, name, exceptId?)` → 409 `'You already have an account called "<name>"'` when an active account matches `lower(name)`. `getAccount` → 404 `'That account no longer exists'`.
Routes: POST inserts `{ userId, name, country, currency: currencyFor(country), type, isEmergencyFund: input.isEmergencyFund ?? false }`; PATCH: 404 if missing; if `country` given and differs and `hasBalances` → 409 `'This account has balances; add a new account instead'`; sets `currency: currencyFor(country)` alongside country; `archived` → `archivedAt: archived ? sql\`now()\` : null`; unarchive re-checks the name is unique; `updatedAt: sql\`now()\``. GET keeps its current shape for the expense form (active only) — the extra fields are additive.

- [ ] **Step 3: Verify** — contracts + `pnpm --filter @nri/api test:int` → PASS (existing transactions tests still pass with the extended `Account`); `pnpm typecheck` (EditTransactionPage uses `AccountList` — extra fields are fine).
- [ ] **Step 4: Commit** — `feat(api): manage accounts — create, edit, archive, country lock`.

---

### Task 4: Balances API (review-day GET with prefill, PUT upsert)

**Files:**
- Create: `packages/contracts/src/balances.ts`, `packages/contracts/test/balances.test.ts`, `apps/api/src/services/snapshots.ts`, `apps/api/src/routes/balances.ts`, `apps/api/test/balances.int.test.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts` (`app.route('/api/balances', balanceRoutes)`)

**Interfaces:**
- Consumes: `balanceAt`, `NwAccount`, `Snapshot` (Task 2); `listAccounts` (Task 3); `cycleOf`, `cycleBounds`, `todayIn`, `paiseFromDecimal`, `decimalFromPaise` (core).
- Produces:

```ts
// contracts/balances.ts
export const PAISE_MAX = 99_999_999_999_999
export const BalanceRow = z.object({
  accountId: z.uuid(), name: z.string(), country: z.enum(['JP', 'IN']), currency: z.enum(['JPY', 'INR']),
  type: z.enum(['bank', 'cash', 'card', 'fd', 'investment']), isEmergencyFund: z.boolean(),
  amount: z.number().int().nullable(),             // yen or paise; null when source = 'none'
  source: z.enum(['this', 'carried', 'none']), fromCycle: CycleString.nullable(),
})
export const BalancesResponse = z.object({ cycle: CycleString, start: z.string(), end: z.string(), rate: z.string(), rows: z.array(BalanceRow) })
export const BalancesPut = z.strictObject({
  cycle: CycleString,
  entries: z.array(z.strictObject({ accountId: z.uuid(), amount: z.number().int().nonnegative().max(PAISE_MAX) })).min(1).max(200),
}).refine((o) => new Set(o.entries.map((e) => e.accountId)).size === o.entries.length, { message: 'Each account once', path: ['entries'] })
```

```ts
// services/snapshots.ts — shared by balances (Task 4) and networth (Task 5)
export async function loadNetWorthInputs(tx: Tx, userId: string, startDay: number, timezone: string):
  Promise<{ accounts: (NwAccount & { name: string; currency: 'JPY' | 'INR'; archived: boolean })[]; snaps: Snapshot[] }>
```
(`archivedCycle` = `cycleOf(<archived_at as date in the profile timezone>, startDay)`; `Snapshot.amount` = `balance_jpy` or `paiseFromDecimal(balance_inr)`; includes archived accounts.)

- [ ] **Step 1: Failing tests**

Contracts: `BalancesPut` rejects duplicate accountIds, negative amounts, non-integers, `PAISE_MAX + 1`, empty entries; accepts `PAISE_MAX`.

Integration (`balances.int.test.ts`; user with profile via `PUT /api/me`, accounts via `POST /api/accounts`: JP bank, IN bank, JP card):

```ts
it('GET prefills from the latest earlier cycle and marks the source', async () => {
  await put({ cycle: '2026-09', entries: [{ accountId: jpBank, amount: 500000 }] })
  const got = await (await call(a, 'GET', '/api/balances?cycle=2026-10')).json()
  expect(got.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({ amount: 500000, source: 'carried', fromCycle: '2026-09' })
  expect(got.rows.find((r: Row) => r.accountId === inBank)).toMatchObject({ amount: null, source: 'none', fromCycle: null })
  expect(got.rows.map((r: Row) => r.country)).toEqual(['JP', 'JP', 'IN']) // Japan first
})
it('PUT twice for the same cycle updates in place; the second value wins', async () => { /* Review Focus 1 */ })
it('round-trips ₹ paise exactly, including amounts above int32 paise', async () => {
  // entries [{ accountId: inBank, amount: 1234567 }] then [{ inBank, amount: 3_000_000_000_00 }] (₹3,000,000,000.00 → paise 300000000000)
  // GET shows the same integers back (Review Focus 3)
})
it('saves all entries or none: one foreign/archived account → 400 and nothing changes', async () => {
  // entries: [jpBank 1, b's account id] → 400 with details naming entries[1]; GET jpBank unchanged
})
it("leaves accounts that aren't in the PUT untouched", async () => { /* … */ })
it('defaults GET to the current cycle; bad cycle → 400', async () => { /* … */ })
```

Run → FAIL.

- [ ] **Step 2: Implement**

GET: `requireProfile`; parse `cycle` like `dashboard.ts`; `loadNetWorthInputs`; rows = active accounts (Japan then India, then type order bank, cash, fd, investment, card, then name) with `balanceAt`. PUT: parse; load the user's **active** accounts; any entry whose `accountId` is not among them → `ApiError(400, 'VALIDATION_FAILED', 'Unknown or archived account', [{ path: ['entries', i, 'accountId'] }])`; ₹ entries must be ≤ `PAISE_MAX`, ¥ entries ≤ `PG_INT_MAX` (400 otherwise, same details shape); upsert each with `onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.cycle], set: { balanceJpy, balanceInr, recordedOn, updatedAt: sql\`now()\` } })` where JP sets `balanceJpy` and `balanceInr: null`, IN sets `balanceInr: decimalFromPaise(amount)` and `balanceJpy: null`; `recordedOn = todayIn(profile.timezone)`. Respond with the GET body for that cycle. The request transaction makes it all-or-nothing.

- [ ] **Step 3: Verify** — tests PASS; `pnpm typecheck`.
- [ ] **Step 4: Commit** — `feat(api): review-day balances — prefilled GET, all-or-nothing PUT`.

---

### Task 5: Net-worth API

**Files:**
- Create: `packages/contracts/src/networth.ts`, `apps/api/src/routes/networth.ts`, `apps/api/test/networth.int.test.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 2 functions; `loadNetWorthInputs` (Task 4); `lastCycles`, `cycleRange`, `previousCycle`, `cycleBounds`, `cycleOf` (core).
- Produces:

```ts
export const NetWorthResponse = z.object({
  rate: z.string(), cycle: CycleString,
  current: z.object({ japanJpy: z.number().int(), indiaPaise: z.number().int(), combinedJpy: z.number().int(),
    changeJpy: z.number().int().nullable(), changePct: z.number().nullable() }),
  assets: z.object({ japanJpy: z.number().int(), indiaPaise: z.number().int() }),
  liabilities: z.object({ japanJpy: z.number().int(), indiaPaise: z.number().int() }),
  series: z.array(z.object({ cycle: CycleString, combinedJpy: z.number().int() })),
  accounts: z.array(z.object({
    accountId: z.uuid(), amount: z.number().int().nullable(), source: z.enum(['this', 'carried', 'none']),
    fromCycle: CycleString.nullable(), changeAmount: z.number().int().nullable(),   // own currency; vs previous cycle's balanceAt
  })),
  emergencyFund: z.object({ balanceJpy: z.number().int(), goalJpy: z.number().int().nullable(),
    monthsCovered: z.number().nullable(), avgSpendJpy: z.number().int().nullable() }),
})
export const NetWorthSpan = z.enum(['6', '12', 'all'])
```

`GET /api/networth?cycle=YYYY-MM&span=6|12|all` (defaults: current cycle, `12`).

- [ ] **Step 1: Failing tests** (`networth.int.test.ts`)

Fixture: profile rate `'1.7'`, start day 25; JP bank, JP card, IN bank (EF); balances for `2026-08`, `2026-09`, `2026-10`; three expenses in cycles `2026-07`..`2026-09` (insert via `withUser`).

```ts
it('returns current totals, change since last cycle, assets/liabilities and per-account rows', async () => { /* exact numbers */ })
it('series covers the span ending at cycle, starting no earlier than the first snapshot', async () => {
  // span=12 at 2026-10 → cycles ['2026-08','2026-09','2026-10'] only
})
it('emergency fund uses flagged non-card accounts and months covered from the 3 prior cycles since the first expense', async () => { /* … */ })
it('re-expresses the whole series at a new planning rate and reports it (Review Focus 5)', async () => {
  // PUT /api/me with planningRateJpyPerInr '2.0' → response.rate '2.0'; every series point recomputed
})
it('works with no accounts or no balances (zeros, empty series, null change)', async () => { /* … */ })
it('bad span or cycle → 400; no profile → 409', async () => { /* … */ })
```

Write the exact expected numbers from the fixture.

- [ ] **Step 2: Implement**

```ts
// routes/networth.ts (outline — write it fully)
const profile = await requireProfile(db, userId)
const cycle = parseCycleOrCurrent(c, profile)            // same rule as dashboard.ts
const span = NetWorthSpan.safeParse(c.req.query('span') ?? '12')  // 400 on failure
const rate = rateOut(profile.planningRateJpyPerInr)      // reuse the trimming from me.ts: move rateOut to services/profile.ts and import it in both
const { accounts, snaps } = await loadNetWorthInputs(db, userId, profile.cycleStartDay, profile.timezone)
const first = snaps.reduce<string | null>((m, s) => (m === null || s.cycle < m ? s.cycle : m), null)
const window = span === 'all' ? (first ? cycleRange(first, cycle) : []) : lastCycles(cycle, Number(span)).filter((c) => first !== null && c >= first)
const now = netWorthAt(accounts, snaps, cycle, rate)
const prevCycle = previousCycle(cycle)
const prev = first !== null && prevCycle >= first ? netWorthAt(accounts, snaps, prevCycle, rate).combinedJpy : null
// emergency fund: priorSpend = spend totals of the 3 cycles before `cycle` that are ≥ cycleOf(first expense date) (query min(occurred_on) and the sums with one grouped query)
```

Per-account `changeAmount` = `balanceAt(cycle).amount − balanceAt(previousCycle).amount` when both exist, else null.

- [ ] **Step 3: Verify** — PASS; `pnpm typecheck`.
- [ ] **Step 4: Commit** — `feat(api): net worth and emergency fund endpoint`.

---

### Task 6: M1 fix — editing an expense whose account was archived

**Files:**
- Modify: `apps/api/src/services/transactions.ts` (`updateTransaction`), `apps/web/src/pages/EditTransactionPage.vue`
- Test: `apps/api/test/transactions.int.test.ts` (append)

**Interfaces:**
- Consumes: `GET /api/accounts?include=archived` (Task 3).

- [ ] **Step 1: Failing test**

```ts
it('saves an edit when the unchanged account has since been archived; still refuses switching to an archived account', async () => {
  // create account X (POST /api/accounts), expense with accountId X, archive X (PATCH archived:true)
  // PATCH expense { description: 'new' } → 200
  // PATCH expense { accountId: X, description: 'again' } → 200   (the edit page sends the whole form)
  // create account Y, archive it; PATCH expense { accountId: Y } → 400
})
```

Run → FAIL on the second PATCH (current code re-checks any provided `accountId`).

- [ ] **Step 2: Implement** — `if (input.accountId !== undefined && input.accountId !== existing.accountId) await checkAccount(tx, userId, input.accountId)`.
Edit page: fetch `/api/accounts?include=archived` (query key `['accounts', 'all']`); options = active accounts plus the expense's current account if archived, titled `<name> (archived)`.

- [ ] **Step 3: Verify** — `pnpm --filter @nri/api test:int -- transactions` PASS; `pnpm --filter @nri/web test`; typecheck.
- [ ] **Step 4: Commit** — `fix: editing an expense keeps its archived account`.

---

### Task 7: Accounts screen + add/edit account + navigation

**Files:**
- Create: `apps/web/src/pages/AccountsPage.vue`, `apps/web/src/components/AccountDialog.vue`, `apps/web/src/components/NetWorthChart.vue`, `apps/web/src/lib/accounts.ts`, `apps/web/test/accounts.test.ts`, `apps/web/test/AccountsPage.test.ts`
- Modify: `apps/web/src/router.ts` (`/accounts`), `apps/web/src/App.vue` (sidebar item "Accounts" with `mdi-bank-outline` between Spend and Settings; phone "More" becomes a menu with Accounts and Settings), `apps/web/src/lib/charts.ts` (area-series builder)

**Interfaces:**
- Consumes: `GET /api/accounts?include=archived`, `POST/PATCH /api/accounts` (Task 3); `GET /api/networth` (Task 5); `PageHeader`, `app.css` utilities, `themeHex`-style colour resolution as in `DashboardPage.vue`, `lib/format.ts` (`yen`, `rupees`, `cycleLabel`).
- Produces (`lib/accounts.ts`, unit-tested):

```ts
export const TYPE_ORDER = ['bank', 'cash', 'fd', 'investment', 'card'] as const
export const TYPE_LABEL: Record<AccountType, string> = { bank: 'Bank', cash: 'Cash', fd: 'Fixed deposits', investment: 'Investments', card: 'Cards' }
export function groupByType<T extends { type: AccountType; name: string }>(rows: T[]): { type: AccountType; label: string; rows: T[] }[] // TYPE_ORDER, empty groups dropped, rows by name
export type ShowIn = 'JPY' | 'INR'
export function loadShowIn(): ShowIn          // localStorage 'nri.accounts.showIn', try/catch → 'JPY'
export function saveShowIn(v: ShowIn): void
export function inOtherCurrency(amount: number, currency: 'JPY' | 'INR', rate: string): number // yen→paise or paise→yen via core
```

Build (spec §4.1–4.2, mockup `<!-- ACCOUNTS (M2) -->`; translate its markup/CSS with theme tokens):
- Header: `PageHeader` "Accounts"; In ¥ / In ₹ segmented (`aria-pressed`, ripple off, persisted with `saveShowIn`); "Update balances" (→ `/accounts/balances`); primary "Add account" (`v-if="!xs"`; phones: button after the list).
- Net worth card: eyebrow "Net worth · Japan + India at ¥<rate> per ₹1"; total in the chosen currency; change with ↑/↓ + percent (`changePct === null` → "first cycle"); `NetWorthChart` (vue-chartjs Line with fill, theme colours, reactive like Dashboard's bar options) with 6 / 12 / All (`span` in the query key); text list of the series below (compact, keyboard reachable).
- Groups (`groupByType`): row = name, `JP`/`IN` tag, balance (own currency; other currency beneath), change, "updated <Mon YYYY>" when `source === 'carried'`, "No balance yet" when `none`, "Emergency fund" badge, card rows "owed"; ⋮ menu "More actions for <name>" → Edit, Archive.
- "Archived (n)" expansion with Unarchive per row.
- Summary card: Assets (Japan, India) / Liabilities (Cards) with Totals / Percent; Emergency fund block (balance "of <goal> goal", bar, "Covers <n> months of spending (3-cycle average ¥…)", pencil "Edit emergency-fund goal" → small dialog that PUTs `/api/me` with the full profile + goal; no goal → "Set a goal").
- Empty states per spec.
- `AccountDialog`: v-dialog (fullscreen on `xs`) — name (`#account-name`), country (JP/IN segmented; currency text derived; disabled with "This account has balances" when `hasBalances` in edit mode), type select (`aria-label="Account type"`), switch "Counts toward emergency fund"; Save / Cancel; API field errors shown on the fields; invalidates `['accounts']`, `['networth']`.

Tests: `accounts.test.ts` (groupByType order + dropping empties, loadShowIn fallback when storage throws, inOtherCurrency both ways); `AccountsPage.test.ts` mounts with mocked `apiFetch` responses (mock `src/lib/supabase`) and asserts: groups in order, a carried row shows "updated Sep 2026", card row shows "owed", per-row "More actions for <name>", empty state text with no accounts.

Acceptance: web unit tests pass (also with blank `VITE_SUPABASE_*`); typecheck/lint; screenshots `/accounts` 1280 + 390, light + dark (extend `scripts/ui-screens.mjs` page list), compared with the mockup Accounts view.

Commit: `feat(web): accounts screen with net worth and emergency fund`.

---

### Task 8: Update balances screen

**Files:**
- Create: `apps/web/src/pages/UpdateBalancesPage.vue`, `apps/web/src/lib/balancesForm.ts`, `apps/web/test/balancesForm.test.ts`
- Modify: `apps/web/src/router.ts` (`/accounts/balances`, before `/accounts/:…` if any)

**Interfaces:**
- Consumes: `GET/PUT /api/balances` (Task 4); `netWorthAt` from `@nri/core` for the live footer (map rows → `NwAccount` + `Snapshot` for the cycle).
- Produces (`lib/balancesForm.ts`, unit-tested):

```ts
export type FieldState = { accountId: string; text: string; initial: string; currency: 'JPY' | 'INR' }
export function toText(amount: number | null, currency: 'JPY' | 'INR'): string      // yen "500000", paise 1234567 → "12345.67"; null → ''
export function parseAmount(text: string, currency: 'JPY' | 'INR'): number | null | 'invalid' // '' → null; commas allowed; ¥ integer only; ₹ ≤ 2 decimals; negative → 'invalid'
export function changedEntries(fields: FieldState[], rows: BalanceRow[]): { accountId: string; amount: number }[]
// includes rows whose text changed OR whose source is 'carried'/'none' with a non-empty text (saving confirms carried values); skips empty
export function isDirty(fields: FieldState[]): boolean
```

Build (spec §4.3, mockup `<!-- UPDATE BALANCES (M2, BAL-1) -->`):
- Header: "Update balances", subtitle "Review day · cycle <Mon YYYY> (<range>)", cycle picker (‹ › with aria-labels "Previous cycle"/"Next cycle", same component style as Dashboard; `?cycle=` in the URL).
- Rows grouped Japan then India: label "Balance for <name>", input `inputmode="decimal"`, hint "from <Mon>" while carried and unchanged, "owed" suffix for cards, ₹ rows show "≈ ¥…" live; field errors from `parseAmount`.
- Sticky footer (above the phone bottom nav): "Net worth after saving ¥… ↑/↓ ¥… since last cycle" computed live; **Copy last cycle** (reset to initial); **Save balances** (PUT `changedEntries`; disabled while invalid or nothing to save; on success invalidate `['balances']`, `['networth']`, `['accounts']` and go to `/accounts` with snackbar "Balances saved for <Mon YYYY>").
- `onBeforeRouteLeave` confirm when `isDirty`.

Tests: `balancesForm.test.ts` covers toText/parseAmount (commas, `12,345.67`, `12.345` invalid for ₹, `1.5` invalid for ¥, negative invalid, blank), changedEntries (unchanged `this` rows skipped, carried rows included, blanks skipped), isDirty.

Acceptance: unit tests (also with blank env); screenshots `/accounts/balances` 1280 + 390 light + dark; footer never covers the last field on phones (viewport check, not fullPage).

Commit: `feat(web): review-day balance entry`.

---

### Task 9: Dashboard cards + Settings goal + import message

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.vue`, `apps/web/src/pages/SettingsPage.vue`, `apps/web/src/lib/profile.ts` if needed
- Test: `apps/web/test/DashboardPage.test.ts` (append), `apps/web/test/SettingsPage.test.ts` (append)

**Interfaces:**
- Consumes: `GET /api/networth?cycle=<dashboard cycle>&span=6` (Task 5); `Profile.emergencyFundGoalJpy`, `ImportResult.profileKept` (Task 1).

Build:
- Dashboard right column above Summary (phones: after KPIs): **Net worth** card (`data-testid="networth"` on the total; change with ↑/↓; "View accounts" link) and **Emergency fund** card (`data-testid="emergency-fund"`; "¥… of ¥… goal", bar using `success-accent`, months covered or "—"); with no balances (`series` empty) both show "Update balances to see this" linking to `/accounts/balances`.
- Settings Profile: number field "Emergency-fund goal (¥)" (`#ef-goal`, optional; empty → `null`), saved with the profile.
- Import result: append " Profile kept: settings from the file were not imported." when `profileKept`.

Tests: Dashboard mounts with networth mocked → shows the two cards' text; empty series → "Update balances to see this". Settings: goal field submits `emergencyFundGoalJpy` (number or null); import message includes the profile-kept sentence when `profileKept: true`.

Commit: `feat(web): net worth and emergency fund on the dashboard; goal in settings`.

---

### Task 10: E2E, screenshots, docs, full run

**Files:**
- Modify: `e2e/smoke.spec.ts`, `scripts/ui-screens.mjs`, `docs/checklist.md`, `docs/diagrams/nri-plan-overview.html`, `README.md`

- [ ] **Step 1: E2E** — laptop test: go to `/accounts`, "Add account" → name "e2e Wise", JP, bank → saved row visible; "Update balances" → fill "Balance for e2e Wise" with `100000`, Save → back on Accounts with "Balances saved for …" and the net-worth total contains `100,000` (the e2e user's other imported starter accounts have no balances); Dashboard shows `data-testid="networth"` with the same total. Phone test: bottom-nav "More" opens a menu with "Accounts"; it navigates to `/accounts`. Existing 4 tests unchanged.
- [ ] **Step 2: Screenshots** — `scripts/ui-screens.mjs` covers `/accounts` and `/accounts/balances` (seed: create two accounts and one cycle of balances for the throwaway user via the API). Run `pnpm ui:screens`; compare with the mockup; fix mismatches in the owning page.
- [ ] **Step 3: Docs** — checklist: ACC-1, BAL-1, BAL-2, EF-1, DASH-5, DASH-6 ✅; small-fixes queue "Import: warn when the profile already exists" ✅; M2 module row → "🟡 M2a done (accounts, balances, EF); M2b remittances next". Plan page WBS: mark the M2 accounts/balances items done (match the file's existing object format). README "Using the app": Accounts, Update balances, emergency fund.
- [ ] **Step 4: Full verification** — `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:scripts`, then `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= pnpm test:unit` (CI parity), then `pnpm stack:check` (integration + e2e), then `pnpm build:vercel` → all green.
- [ ] **Step 5: Commit** — `docs: M2a — checklist, plan page, README; e2e and screenshots for accounts`.
