# M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo with the calculation core, shared contracts, the full Postgres schema with row-level security, a Hono API (health, profile, v1 import) and a Vue sign-in shell, running locally against Supabase and deployable to Vercel.

**Architecture:** Vue 3 SPA (`apps/web`) and Hono API (`apps/api`) in one repo. The API verifies Supabase JWTs and runs every request in a Postgres transaction as role `authenticated` with the caller's claims, so RLS applies. Shared pure code lives in `packages/core` (calculations) and `packages/contracts` (zod schemas); `packages/db` holds the Drizzle schema, migrations and the request-scoped transaction helper. Production deploys use Vercel's Build Output API, produced by one build script.

**Tech Stack:** Node 22+, TypeScript strict, pnpm workspaces, Vue 3 + Vite + Vuetify 3 + Vue Router + TanStack Query, Hono + @hono/node-server, zod, Drizzle ORM + postgres.js + drizzle-kit, jose, Supabase CLI (local Postgres + Auth in Docker), Vitest, Playwright, esbuild, GitHub Actions.

**Spec:** `docs/prd.md` (requirement IDs) and `docs/trd.md` (technical design). This plan implements PRD §6.1–6.2 (AUTH-1..3, PROF-1, IMP-1..4) and TRD §1–§5.2, §8, §9, §10 for M0.

## Global Constraints

- Money: ¥ is an integer number of yen; ₹ is integer paise in TypeScript and JSON (field names end in `Paise`), `numeric(14,2)` in Postgres. No floating-point money except at the single v1-import boundary (`Math.round(x * 100)`).
- Rates are strings of up to 6 decimals, ¥ per ₹ (e.g. `"1.694915"`); arithmetic on them uses BigInt micro-units.
- Never call `toISOString()` to get a calendar date in app code; use `todayIn(timezone)` from `@nri/core`. Lint enforces this.
- Every API request after `auth` runs inside `withUser()` (role `authenticated` + JWT claims). Services still filter by `userId`.
- The browser never receives `DATABASE_URL`, the service-role key or the JWT secret. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are exposed to the web app.
- Cycle start day default 25, timezone default `Asia/Tokyo`, cycle label `YYYY-MM` = the month the cycle closes in.
- `v-html` is banned in Vue templates.
- Package names: `@nri/core`, `@nri/contracts`, `@nri/db`, `@nri/test-utils`, `@nri/api`, `@nri/web`. Workspace packages are consumed as TypeScript source (`"exports": "./src/index.ts"`); only the production build bundles.
- Error envelope: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with codes `VALIDATION_FAILED` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `DATABASE_UNAVAILABLE` (503), `INTERNAL` (500).
- The v1 app keeps working: it moves to `legacy/` with its own `package.json`, outside the pnpm workspace. `finance-data.json` (gitignored) stays at the repo root untouched.

## Review Focus

- A JWT signed by a different Supabase project, or for the wrong audience, must get 401, never a 500 or a silent pass — test in Task 9.
- A database that is down or paused (free tier pauses after 7 idle days) must produce 503 `DATABASE_UNAVAILABLE` with a readable message, not a 500 with a stack — test in Task 10.
- A malformed or non-JSON request body must produce 400 `VALIDATION_FAILED`, not 500 — test in Task 8.
- v1 rows with both `amountJPY` and `amountINR` equal to 0 must be skipped and counted, not crash the import or violate `amount_jpy > 0` — test in Task 11.
- When the web app gets a 401 (expired session) it must send the user to sign-in and come back to the same page afterwards — test in Task 13.

---

### Task 1: Workspace scaffold and move v1 to `legacy/`

**Files:**
- Move: `index.html`, `js/`, `tests/`, `scripts/`, `seed-data.json`, `package.json`, `package-lock.json` → `legacy/`
- Move: `nri-*.png`, `nri-*.html` → `docs/diagrams/`
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `eslint.config.js`, `.prettierrc.json`, `.gitignore` (modify)

**Interfaces:**
- Produces: root scripts `dev`, `typecheck`, `lint`, `test:unit`, `test:integration`, `test:env`, `db:generate`, `db:migrate`, `build:vercel`, `test:e2e` (later tasks fill in the commands they call).

- [ ] **Step 1: Move v1 and diagrams**

```bash
mkdir -p legacy docs/diagrams
git mv index.html js tests scripts seed-data.json package.json package-lock.json legacy/
mv nri-*.png nri-*.html docs/diagrams/
rm -rf node_modules
```

- [ ] **Step 2: Verify v1 still passes its own tests from `legacy/`**

Run: `cd legacy && npm install && node js/calc.test.js && node tests/app.test.js; cd ..`
Expected: `calc.test.js: … ALL PASS` and `tests/app.test.js: 16 checks — ALL PASS`

- [ ] **Step 3: Root workspace files**

`pnpm-workspace.yaml`
```yaml
packages:
  - apps/*
  - packages/*
```

`package.json`
```json
{
  "name": "nri-finance",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.10.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"pnpm --filter @nri/api dev\" \"pnpm --filter @nri/web dev\"",
    "typecheck": "pnpm -r run typecheck",
    "lint": "eslint .",
    "test:unit": "pnpm -r run test",
    "test:integration": "pnpm -r run test:int",
    "test:env": "node scripts/test-env.mjs",
    "db:generate": "pnpm --filter @nri/db generate",
    "db:migrate": "pnpm --filter @nri/db migrate",
    "build:vercel": "node scripts/vercel-build.mjs",
    "test:e2e": "playwright test"
  }
}
```

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

`.nvmrc`
```
22
```

`.prettierrc.json`
```json
{ "singleQuote": true, "semi": false, "printWidth": 110 }
```

`.gitignore` (replace contents)
```
node_modules/
.superpowers/
.DS_Store
finance-data.json
finance-backup-*.json
.env.local
.env*.local
dist/
.vercel/
playwright-report/
test-results/
supabase/.temp/
```

- [ ] **Step 4: Lint config**

Run: `pnpm add -Dw typescript @types/node eslint @eslint/js typescript-eslint eslint-plugin-vue vue-eslint-parser globals prettier concurrently`

`eslint.config.js`
```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['legacy/**', '**/dist/**', '.vercel/**', 'docs/**', 'supabase/**', 'packages/db/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='toISOString']",
          message: 'Use todayIn(timezone) or formatIsoDate from @nri/core; toISOString() returns the UTC date.',
        },
      ],
    },
  },
)
```

- [ ] **Step 5: Install and lint an empty workspace**

Run: `pnpm install && pnpm lint`
Expected: install succeeds; lint exits 0 (no files yet besides config).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: set up pnpm monorepo and move v1 app to legacy/"
```

---

### Task 2: `@nri/core` — cycles and local dates

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/cycles.ts`, `packages/core/test/cycles.test.ts`

**Interfaces:**
- Produces: `cycleOf(date: IsoDate, startDay?: number): Cycle`, `cycleBounds(cycle: Cycle, startDay?: number): { start: IsoDate; end: IsoDate }`, `todayIn(timeZone: string, now?: Date): IsoDate`, `formatIsoDate(y: number, m: number, d: number): IsoDate`, types `IsoDate = string`, `Cycle = string`.

- [ ] **Step 1: Package files**

`packages/core/package.json`
```json
{
  "name": "@nri/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" }
}
```

`packages/core/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm --filter @nri/core add -D vitest`

- [ ] **Step 2: Write the failing tests**

`packages/core/test/cycles.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { cycleBounds, cycleOf, formatIsoDate, todayIn } from '../src/index'

describe('cycleOf', () => {
  it('puts the 24th in the cycle closing that month', () => expect(cycleOf('2026-08-24')).toBe('2026-08'))
  it('puts the 25th in the next cycle', () => expect(cycleOf('2026-08-25')).toBe('2026-09'))
  it('rolls Dec 25 into January of the next year', () => expect(cycleOf('2026-12-25')).toBe('2027-01'))
  it('honours a custom start day', () => {
    expect(cycleOf('2026-09-05', 10)).toBe('2026-09')
    expect(cycleOf('2026-09-15', 10)).toBe('2026-10')
  })
  it('treats start day 1 as calendar-month cycles labeled by the next month', () =>
    expect(cycleOf('2026-09-05', 1)).toBe('2026-10'))
})

describe('cycleBounds', () => {
  it('returns 25th to 24th', () => expect(cycleBounds('2026-09')).toEqual({ start: '2026-08-25', end: '2026-09-24' }))
  it('crosses the year for January', () =>
    expect(cycleBounds('2027-01')).toEqual({ start: '2026-12-25', end: '2027-01-24' }))
  it('handles start day 1 (end = last day of previous month)', () =>
    expect(cycleBounds('2026-10', 1)).toEqual({ start: '2026-09-01', end: '2026-09-30' }))
  it('round-trips with cycleOf at both edges', () => {
    const { start, end } = cycleBounds('2026-03')
    expect(cycleOf(start)).toBe('2026-03')
    expect(cycleOf(end)).toBe('2026-03')
  })
})

describe('todayIn', () => {
  it('uses the local calendar date, not UTC', () => {
    const instant = new Date('2026-09-24T18:00:00Z') // 03:00 on the 25th in Tokyo
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-09-25')
    expect(todayIn('UTC', instant)).toBe('2026-09-24')
  })
})

describe('formatIsoDate', () => {
  it('normalises overflowing days', () => expect(formatIsoDate(2026, 10, 0)).toBe('2026-09-30'))
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @nri/core test`
Expected: FAIL — `Failed to resolve import "../src/index"`.

- [ ] **Step 4: Implement**

`packages/core/src/cycles.ts`
```ts
export type IsoDate = string
export type Cycle = string

const pad = (n: number) => String(n).padStart(2, '0')

/** Builds YYYY-MM-DD from calendar parts; day 0 or overflow rolls like Date.UTC. */
export function formatIsoDate(y: number, m: number, d: number): IsoDate {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function cycleOf(date: IsoDate, startDay = 25): Cycle {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  let year = y
  let month = m
  if (d >= startDay) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return `${year}-${pad(month)}`
}

export function cycleBounds(cycle: Cycle, startDay = 25): { start: IsoDate; end: IsoDate } {
  const [y, m] = cycle.split('-').map(Number) as [number, number]
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  return { start: formatIsoDate(prevY, prevM, startDay), end: formatIsoDate(y, m, startDay - 1) }
}

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
```

`packages/core/src/index.ts`
```ts
export * from './cycles'
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nri/core test && pnpm --filter @nri/core typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add billing cycles and local-date helpers"
```

