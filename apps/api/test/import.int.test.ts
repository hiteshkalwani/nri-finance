import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { accounts, createDb, cycleTargets, loanPlannedPrepayments, remittances, transactions, withUser } from '@nri/db'
import { json, testApp } from './helpers'

const seed = JSON.parse(readFileSync(new URL('../../../fixtures/v1-sample.json', import.meta.url), 'utf8'))
const familyRows = seed.transactions.filter((t: { categoryId: string }) => t.categoryId === 'family-india')
const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let u: TestUser

beforeAll(async () => { u = await createTestUser('import') })
afterAll(async () => { await deleteTestUser(u.id); await close(); await closeDb() })

describe('POST /api/import/v1', () => {
  it('imports the v1 seed: family rows become remittances, the rest transactions', async () => {
    const res = await app.request('/api/import/v1', json(u.accessToken, 'POST', seed))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inserted.remittances).toBe(familyRows.length)
    expect(body.skippedRows).toEqual([])
    expect(body.inserted.transactions).toBe(seed.transactions.length - familyRows.length)
    expect(body.inserted.accounts).toBe(3)
    expect(body.inserted.loans).toBe(1)
    expect(body.inserted.sipPlans).toBe(1)
    expect(body.inserted.categories).toBe(seed.categories.length - 1) // family-india is not a spending category
  })

  it('creates the profile from v1 settings', async () => {
    const me = await (await app.request('/api/me', json(u.accessToken, 'GET'))).json()
    expect(me.profile).toEqual({
      salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: 1000000,
    })
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

  it('maps every field, not just counts (IMP-2, INR-only rows, payment, accounts)', async () => {
    const rows = await withUser(db, { sub: u.id }, async (tx) => ({
      rem: await tx.select().from(remittances).where(eq(remittances.userId, u.id)),
      txn: await tx.select().from(transactions).where(eq(transactions.userId, u.id)),
      acc: await tx.select().from(accounts).where(eq(accounts.userId, u.id)),
    }))
    const byLegacy = <T extends { legacyId: string | null }>(xs: T[], id: string) => xs.find((x) => x.legacyId === id)!
    // sample-2 was entered in ₹ only: ₹ received is the stored INR amount, ¥ sent is converted at the planning rate.
    expect(byLegacy(rows.rem, 'sample-2')).toMatchObject({ jpySent: 33898, inrReceived: '20000.00', purpose: 'family' })
    // sample-8 had both amounts: both are kept as stored, nothing recomputed.
    expect(byLegacy(rows.rem, 'sample-8')).toMatchObject({ jpySent: 34000, inrReceived: '20000.00' })
    const jpBank = byLegacy(rows.acc, 'starter-jp-bank')
    const inBank = byLegacy(rows.acc, 'starter-in-bank')
    expect(byLegacy(rows.rem, 'sample-2')).toMatchObject({ fromAccountId: jpBank.id, toAccountId: inBank.id })
    expect(byLegacy(rows.acc, 'starter-jp-emergency')).toMatchObject({ isEmergencyFund: true, currency: 'JPY' })
    expect(inBank).toMatchObject({ country: 'IN', currency: 'INR', isEmergencyFund: false })
    expect(byLegacy(rows.txn, 'sample-9')).toMatchObject({ paymentMethod: 'credit_card', needWant: 'want', enteredCurrency: 'JPY' })
    expect(byLegacy(rows.txn, 'sample-3')).toMatchObject({ paymentMethod: 'ic_card', amountJpy: 1200 })
  })

  it('imports non-empty cycle targets and loan extras, rounding fractional yen', async () => {
    const other = await createTestUser('import-targets')
    const doc = {
      ...seed,
      cycleTargets: [{ cycle: '2026-10', savingsTargetJPY: 50000.5, emergencyFundTargetJPY: 20000, loanPrepaymentTargetINR: 40000.25 }],
      homeLoanExtras: [{ monthIndex: 3, extraPrepaymentINR: 120000 }, { monthIndex: 4, extraPrepaymentINR: 0 }],
    }
    const res = await app.request('/api/import/v1', json(other.accessToken, 'POST', doc))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inserted).toMatchObject({ cycleTargets: 1, plannedPrepayments: 1 })
    const [target] = await withUser(db, { sub: other.id }, (tx) => tx.select().from(cycleTargets))
    expect(target).toMatchObject({ savingsTargetJpy: 50001, emergencyFundTargetJpy: 20000, prepaymentTargetInr: '40000.25' })
    const extras = await withUser(db, { sub: other.id }, (tx) => tx.select().from(loanPlannedPrepayments))
    expect(extras.map((e) => [e.monthIndex, e.amountInr])).toEqual([[3, '120000.00']])
    await deleteTestUser(other.id)
  })

  it('skips an INR-only row too small to be worth ¥1, instead of failing the import', async () => {
    const other = await createTestUser('import-tiny')
    const doc = {
      ...seed,
      transactions: [
        { id: 'tiny-1', date: '2026-09-01', categoryId: 'groceries', description: 'tiny', amountJPY: 0, amountINR: 0.1 },
        { id: 'tiny-fam', date: '2026-09-01', categoryId: 'family-india', description: 'tiny', amountJPY: 0, amountINR: 0.1 },
        { id: 'ok-1', date: '2026-09-01', categoryId: 'groceries', description: 'fine', amountJPY: 500, amountINR: 0 },
      ],
    }
    const res = await app.request('/api/import/v1', json(other.accessToken, 'POST', doc))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inserted).toMatchObject({ transactions: 1, remittances: 0 })
    expect(body.skippedRows).toEqual(['tiny-1: converts to ¥0', 'tiny-fam: converts to ¥0'])
    await deleteTestUser(other.id)
  })

  it('rejects a document that is not a v1 export', async () => {
    const res = await app.request('/api/import/v1', json(u.accessToken, 'POST', { hello: 'world' }))
    expect(res.status).toBe(400)
  })

  it('imports the v1 emergency-fund goal into a new profile and reports profileKept on a re-import', async () => {
    const fresh = await createTestUser('import-ef-goal')
    const doc = { ...seed, settings: { ...seed.settings, emergencyFundTargetJPY: 1000000 } }
    const first = await (await app.request('/api/import/v1', json(fresh.accessToken, 'POST', doc))).json()
    expect(first.profileKept).toBe(false)
    const me = await (await app.request('/api/me', json(fresh.accessToken, 'GET'))).json()
    expect(me.profile.emergencyFundGoalJpy).toBe(1000000)
    const again = await (await app.request('/api/import/v1', json(fresh.accessToken, 'POST', doc))).json()
    expect(again.profileKept).toBe(true)
    await deleteTestUser(fresh.id)
  })

  it('treats a v1 goal of 0 as no goal', async () => {
    const fresh = await createTestUser('import-ef-zero')
    const doc = { ...seed, settings: { ...seed.settings, emergencyFundTargetJPY: 0 } }
    await app.request('/api/import/v1', json(fresh.accessToken, 'POST', doc))
    const me = await (await app.request('/api/me', json(fresh.accessToken, 'GET'))).json()
    expect(me.profile.emergencyFundGoalJpy).toBeNull()
    await deleteTestUser(fresh.id)
  })
})
