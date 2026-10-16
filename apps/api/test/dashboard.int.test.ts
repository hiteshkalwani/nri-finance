import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cycleOf, todayIn } from '@nri/core'
import { accounts, createDb, remittances, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser, b: TestUser, c: TestUser
let foodId: string, rentId: string
const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const spend = (occurredOn: string, amountJpy: number, categoryId: string) =>
  call(a, 'POST', '/api/transactions', { occurredOn, amountJpy, categoryId, paymentMethod: 'cash', needWant: 'need' })

beforeAll(async () => {
  a = await createTestUser('dash-a'); b = await createTestUser('dash-b'); c = await createTestUser('dash-c')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
  foodId = (await (await call(a, 'POST', '/api/categories', { name: 'Food', color: '#4caf50' })).json()).id
  rentId = (await (await call(a, 'POST', '/api/categories', { name: 'Rent', color: '#2196f3' })).json()).id
  await spend('2026-09-24', 1000, foodId) // cycle 2026-09
  await spend('2026-09-25', 2000, foodId) // cycle 2026-10 (first day)
  await spend('2026-10-24', 500, rentId) // cycle 2026-10 (last day)
  await spend('2026-10-25', 700, foodId) // cycle 2026-11
  await withUser(db, { sub: a.id }, async (tx) => {
    await tx.insert(remittances).values({ userId: a.id, sentOn: '2026-10-01', jpySent: 100000, inrReceived: '59000.00', feeJpy: 500, purpose: 'family' })
    await tx.insert(accounts).values([
      { userId: a.id, name: 'Zeta bank', country: 'JP', currency: 'JPY', type: 'bank' },
      { userId: a.id, name: 'Alpha bank', country: 'IN', currency: 'INR', type: 'bank' },
      { userId: a.id, name: 'Closed', country: 'JP', currency: 'JPY', type: 'cash', archivedAt: new Date() },
    ])
  })
})
afterAll(async () => { for (const u of [a, b, c]) await deleteTestUser(u.id); await close(); await closeDb() })

describe('/api/dashboard', () => {
  it('summarises the 25th–24th cycle with categories and 12 cycles of history', async () => {
    const res = await call(a, 'GET', '/api/dashboard?cycle=2026-10')
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d).toMatchObject({
      cycle: '2026-10', start: '2026-09-25', end: '2026-10-24',
      incomeJpy: 300000, spentJpy: 2500, sentJpy: 100000, feesJpy: 500, keptJpy: 197500, savingsRatePct: 65.8,
      expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0,
    })
    expect(d.byCategory).toEqual([
      { categoryId: foodId, name: 'Food', color: '#4caf50', spentJpy: 2000 },
      { categoryId: rentId, name: 'Rent', color: '#2196f3', spentJpy: 500 },
    ])
    expect(d.byCycle).toHaveLength(12)
    expect(d.byCycle[0]).toEqual({ cycle: '2025-11', spentJpy: 0 })
    expect(d.byCycle.slice(-2)).toEqual([{ cycle: '2026-09', spentJpy: 1000 }, { cycle: '2026-10', spentJpy: 2500 }])
  })

  it('defaults to the current cycle in my timezone', async () => {
    const d = await (await call(a, 'GET', '/api/dashboard')).json()
    expect(d.cycle).toBe(cycleOf(todayIn('Asia/Tokyo'), 25))
  })

  it('shows nothing of another user’s money', async () => {
    const d = await (await call(b, 'GET', '/api/dashboard?cycle=2026-10')).json()
    expect(d).toMatchObject({ spentJpy: 0, sentJpy: 0, byCategory: [] })
  })

  it('asks for a profile first (409) and rejects a bad cycle (400)', async () => {
    expect((await call(c, 'GET', '/api/dashboard')).status).toBe(409)
    expect((await call(a, 'GET', '/api/dashboard?cycle=2026-13')).status).toBe(400)
  })
})

describe('/api/accounts', () => {
  it('lists my active accounts grouped by country then type then name', async () => {
    const { items } = await (await call(a, 'GET', '/api/accounts')).json()
    // Order is country (JP before IN), then type, then name — 'Closed' (JP, cash, archived) is excluded.
    expect(items.map((x: { name: string }) => x.name)).toEqual(['Zeta bank', 'Alpha bank'])
    expect((await (await call(b, 'GET', '/api/accounts')).json()).items).toEqual([])
  })
})