---

### Task 3: `@nri/core` — money in minor units

**Files:**
- Create: `packages/core/src/money.ts`, `packages/core/test/money.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `parseRate(rate: string): bigint` (micro-units), `formatRate(micro: bigint): string`, `rateFromNumber(n: number): string`, `jpyFromInrPaise(paise: number, rate: string): number`, `inrPaiseFromJpy(jpy: number, rate: string): number`, `effectiveRate(jpySent: number, inrPaise: number): string`, `paiseFromDecimal(s: string): number`, `decimalFromPaise(p: number): string`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/money.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import {
  decimalFromPaise, effectiveRate, formatRate, inrPaiseFromJpy, jpyFromInrPaise, paiseFromDecimal, parseRate, rateFromNumber,
} from '../src/index'

describe('rates', () => {
  it('parses and formats 6-decimal rates exactly', () => {
    expect(parseRate('1.694915')).toBe(1_694_915n)
    expect(parseRate('2')).toBe(2_000_000n)
    expect(formatRate(1_694_915n)).toBe('1.694915')
  })
  it('rejects malformed rates', () => {
    expect(() => parseRate('1.2345678')).toThrow()
    expect(() => parseRate('-1')).toThrow()
    expect(() => parseRate('0')).toThrow()
  })
  it('rounds a float rate from v1 to 6 decimals', () => expect(rateFromNumber(1.694915254237288)).toBe('1.694915'))
})

describe('conversion', () => {
  it('converts ₹ paise to whole yen, half up', () => {
    expect(jpyFromInrPaise(1_000_00, '1.694915')).toBe(1695) // ₹1000 → ¥1694.915
    expect(jpyFromInrPaise(1_00, '2.5')).toBe(3) // ₹1 → ¥2.5 → 3
  })
  it('converts yen to ₹ paise, half up', () => {
    expect(inrPaiseFromJpy(1695, '1.694915')).toBe(1_000_05) // ₹1000.05
    expect(inrPaiseFromJpy(500, '2')).toBe(250_00)
  })
  it('computes the effective rate of a transfer', () => {
    expect(effectiveRate(50_000, 29_500_00)).toBe('1.694915')
  })
})

describe('decimal strings', () => {
  it('converts numeric strings from Postgres to paise and back', () => {
    expect(paiseFromDecimal('8006.00')).toBe(800_600)
    expect(paiseFromDecimal('555.19')).toBe(55_519)
    expect(paiseFromDecimal('12')).toBe(1_200)
    expect(paiseFromDecimal('0.5')).toBe(50)
    expect(decimalFromPaise(800_600)).toBe('8006.00')
    expect(decimalFromPaise(5)).toBe('0.05')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nri/core test`
Expected: FAIL — `parseRate is not exported`.

- [ ] **Step 3: Implement**

`packages/core/src/money.ts`
```ts
const MICRO = 1_000_000n

export function parseRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate)
  if (!m) throw new Error(`Invalid rate "${rate}": expected up to 6 decimals`)
  const micro = BigInt(m[1]!) * MICRO + BigInt((m[2] ?? '').padEnd(6, '0'))
  if (micro === 0n) throw new Error('Rate must be greater than zero')
  return micro
}

export function formatRate(micro: bigint): string {
  const whole = micro / MICRO
  const frac = (micro % MICRO).toString().padStart(6, '0')
  return `${whole}.${frac}`
}

export function rateFromNumber(n: number): string {
  return formatRate(BigInt(Math.round(n * 1_000_000)))
}

/** Half-up division for non-negative BigInts. */
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n)
}

export function jpyFromInrPaise(paise: number, rate: string): number {
  return Number(divRound(BigInt(paise) * parseRate(rate), 100n * MICRO))
}

export function inrPaiseFromJpy(jpy: number, rate: string): number {
  return Number(divRound(BigInt(jpy) * 100n * MICRO, parseRate(rate)))
}

export function effectiveRate(jpySent: number, inrPaise: number): string {
  return formatRate(divRound(BigInt(jpySent) * 100n * MICRO, BigInt(inrPaise)))
}

export function paiseFromDecimal(s: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) throw new Error(`Invalid amount "${s}"`)
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

export function decimalFromPaise(p: number): string {
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`
}
```

`packages/core/src/index.ts`
```ts
export * from './cycles'
export * from './money'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @nri/core test && pnpm --filter @nri/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add exact rate and minor-unit money conversions"
```

---

### Task 4: `@nri/contracts` — shared schemas

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/src/common.ts`, `packages/contracts/src/profile.ts`, `packages/contracts/src/importV1.ts`, `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces: `ErrorCode`, `ErrorBody`; `RateString`, `CycleString`, `IsoDateString`; `ProfileInput`, `Profile`, `MeResponse` (+ inferred types); `V1Document`, `ImportResult` (+ types).

- [ ] **Step 1: Package files**

`packages/contracts/package.json`
```json
{
  "name": "@nri/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" }
}
```
`packages/contracts/tsconfig.json`: same as core's.

Run: `pnpm --filter @nri/contracts add zod && pnpm --filter @nri/contracts add -D vitest`

- [ ] **Step 2: Write the failing tests**

`packages/contracts/test/contracts.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CycleString, ProfileInput, RateString, V1Document } from '../src/index'

describe('primitives', () => {
  it('accepts valid and rejects invalid cycles and rates', () => {
    expect(CycleString.safeParse('2026-09').success).toBe(true)
    expect(CycleString.safeParse('2026-13').success).toBe(false)
    expect(RateString.safeParse('1.694915').success).toBe(true)
    expect(RateString.safeParse('1.6949152').success).toBe(false)
  })
})

