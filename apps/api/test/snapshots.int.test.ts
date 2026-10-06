import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { accounts, balanceSnapshots, createDb, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { loadNetWorthInputs } from '../src/services/snapshots'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser
let acc1: string // archived 2026-10-24T14:30:00Z = 23:30 JST on the 24th → still cycle '2026-10'
let acc2: string // archived 2026-10-24T15:30:00Z = 00:30 JST on the 25th → rolls to cycle '2026-11'
let acc3: string // never archived → archivedCycle null
let bAccount: string

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const createAccount = async (u: TestUser, body: Record<string, unknown>): Promise<string> =>
  (await (await call(u, 'POST', '/api/accounts', body)).json()).id
const archiveAt = (u: TestUser, accountId: string, at: string) =>
  withUser(db, { sub: u.id }, (tx) =>
    tx.update(accounts).set({ archivedAt: new Date(at) }).where(eq(accounts.id, accountId)))

beforeAll(async () => {
  a = await createTestUser('snap-a')
  b = await createTestUser('snap-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
  acc1 = await createAccount(a, { name: 'Archived same cycle', country: 'JP', type: 'bank' })
  acc2 = await createAccount(a, { name: 'Archived next cycle', country: 'JP', type: 'bank' })
  acc3 = await createAccount(a, { name: 'Still active', country: 'JP', type: 'bank' })
  bAccount = await createAccount(b, { name: "Someone else's account", country: 'JP', type: 'bank' })

  // Bypass the API (which stamps archived_at with `now()`) to pin exact instants either side of midnight JST.
  await archiveAt(a, acc1, '2026-10-24T14:30:00Z')
  await archiveAt(a, acc2, '2026-10-24T15:30:00Z')

  await withUser(db, { sub: a.id }, (tx) =>
    tx.insert(balanceSnapshots).values({ userId: a.id, accountId: acc3, cycle: '2026-10', balanceJpy: 1000, recordedOn: '2026-10-25' }))
  await withUser(db, { sub: b.id }, (tx) =>
    tx.insert(balanceSnapshots).values({ userId: b.id, accountId: bAccount, cycle: '2026-10', balanceJpy: 2000, recordedOn: '2026-10-25' }))
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close(); await closeDb() })

describe('loadNetWorthInputs', () => {
  it('converts archived_at to the cycle it falls in, in the profile timezone; active accounts get null', async () => {
    const { accounts: loaded } = await withUser(db, { sub: a.id }, (tx) => loadNetWorthInputs(tx, a.id, 25, 'Asia/Tokyo'))
    const byId = new Map(loaded.map((acc) => [acc.id, acc]))

    expect(byId.get(acc1)).toMatchObject({ archived: true, archivedCycle: '2026-10' })
    expect(byId.get(acc2)).toMatchObject({ archived: true, archivedCycle: '2026-11' })
    expect(byId.get(acc3)).toMatchObject({ archived: false, archivedCycle: null })
  })

  it("returns only the caller's accounts and snapshots", async () => {
    const { accounts: loaded, snaps } = await withUser(db, { sub: a.id }, (tx) => loadNetWorthInputs(tx, a.id, 25, 'Asia/Tokyo'))

    expect(loaded.map((acc) => acc.id)).not.toContain(bAccount)
    expect(snaps.map((s) => s.accountId)).not.toContain(bAccount)
    expect(snaps.some((s) => s.accountId === acc3)).toBe(true)
  })
})
