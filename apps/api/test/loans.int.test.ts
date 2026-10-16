import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cycleOf, todayIn } from '@nri/core'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
// Same figures as packages/core/test/loan.test.ts: 60 months, payoff exactly 59 months after startCycle.
const base = (over: Record<string, unknown> = {}) => ({
  name: 'Home loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60, startCycle: '2026-01', ...over,
})
const post = (u: TestUser, body: unknown) => call(u, 'POST', '/api/loans', body)
const patch = (u: TestUser, id: string, body: unknown) => call(u, 'PATCH', `/api/loans/${id}`, body)
const schedule = (u: TestUser, id: string) => call(u, 'GET', `/api/loans/${id}/schedule`)
const putPrepayments = (u: TestUser, id: string, items: unknown[]) => call(u, 'PUT', `/api/loans/${id}/planned-prepayments`, { items })
const remit = (u: TestUser, loanId: string, purpose: string, sentOn: string, inrPaise: number) =>
  call(u, 'POST', '/api/remittances', { sentOn, jpySent: 1000, inrPaise, service: 'wise', purpose, loanId })

beforeAll(async () => {
  a = await createTestUser('loan-a')
  b = await createTestUser('loan-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('POST /api/loans', () => {
  it('creates a loan (201) with paise amounts and the rate padded to 3 decimals', async () => {
    const res = await post(a, base({ name: 'New loan', annualRatePct: '12' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      name: 'New loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60,
      startCycle: '2026-01', closedAt: null,
    })
    expect(body.id).toBeTypeOf('string')
  })

  it('rejects a non-positive principal/EMI, a rate over 99.999, tenureMonths out of range, and unknown keys (400)', async () => {
    expect((await post(a, base({ principalPaise: 0 }))).status).toBe(400)
    expect((await post(a, base({ emiPaise: -1 }))).status).toBe(400)
    expect((await post(a, base({ annualRatePct: '100.000' }))).status).toBe(400)
    expect((await post(a, base({ tenureMonths: 601 }))).status).toBe(400)
    expect((await post(a, { ...base(), extra: 1 })).status).toBe(400)
  })
})

describe('PATCH /api/loans/:id', () => {
  it('closes and reopens a loan (closedAt now/null)', async () => {
    const loan = await (await post(a, base({ name: 'To close' }))).json()
    const closed = await patch(a, loan.id, { closed: true })
    expect(closed.status).toBe(200)
    const closedBody = await closed.json()
    expect(closedBody.closedAt).not.toBeNull()

    const reopened = await (await patch(a, loan.id, { closed: false })).json()
    expect(reopened.closedAt).toBeNull()
  })

  it('edits loan terms', async () => {
    const loan = await (await post(a, base({ name: 'To edit' }))).json()
    const res = await patch(a, loan.id, { name: 'Edited', emiPaise: 2_300_000 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Edited', emiPaise: 2_300_000, principalPaise: 100_000_000 })
  })

  it('rejects an empty patch (400) and never patches another user’s loan (404)', async () => {
    const loan = await (await post(a, base())).json()
    expect((await patch(a, loan.id, {})).status).toBe(400)
    expect((await patch(b, loan.id, { closed: true })).status).toBe(404)
  })
})

describe('GET /api/loans/:id/schedule', () => {
  it('projects the unmodified plan: 60 months, payoff Dec 2030, no interest saved', async () => {
    const loan = await (await post(a, base({ name: 'Plan only' }))).json()
    const res = await schedule(a, loan.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(60)
    expect(body.rows[0]).toMatchObject({ month: 1, cycle: '2026-01', openingPaise: 100_000_000, actual: false })
    expect(body.plan).toMatchObject({ payoffCycle: '2030-12', months: 60 })
    expect(body.projected).toEqual(body.plan)
    expect(body.interestSavedPaise).toBe(0)
  })

  it('a real EMI+prepayment remittance flags that month actual, moves payoff earlier, and saves interest (LOAN-3/4)', async () => {
    const loan = await (await post(a, base({ name: 'With actuals' }))).json()
    await remit(a, loan.id, 'loan_emi', '2026-02-05', 2_224_445)
    await remit(a, loan.id, 'loan_prepayment', '2026-02-10', 20_000_000)

    const body = await (await schedule(a, loan.id)).json()
    const feb = body.rows.find((r: { cycle: string }) => r.cycle === '2026-02')
    expect(feb).toMatchObject({ actual: true, emiPaise: 2_224_445, extraPaise: 20_000_000 })
    expect(body.projected.payoffCycle < body.plan.payoffCycle).toBe(true)
    expect(body.interestSavedPaise).toBeGreaterThan(0)
  })

  it('outstandingPaise is the principal before the loan starts, and 0 once already paid off', async () => {
    const future = await (await post(a, base({ name: 'Future', startCycle: '2099-01' }))).json()
    const futureBody = await (await schedule(a, future.id)).json()
    expect(futureBody.outstandingPaise).toBe(100_000_000)

    const past = await (await post(a, base({ name: 'Past', startCycle: '2000-01' }))).json()
    const pastBody = await (await schedule(a, past.id)).json()
    expect(pastBody.outstandingPaise).toBe(0)
    expect(pastBody.projected.payoffCycle).not.toBeNull()
  })

  it('matches today’s closing balance for a loan in progress', async () => {
    const loan = await (await post(a, base({ name: 'In progress' }))).json()
    const body = await (await schedule(a, loan.id)).json()
    const todayCycle = cycleOf(todayIn('Asia/Tokyo'), 25)
    const row = body.rows.find((r: { cycle: string }) => r.cycle === todayCycle)
    expect(body.outstandingPaise).toBe(row.closingPaise)
  })

  it('never shows another user’s loan (404)', async () => {
    const loanB = await (await post(b, base({ name: 'B loan' }))).json()
    expect((await schedule(a, loanB.id)).status).toBe(404)
  })
})

describe('PUT /api/loans/:id/planned-prepayments', () => {
  it('replaces planned extras, applied where there is no actual month', async () => {
    const loan = await (await post(a, base({ name: 'Planned' }))).json()
    expect((await putPrepayments(a, loan.id, [{ monthIndex: 3, amountPaise: 1_000_000 }])).status).toBe(204)

    const first = await (await schedule(a, loan.id)).json()
    expect(first.rows[2]).toMatchObject({ month: 3, extraPaise: 1_000_000, actual: false })

    // Replace wholesale: month 3's extra disappears, month 5 gets a new one.
    expect((await putPrepayments(a, loan.id, [{ monthIndex: 5, amountPaise: 2_000_000 }])).status).toBe(204)
    const second = await (await schedule(a, loan.id)).json()
    expect(second.rows[2]).toMatchObject({ month: 3, extraPaise: 0 })
    expect(second.rows[4]).toMatchObject({ month: 5, extraPaise: 2_000_000 })
  })

  it('rejects a duplicate monthIndex (400) and never replaces another user’s loan (404)', async () => {
    const loan = await (await post(a, base({ name: 'Dup check' }))).json()
    const dup = await putPrepayments(a, loan.id, [{ monthIndex: 2, amountPaise: 100 }, { monthIndex: 2, amountPaise: 200 }])
    expect(dup.status).toBe(400)

    const loanB = await (await post(b, base({ name: 'B planned' }))).json()
    expect((await putPrepayments(a, loanB.id, [{ monthIndex: 1, amountPaise: 100 }])).status).toBe(404)
  })
})