describe('ProfileInput', () => {
  it('accepts the workbook profile', () => {
    expect(
      ProfileInput.safeParse({ salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
        .success,
    ).toBe(true)
  })
  it('rejects a start day of 29 and fractional yen', () => {
    const base = { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
    expect(ProfileInput.safeParse({ ...base, cycleStartDay: 29 }).success).toBe(false)
    expect(ProfileInput.safeParse({ ...base, salaryJpy: 1.5 }).success).toBe(false)
  })
})

describe('V1Document', () => {
  it('parses the real v1 seed file', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../legacy/seed-data.json', import.meta.url), 'utf8'))
    const r = V1Document.safeParse(raw)
    expect(r.success).toBe(true)
    expect(r.success && r.data.transactions.length).toBe(57)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @nri/contracts test`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 4: Implement**

`packages/contracts/src/common.ts`
```ts
import { z } from 'zod'

export const ErrorCode = z.enum([
  'VALIDATION_FAILED', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'DATABASE_UNAVAILABLE', 'INTERNAL',
])
export type ErrorCode = z.infer<typeof ErrorCode>
export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
})
export type ErrorBody = z.infer<typeof ErrorBody>

export const CycleString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
export const IsoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
export const RateString = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Expected a rate with up to 6 decimals')
```

`packages/contracts/src/profile.ts`
```ts
import { z } from 'zod'
import { RateString } from './common'

export const ProfileInput = z.object({
  salaryJpy: z.number().int().nonnegative(),
  planningRateJpyPerInr: RateString,
  cycleStartDay: z.number().int().min(1).max(28),
  timezone: z.string().min(1).max(64),
})
export type ProfileInput = z.infer<typeof ProfileInput>
export const Profile = ProfileInput
export type Profile = z.infer<typeof Profile>

export const MeResponse = z.object({
  userId: z.string().uuid(),
  email: z.string().nullable(),
  profile: Profile.nullable(),
})
export type MeResponse = z.infer<typeof MeResponse>
```

`packages/contracts/src/importV1.ts`
```ts
import { z } from 'zod'

const V1Transaction = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string(),
  description: z.string().default(''),
  amountJPY: z.number().nonnegative().default(0),
  amountINR: z.number().nonnegative().default(0),
  paymentMethod: z.string().default('Cash'),
  needWant: z.string().default('Need'),
  notes: z.string().default(''),
})

export const V1Document = z.object({
  settings: z.object({
    salaryJPY: z.number().nonnegative(),
    jpyPerInr: z.number().positive(),
    cycleStartDay: z.number().int().min(1).max(28).default(25),
    emergencyFundTargetJPY: z.number().nonnegative().default(0),
    homeLoan: z.object({
      principalINR: z.number().nonnegative(),
      annualRatePct: z.number().nonnegative(),
      emiINR: z.number().nonnegative(),
      tenureMonths: z.number().int().nonnegative(),
      startCycle: z.string().regex(/^\d{4}-\d{2}$/),
    }),
    sip: z.object({
      startingMonthlyINR: z.number().nonnegative(),
      annualStepUpPct: z.number(),
      estimatedReturnPct: z.number(),
      allocation: z.record(z.string(), z.number()),
    }),
  }),
  categories: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  transactions: z.array(V1Transaction),
  cycleTargets: z
    .array(
      z.object({
        cycle: z.string(),
        savingsTargetJPY: z.number().optional(),
        emergencyFundTargetJPY: z.number().optional(),
        loanPrepaymentTargetINR: z.number().optional(),
      }),
    )
    .default([]),
  homeLoanExtras: z.array(z.object({ monthIndex: z.number().int(), extraPrepaymentINR: z.number() })).default([]),
})
export type V1Document = z.infer<typeof V1Document>

export const ImportCounts = z.object({
  categories: z.number().int(),
  accounts: z.number().int(),
  transactions: z.number().int(),
  remittances: z.number().int(),
  loans: z.number().int(),
  plannedPrepayments: z.number().int(),
  sipPlans: z.number().int(),
  cycleTargets: z.number().int(),
})
export const ImportResult = z.object({ inserted: ImportCounts, skippedRows: z.array(z.string()) })
export type ImportResult = z.infer<typeof ImportResult>
```

`packages/contracts/src/index.ts`
```ts
export * from './common'
export * from './profile'
export * from './importV1'
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nri/contracts test && pnpm --filter @nri/contracts typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add shared zod schemas for profile, errors and v1 import"
```

---

### Task 5: Local Supabase and environment file

**Files:**
- Create: `supabase/` (via CLI), `scripts/test-env.mjs`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `.env.local` at the repo root with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Every later integration test and the dev server read it.

- [ ] **Step 1: Install CLI and initialise**

Run: `pnpm add -Dw supabase && pnpm exec supabase init`
Expected: `supabase/config.toml` created.

- [ ] **Step 2: Close sign-ups (AUTH-3)**

In `supabase/config.toml`, set under `[auth]`: `enable_signup = false`, and under `[auth.email]`: `enable_signup = false`. (Users are created with the admin API; that still works with sign-up closed.)

- [ ] **Step 3: Write the env script**

`scripts/test-env.mjs`
```js
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const raw = execSync('pnpm exec supabase status -o env', { encoding: 'utf8' })
const env = Object.fromEntries(
  raw
    .split('\n')
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const out = {
  SUPABASE_URL: env.API_URL,
  SUPABASE_ANON_KEY: env.ANON_KEY ?? env.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY ?? env.SECRET_KEY,
  SUPABASE_JWT_SECRET: env.JWT_SECRET,
  DATABASE_URL: env.DB_URL,
  VITE_SUPABASE_URL: env.API_URL,
  VITE_SUPABASE_ANON_KEY: env.ANON_KEY ?? env.PUBLISHABLE_KEY,
}
for (const [k, v] of Object.entries(out)) if (!v) throw new Error(`supabase status did not report ${k}`)
writeFileSync('.env.local', Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
console.log('wrote .env.local')
```

- [ ] **Step 4: Start and generate**

Run: `pnpm exec supabase start && pnpm test:env && cat .env.local | cut -d= -f1`
Expected: Supabase containers start; `.env.local` lists the 7 keys.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/.gitignore scripts/test-env.mjs package.json pnpm-lock.yaml
git commit -m "chore: add local Supabase with sign-ups disabled and env generator"
```

---

### Task 6: `@nri/db` — schema and migrations

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/migrations/*` (generated), `packages/db/migrations/<n>_rls.sql` (custom)

**Interfaces:**
- Produces: Drizzle tables `profiles, accounts, categories, transactions, remittances, balanceSnapshots, categoryBudgets, cycleTargets, loans, loanPlannedPrepayments, sipPlans, sipAllocations` and enums; `schema` namespace export.

- [ ] **Step 1: Package files**

`packages/db/package.json`
```json
{
  "name": "@nri/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "test:int": "vitest run"
  }
}
```
`packages/db/tsconfig.json`: same as core's.

Run: `pnpm --filter @nri/db add drizzle-orm postgres @nri/contracts@workspace:* && pnpm --filter @nri/db add -D drizzle-kit vitest`

`packages/db/drizzle.config.ts`
```ts
import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Local runs read the generated .env.local; CI and production pass DATABASE_URL explicitly.
if (!process.env.DATABASE_URL && existsSync('../../.env.local')) process.loadEnvFile('../../.env.local')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
```

- [ ] **Step 2: Schema**

`packages/db/src/schema.ts`
```ts
import { sql } from 'drizzle-orm'
import {
  boolean, char, check, date, index, integer, numeric, pgEnum, pgTable, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

export const country = pgEnum('country', ['JP', 'IN'])
export const currency = pgEnum('currency', ['JPY', 'INR'])
export const accountType = pgEnum('account_type', ['bank', 'cash', 'card', 'fd', 'investment'])
export const paymentMethod = pgEnum('payment_method', ['bank', 'cash', 'credit_card', 'ic_card'])
export const needWant = pgEnum('need_want', ['need', 'want'])
export const remittancePurpose = pgEnum('remittance_purpose', [
  'family', 'india_savings', 'sip', 'loan_emi', 'loan_prepayment', 'other',
])

const inr = (name: string) => numeric(name, { precision: 14, scale: 2 })
const rate = (name: string) => numeric(name, { precision: 12, scale: 6 })
const cycle = (name: string) => char(name, { length: 7 })
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}
const owned = {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  ...stamps,
}
const cycleCheck = (col: string) => sql.raw(`${col} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`)

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  salaryJpy: integer('salary_jpy').notNull(),
  planningRateJpyPerInr: rate('planning_rate_jpy_per_inr').notNull(),
  cycleStartDay: smallint('cycle_start_day').notNull().default(25),
  timezone: text('timezone').notNull().default('Asia/Tokyo'),
  ...stamps,
}, (t) => [check('profiles_start_day', sql`${t.cycleStartDay} between 1 and 28`)])

export const accounts = pgTable('accounts', {
  ...owned,
  name: text('name').notNull(),
  country: country('country').notNull(),
  currency: currency('currency').notNull(),
  type: accountType('type').notNull(),
  isEmergencyFund: boolean('is_emergency_fund').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('accounts_legacy').on(t.userId, t.legacyId),
  check('accounts_country_currency', sql`(${t.country} = 'JP') = (${t.currency} = 'JPY')`),
])

export const categories = pgTable('categories', {
  ...owned,
  name: text('name').notNull(),
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [unique('categories_legacy').on(t.userId, t.legacyId)])

export const loans = pgTable('loans', {
  ...owned,
  name: text('name').notNull(),
  principalInr: inr('principal_inr').notNull(),
  annualRatePct: numeric('annual_rate_pct', { precision: 6, scale: 3 }).notNull(),
  emiInr: inr('emi_inr').notNull(),
  tenureMonths: smallint('tenure_months').notNull(),
  startCycle: cycle('start_cycle').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [unique('loans_legacy').on(t.userId, t.legacyId), check('loans_start_cycle', cycleCheck('start_cycle'))])

export const transactions = pgTable('transactions', {
  ...owned,
  occurredOn: date('occurred_on').notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  accountId: uuid('account_id').references(() => accounts.id),
  description: text('description').notNull().default(''),
  amountJpy: integer('amount_jpy').notNull(),
  enteredCurrency: currency('entered_currency').notNull().default('JPY'),
  amountInr: inr('amount_inr'),
  rateUsed: rate('rate_used'),
  paymentMethod: paymentMethod('payment_method').notNull(),
  needWant: needWant('need_want').notNull(),
  notes: text('notes').notNull().default(''),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('transactions_legacy').on(t.userId, t.legacyId),
  check('transactions_amount_positive', sql`${t.amountJpy} > 0`),
  index('transactions_user_date').on(t.userId, t.occurredOn.desc()),
  index('transactions_user_category').on(t.userId, t.categoryId),
])

export const remittances = pgTable('remittances', {
  ...owned,
  sentOn: date('sent_on').notNull(),
  jpySent: integer('jpy_sent').notNull(),
  inrReceived: inr('inr_received').notNull(),
  feeJpy: integer('fee_jpy').notNull().default(0),
  service: text('service').notNull().default(''),
  fromAccountId: uuid('from_account_id').references(() => accounts.id),
  toAccountId: uuid('to_account_id').references(() => accounts.id),
  purpose: remittancePurpose('purpose').notNull(),
  loanId: uuid('loan_id').references(() => loans.id),
  notes: text('notes').notNull().default(''),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('remittances_legacy').on(t.userId, t.legacyId),
  check('remittances_amounts', sql`${t.jpySent} > 0 and ${t.inrReceived} > 0 and ${t.feeJpy} >= 0`),
  check('remittances_loan_link', sql`(${t.purpose} in ('loan_emi','loan_prepayment')) = (${t.loanId} is not null)`),
  index('remittances_user_date').on(t.userId, t.sentOn.desc()),
])

export const balanceSnapshots = pgTable('balance_snapshots', {
  ...owned,
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  cycle: cycle('cycle').notNull(),
  balanceJpy: integer('balance_jpy'),
  balanceInr: inr('balance_inr'),
  recordedOn: date('recorded_on').notNull(),
}, (t) => [
  unique('balance_snapshots_account_cycle').on(t.accountId, t.cycle),
  check('balance_snapshots_one_amount', sql`(${t.balanceJpy} is null) <> (${t.balanceInr} is null)`),
  check('balance_snapshots_cycle', cycleCheck('cycle')),
])

export const categoryBudgets = pgTable('category_budgets', {
  ...owned,
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  amountJpy: integer('amount_jpy').notNull(),
  effectiveFromCycle: cycle('effective_from_cycle').notNull(),
}, (t) => [
  unique('category_budgets_from').on(t.categoryId, t.effectiveFromCycle),
  check('category_budgets_amount', sql`${t.amountJpy} >= 0`),
  check('category_budgets_cycle', cycleCheck('effective_from_cycle')),
])

export const cycleTargets = pgTable('cycle_targets', {
  ...owned,
  cycle: cycle('cycle').notNull(),
  savingsTargetJpy: integer('savings_target_jpy'),
  emergencyFundTargetJpy: integer('emergency_fund_target_jpy'),
  remittanceTargetJpy: integer('remittance_target_jpy'),
  prepaymentTargetInr: inr('prepayment_target_inr'),
}, (t) => [unique('cycle_targets_cycle').on(t.userId, t.cycle), check('cycle_targets_cycle', cycleCheck('cycle'))])

export const loanPlannedPrepayments = pgTable('loan_planned_prepayments', {
  ...owned,
  loanId: uuid('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  monthIndex: smallint('month_index').notNull(),
  amountInr: inr('amount_inr').notNull(),
}, (t) => [
  unique('loan_planned_prepayments_month').on(t.loanId, t.monthIndex),
  check('loan_planned_prepayments_values', sql`${t.monthIndex} >= 1 and ${t.amountInr} > 0`),
])

export const sipPlans = pgTable('sip_plans', {
  ...owned,
  startingMonthlyInr: inr('starting_monthly_inr').notNull(),
  stepUpPct: numeric('step_up_pct', { precision: 5, scale: 2 }).notNull(),
  expectedReturnPct: numeric('expected_return_pct', { precision: 5, scale: 2 }).notNull(),
  startYear: smallint('start_year').notNull(),
  endYear: smallint('end_year').notNull(),
  redirectEmiAfterPayoff: boolean('redirect_emi_after_payoff').notNull().default(true),
}, (t) => [unique('sip_plans_user').on(t.userId)])

export const sipAllocations = pgTable('sip_allocations', {
  ...owned,
  planId: uuid('plan_id').notNull().references(() => sipPlans.id, { onDelete: 'cascade' }),
  fundName: text('fund_name').notNull(),
  pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),
}, (t) => [check('sip_allocations_pct', sql`${t.pct} > 0 and ${t.pct} <= 100`)])

export const OWNED_TABLES = [
  'profiles', 'accounts', 'categories', 'loans', 'transactions', 'remittances', 'balance_snapshots',
  'category_budgets', 'cycle_targets', 'loan_planned_prepayments', 'sip_plans', 'sip_allocations',
] as const
```

`packages/db/src/index.ts`
```ts
export * as schema from './schema'
export * from './schema'
```

- [ ] **Step 3: Generate the table migration**

Run: `pnpm --filter @nri/db exec drizzle-kit generate --name init`
Expected: `packages/db/migrations/0000_init.sql` with `CREATE TYPE` and `CREATE TABLE` statements for all 12 tables.

- [ ] **Step 4: Custom migration for auth FKs, case-insensitive category names, `updated_at` and RLS**

Run: `pnpm --filter @nri/db exec drizzle-kit generate --custom --name rls`
Then fill `packages/db/migrations/0001_rls.sql`:
```sql
create unique index categories_user_name on categories (user_id, lower(name));

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','categories','loans','transactions','remittances',
    'balance_snapshots','category_budgets','cycle_targets','loan_planned_prepayments','sip_plans','sip_allocations']
  loop
    execute format('alter table %I add constraint %I foreign key (user_id) references auth.users(id) on delete cascade', t, t || '_user_fk');
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy own_rows on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
```

- [ ] **Step 5: Apply and inspect**

Run: `pnpm db:migrate && psql "$(grep ^DATABASE_URL .env.local | cut -d= -f2-)" -c "select tablename, rowsecurity from pg_tables where schemaname='public' order by 1"`
Expected: 12 rows, all `rowsecurity = t`.
(If `psql` is not installed, run: `docker exec -i $(docker ps -qf name=supabase_db) psql -U postgres -c "<same query>"`.)

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): add schema for all 12 tables with RLS, auth FKs and updated_at triggers"
```

---

### Task 7: Request-scoped transactions and RLS isolation test

**Files:**
- Create: `packages/test-utils/package.json`, `packages/test-utils/src/index.ts`, `packages/db/src/client.ts`, `packages/db/vitest.config.ts`, `packages/db/test/setup.ts`, `packages/db/test/rls.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: tables from Task 6; `.env.local` from Task 5.
- Produces: `createDb(url: string): { db: Db; close(): Promise<void> }`, `withUser<T>(db: Db, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T>`, types `Db`, `Tx`, `Claims = { sub: string; [k: string]: unknown }`. Test utils: `createTestUser(prefix?): Promise<{ id: string; email: string; password: string; accessToken: string }>`, `deleteTestUser(id): Promise<void>`.

- [ ] **Step 1: Test utilities (Supabase Auth admin API over fetch)**

`packages/test-utils/package.json`
```json
{ "name": "@nri/test-utils", "version": "0.0.0", "private": true, "type": "module", "exports": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" } }
```
Add `packages/test-utils/tsconfig.json` (same as core's).

`packages/test-utils/src/index.ts`
```ts
import { randomUUID } from 'node:crypto'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing — run "pnpm test:env" with Supabase running`)
  return v
}

export type TestUser = { id: string; email: string; password: string; accessToken: string }

export async function createTestUser(prefix = 'test'): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@example.test`
  const password = `pw-${randomUUID()}`
  const admin = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!admin.ok) throw new Error(`create user failed: ${admin.status} ${await admin.text()}`)
  const { id } = (await admin.json()) as { id: string }
  const token = await fetch(`${env('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!token.ok) throw new Error(`sign in failed: ${token.status} ${await token.text()}`)
  const { access_token } = (await token.json()) as { access_token: string }
  return { id, email, password, accessToken: access_token }
}

export async function deleteTestUser(id: string): Promise<void> {
  await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
  })
}
```

Run: `pnpm install && pnpm --filter @nri/db add -D @nri/test-utils@workspace:*`

- [ ] **Step 2: Write the failing RLS test**

`packages/db/vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { setupFiles: ['./test/setup.ts'], testTimeout: 20_000 } })
```

`packages/db/test/setup.ts`
```ts
import { fileURLToPath } from 'node:url'
process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
```

`packages/db/test/rls.test.ts`
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { categories, createDb, withUser } from '../src/index'

const { db, close } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser

beforeAll(async () => {
  a = await createTestUser('rls-a')
  b = await createTestUser('rls-b')
})
afterAll(async () => {
  await deleteTestUser(a.id)
  await deleteTestUser(b.id)
  await close()
})

describe('withUser + RLS', () => {
  it('runs as role authenticated with the caller as auth.uid()', async () => {
    const row = await withUser(db, { sub: a.id, role: 'authenticated' }, (tx) =>
      tx.execute(sql`select current_user as role, auth.uid() as uid`),
    )
    expect(row[0]).toMatchObject({ role: 'authenticated', uid: a.id })
  })

  it('lets a user read their own rows but never another user’s', async () => {
    await withUser(db, { sub: a.id }, (tx) =>
      tx.insert(categories).values({ userId: a.id, name: 'Groceries', color: '#4caf50' }),
    )
    const seenByA = await withUser(db, { sub: a.id }, (tx) => tx.select().from(categories))
    const seenByB = await withUser(db, { sub: b.id }, (tx) => tx.select().from(categories))
    expect(seenByA.map((c) => c.name)).toContain('Groceries')
    expect(seenByB).toHaveLength(0)
  })

  it('blocks writing a row owned by someone else', async () => {
    await expect(
      withUser(db, { sub: b.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'Sneaky', color: '#000' })),
    ).rejects.toThrow(/row-level security/)
  })

  it('blocks updating another user’s row (zero rows affected)', async () => {
    const updated = await withUser(db, { sub: b.id }, (tx) =>
      tx.update(categories).set({ name: 'Hijacked' }).where(eq(categories.userId, a.id)).returning(),
    )
    expect(updated).toHaveLength(0)
  })

  it('rejects a duplicate category name ignoring case', async () => {
    await expect(
      withUser(db, { sub: a.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'groceries', color: '#111' })),
    ).rejects.toThrow(/categories_user_name/)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @nri/db test:int`
Expected: FAIL — `createDb` / `withUser` not exported.

- [ ] **Step 4: Implement the client**

`packages/db/src/client.ts`
```ts
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Claims = { sub: string; [k: string]: unknown }

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // prepare:false is required by Supabase's transaction-mode pooler.
  const client = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 })
  return { db: drizzle(client, { schema }), close: () => client.end() }
}

export function withUser<T>(db: Db, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`)
    await tx.execute(sql`set local role authenticated`)
    return fn(tx)
  })
}
```

`packages/db/src/index.ts`
```ts
export * as schema from './schema'
export * from './schema'
export * from './client'
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nri/db test:int && pnpm --filter @nri/db typecheck`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/test-utils packages/db pnpm-lock.yaml
git commit -m "feat(db): add withUser transaction helper with RLS isolation tests"
```

---

### Task 8: `@nri/api` — app skeleton, errors, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/errors.ts`, `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/test/app.test.ts`

**Interfaces:**
- Produces: `class ApiError(status, code, message, details?)`; `loadConfig(env): Config` with `{ supabaseUrl, jwtSecret?, databaseUrl }`; `createApp(deps: AppDeps): Hono` where `AppDeps = { config: Config; getDb: () => Db }`; `parseJson(c, schema)` helper for bodies; routes registered under `/api`.

- [ ] **Step 1: Package files**

`apps/api/package.json`
```json
{
  "name": "@nri/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env.local src/dev.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:int": "vitest run --project int"
  }
}
```
`apps/api/tsconfig.json`: same as core's.

Run: `pnpm --filter @nri/api add hono @hono/node-server jose zod @nri/core@workspace:* @nri/contracts@workspace:* @nri/db@workspace:* drizzle-orm && pnpm --filter @nri/api add -D vitest tsx @nri/test-utils@workspace:*`

`apps/api/vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] } },
      { test: { name: 'int', include: ['test/**/*.int.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 20_000 } },
    ],
  },
})
```

`apps/api/test/setup.ts`
```ts
import { fileURLToPath } from 'node:url'
process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/app.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { createApp } from '../src/app'
import { parseJson, toErrorResponse } from '../src/errors'

