import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accounts, createDb, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser
let food: string, rent: string, old: string, bCat: string, accountA: string
const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const base = (over: Record<string, unknown> = {}) => ({ occurredOn: '2026-10-01', categoryId: food, paymentMethod: 'cash', needWant: 'need', ...over })
const post = async (u: TestUser, body: unknown) => call(u, 'POST', '/api/transactions', body)
const list = async (u: TestUser, qs = '') => (await (await call(u, 'GET', `/api/transactions${qs}`)).json())

beforeAll(async () => {
  a = await createTestUser('txn-a')
  b = await createTestUser('txn-b')
  await call(a, 'PUT', '/api/me', profile)
  const mk = async (u: TestUser, name: string) => (await (await call(u, 'POST', '/api/categories', { name, color: '#4caf50' })).json()).id as string
  food = await mk(a, 'Food'); rent = await mk(a, 'Rent'); old = await mk(a, 'Old'); bCat = await mk(b, 'B cat')
  await call(a, 'PATCH', `/api/categories/${old}`, { archived: true })
  accountA = await withUser(db, { sub: a.id }, async (tx) =>
    (await tx.insert(accounts).values({ userId: a.id, name: 'JP bank', country: 'JP', currency: 'JPY', type: 'bank' }).returning())[0]!.id)
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close(); await closeDb() })

describe('/api/transactions', () => {
  it('creates a ¥ expense and computes its cycle', async () => {
    const res = await post(a, base({ amountJpy: 1280, description: 'Lunch', accountId: accountA }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      amountJpy: 1280, enteredCurrency: 'JPY', amountInrPaise: null, rateUsed: null, cycle: '2026-10', description: 'Lunch', accountId: accountA,
    })
  })

  it('converts a ₹ expense at the planning rate and never recomputes it when the rate changes (TXN-4)', async () => {
    const created = await (await post(a, base({ amountInrPaise: 100000, description: 'In Delhi' }))).json()
    expect(created).toMatchObject({ amountJpy: 1695, enteredCurrency: 'INR', amountInrPaise: 100000, rateUsed: '1.694915' })
    await call(a, 'PUT', '/api/me', { ...profile, planningRateJpyPerInr: '2.0' })
    const again = (await list(a, '?q=In%20Delhi')).items[0]
    expect(again.amountJpy).toBe(1695)
    const edited = await (await call(a, 'PATCH', `/api/transactions/${created.id}`, { description: 'In Delhi (taxi)' })).json()
    expect(edited.amountJpy).toBe(1695)
    const reAmount = await (await call(a, 'PATCH', `/api/transactions/${created.id}`, { amountInrPaise: 100000 })).json()
    expect(reAmount).toMatchObject({ amountJpy: 2000, rateUsed: '2.000000' })
    await call(a, 'PUT', '/api/me', profile)
  })

  it('refuses a ₹ amount that converts to ¥0', async () => {
    expect((await post(a, base({ amountInrPaise: 1 }))).status).toBe(400)
  })

  it('refuses an archived category, an unknown category and another user’s category with 400, never 500', async () => {
    for (const categoryId of [old, '00000000-0000-4000-8000-000000000000', bCat]) {
      const res = await post(a, base({ amountJpy: 100, categoryId }))
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('needs a profile for ₹ entries (409)', async () => {
    expect((await post(b, { ...base({ amountInrPaise: 50000 }), categoryId: bCat })).status).toBe(409)
  })

  it('filters by cycle using the 25th–24th window', async () => {
    await post(a, base({ occurredOn: '2026-10-24', amountJpy: 11, description: 'edge-24' }))
    await post(a, base({ occurredOn: '2026-10-25', amountJpy: 12, description: 'edge-25' }))
    const oct = (await list(a, '?cycle=2026-10&q=edge')).items.map((t: { description: string }) => t.description)
    const nov = (await list(a, '?cycle=2026-11&q=edge')).items.map((t: { description: string }) => t.description)
    expect(oct).toEqual(['edge-24'])
    expect(nov).toEqual(['edge-25'])
  })

  it('filters by category, payment method, need/want; totals cover all pages', async () => {
    await post(a, base({ categoryId: rent, amountJpy: 90000, paymentMethod: 'bank', needWant: 'need', description: 'October rent' }))
    await post(a, base({ categoryId: rent, amountJpy: 500, paymentMethod: 'credit_card', needWant: 'want', description: 'Rent fee' }))
    const byCat = await list(a, `?categoryId=${rent}&pageSize=1`)
    expect(byCat).toMatchObject({ total: 2, pageSize: 1, totalJpy: 90500 })
    expect(byCat.items).toHaveLength(1)
    expect((await list(a, `?categoryId=${rent}&paymentMethod=bank`)).total).toBe(1)
    expect((await list(a, `?categoryId=${rent}&needWant=want`)).items[0].description).toBe('Rent fee')
  })

  it('matches %, _ and \\ in the search text literally', async () => {
    await post(a, base({ amountJpy: 1, description: '50% off' }))
    await post(a, base({ amountJpy: 1, description: '50 percent off' }))
    await post(a, base({ amountJpy: 1, description: 'a_b' }))
    await post(a, base({ amountJpy: 1, description: 'axb' }))
    expect((await list(a, `?q=${encodeURIComponent('50%')}`)).items.map((t: { description: string }) => t.description)).toEqual(['50% off'])
    expect((await list(a, '?q=a_b')).items.map((t: { description: string }) => t.description)).toEqual(['a_b'])
  })

  it('sorts by amount ascending and by category name', async () => {
    const asc = (await list(a, '?sort=amountJpy&dir=asc&pageSize=200')).items.map((t: { amountJpy: number }) => t.amountJpy)
    expect(asc).toEqual([...asc].sort((x, y) => x - y))
    const byCat = (await list(a, '?sort=category&dir=asc&pageSize=200')).items.map((t: { categoryId: string }) => t.categoryId)
    expect(byCat.indexOf(food)).toBeLessThan(byCat.indexOf(rent)) // Food < Rent
  })

  it('rejects bad query values with 400', async () => {
    for (const qs of ['?pageSize=500', '?sort=userId', '?cycle=2026-13', `?q=${'x'.repeat(101)}`]) {
      expect((await call(a, 'GET', `/api/transactions${qs}`)).status).toBe(400)
    }
  })

  it('edits and deletes my rows; another user gets 404 and sees nothing', async () => {
    const t = await (await post(a, base({ amountJpy: 777, description: 'mine' }))).json()
    expect(await (await call(a, 'GET', `/api/transactions/${t.id}`)).json()).toMatchObject({ id: t.id, amountJpy: 777, description: 'mine' })
    expect((await call(b, 'GET', `/api/transactions/${t.id}`)).status).toBe(404)
    expect((await call(b, 'PATCH', `/api/transactions/${t.id}`, { amountJpy: 1 })).status).toBe(404)
    expect((await call(b, 'DELETE', `/api/transactions/${t.id}`)).status).toBe(404)
    expect((await list(b)).total).toBe(0)
    expect((await call(a, 'PATCH', `/api/transactions/${t.id}`, { amountJpy: 778, categoryId: rent })).status).toBe(200)
    expect((await call(a, 'DELETE', `/api/transactions/${t.id}`)).status).toBe(204)
    expect((await call(a, 'DELETE', `/api/transactions/${t.id}`)).status).toBe(404)
    expect((await call(a, 'PATCH', '/api/transactions/not-a-uuid', { amountJpy: 1 })).status).toBe(404)
  })
})
