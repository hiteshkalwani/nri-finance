import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, transactions, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser
const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const create = async (u: TestUser, name: string, color = '#4caf50') => (await (await call(u, 'POST', '/api/categories', { name, color })).json())

beforeAll(async () => { a = await createTestUser('cat-a'); b = await createTestUser('cat-b') })
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close(); await closeDb() })

describe('/api/categories', () => {
  it('creates categories at the end of the order and lists them', async () => {
    const food = await create(a, 'Food')
    const rent = await create(a, 'Rent', '#2196f3')
    expect(food).toMatchObject({ name: 'Food', color: '#4caf50', archived: false, inUse: false, lastPaymentMethod: null })
    expect(rent.sortOrder).toBe(food.sortOrder + 1)
    const list = await (await call(a, 'GET', '/api/categories')).json()
    expect(list.items.map((c: { name: string }) => c.name)).toEqual(['Food', 'Rent'])
  })

  it('refuses a duplicate name regardless of case (409) and a bad colour (400)', async () => {
    expect((await call(a, 'POST', '/api/categories', { name: 'food', color: '#000000' })).status).toBe(409)
    expect((await call(a, 'POST', '/api/categories', { name: 'Travel', color: 'red' })).status).toBe(400)
  })

  it('renames, recolours and archives', async () => {
    const c = await create(a, 'Snacks')
    const res = await call(a, 'PATCH', `/api/categories/${c.id}`, { name: 'Treats', color: '#ff9800', archived: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Treats', color: '#ff9800', archived: true })
    expect(await (await call(a, 'PATCH', `/api/categories/${c.id}`, { archived: false })).json()).toMatchObject({ archived: false })
  })

  it('reports last payment method and need/want from the latest transaction, and inUse', async () => {
    const c = await create(a, 'Transport')
    await withUser(db, { sub: a.id }, (tx) => tx.insert(transactions).values([
      { userId: a.id, occurredOn: '2026-10-01', categoryId: c.id, amountJpy: 200, paymentMethod: 'cash', needWant: 'want' },
      { userId: a.id, occurredOn: '2026-10-03', categoryId: c.id, amountJpy: 180, paymentMethod: 'ic_card', needWant: 'need' },
    ]))
    const got = (await (await call(a, 'GET', '/api/categories')).json()).items.find((x: { id: string }) => x.id === c.id)
    expect(got).toMatchObject({ inUse: true, lastPaymentMethod: 'ic_card', lastNeedWant: 'need' })
  })

  it('deletes an unused category, refuses one in use with 409', async () => {
    const unused = await create(a, 'Unused')
    expect((await call(a, 'DELETE', `/api/categories/${unused.id}`)).status).toBe(204)
    const used = (await (await call(a, 'GET', '/api/categories')).json()).items.find((x: { name: string }) => x.name === 'Transport')
    const res = await call(a, 'DELETE', `/api/categories/${used.id}`)
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toMatch(/archive it instead/)
  })

  it('reorders with exactly my ids, and refuses missing, repeated or foreign ids without changing anything', async () => {
    const before = (await (await call(a, 'GET', '/api/categories')).json()).items.map((c: { id: string }) => c.id) as string[]
    const reversed = [...before].reverse()
    const ok = await call(a, 'PUT', '/api/categories/order', { ids: reversed })
    expect(ok.status).toBe(200)
    expect((await ok.json()).items.map((c: { id: string }) => c.id)).toEqual(reversed)

    const bCat = await create(b, 'B only')
    for (const ids of [reversed.slice(1), [...reversed, reversed[0]], [...reversed.slice(1), bCat.id]]) {
      expect((await call(a, 'PUT', '/api/categories/order', { ids })).status).toBe(400)
    }
    const after = (await (await call(a, 'GET', '/api/categories')).json()).items.map((c: { id: string }) => c.id)
    expect(after).toEqual(reversed)
  })

  it('never shows or changes another user’s categories', async () => {
    const mine = await create(a, 'Private')
    expect((await (await call(b, 'GET', '/api/categories')).json()).items.map((c: { name: string }) => c.name)).not.toContain('Private')
    expect((await call(b, 'PATCH', `/api/categories/${mine.id}`, { name: 'Taken' })).status).toBe(404)
    expect((await call(b, 'DELETE', `/api/categories/${mine.id}`)).status).toBe(404)
  })
})