const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 'x'.repeat(32), databaseUrl: 'postgres://unused' }
const app = createApp({ config, getDb: () => { throw new Error('no db in unit tests') } })

// parseJson is exercised on a bare app so these tests keep passing once auth guards /api/* (Task 9).
const echo = new Hono()
echo.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
echo.post('/echo', async (c) => c.json(await parseJson(c, z.object({ n: z.number() }))))

describe('api skeleton', () => {
  it('GET /api/health returns ok without auth', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown routes return the error envelope with 404', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No route for GET /nope' } })
  })

  it('a non-JSON body returns 400 VALIDATION_FAILED, not 500', async () => {
    const res = await echo.request('/echo', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('a body failing the schema returns 400 with zod issues', async () => {
    const res = await echo.request('/echo', {
      method: 'POST', body: JSON.stringify({ n: 'one' }), headers: { 'content-type': 'application/json' },
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details[0].path).toEqual(['n'])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @nri/api test`
Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 4: Implement**

`apps/api/src/errors.ts`
```ts
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'
import type { ErrorCode } from '@nri/contracts'

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON')
  }
  const r = schema.safeParse(raw)
  if (!r.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body is invalid', r.error.issues)
  return r.data
}

const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', '57P01', '57P03'])

export function toErrorResponse(err: unknown): { status: ContentfulStatusCode; body: object } {
  if (err instanceof ApiError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return { status: err.status, body: { error } }
  }
  const code = (err as { code?: string } | null)?.code ?? (err as { cause?: { code?: string } })?.cause?.code
  if (code && DB_DOWN_CODES.has(code)) {
    return {
      status: 503,
      body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is not reachable right now (it may be waking up). Try again in a minute.' } },
    }
  }
  console.error(err)
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server' } } }
}
```

`apps/api/src/config.ts`
```ts
export type Config = { supabaseUrl: string; jwtSecret?: string; databaseUrl: string }

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL
  const databaseUrl = env.DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('SUPABASE_URL and DATABASE_URL must be set')
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), databaseUrl, jwtSecret: env.SUPABASE_JWT_SECRET || undefined }
}
```

`apps/api/src/app.ts`
```ts
import { Hono } from 'hono'
import type { Db } from '@nri/db'
import type { Config } from './config'
import { toErrorResponse } from './errors'

export type AppDeps = { config: Config; getDb: () => Db }

export function createApp(deps: AppDeps) {
  const app = new Hono()

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err)
    return c.json(body, status)
  })
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  )

  app.get('/api/health', (c) => c.json({ ok: true }))

  void deps // routes using deps are added in Tasks 9–11
  return app
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nri/api test && pnpm --filter @nri/api typecheck`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add Hono app skeleton with error envelope and health route"
```

