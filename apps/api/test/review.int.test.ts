import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
let foodId: string
let efAccountId: string
let loanId: string

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const review = (u: TestUser, cycle: string) => call(u, 'GET', `/api/review/${cycle}`)

beforeAll(async () => {
  a = await createTestUser('rev-a')
  b = await createTestUser('rev-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)

  foodId = (await (await call(a, 'POST', '/api/categories', { name: 'Food', color: '#4caf50' })).json()).id
  efAccountId = (await (await call(a, 'POST', '/api/accounts', { name: 'EF savings', country: 'JP', type: 'bank', isEmergencyFund: true })).json()).id
  loanId = (await (await call(a, 'POST', '/api/loans', {
    name: 'Home loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60, startCycle: '2026-01',
  })).json()).id

  // Emergency fund: ¥500,000 at the end of 2026-09, ¥650,000 at the end of 2026-10 → a ¥150,000 contribution this cycle.
  await call(a, 'PUT', '/api/balances', { cycle: '2026-09', entries: [{ accountId: efAccountId, amount: 500_000 }] })
  await call(a, 'PUT', '/api/balances', { cycle: '2026-10', entries: [{ accountId: efAccountId, amount: 650_000 }] })

  // Food: budget ¥5,000, spent ¥6,000 → 120%, over.
  await call(a, 'PUT', '/api/budgets', { cycle: '2026-10', items: [{ categoryId: foodId, amountJpy: 5_000 }] })
  await call(a, 'POST', '/api/transactions', { occurredOn: '2026-10-01', amountJpy: 6_000, categoryId: foodId, paymentMethod: 'cash', needWant: 'want' })

  // ¥150,000 sent total this cycle: ¥50,000 family + ¥100,000 loan prepayment (₹59,000.00 received).
  await call(a, 'POST', '/api/remittances', { sentOn: '2026-10-02', jpySent: 50_000, inrPaise: 2_950_000, service: 'wise', purpose: 'family' })
  await call(a, 'POST', '/api/remittances', { sentOn: '2026-10-03', jpySent: 100_000, inrPaise: 5_900_000, service: 'wise', purpose: 'loan_prepayment', loanId })

  // Targets: savings and EF contribution targets are met; remittance target is not.
  await call(a, 'PUT', '/api/targets/2026-10', { savingsJpy: 100_000, emergencyFundJpy: 100_000, remittanceJpy: 200_000, prepaymentPaise: 5_000_000 })
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('GET /api/review/:cycle', () => {
  it('summarises the closed cycle (REV-1)', async () => {
    const res = await review(a, '2026-10')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      cycle: '2026-10', start: '2026-09-25', end: '2026-10-24',
      summary: { incomeJpy: 300_000, spentJpy: 6_000, sentJpy: 150_000, keptJpy: 144_000, savingsRatePct: 48, receivedPaise: 8_850_000 },
      balancesDone: true,
      nextCycle: '2026-11',
    })
  })

  it('reports target vs actual, including the emergency-fund contribution and ₹ prepayment received (TGT-2)', async () => {
    const body = await (await review(a, '2026-10')).json()
    expect(body.targets).toEqual(expect.arrayContaining([
      { key: 'savings', targetValue: 100_000, actualValue: 144_000, diff: 44_000, met: true },
      { key: 'emergencyFund', targetValue: 100_000, actualValue: 150_000, diff: 50_000, met: true },
      { key: 'remittance', targetValue: 200_000, actualValue: 150_000, diff: -50_000, met: false },
      { key: 'prepayment', targetValue: 5_000_000, actualValue: 5_900_000, diff: 900_000, met: true },
    ]))
  })

  it('lists over/near budgets and highlights the over-budget category first (DASH-9/REV-1)', async () => {
    const body = await (await review(a, '2026-10')).json()
    expect(body.budgets).toEqual([
      expect.objectContaining({ categoryId: foodId, name: 'Food', budgetJpy: 5_000, spentJpy: 6_000, remainingJpy: -1_000, pct: 120, state: 'over' }),
    ])
    expect(body.highlights[0]).toEqual({ tone: 'bad', text: 'Food went over budget by ￥1,000 (120%).' })
    expect(body.highlights.some((h: { tone: string; text: string }) => h.tone === 'warn' && h.text.includes('Remittance'))).toBe(true)
  })

  it('nextTargetsSet flips once the next cycle’s targets are saved', async () => {
    expect((await (await review(a, '2026-10')).json()).nextTargetsSet).toBe(false)
    await call(a, 'PUT', '/api/targets/2026-11', { savingsJpy: 50_000, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null })
    expect((await (await review(a, '2026-10')).json()).nextTargetsSet).toBe(true)
  })

  it('balancesDone is false for a cycle with no saved snapshot', async () => {
    const body = await (await review(a, '2026-11')).json()
    expect(body.balancesDone).toBe(false)
  })

  it('rejects a bad cycle (400) and shows nothing of another user’s cycle', async () => {
    expect((await review(a, '2026-13')).status).toBe(400)
    const bBody = await (await review(b, '2026-10')).json()
    expect(bBody).toMatchObject({ summary: { spentJpy: 0, sentJpy: 0 }, budgets: [], targets: [], balancesDone: false })
  })
})
