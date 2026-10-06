import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, transactions, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser // JP bank, JP card, IN bank (EF); rate 1.7; balances in 2026-08/09/10; 3 expenses 2026-07..09
let c: TestUser // profile only, no accounts, no balances, no transactions
let d: TestUser // no profile at all
let jpBank: string
let jpCard: string
let inBank: string

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const createAccount = async (u: TestUser, body: Record<string, unknown>): Promise<string> =>
  (await (await call(u, 'POST', '/api/accounts', body)).json()).id
const putBalances = (u: TestUser, cycle: string, entries: Array<{ accountId: string; amount: number }>) =>
  call(u, 'PUT', '/api/balances', { cycle, entries })
const get = (u: TestUser, qs = '') => call(u, 'GET', `/api/networth${qs}`)

beforeAll(async () => {
  a = await createTestUser('nw-a')
  c = await createTestUser('nw-c')
  d = await createTestUser('nw-d')

  await call(a, 'PUT', '/api/me', {
    salaryJpy: 300000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: 2000000,
  })
  await call(c, 'PUT', '/api/me', { salaryJpy: 300000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
  // d: never calls PUT /api/me — no profile row.

  jpBank = await createAccount(a, { name: 'Postal bank', country: 'JP', type: 'bank' })
  jpCard = await createAccount(a, { name: 'Rakuten card', country: 'JP', type: 'card' })
  inBank = await createAccount(a, { name: 'HDFC', country: 'IN', type: 'bank', isEmergencyFund: true })

  // ¥ balances; ₹ balances in paise. India converts at rate 1.7: 1,000,000p→¥17,000; 2,000,000p→¥34,000; 3,000,000p→¥51,000.
  await putBalances(a, '2026-08', [{ accountId: jpBank, amount: 400000 }, { accountId: jpCard, amount: 10000 }, { accountId: inBank, amount: 1_000_000 }])
  await putBalances(a, '2026-09', [{ accountId: jpBank, amount: 450000 }, { accountId: jpCard, amount: 15000 }, { accountId: inBank, amount: 2_000_000 }])
  await putBalances(a, '2026-10', [{ accountId: jpBank, amount: 500000 }, { accountId: jpCard, amount: 20000 }, { accountId: inBank, amount: 3_000_000 }])

  const cat = await (await call(a, 'POST', '/api/categories', { name: 'Groceries', color: '#4caf50' })).json()
  // First expense is in cycle 2026-07 (day 1, startDay 25 → stays in month 07). Totals: ¥10,000 / ¥30,000 / ¥50,000.
  await withUser(db, { sub: a.id }, (tx) =>
    tx.insert(transactions).values([
      { userId: a.id, occurredOn: '2026-07-01', categoryId: cat.id, amountJpy: 10000, paymentMethod: 'cash', needWant: 'need' },
      { userId: a.id, occurredOn: '2026-08-01', categoryId: cat.id, amountJpy: 30000, paymentMethod: 'cash', needWant: 'need' },
      { userId: a.id, occurredOn: '2026-09-01', categoryId: cat.id, amountJpy: 50000, paymentMethod: 'cash', needWant: 'need' },
    ]),
  )
})
afterAll(async () => {
  await deleteTestUser(a.id); await deleteTestUser(c.id); await deleteTestUser(d.id)
  await close(); await closeDb()
})

describe('/api/networth', () => {
  it('returns current totals, change since last cycle, assets/liabilities and per-account rows', async () => {
    const res = await get(a, '?cycle=2026-10')
    expect(res.status).toBe(200)
    const body = await res.json()

    // Japan: assets 500,000 − liabilities 20,000 = 480,000. India: 3,000,000p → ¥51,000.
    // combinedJpy = 480,000 + 51,000 = 531,000.
    // Previous cycle (2026-09): Japan 450,000 − 15,000 = 435,000; India 2,000,000p → ¥34,000; combined 469,000.
    // changeJpy = 531,000 − 469,000 = 62,000; changePct = round(62,000 × 1000 / 469,000) / 10 = 13.2.
    expect(body.rate).toBe('1.7')
    expect(body.cycle).toBe('2026-10')
    expect(body.current).toEqual({ japanJpy: 480000, indiaPaise: 3_000_000, combinedJpy: 531000, changeJpy: 62000, changePct: 13.2 })
    expect(body.assets).toEqual({ japanJpy: 500000, indiaPaise: 3_000_000 })
    expect(body.liabilities).toEqual({ japanJpy: 20000, indiaPaise: 0 })

    // Per-account rows (active only): changeAmount = this cycle's balanceAt − previous cycle's balanceAt.
    expect(body.accounts).toEqual(
      expect.arrayContaining([
        { accountId: jpBank, amount: 500000, source: 'this', fromCycle: '2026-10', changeAmount: 50000 },
        { accountId: jpCard, amount: 20000, source: 'this', fromCycle: '2026-10', changeAmount: 5000 },
        { accountId: inBank, amount: 3_000_000, source: 'this', fromCycle: '2026-10', changeAmount: 1_000_000 },
      ]),
    )
    expect(body.accounts).toHaveLength(3)
  })

  it('series covers the span ending at cycle, starting no earlier than the first snapshot', async () => {
    const body = await (await get(a, '?cycle=2026-10&span=12')).json()
    // The first snapshot for any account is cycle 2026-08, so span=12 (which would reach back to 2025-11) is
    // clipped to just ['2026-08', '2026-09', '2026-10'].
    // 2026-08 combined: Japan 400,000 − 10,000 = 390,000; India 1,000,000p → ¥17,000 → 407,000.
    // 2026-09 combined: 435,000 + 34,000 = 469,000 (computed above).
    // 2026-10 combined: 531,000 (computed above).
    expect(body.series).toEqual([
      { cycle: '2026-08', combinedJpy: 407000 },
      { cycle: '2026-09', combinedJpy: 469000 },
      { cycle: '2026-10', combinedJpy: 531000 },
    ])
  })

  it('emergency fund uses flagged non-card accounts and months covered from the 3 prior cycles since the first expense', async () => {
    const body = await (await get(a, '?cycle=2026-10')).json()
    // EF balance: only inBank is flagged and non-card → ¥51,000 (computed above).
    // The 3 cycles immediately before 2026-10 are 2026-07, 2026-08, 2026-09, all on or after the first
    // expense's cycle (2026-07), so all 3 count: spend ¥10,000 / ¥30,000 / ¥50,000 → avg ¥30,000.
    // monthsCovered = round(51,000 × 10 / 30,000) / 10 = round(17) / 10 = 1.7.
    expect(body.emergencyFund).toEqual({ balanceJpy: 51000, goalJpy: 2000000, monthsCovered: 1.7, avgSpendJpy: 30000 })
  })

  it('re-expresses the whole series at a new planning rate and reports it (Review Focus 5)', async () => {
    await call(a, 'PUT', '/api/me', {
      salaryJpy: 300000, planningRateJpyPerInr: '2.0', cycleStartDay: 25, timezone: 'Asia/Tokyo',
    })
    const body = await (await get(a, '?cycle=2026-10&span=12')).json()

    expect(body.rate).toBe('2.0')
    // At rate 2.0: 1,000,000p→¥20,000; 2,000,000p→¥40,000; 3,000,000p→¥60,000. Japan side is unchanged.
    expect(body.series).toEqual([
      { cycle: '2026-08', combinedJpy: 390000 + 20000 },
      { cycle: '2026-09', combinedJpy: 435000 + 40000 },
      { cycle: '2026-10', combinedJpy: 480000 + 60000 },
    ])
    expect(body.current.combinedJpy).toBe(480000 + 60000)
    // The emergency fund goal set earlier survives this rate-only update (profileKept-style merge in PUT /api/me).
    expect(body.emergencyFund.goalJpy).toBe(2000000)
  })

  it('works with no accounts or no balances (zeros, empty series, null change)', async () => {
    const body = await (await get(c)).json()
    expect(body.current).toEqual({ japanJpy: 0, indiaPaise: 0, combinedJpy: 0, changeJpy: null, changePct: null })
    expect(body.assets).toEqual({ japanJpy: 0, indiaPaise: 0 })
    expect(body.liabilities).toEqual({ japanJpy: 0, indiaPaise: 0 })
    expect(body.series).toEqual([])
    expect(body.accounts).toEqual([])
    expect(body.emergencyFund).toEqual({ balanceJpy: 0, goalJpy: null, monthsCovered: null, avgSpendJpy: null })
  })

  it('bad span or cycle → 400; no profile → 409', async () => {
    const badCycle = await get(a, '?cycle=2026-13')
    expect(badCycle.status).toBe(400)
    expect((await badCycle.json()).error.code).toBe('VALIDATION_FAILED')

    const badSpan = await get(a, '?cycle=2026-10&span=24')
    expect(badSpan.status).toBe(400)
    expect((await badSpan.json()).error.code).toBe('VALIDATION_FAILED')

    const noProfile = await get(d)
    expect(noProfile.status).toBe(409)
    expect((await noProfile.json()).error.code).toBe('CONFLICT')
  })
})