---

### Task 9: Auth middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/auth.int.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `ApiError`, `Config`.
- Produces: `type AuthVars = { userId: string; email: string | null; claims: Claims }`; `authMiddleware(config): MiddlewareHandler<{ Variables: AuthVars }>`; `createApp` applies it to `/api/*` except `/api/health`; test-only route `GET /api/_whoami` is NOT added to the app — tests mount their own.

- [ ] **Step 1: Write the failing unit test (HS256, local-style tokens)**

`apps/api/test/auth.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'
import { toErrorResponse } from '../src/errors'

const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 's'.repeat(40), databaseUrl: 'x' }
const issuer = `${config.supabaseUrl}/auth/v1`

function app() {
  const a = new Hono<{ Variables: AuthVars }>()
  a.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
  a.use('/api/*', authMiddleware(config))
  a.get('/api/whoami', (c) => c.json({ userId: c.var.userId, email: c.var.email }))
  return a
}

async function token(over: { secret?: string; iss?: string; aud?: string; exp?: string; sub?: string } = {}) {
  return new SignJWT({ email: 'me@example.test', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(over.sub ?? '11111111-1111-1111-1111-111111111111')
    .setIssuer(over.iss ?? issuer)
    .setAudience(over.aud ?? 'authenticated')
    .setExpirationTime(over.exp ?? '5m')
    .sign(new TextEncoder().encode(over.secret ?? config.jwtSecret))
}

const call = async (auth?: string) => app().request('/api/whoami', { headers: auth ? { authorization: auth } : {} })

describe('authMiddleware', () => {
  it('accepts a valid token and exposes userId and email', async () => {
    const res = await call(`Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: '11111111-1111-1111-1111-111111111111', email: 'me@example.test' })
  })
  it('rejects a missing header', async () => expect((await call()).status).toBe(401))
  it('rejects a token signed with another project’s secret', async () =>
    expect((await call(`Bearer ${await token({ secret: 'z'.repeat(40) })}`)).status).toBe(401))
  it('rejects the wrong issuer', async () =>
    expect((await call(`Bearer ${await token({ iss: 'https://other.supabase.co/auth/v1' })}`)).status).toBe(401))
  it('rejects the wrong audience (e.g. anon)', async () =>
    expect((await call(`Bearer ${await token({ aud: 'anon' })}`)).status).toBe(401))
  it('rejects an expired token with a readable message', async () => {
    const res = await call(`Bearer ${await token({ exp: '-1m' })}`)
    expect(res.status).toBe(401)
    expect((await res.json()).error.message).toMatch(/sign in again/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nri/api test`
Expected: FAIL — cannot resolve `../src/middleware/auth`.

- [ ] **Step 3: Implement**

`apps/api/src/middleware/auth.ts`
```ts
import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Claims } from '@nri/db'
import type { Config } from '../config'
import { ApiError } from '../errors'

export type AuthVars = { userId: string; email: string | null; claims: Claims }

export function authMiddleware(config: Config) {
  const issuer = `${config.supabaseUrl}/auth/v1`
  // Local Supabase signs with HS256 + JWT secret; hosted projects publish asymmetric keys at the JWKS URL.
  const key: Uint8Array | JWTVerifyGetKey = config.jwtSecret
    ? new TextEncoder().encode(config.jwtSecret)
    : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

  return createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const match = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')
    if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required')
    let claims: Claims
    try {
      const { payload } = await jwtVerify(match[1]!, key as Uint8Array, { issuer, audience: 'authenticated' })
      if (!payload.sub) throw new Error('token has no subject')
      claims = payload as Claims
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired or is invalid. Please sign in again.')
    }
    c.set('claims', claims)
    c.set('userId', claims.sub)
    c.set('email', typeof claims.email === 'string' ? claims.email : null)
    await next()
  })
}
```

In `apps/api/src/app.ts`, change `new Hono()` to `new Hono<{ Variables: AuthVars }>()` and after the health route add:
```ts
  const auth = authMiddleware(deps.config)
  app.use('/api/*', async (c, next) => (c.req.path === '/api/health' ? next() : auth(c, next)))
```
(with `import { authMiddleware, type AuthVars } from './middleware/auth'`).

- [ ] **Step 4: Integration test with a real local Supabase token**

`apps/api/test/auth.int.test.ts`
```ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { loadConfig } from '../src/config'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'

let user: TestUser
beforeAll(async () => { user = await createTestUser('auth') })
afterAll(async () => { await deleteTestUser(user.id) })

it('accepts a token issued by local Supabase Auth', async () => {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('/api/*', authMiddleware(loadConfig(process.env)))
  app.get('/api/whoami', (c) => c.json({ userId: c.var.userId }))
  const res = await app.request('/api/whoami', { headers: { authorization: `Bearer ${user.accessToken}` } })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ userId: user.id })
})
```

- [ ] **Step 5: Run to verify all pass**

Run: `pnpm --filter @nri/api test && pnpm --filter @nri/api test:int && pnpm --filter @nri/api typecheck`
Expected: all unit and integration tests PASS; the Task 8 health test still passes (health skips auth).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): verify Supabase JWTs (HS256 locally, JWKS in production)"
```

---

### Task 10: DB middleware and `/api/me`

**Files:**
- Create: `apps/api/src/middleware/db.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/helpers.ts`, `apps/api/test/me.int.test.ts`, `apps/api/test/dbdown.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `withUser`, `profiles`, `ProfileInput`, `MeResponse`, `parseJson`.
- Produces: `type AppVars = AuthVars & { db: Tx }`; `dbMiddleware(getDb)`; `GET /api/me` → `MeResponse`; `PUT /api/me` (body `ProfileInput`) → `MeResponse`. Test helper `testApp()` returning `{ app, close }` wired to `.env.local`.

- [ ] **Step 1: Write the failing integration tests**

`apps/api/test/helpers.ts`
```ts
import { createDb } from '@nri/db'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config'

export function testApp() {
  const config = loadConfig(process.env)
  const { db, close } = createDb(config.databaseUrl)
  return { app: createApp({ config, getDb: () => db }), close }
}

