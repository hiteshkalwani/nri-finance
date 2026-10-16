import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
let foodId: string
let rentId: string
let bCatId: string

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const get = (u: TestUser, cycle: string) => call(u, 'GET', `/api/budgets?cycle=${cycle}`)
const put = (u: TestUser, cycle: string, items: { categoryId: string; amountJpy: number | null }[]) =>
  call(u, 'PUT', '/api/budgets', { cycle, items })
const spend = (occurredOn: string, amountJpy: number, categoryId: string) =>
  call(a, 'POST', '/api/transactions', { occurredOn, amountJpy, categoryId, paymentMethod: 'cash', needWant: 'need' })
const row = (body: { rows: { categoryId: string }[] }, categoryId: string) => body.rows.find((r) => r.categoryId === categoryId)

beforeAll(async () => {
  a = await createTestUser('bud-a')
  b = await createTestUser('bud-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
  foodId = (await (await call(a, 'POST', '/api/categories', { name: 'Food', color: '#4caf50' })).json()).id
  rentId = (await (await call(a, 'POST', '/api/categories', { name: 'Rent', color: '#2196f3' })).json()).id
  bCatId = (await (await call(b, 'POST', '/api/categories', { name: 'B cat', color: '#000000' })).json()).id
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('GET /api/budgets', () => {
  it('lists every active category, with null budget fields when none is set (BUD-1)', async () => {
    const res = await get(a, '2026-10')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cycle).toBe('2026-10')
    expect(row(body, foodId)).toMatchObject({ budgetJpy: null, effectiveFromCycle: null, spentJpy: 0, remainingJpy: null, pct: null, state: null })
    expect(row(body, rentId)).toMatchObject({ name: 'Rent', color: '#2196f3', budgetJpy: null })
  })

  it('rejects a bad cycle (400)', async () => {
    expect((await get(a, '2026-13')).status).toBe(400)
  })
})

describe('PUT /api/budgets (BUD-1 carry-forward)', () => {
  it('carries a budget forward until changed, and leaves past cycles alone when set from a later cycle', async () => {
    await put(a, '2026-06', [{ categoryId: foodId, amountJpy: 10_000 }])
    expect(row(await (await get(a, '2026-05')).json(), foodId)).toMatchObject({ budgetJpy: null })
    expect(row(await (await get(a, '2026-06')).json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })
    expect(row(await (await get(a, '2026-09')).json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })

    // Set a new amount from 2026-09: 2026-06..08 keep the old amount, 2026-09+ gets the new one.
    const putRes = await put(a, '2026-09', [{ categoryId: foodId, amountJpy: 15_000 }])
    expect(putRes.status).toBe(200)
    expect(row(await putRes.json(), foodId)).toMatchObject({ budgetJpy: 15_000, effectiveFromCycle: '2026-09' })
    expect(row(await (await get(a, '2026-06')).json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })
    expect(row(await (await get(a, '2026-08')).json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })
    expect(row(await (await get(a, '2026-12')).json(), foodId)).toMatchObject({ budgetJpy: 15_000, effectiveFromCycle: '2026-09' })
  })

  it('a null amount removes the row at that cycle, so the earlier budget applies again', async () => {
    const res = await put(a, '2026-09', [{ categoryId: foodId, amountJpy: null }])
    expect(res.status).toBe(200)
    expect(row(await res.json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })
    expect(row(await (await get(a, '2026-12')).json(), foodId)).toMatchObject({ budgetJpy: 10_000, effectiveFromCycle: '2026-06' })
  })

  it('allows a zero budget', async () => {
    const res = await put(a, '2026-10', [{ categoryId: rentId, amountJpy: 0 }])
    expect(res.status).toBe(200)
    expect(row(await res.json(), rentId)).toMatchObject({ budgetJpy: 0, remainingJpy: 0, pct: null, state: 'under' })
  })

  it("rejects another user's category, naming the entry (400), and writes nothing", async () => {
    const res = await put(a, '2026-10', [{ categoryId: foodId, amountJpy: 999 }, { categoryId: bCatId, amountJpy: 1 }])
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toMatchObject([{ path: ['items', 1, 'categoryId'] }])

    // foodId's budget is untouched by the rejected PUT (still 10,000 from the earlier test).
    expect(row(await (await get(a, '2026-10')).json(), foodId)).toMatchObject({ budgetJpy: 10_000 })
  })
})

describe('DASH-9 near/over states from real spend', () => {
  it('reports near at 90% and over past 100%, sorted over first', async () => {
    await put(a, '2026-11', [{ categoryId: foodId, amountJpy: 10_000 }, { categoryId: rentId, amountJpy: 1_000 }])
    await spend('2026-10-26', 9_000, foodId) // 90% of 10,000: near
    await spend('2026-10-27', 1_265, rentId) // 126.5% of 1,000: over

    const body = await (await get(a, '2026-11')).json()
    expect(row(body, foodId)).toMatchObject({ budgetJpy: 10_000, spentJpy: 9_000, pct: 90, state: 'near' })
    expect(row(body, rentId)).toMatchObject({ budgetJpy: 1_000, spentJpy: 1_265, pct: 126.5, state: 'over' })
  })
})

describe('cross-user isolation', () => {
  it("never shows or lets me set another user's budgets", async () => {
    const res = await put(b, '2026-10', [{ categoryId: foodId, amountJpy: 1 }])
    expect(res.status).toBe(400)
    const bBody = await (await get(b, '2026-10')).json()
    expect(bBody.rows.find((r: { categoryId: string }) => r.categoryId === foodId)).toBeUndefined()
  })
})