describe('PUT /api/cycles/:cycle/income + dashboard override', () => {
  const putIncome = (u: TestUser, cycle: string, incomeJpy: number | null) =>
    call(u, 'PUT', `/api/cycles/${cycle}/income`, { incomeJpy })

  it('overrides income for a cycle; clearing it with null reverts to salary', async () => {
    const before = await (await call(a, 'GET', '/api/dashboard?cycle=2026-12')).json()
    expect(before).toMatchObject({ salaryJpy: 300000, incomeJpy: 300000, incomeOverridden: false })

    const put = await putIncome(a, '2026-12', 350000)
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ cycle: '2026-12', incomeJpy: 350000 })

    const overridden = await (await call(a, 'GET', '/api/dashboard?cycle=2026-12')).json()
    expect(overridden).toMatchObject({ salaryJpy: 300000, incomeJpy: 350000, incomeOverridden: true })

    const cleared = await putIncome(a, '2026-12', null)
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ cycle: '2026-12', incomeJpy: null })

    const after = await (await call(a, 'GET', '/api/dashboard?cycle=2026-12')).json()
    expect(after).toMatchObject({ salaryJpy: 300000, incomeJpy: 300000, incomeOverridden: false })
  })

  it('never overrides another user’s cycle, and rejects a bad cycle (400)', async () => {
    await putIncome(a, '2026-12', 999999)
    const bDashboard = await (await call(b, 'GET', '/api/dashboard?cycle=2026-12')).json()
    expect(bDashboard).toMatchObject({ incomeOverridden: false, incomeJpy: 300000 })

    expect((await putIncome(a, '2026-13', 1000)).status).toBe(400)
  })
})

describe('DASH-9/TGT-2: budgets and targets', () => {
  it('summarises near/over budgets and target vs actual for the cycle', async () => {
    // Cycle 2026-10 spend (from the beforeAll fixtures above): food ¥2,000, rent ¥500.
    await call(a, 'PUT', '/api/budgets', { cycle: '2026-10', items: [{ categoryId: foodId, amountJpy: 1_000 }, { categoryId: rentId, amountJpy: 1_000 }] })
    await call(a, 'PUT', '/api/targets/2026-10', { savingsJpy: 100_000, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null })

    const d = await (await call(a, 'GET', '/api/dashboard?cycle=2026-10')).json()
    expect(d.budgets.overCount).toBe(1)
    expect(d.budgets.nearCount).toBe(0)
    expect(d.budgets.rows).toEqual([
      expect.objectContaining({ categoryId: foodId, budgetJpy: 1_000, spentJpy: 2_000, state: 'over' }),
    ])
    expect(d.targets).toEqual([
      { key: 'savings', targetValue: 100_000, actualValue: d.keptJpy, diff: d.keptJpy - 100_000, met: d.keptJpy >= 100_000 },
    ])
  })

  it('is empty with no budgets or targets set', async () => {
    const d = await (await call(b, 'GET', '/api/dashboard?cycle=2026-10')).json()
    expect(d.budgets).toEqual({ overCount: 0, nearCount: 0, rows: [] })
    expect(d.targets).toEqual([])
  })
})

describe('DASH-7/8: loan and sip', () => {
  it('is null with no open loan or SIP plan, then shows both once set up', async () => {
    const before = await (await call(b, 'GET', '/api/dashboard?cycle=2026-10')).json()
    expect(before).toMatchObject({ loan: null, sip: null })

    // 2099 start keeps this deterministic: "today" is always before the loan starts, so outstanding = principal.
    await call(b, 'POST', '/api/loans', {
      name: 'Future loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60, startCycle: '2099-01',
    })
    await call(b, 'PUT', '/api/sip', {
      startingMonthlyPaise: 5_000_000, stepUpPct: '10.00', expectedReturnPct: '12.00', startYear: 2026, endYear: 2036,
      redirectEmiAfterPayoff: true, allocations: [{ fundName: 'Index fund', pct: '100.00' }],
    })

    const after = await (await call(b, 'GET', '/api/dashboard?cycle=2026-10')).json()
    expect(after.loan).toEqual({ name: 'Future loan', outstandingPaise: 100_000_000, payoffCycle: '2103-12' })
    expect(after.sip.plannedPaise).toBeGreaterThan(0)
    expect(after.sip.projectedCorpusPaise).toBeGreaterThan(0)
  })
})