export const json = (token: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
```

`apps/api/test/me.int.test.ts`
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
const profile = { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }

beforeAll(async () => { a = await createTestUser('me-a'); b = await createTestUser('me-b') })
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('/api/me', () => {
  it('returns profile null before one is saved', async () => {
    const res = await app.request('/api/me', json(a.accessToken, 'GET'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: a.id, email: a.email, profile: null })
  })

  it('saves and returns the profile, rate kept exact', async () => {
    const put = await app.request('/api/me', json(a.accessToken, 'PUT', profile))
    expect(put.status).toBe(200)
    expect((await put.json()).profile).toEqual(profile)
    const again = await app.request('/api/me', json(a.accessToken, 'PUT', { ...profile, salaryJpy: 700000 }))
    expect((await again.json()).profile.salaryJpy).toBe(700000)
  })

  it('never shows one user’s profile to another', async () => {
    const res = await app.request('/api/me', json(b.accessToken, 'GET'))
    expect((await res.json()).profile).toBeNull()
  })

  it('rejects an invalid profile with 400 and does not write', async () => {
    const res = await app.request('/api/me', json(b.accessToken, 'PUT', { ...profile, cycleStartDay: 31 }))
    expect(res.status).toBe(400)
    expect((await (await app.request('/api/me', json(b.accessToken, 'GET'))).json()).profile).toBeNull()
  })
})
```

`apps/api/test/dbdown.test.ts`
```ts
import { expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { createDb } from '@nri/db'
import { createApp } from '../src/app'

it('returns 503 DATABASE_UNAVAILABLE when Postgres is unreachable', async () => {
  const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 's'.repeat(40), databaseUrl: 'postgres://u:p@127.0.0.1:1/x' }
  const { db, close } = createDb(config.databaseUrl)
  const app = createApp({ config, getDb: () => db })
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuer(`${config.supabaseUrl}/auth/v1`).setAudience('authenticated').setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.jwtSecret))
  const res = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
  expect(res.status).toBe(503)
  expect((await res.json()).error.code).toBe('DATABASE_UNAVAILABLE')
  await close()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @nri/api test && pnpm --filter @nri/api test:int`
Expected: FAIL — `/api/me` returns 404.

- [ ] **Step 3: Implement the db middleware**

`apps/api/src/middleware/db.ts`
```ts
import { createMiddleware } from 'hono/factory'
import { withUser, type Db, type Tx } from '@nri/db'
import type { AuthVars } from './auth'

export type AppVars = AuthVars & { db: Tx }
const ROLLBACK = Symbol('rollback')

/** Runs the rest of the request in one transaction as the caller; rolls back if the handler failed. */
export function dbMiddleware(getDb: () => Db) {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    try {
      await withUser(getDb(), c.var.claims, async (tx) => {
        c.set('db', tx)
        await next()
        if (c.error) throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
  })
}
```

- [ ] **Step 4: Implement the route**

`apps/api/src/routes/me.ts`
```ts
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { MeResponse, ProfileInput, type Profile } from '@nri/contracts'
import { profiles } from '@nri/db'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'

type Row = typeof profiles.$inferSelect
// numeric(12,6) comes back as "1.694915"; trim trailing zeros but keep at least one decimal digit.
const rateOut = (s: string) => s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '.0')
const toProfile = (r: Row): Profile => ({
  salaryJpy: r.salaryJpy,
  planningRateJpyPerInr: rateOut(r.planningRateJpyPerInr),
  cycleStartDay: r.cycleStartDay,
  timezone: r.timezone,
})

export const meRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const [row] = await c.var.db.select().from(profiles).where(eq(profiles.userId, c.var.userId))
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: row ? toProfile(row) : null }))
  })
  .put('/', async (c) => {
    const input = await parseJson(c, ProfileInput)
    const values = { userId: c.var.userId, ...input }
    const [row] = await c.var.db
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({ target: profiles.userId, set: { ...input } })
      .returning()
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: toProfile(row!) }))
  })
```

Note: with `rateOut`, `'1.694915'` stays `'1.694915'`, `'2.000000'` becomes `'2.0'`, which still satisfies `RateString`.

In `apps/api/src/app.ts`: type the app as `Hono<{ Variables: AppVars }>`, and after the auth `use`, add:
```ts
  const db = dbMiddleware(deps.getDb)
  app.use('/api/*', async (c, next) => (c.req.path === '/api/health' ? next() : db(c, next)))
  app.route('/api/me', meRoutes)
```
Remove the `void deps` line.

- [ ] **Step 5: Run to verify all pass**

Run: `pnpm --filter @nri/api test && pnpm --filter @nri/api test:int && pnpm --filter @nri/api typecheck`
Expected: all PASS, including 503 for the unreachable database.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add per-request RLS transaction and /api/me profile routes (PROF-1)"
```

---

### Task 11: v1 import (`POST /api/import/v1`)

**Files:**
- Create: `apps/api/src/services/importV1.ts`, `apps/api/src/routes/import.ts`, `apps/api/test/import.int.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `V1Document`, `ImportResult`, core money helpers, all db tables.
- Produces: `importV1(tx: Tx, userId: string, doc: V1Document): Promise<ImportResult>`; route `POST /api/import/v1` (body `V1Document`) → `ImportResult`.

Mapping rules (PRD IMP-1..4):
- Profile: insert if absent (never overwrite an existing profile): `salaryJpy = round(salaryJPY)`, `planningRateJpyPerInr = rateFromNumber(jpyPerInr)`, `cycleStartDay`, timezone `Asia/Tokyo`.
- Accounts (legacy ids `starter-jp-bank`, `starter-jp-emergency`, `starter-in-bank`): "Japan bank" JP/JPY/bank; "Japan emergency fund" JP/JPY/bank/`isEmergencyFund`; "India bank" IN/INR/bank.
- Categories: every v1 category except `family-india`; `legacyId = v1 id`, `sortOrder = index`.
- Transactions in `family-india` → remittances, purpose `family`, from Japan bank → India bank, `jpySent = amountJPY` if > 0 else converted from ₹; `inrReceived = amountINR` if > 0 else converted from ¥. Both zero → skipped.
- Other transactions → `amountJpy = round(amountJPY)` if > 0; else if `amountINR > 0`: `enteredCurrency INR`, `amountInr`, `rateUsed = planning rate`, `amountJpy` converted. Both zero → skipped. Payment `Bank/Cash/Credit Card/IC Card` → `bank/cash/credit_card/ic_card` (unknown → `cash`); need/want lower-cased (unknown → `need`). Unknown category id → skipped.
- Loan (legacy id `v1-home-loan`) named "Home loan"; planned prepayments from `homeLoanExtras` with amount > 0.
- SIP plan: start 2027, end 2036; allocations only when the plan was newly inserted, skipping 0% funds.
- Cycle targets: `savingsTargetJPY`, `emergencyFundTargetJPY`, `loanPrepaymentTargetINR` → matching columns, insert if absent.
- Every insert uses `onConflictDoNothing`; `inserted` counts only newly created rows.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/import.int.test.ts`
```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const seed = JSON.parse(readFileSync(new URL('../../../legacy/seed-data.json', import.meta.url), 'utf8'))
const familyRows = seed.transactions.filter((t: { categoryId: string }) => t.categoryId === 'family-india')
const { app, close } = testApp()
let u: TestUser

beforeAll(async () => { u = await createTestUser('import') })
afterAll(async () => { await deleteTestUser(u.id); await close() })

describe('POST /api/import/v1', () => {
  it('imports the v1 seed: family rows become remittances, the rest transactions', async () => {
    const res = await app.request('/api/import/v1', json(u.accessToken, 'POST', seed))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inserted.remittances).toBe(familyRows.length)
    expect(body.inserted.transactions + body.inserted.remittances + body.skippedRows.length).toBe(57)
    expect(body.inserted.accounts).toBe(3)
    expect(body.inserted.loans).toBe(1)
    expect(body.inserted.sipPlans).toBe(1)
    expect(body.inserted.categories).toBe(seed.categories.length - 1) // family-india is not a spending category
  })

  it('creates the profile from v1 settings', async () => {
    const me = await (await app.request('/api/me', json(u.accessToken, 'GET'))).json()
    expect(me.profile).toEqual({ salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
  })

  it('is idempotent: a second import inserts nothing', async () => {
    const body = await (await app.request('/api/import/v1', json(u.accessToken, 'POST', seed))).json()
    expect(Object.values(body.inserted).every((n) => n === 0)).toBe(true)
  })

  it('skips rows with no amount instead of failing', async () => {
    const other = await createTestUser('import-zero')
    const doc = {
      ...seed,
      transactions: [{ id: 'zero-1', date: '2026-09-01', categoryId: 'groceries', description: 'empty', amountJPY: 0, amountINR: 0 }],
    }
    const body = await (await app.request('/api/import/v1', json(other.accessToken, 'POST', doc))).json()
    expect(body.inserted.transactions).toBe(0)
    expect(body.skippedRows).toEqual(['zero-1: no amount'])
    await deleteTestUser(other.id)
  })

  it('rejects a document that is not a v1 export', async () => {
    const res = await app.request('/api/import/v1', json(u.accessToken, 'POST', { hello: 'world' }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nri/api test:int`
Expected: FAIL — `/api/import/v1` returns 404.

- [ ] **Step 3: Implement the service**

`apps/api/src/services/importV1.ts`
```ts
import { and, eq, inArray } from 'drizzle-orm'
import { decimalFromPaise, inrPaiseFromJpy, jpyFromInrPaise, rateFromNumber } from '@nri/core'
import type { ImportResult, V1Document } from '@nri/contracts'
import {
  accounts, categories, cycleTargets, loanPlannedPrepayments, loans, profiles, remittances, sipAllocations, sipPlans,
  transactions, type Tx,
} from '@nri/db'

const PAYMENT: Record<string, 'bank' | 'cash' | 'credit_card' | 'ic_card'> = {
  bank: 'bank', cash: 'cash', 'credit card': 'credit_card', 'ic card': 'ic_card',
}
const paise = (n: number) => Math.round(n * 100) // only floating-point money conversion in the app (v1 boundary)
const inr = (n: number) => decimalFromPaise(paise(n))

export async function importV1(tx: Tx, userId: string, doc: V1Document): Promise<ImportResult> {
  const rate = rateFromNumber(doc.settings.jpyPerInr)
  const skippedRows: string[] = []
  const inserted = { categories: 0, accounts: 0, transactions: 0, remittances: 0, loans: 0, plannedPrepayments: 0, sipPlans: 0, cycleTargets: 0 }

  await tx.insert(profiles).values({
    userId,
    salaryJpy: Math.round(doc.settings.salaryJPY),
    planningRateJpyPerInr: rate,
    cycleStartDay: doc.settings.cycleStartDay,
    timezone: 'Asia/Tokyo',
  }).onConflictDoNothing()

  const starter = [
    { legacyId: 'starter-jp-bank', name: 'Japan bank', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false },
    { legacyId: 'starter-jp-emergency', name: 'Japan emergency fund', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: true },
    { legacyId: 'starter-in-bank', name: 'India bank', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false },
  ] as const
  inserted.accounts = (await tx.insert(accounts).values(starter.map((a) => ({ ...a, userId }))).onConflictDoNothing().returning({ id: accounts.id })).length
  const acc = Object.fromEntries(
    (await tx.select({ id: accounts.id, legacyId: accounts.legacyId }).from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.legacyId, starter.map((a) => a.legacyId))))).map((r) => [r.legacyId, r.id]),
  )

  const cats = doc.categories.filter((c) => c.id !== 'family-india')
  if (cats.length) {
    inserted.categories = (await tx.insert(categories)
      .values(cats.map((c, i) => ({ userId, name: c.name, color: c.color, sortOrder: i, legacyId: c.id })))
      .onConflictDoNothing().returning({ id: categories.id })).length
  }
  const catIds = Object.fromEntries(
    (await tx.select({ id: categories.id, legacyId: categories.legacyId }).from(categories)
      .where(eq(categories.userId, userId))).map((r) => [r.legacyId, r.id]),
  )

  const h = doc.settings.homeLoan
  inserted.loans = (await tx.insert(loans).values({
    userId, legacyId: 'v1-home-loan', name: 'Home loan', principalInr: inr(h.principalINR),
    annualRatePct: h.annualRatePct.toFixed(3), emiInr: inr(h.emiINR), tenureMonths: h.tenureMonths, startCycle: h.startCycle,
  }).onConflictDoNothing().returning({ id: loans.id })).length
  const [loan] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.userId, userId), eq(loans.legacyId, 'v1-home-loan')))
  const extras = doc.homeLoanExtras.filter((e) => e.extraPrepaymentINR > 0 && e.monthIndex >= 1)
  if (loan && extras.length) {
    inserted.plannedPrepayments = (await tx.insert(loanPlannedPrepayments)
      .values(extras.map((e) => ({ userId, loanId: loan.id, monthIndex: e.monthIndex, amountInr: inr(e.extraPrepaymentINR) })))
      .onConflictDoNothing().returning({ id: loanPlannedPrepayments.id })).length
  }

  const s = doc.settings.sip
  const newPlan = await tx.insert(sipPlans).values({
    userId, startingMonthlyInr: inr(s.startingMonthlyINR), stepUpPct: s.annualStepUpPct.toFixed(2),
    expectedReturnPct: s.estimatedReturnPct.toFixed(2), startYear: 2027, endYear: 2036,
  }).onConflictDoNothing().returning({ id: sipPlans.id })
  inserted.sipPlans = newPlan.length
  const allocations = Object.entries(s.allocation).filter(([, pct]) => pct > 0)
  if (newPlan[0] && allocations.length) {
    await tx.insert(sipAllocations).values(
      allocations.map(([fundName, pct]) => ({ userId, planId: newPlan[0]!.id, fundName, pct: pct.toFixed(2) })),
    )
  }

  if (doc.cycleTargets.length) {
    inserted.cycleTargets = (await tx.insert(cycleTargets).values(doc.cycleTargets.map((t) => ({
      userId, cycle: t.cycle,
      savingsTargetJpy: t.savingsTargetJPY ?? null,
      emergencyFundTargetJpy: t.emergencyFundTargetJPY ?? null,
      prepaymentTargetInr: t.loanPrepaymentTargetINR != null ? inr(t.loanPrepaymentTargetINR) : null,
    }))).onConflictDoNothing().returning({ id: cycleTargets.id })).length
  }

  const txnRows: (typeof transactions.$inferInsert)[] = []
  const remRows: (typeof remittances.$inferInsert)[] = []
  for (const t of doc.transactions) {
    const jpy = Math.round(t.amountJPY)
    const inrPaise = paise(t.amountINR)
    if (jpy <= 0 && inrPaise <= 0) { skippedRows.push(`${t.id}: no amount`); continue }
    if (t.categoryId === 'family-india') {
      const jpySent = jpy > 0 ? jpy : jpyFromInrPaise(inrPaise, rate)
      const received = inrPaise > 0 ? inrPaise : inrPaiseFromJpy(jpy, rate)
      remRows.push({
        userId, legacyId: t.id, sentOn: t.date, jpySent, inrReceived: decimalFromPaise(received), purpose: 'family',
        fromAccountId: acc['starter-jp-bank'], toAccountId: acc['starter-in-bank'],
        notes: [t.description, t.notes].filter(Boolean).join(' — '),
      })
      continue
    }
    const categoryId = catIds[t.categoryId]
    if (!categoryId) { skippedRows.push(`${t.id}: unknown category ${t.categoryId}`); continue }
    const enteredInINR = jpy <= 0
    txnRows.push({
      userId, legacyId: t.id, occurredOn: t.date, categoryId, description: t.description,
      amountJpy: enteredInINR ? jpyFromInrPaise(inrPaise, rate) : jpy,
      enteredCurrency: enteredInINR ? 'INR' : 'JPY',
      amountInr: enteredInINR ? decimalFromPaise(inrPaise) : null,
      rateUsed: enteredInINR ? rate : null,
      paymentMethod: PAYMENT[t.paymentMethod.toLowerCase()] ?? 'cash',
      needWant: t.needWant.toLowerCase() === 'want' ? 'want' : 'need',
      notes: t.notes,
    })
  }
  if (txnRows.length) inserted.transactions = (await tx.insert(transactions).values(txnRows).onConflictDoNothing().returning({ id: transactions.id })).length
  if (remRows.length) inserted.remittances = (await tx.insert(remittances).values(remRows).onConflictDoNothing().returning({ id: remittances.id })).length

  return { inserted, skippedRows }
}
```

- [ ] **Step 4: Implement the route**

`apps/api/src/routes/import.ts`
```ts
import { Hono } from 'hono'
import { ImportResult, V1Document } from '@nri/contracts'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { importV1 } from '../services/importV1'

export const importRoutes = new Hono<{ Variables: AppVars }>().post('/v1', async (c) => {
  const doc = await parseJson(c, V1Document)
  return c.json(ImportResult.parse(await importV1(c.var.db, c.var.userId, doc)))
})
```

In `apps/api/src/app.ts` add `app.route('/api/import', importRoutes)`.

- [ ] **Step 5: Run to verify all pass**

Run: `pnpm --filter @nri/api test:int && pnpm --filter @nri/api typecheck`
Expected: 5 import tests PASS plus earlier suites.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): import v1 finance-data.json idempotently (IMP-1..4)"
```

---

### Task 12: Local dev server

**Files:**
- Create: `apps/api/src/dev.ts`, `apps/api/src/vercel.ts`

**Interfaces:**
- Produces: `pnpm --filter @nri/api dev` serving the API on `http://localhost:8787`; `apps/api/src/vercel.ts` default-exporting a Node `(req, res)` handler (used in Task 14).

- [ ] **Step 1: Implement**

`apps/api/src/dev.ts`
```ts
import { serve } from '@hono/node-server'
import { createDb } from '@nri/db'
import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig(process.env)
const { db } = createDb(config.databaseUrl)
serve({ fetch: createApp({ config, getDb: () => db }).fetch, port: 8787 }, (info) =>
  console.log(`api on http://localhost:${info.port}`),
)
```

`apps/api/src/vercel.ts`
```ts
import { handle } from '@hono/node-server/vercel'
import { createDb, type Db } from '@nri/db'
import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig(process.env)
let db: Db | undefined // created on first request, reused while the function instance stays warm
const getDb = () => (db ??= createDb(config.databaseUrl).db)

export default handle(createApp({ config, getDb }))
```

- [ ] **Step 2: Verify**

Run: `(pnpm --filter @nri/api dev &) ; sleep 4 ; curl -s localhost:8787/api/health ; curl -s localhost:8787/api/me ; pkill -f "src/dev.ts"`
Expected: `{"ok":true}` then `{"error":{"code":"UNAUTHORIZED","message":"Sign in required"}}`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/dev.ts apps/api/src/vercel.ts
git commit -m "feat(api): add local dev server and Vercel handler entry"
```

---

### Task 13: `@nri/web` — Vue shell, sign-in, profile and import

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/App.vue`, `apps/web/src/env.d.ts`, `apps/web/src/lib/supabase.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/router.ts`, `apps/web/src/pages/LoginPage.vue`, `apps/web/src/pages/HomePage.vue`, `apps/web/src/pages/SettingsPage.vue`, `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes: `/api/me` (GET/PUT), `/api/import/v1`; `MeResponse`, `ProfileInput`, `ImportResult`, `V1Document` from `@nri/contracts`; `formatJpy` is not needed yet.
- Produces: `apiFetch<T>(path, init?, schema?)` that attaches the token, parses errors into `ApiRequestError { status, code, message }`, and on 401 calls the registered `onUnauthorized` handler; router guard that sends signed-out users to `/login?next=<path>` and returns them to `next` after sign-in (AUTH-2).

- [ ] **Step 1: Scaffold and install**

`apps/web/package.json`
```json
{
  "name": "@nri/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vue-tsc --noEmit && vite build", "typecheck": "vue-tsc --noEmit", "test": "vitest run" }
}
```

Run:
```bash
pnpm install
pnpm --filter @nri/web add vue vue-router vuetify @mdi/font @tanstack/vue-query @supabase/supabase-js zod @nri/contracts@workspace:* @nri/core@workspace:*
pnpm --filter @nri/web add -D vite @vitejs/plugin-vue vite-plugin-vuetify vue-tsc vitest jsdom @vue/test-utils
```

`apps/web/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["vite/client", "node"], "jsx": "preserve", "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`
```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [vue(), vuetify({ autoImport: true })],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'jsdom' },
})
```

`apps/web/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>NRI Finance</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/web/src/env.d.ts`
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_SUPABASE_URL: string; readonly VITE_SUPABASE_ANON_KEY: string }
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent
  export default c
}
```

- [ ] **Step 2: Write the failing API-client test**

`apps/web/test/api.test.ts`
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))
import { ApiRequestError, apiFetch, setOnUnauthorized } from '../src/lib/api'

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('sends the bearer token and returns parsed JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await apiFetch('/api/health')).toEqual({ ok: true })
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    expect(headers.get('authorization')).toBe('Bearer tok-123')
  })

  it('turns the error envelope into ApiRequestError', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Bad input' } }), { status: 400 }))
    await expect(apiFetch('/api/me')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', message: 'Bad input' })
  })

  it('calls the unauthorized handler on 401 (expired session)', async () => {
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again' } }), { status: 401 }))
    await expect(apiFetch('/api/me')).rejects.toBeInstanceOf(ApiRequestError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @nri/web test`
