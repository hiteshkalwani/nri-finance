import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceSnapshots, createDb, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser
const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const create = async (u: TestUser, body: Record<string, unknown>) => (await (await call(u, 'POST', '/api/accounts', body)).json())

beforeAll(async () => { a = await createTestUser('acc-a'); b = await createTestUser('acc-b') })
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close(); await closeDb() })

describe('/api/accounts', () => {
  it('creates an account with currency derived from country', async () => {
    const res = await call(a, 'POST', '/api/accounts', { name: 'HDFC savings', country: 'IN', type: 'bank', isEmergencyFund: true })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      name: 'HDFC savings', country: 'IN', currency: 'INR', isEmergencyFund: true, archived: false, hasBalances: false,
    })
  })

  it('refuses a duplicate active name (case-insensitive) with 409, allows reusing an archived name', async () => {
    const acc = await create(a, { name: 'Shared Name', country: 'IN', type: 'bank' })
    const dup = await call(a, 'POST', '/api/accounts', { name: 'shared name', country: 'JP', type: 'cash' })
    expect(dup.status).toBe(409)
    expect((await dup.json()).error.message).toBe('You already have an account called "shared name"')

    const archiveRes = await call(a, 'PATCH', `/api/accounts/${acc.id}`, { archived: true })
    expect(archiveRes.status).toBe(200)
    expect((await archiveRes.json()).archived).toBe(true)

    const reused = await call(a, 'POST', '/api/accounts', { name: 'Shared Name', country: 'JP', type: 'cash' })
    expect(reused.status).toBe(201)
    expect(await reused.json()).toMatchObject({ name: 'Shared Name', country: 'JP', currency: 'JPY' })
  })

  it('renames, retypes, flags and archives; list hides archived unless include=archived', async () => {
    const acc = await create(a, { name: 'Daily wallet', country: 'JP', type: 'cash' })
    const patched = await call(a, 'PATCH', `/api/accounts/${acc.id}`, {
      name: 'Main wallet', type: 'bank', isEmergencyFund: true,
    })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ name: 'Main wallet', type: 'bank', isEmergencyFund: true, archived: false })

    const archived = await call(a, 'PATCH', `/api/accounts/${acc.id}`, { archived: true })
    expect(archived.status).toBe(200)
    expect((await archived.json()).archived).toBe(true)

    const activeOnly = await (await call(a, 'GET', '/api/accounts')).json()
    expect(activeOnly.items.map((x: { id: string }) => x.id)).not.toContain(acc.id)

    const withArchived = await (await call(a, 'GET', '/api/accounts?include=archived')).json()
    const found = withArchived.items.find((x: { id: string }) => x.id === acc.id)
    expect(found).toMatchObject({ name: 'Main wallet', archived: true })

    const unarchived = await call(a, 'PATCH', `/api/accounts/${acc.id}`, { archived: false })
    expect(unarchived.status).toBe(200)
    expect((await unarchived.json()).archived).toBe(false)
  })

  it('locks country once the account has balances (409), allows it before', async () => {
    const acc = await create(a, { name: 'Postal savings', country: 'JP', type: 'bank' })

    const changed = await call(a, 'PATCH', `/api/accounts/${acc.id}`, { country: 'IN' })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ country: 'IN', currency: 'INR' })

    await withUser(db, { sub: a.id }, (tx) => tx.insert(balanceSnapshots).values({
      userId: a.id, accountId: acc.id, cycle: '2026-10', balanceInr: '1000.00', recordedOn: '2026-10-25',
    }))

    const nowHasBalances = await (await call(a, 'GET', '/api/accounts?include=archived')).json()
    expect(nowHasBalances.items.find((x: { id: string }) => x.id === acc.id)).toMatchObject({ hasBalances: true })

    const locked = await call(a, 'PATCH', `/api/accounts/${acc.id}`, { country: 'JP' })
    expect(locked.status).toBe(409)
    expect((await locked.json()).error.message).toBe('This account has balances; add a new account instead')
  })

  it("never shows or edits another user's account (404)", async () => {
    const mine = await create(a, { name: 'Private account', country: 'JP', type: 'bank' })
    const patchRes = await call(b, 'PATCH', `/api/accounts/${mine.id}`, { name: 'Taken' })
    expect(patchRes.status).toBe(404)
    const bList = await (await call(b, 'GET', '/api/accounts')).json()
    expect(bList.items.map((x: { id: string }) => x.id)).not.toContain(mine.id)
  })
})
