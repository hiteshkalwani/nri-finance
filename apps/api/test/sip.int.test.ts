import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cycleBounds, cycleOf, nextCycle, sipMonthlyFor, todayIn } from '@nri/core'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const base = (over: Record<string, unknown> = {}) => ({
  startingMonthlyPaise: 10_000_000, stepUpPct: '10.00', expectedReturnPct: '12.00', startYear: 2026, endYear: 2036,
  redirectEmiAfterPayoff: true, allocations: [{ fundName: 'Index fund', pct: '60.00' }, { fundName: 'Debt fund', pct: '40.00' }],
  ...over,
})
const putPlan = (u: TestUser, body: unknown) => call(u, 'PUT', '/api/sip', body)
const getPlan = (u: TestUser) => call(u, 'GET', '/api/sip')
const getProjection = (u: TestUser) => call(u, 'GET', '/api/sip/projection')
// Same loan figures as loan.int.test.ts: payoff exactly 59 months after startCycle (2030-12 for 2026-01).
const loanBase = (over: Record<string, unknown> = {}) => ({
  name: 'Home loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60, startCycle: '2026-01', ...over,
})

beforeAll(async () => {
  a = await createTestUser('sip-a')
  b = await createTestUser('sip-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('GET /api/sip', () => {
  it('is null before a plan is set up', async () => {
    const res = await getPlan(b)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})

describe('PUT /api/sip', () => {
  it('upserts the plan and its allocations (SIP-1/2)', async () => {
    const res = await putPlan(a, base())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(base())

    // Upsert again with a different shape: old allocations are gone, not merged.
    const updated = await (await putPlan(a, base({ allocations: [{ fundName: 'Gold fund', pct: '100.00' }] }))).json()
    expect(updated.allocations).toEqual([{ fundName: 'Gold fund', pct: '100.00' }])

    const fetched = await (await getPlan(a)).json()
    expect(fetched).toEqual(updated)
  })

  it('rejects allocations that do not total exactly 100 (400, SIP-2)', async () => {
    const res = await putPlan(a, base({ allocations: [{ fundName: 'Index fund', pct: '59.99' }, { fundName: 'Debt fund', pct: '40.00' }] }))
    expect(res.status).toBe(400)
  })

  it('rejects endYear before startYear (400)', async () => {
    const res = await putPlan(a, base({ startYear: 2030, endYear: 2029 }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/sip/projection', () => {
  it('asks for a plan first (409) before one is set up', async () => {
    const res = await getProjection(b)
    expect(res.status).toBe(409)
  })

  it('projects yearly rows, redirects the EMI from the real payoff cycle, and reports the last 12 cycles vs plan (SIP-3/4)', async () => {
    await putPlan(b, base())
    const loan = await (await call(b, 'POST', '/api/loans', loanBase())).json()

    const res = await getProjection(b)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.years).toHaveLength(2036 - 2026 + 1)
    expect(body.years[0]).toMatchObject({ year: 2026, monthlyPaise: 10_000_000 })
    expect(body.redirectFromCycle).toBe(nextCycle('2030-12'))
    const redirectYear = body.years.find((y: { year: number }) => y.year === 2031)
    expect(redirectYear.emiPaidPaise).toBe(12 * 2_224_445)
    expect(body.years.find((y: { year: number }) => y.year === 2030).emiPaidPaise).toBe(0)

    const todayCycle = cycleOf(todayIn('Asia/Tokyo'), 25)
    expect(body.actuals).toHaveLength(12)
    expect(body.actuals.at(-1)).toMatchObject({ cycle: todayCycle })
    const core = { startingMonthlyPaise: 10_000_000, stepUpPct: 10, expectedReturnPct: 12, startYear: 2026, endYear: 2036, redirectEmiAfterPayoff: true }
    for (const row of body.actuals) {
      expect(row.plannedPaise).toBe(sipMonthlyFor(core, Number(row.cycle.slice(0, 4))))
      expect(row.paidPaise).toBe(0)
    }

    await call(b, 'PATCH', `/api/loans/${loan.id}`, { closed: true }) // tidy up for the next test
  })

  it('counts SIP-purpose remittances for the current cycle as paid, and no others', async () => {
    const todayCycle = cycleOf(todayIn('Asia/Tokyo'), 25)
    const sentOn = cycleBounds(todayCycle, 25).start
    await call(a, 'POST', '/api/remittances', { sentOn, jpySent: 1000, inrPaise: 5_000_000, service: 'wise', purpose: 'sip' })
    await call(a, 'POST', '/api/remittances', { sentOn, jpySent: 1000, inrPaise: 59000, service: 'wise', purpose: 'family' })

    const body = await (await getProjection(a)).json()
    const row = body.actuals.find((r: { cycle: string }) => r.cycle === todayCycle)
    expect(row.paidPaise).toBe(5_000_000)
  })

  it('no EMI redirect in the years when the plan turns it off, even though redirectFromCycle is still reported', async () => {
    await putPlan(b, base({ redirectEmiAfterPayoff: false }))
    const loan = await (await call(b, 'POST', '/api/loans', loanBase({ name: 'No redirect' }))).json()

    const body = await (await getProjection(b)).json()
    expect(body.redirectFromCycle).not.toBeNull()
    expect(body.years.every((y: { emiPaidPaise: number; emiCorpusPaise: number }) => y.emiPaidPaise === 0 && y.emiCorpusPaise === 0)).toBe(true)

    await call(b, 'PATCH', `/api/loans/${loan.id}`, { closed: true })
  })
})