Expected: FAIL — cannot resolve `../src/lib/api`.

- [ ] **Step 4: Implement the libraries**

`apps/web/src/lib/supabase.ts`
```ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
```

`apps/web/src/lib/api.ts`
```ts
import type { ZodType } from 'zod'
import { supabase } from './supabase'

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
  }
}

let onUnauthorized: () => void = () => {}
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn }

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}, schema?: ZodType<T>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (data.session) headers.set('authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) onUnauthorized()
    const err = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `Request failed (${res.status})`, err?.details)
  }
  return schema ? schema.parse(body) : (body as T)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nri/web test`
Expected: 3 tests PASS.

- [ ] **Step 6: App, router and pages**

`apps/web/src/router.ts`
```ts
import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from './lib/supabase'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/', component: () => import('./pages/HomePage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const { data } = await supabase.auth.getSession()
  return data.session ? true : { path: '/login', query: { next: to.fullPath } }
})
```

`apps/web/src/main.ts`
```ts
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { setOnUnauthorized } from './lib/api'

setOnUnauthorized(() => {
  const next = router.currentRoute.value.fullPath
  if (router.currentRoute.value.path !== '/login') void router.push({ path: '/login', query: { next } })
})

createApp(App)
  .use(router)
  .use(VueQueryPlugin)
  .use(createVuetify({ theme: { defaultTheme: 'light' } }))
  .mount('#app')
```

`apps/web/src/App.vue`
```vue
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { supabase } from './lib/supabase'

const route = useRoute()
const router = useRouter()
async function signOut() {
  await supabase.auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <v-app>
    <v-app-bar v-if="!route.meta.public" density="comfortable" title="NRI Finance">
      <v-btn to="/" variant="text">Home</v-btn>
      <v-btn to="/settings" variant="text">Settings</v-btn>
      <v-btn variant="text" @click="signOut">Sign out</v-btn>
    </v-app-bar>
    <v-main>
      <v-container class="py-6" style="max-width: 760px">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
```

`apps/web/src/pages/LoginPage.vue`
```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const route = useRoute()
const router = useRouter()

async function submit() {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  busy.value = false
  if (e) { error.value = 'Email or password is incorrect.'; return }
  await router.replace(typeof route.query.next === 'string' ? route.query.next : '/')
}
</script>

<template>
  <v-card class="mx-auto mt-12" max-width="420">
    <v-card-title>Sign in</v-card-title>
    <v-card-text>
      <v-form @submit.prevent="submit">
        <v-text-field id="email" v-model="email" label="Email" type="email" autocomplete="username" required />
        <v-text-field id="password" v-model="password" label="Password" type="password" autocomplete="current-password" required />
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
        <v-btn type="submit" color="primary" block :loading="busy">Sign in</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>
```

`apps/web/src/pages/HomePage.vue`
```vue
<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { MeResponse } from '@nri/contracts'
import { apiFetch } from '../lib/api'

const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/api/me', {}, MeResponse) })
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
</script>

<template>
  <h1 class="text-h5 mb-4">Welcome</h1>
  <v-progress-linear v-if="me.isLoading.value" indeterminate />
  <v-alert v-else-if="me.error.value" type="error" variant="tonal">{{ me.error.value.message }}</v-alert>
  <template v-else-if="me.data.value">
    <p class="mb-4">Signed in as {{ me.data.value.email }}</p>
    <v-card v-if="me.data.value.profile">
      <v-card-text>
        <div data-testid="salary">Salary: {{ yen(me.data.value.profile.salaryJpy) }} / month</div>
        <div>Cycle starts on day {{ me.data.value.profile.cycleStartDay }} ({{ me.data.value.profile.timezone }})</div>
        <div>Planning rate: ¥{{ me.data.value.profile.planningRateJpyPerInr }} per ₹1</div>
      </v-card-text>
    </v-card>
    <v-alert v-else type="info" variant="tonal">
      No profile yet. Go to <router-link to="/settings">Settings</router-link> to import your v1 data or enter it.
    </v-alert>
  </template>
</template>
```

