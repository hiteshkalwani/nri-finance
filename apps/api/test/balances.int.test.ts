import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cycleOf, todayIn } from '@nri/core'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
let jpBank: string
let inBank: string
let jpCard: string
let bAccount: string

type Row = { accountId: string; country: string; amount: number | null; source: string; fromCycle: string | null }

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const createAccount = async (u: TestUser, body: Record<string, unknown>): Promise<string> =>
  (await (await call(u, 'POST', '/api/accounts', body)).json()).id
const put = (u: TestUser, body: unknown) => call(u, 'PUT', '/api/balances', body)
const get = (u: TestUser, qs = '') => call(u, 'GET', `/api/balances${qs}`)

beforeAll(async () => {
  a = await createTestUser('bal-a')
  b = await createTestUser('bal-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
  jpBank = await createAccount(a, { name: 'Postal bank', country: 'JP', type: 'bank' })
  inBank = await createAccount(a, { name: 'HDFC', country: 'IN', type: 'bank' })
  jpCard = await createAccount(a, { name: 'Rakuten card', country: 'JP', type: 'card' })
  bAccount = await createAccount(b, { name: 'Other bank', country: 'JP', type: 'bank' })
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('/api/balances', () => {
  it('GET prefills from the latest earlier cycle and marks the source', async () => {
    expect((await put(a, { cycle: '2026-09', entries: [{ accountId: jpBank, amount: 500000 }] })).status).toBe(200)
    const got = await (await get(a, '?cycle=2026-10')).json()
    expect(got.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({
      amount: 500000, source: 'carried', fromCycle: '2026-09',
    })
    expect(got.rows.find((r: Row) => r.accountId === inBank)).toMatchObject({
      amount: null, source: 'none', fromCycle: null,
    })
    expect(got.rows.map((r: Row) => r.country)).toEqual(['JP', 'JP', 'IN']) // Japan first
  })

  it('PUT twice for the same cycle updates in place; the second value wins', async () => {
    await put(a, { cycle: '2026-10', entries: [{ accountId: jpBank, amount: 100 }] })
    const res = await put(a, { cycle: '2026-10', entries: [{ accountId: jpBank, amount: 200 }] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({
      amount: 200, source: 'this', fromCycle: '2026-10',
    })

    const got = await (await get(a, '?cycle=2026-10')).json()
    expect(got.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({ amount: 200 })
  })

  it('round-trips ₹ paise exactly, including amounts above int32 paise', async () => {
    await put(a, { cycle: '2026-10', entries: [{ accountId: inBank, amount: 1234567 }] })
    const big = 300_000_000_000 // ₹3,000,000,000.00
    const res = await put(a, { cycle: '2026-10', entries: [{ accountId: inBank, amount: big }] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows.find((r: Row) => r.accountId === inBank)).toMatchObject({ amount: big, source: 'this' })

    const got = await (await get(a, '?cycle=2026-10')).json()
    expect(got.rows.find((r: Row) => r.accountId === inBank)).toMatchObject({ amount: big })
  })

  it('saves all entries or none: one foreign/archived account → 400 and nothing changes', async () => {
    const before = await (await get(a, '?cycle=2026-10')).json()
    const beforeJp = before.rows.find((r: Row) => r.accountId === jpBank)

    const res = await put(a, { cycle: '2026-10', entries: [{ accountId: jpBank, amount: 1 }, { accountId: bAccount, amount: 2 }] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toMatchObject([{ path: ['entries', 1, 'accountId'] }])

    const after = await (await get(a, '?cycle=2026-10')).json()
    expect(after.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject(beforeJp)
  })

  it("leaves accounts that aren't in the PUT untouched", async () => {
    await put(a, { cycle: '2026-10', entries: [{ accountId: jpCard, amount: 999 }] })
    const got = await (await get(a, '?cycle=2026-10')).json()
    expect(got.rows.find((r: Row) => r.accountId === jpCard)).toMatchObject({ amount: 999, source: 'this' })
    // Untouched by the PUT above — still what the earlier tests left it at.
    expect(got.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({ amount: 200 })
  })

  it('defaults GET to the current cycle; bad cycle → 400', async () => {
    const d = await (await get(a)).json()
    expect(d.cycle).toBe(cycleOf(todayIn('Asia/Tokyo'), 25))

    const bad = await get(a, '?cycle=2026-13')
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('rejects a ¥ amount above the integer column range (400), writing nothing', async () => {
    const res = await put(a, { cycle: '2026-10', entries: [{ accountId: jpBank, amount: 3_000_000_000 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).error.details).toMatchObject([{ path: ['entries', 0, 'amount'] }])

    const got = await (await get(a, '?cycle=2026-10')).json()
    expect(got.rows.find((r: Row) => r.accountId === jpBank)).toMatchObject({ amount: 200 })
  })
})
