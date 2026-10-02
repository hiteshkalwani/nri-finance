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
    expect(me.profile).toEqual({ salaryJpy: 670000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
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