`apps/web/src/pages/SettingsPage.vue`
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ImportResult, MeResponse, ProfileInput, V1Document } from '@nri/contracts'
import { apiFetch } from '../lib/api'

const qc = useQueryClient()
const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/api/me', {}, MeResponse) })
const form = ref({ salaryJpy: 0, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
watch(() => me.data.value?.profile, (p) => { if (p) form.value = { ...p } }, { immediate: true })
const formError = ref('')

const save = useMutation({
  mutationFn: (body: ProfileInput) => apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(body) }, MeResponse),
  onSuccess: (data) => qc.setQueryData(['me'], data),
})
function submitProfile() {
  const parsed = ProfileInput.safeParse({ ...form.value, salaryJpy: Number(form.value.salaryJpy), cycleStartDay: Number(form.value.cycleStartDay) })
  formError.value = parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  if (parsed.success) save.mutate(parsed.data)
}

const importMessage = ref('')
const runImport = useMutation({
  mutationFn: (doc: V1Document) => apiFetch('/api/import/v1', { method: 'POST', body: JSON.stringify(doc) }, ImportResult),
  onSuccess: (r) => {
    const i = r.inserted
    importMessage.value = `Imported ${i.transactions} transactions, ${i.remittances} remittances, ${i.categories} categories, ${i.accounts} accounts.` +
      (r.skippedRows.length ? ` Skipped ${r.skippedRows.length}: ${r.skippedRows.join(', ')}` : '')
    void qc.invalidateQueries({ queryKey: ['me'] })
  },
})
async function onFile(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files
  if (!file) return
  const parsed = V1Document.safeParse(JSON.parse(await file.text()))
  if (!parsed.success) { importMessage.value = 'That file is not a v1 finance-data.json export.'; return }
  runImport.mutate(parsed.data)
}
</script>

<template>
  <h1 class="text-h5 mb-4">Settings</h1>
  <v-card class="mb-6">
    <v-card-title>Profile</v-card-title>
    <v-card-text>
      <v-form @submit.prevent="submitProfile">
        <v-text-field id="salary" v-model.number="form.salaryJpy" label="Monthly salary (¥)" type="number" />
        <v-text-field id="rate" v-model="form.planningRateJpyPerInr" label="Planning rate (¥ per ₹1)" />
        <v-text-field id="start-day" v-model.number="form.cycleStartDay" label="Cycle start day" type="number" />
        <v-text-field id="timezone" v-model="form.timezone" label="Timezone" />
        <v-alert v-if="formError || save.error.value" type="error" variant="tonal" class="mb-4">
          {{ formError || save.error.value?.message }}
        </v-alert>
        <v-btn type="submit" color="primary" :loading="save.isPending.value">Save profile</v-btn>
        <span v-if="save.isSuccess.value" class="ml-3">Saved</span>
      </v-form>
    </v-card-text>
  </v-card>
  <v-card>
    <v-card-title>Import from v1</v-card-title>
    <v-card-text>
      <p class="mb-3">Choose your <code>finance-data.json</code>. Importing twice does not create duplicates.</p>
      <v-file-input id="import-file" label="finance-data.json" accept="application/json" @update:model-value="onFile" />
      <v-alert v-if="importMessage" type="success" variant="tonal">{{ importMessage }}</v-alert>
      <v-alert v-if="runImport.error.value" type="error" variant="tonal">{{ runImport.error.value.message }}</v-alert>
    </v-card-text>
  </v-card>
</template>
```

- [ ] **Step 7: Verify it builds and typechecks**

Run: `pnpm --filter @nri/web typecheck && pnpm --filter @nri/web build && pnpm lint`
Expected: no type errors; `apps/web/dist/index.html` exists; lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add Vue shell with sign-in, profile settings and v1 import (AUTH-1,2, PROF-1)"
```

---

### Task 14: Vercel build output

**Files:**
- Create: `scripts/vercel-build.mjs`, `vercel.json`

**Interfaces:**
- Consumes: `apps/web` build, `apps/api/src/vercel.ts`.
- Produces: `.vercel/output/` in Build Output API v3 format: `static/` (web), `functions/api.func/` (bundled API), `config.json` (routes + security headers).

- [ ] **Step 1: Implement**

Run: `pnpm add -Dw esbuild`

`scripts/vercel-build.mjs`
```js
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = '.vercel/output'
rmSync(out, { recursive: true, force: true })

execSync('pnpm --filter @nri/web build', { stdio: 'inherit' })
cpSync('apps/web/dist', `${out}/static`, { recursive: true })

const fn = `${out}/functions/api.func`
mkdirSync(fn, { recursive: true })
await build({
  entryPoints: ['apps/api/src/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: `${fn}/index.mjs`,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }))
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs' }))

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
const headers = {
  'Content-Security-Policy': `default-src 'self'; connect-src 'self' ${supabaseUrl}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
}
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers, continue: true },
    { src: '/api/(.*)', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2))
console.log('Vercel build output written to', out)
```

`vercel.json`
```json
{ "buildCommand": "pnpm build:vercel", "installCommand": "pnpm install --frozen-lockfile", "framework": null }
```

- [ ] **Step 2: Verify the output**

Run: `pnpm build:vercel && ls .vercel/output/static/index.html .vercel/output/functions/api.func/index.mjs && SUPABASE_URL=http://x DATABASE_URL=postgres://x node -e "import('./.vercel/output/functions/api.func/index.mjs').then(m => console.log(typeof m.default))"`
Expected: both files listed; prints `function`.

- [ ] **Step 3: Commit**

```bash
git add scripts/vercel-build.mjs vercel.json package.json pnpm-lock.yaml
git commit -m "build: produce Vercel Build Output (static web + bundled API function)"
```

---

### Task 15: End-to-end smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: running `pnpm dev`, `createTestUser`.
- Produces: `pnpm test:e2e` that signs in on a phone-sized viewport, imports the v1 seed, and sees the salary on Home.

- [ ] **Step 1: Install**

Run: `pnpm add -Dw @playwright/test`
(Uses the installed Google Chrome via `channel: 'chrome'`; no browser download needed.)

`playwright.config.ts`
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5173', ...devices['Pixel 7'], channel: 'chrome' },
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
})
```

`e2e/global-setup.ts`
```ts
import { writeFileSync } from 'node:fs'
import { createTestUser } from '@nri/test-utils'

export default async function globalSetup() {
  process.loadEnvFile('.env.local')
  const user = await createTestUser('e2e')
  writeFileSync('.e2e-user.json', JSON.stringify(user))
}
```
Run `pnpm add -Dw @nri/test-utils@workspace:*` and add `.e2e-user.json` to `.gitignore` (Playwright clears `test-results/` at the start of each run, so the file can't live there).

`e2e/smoke.spec.ts`
```ts
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const user = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { email: string; password: string }

test('sign in, import v1 data, see the profile', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/settings$/) // returned to where the guard stopped us (AUTH-2)

  await page.locator('#import-file').setInputFiles('legacy/seed-data.json')
  await expect(page.getByText(/Imported \d+ transactions/)).toBeVisible()

  await page.getByRole('link', { name: 'Home' }).click()
  await expect(page.getByTestId('salary')).toHaveText('Salary: ¥500,000 / month')
})
```

- [ ] **Step 2: Run**

Run: `pnpm test:e2e`
Expected: 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts e2e package.json pnpm-lock.yaml .gitignore
git commit -m "test: add Playwright smoke test for sign-in and v1 import on a phone viewport"
```

---

### Task 16: CI and GitHub repository

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI on every push and pull request running typecheck, lint, unit, integration tests.

- [ ] **Step 1: Workflow**

`.github/workflows/ci.yml`
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm exec supabase start
      - run: pnpm test:env
      - run: pnpm db:migrate
      - run: pnpm test:integration
```

- [ ] **Step 2: Full local run of everything CI runs**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run typecheck, lint, unit and integration tests on GitHub Actions"
```

- [ ] **Step 4: Create the private repository and push — ASK THE USER FIRST**

This publishes code to GitHub. Confirm with the user, then:
```bash
gh repo create nri-finance --private --source . --remote origin --push
gh run watch --exit-status
```
Expected: CI run passes.

---

### Task 17: Cloud setup and first deploy (with the user)

Steps that need the user's accounts are marked **USER**. No code changes except possibly fixes found by the smoke checks.

- [ ] **Step 1 (USER): Supabase project.** Create a project named `nri-finance` in the Tokyo region (`ap-northeast-1`). In Authentication → Sign In / Providers, turn off "Allow new users to sign up". In Authentication → Users, add your user (email + password, auto-confirm). Copy: Project URL, anon/publishable key, and the **transaction pooler** connection string (port 6543) from Connect.

- [ ] **Step 2: Apply migrations to production**

Run: `DATABASE_URL='<pooler url>' pnpm --filter @nri/db exec drizzle-kit migrate`
Expected: both migrations applied. Verify RLS: `select tablename, rowsecurity from pg_tables where schemaname='public'` → 12 rows, all true.

- [ ] **Step 3 (USER): Vercel project.** Import the GitHub repo in Vercel. Set environment variables for Production and Preview: `SUPABASE_URL`, `DATABASE_URL` (pooler, port 6543), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Do **not** set `SUPABASE_JWT_SECRET` in Vercel (production verifies via JWKS). Set the Node.js version to 22.

- [ ] **Step 4: Smoke-check the deploy**

Run:
```bash
curl -s https://<app>.vercel.app/api/health         # {"ok":true}
curl -s https://<app>.vercel.app/api/me             # 401 envelope
curl -sI https://<app>.vercel.app/ | grep -i content-security-policy
```
Then on the phone: open the URL, sign in, Settings → import `finance-data.json`, Home shows "Salary: ¥500,000 / month".

- [ ] **Step 5: Record the deployment**

Add the production URL and Supabase project ref to `docs/trd.md` §9.1, and update §9.2 to say deploys use the Build Output API produced by `scripts/vercel-build.mjs` (not `vercel.json` routes). Commit:
```bash
git add docs/trd.md
git commit -m "docs: record production URL and Build Output API deploy"
```
