import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { effectiveRate } from '@nri/core'
import { createDb, loans, withUser } from '@nri/db'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
const { db, close: closeDb } = createDb(process.env.DATABASE_URL!)
let a: TestUser
let b: TestUser
let jpBank: string, inBank: string, bJpBank: string
let loanA: string, loanB: string

const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const createAccount = async (u: TestUser, b2: Record<string, unknown>): Promise<string> =>
  (await (await call(u, 'POST', '/api/accounts', b2)).json()).id
const base = (over: Record<string, unknown> = {}) => ({
  sentOn: '2026-10-01', jpySent: 100000, inrPaise: 5900000, service: 'wise', purpose: 'family',
  fromAccountId: jpBank, toAccountId: inBank, ...over,
})
const post = (u: TestUser, body: unknown) => call(u, 'POST', '/api/remittances', body)
const patch = (u: TestUser, id: string, body: unknown) => call(u, 'PATCH', `/api/remittances/${id}`, body)
const get = (u: TestUser, path: string) => call(u, 'GET', path)

beforeAll(async () => {
  a = await createTestUser('rem-a')
  b = await createTestUser('rem-b')
  await call(a, 'PUT', '/api/me', profile)
  await call(b, 'PUT', '/api/me', profile)
  jpBank = await createAccount(a, { name: 'Postal bank', country: 'JP', type: 'bank' })
  inBank = await createAccount(a, { name: 'HDFC', country: 'IN', type: 'bank' })
  bJpBank = await createAccount(b, { name: 'B bank', country: 'JP', type: 'bank' })
  loanA = await withUser(db, { sub: a.id }, async (tx) =>
    (await tx.insert(loans).values({
      userId: a.id, name: 'Home loan', principalInr: '1000000.00', annualRatePct: '8.500', emiInr: '10000.00',
      tenureMonths: 240, startCycle: '2026-01',
    }).returning())[0]!.id)
  loanB = await withUser(db, { sub: b.id }, async (tx) =>
    (await tx.insert(loans).values({
      userId: b.id, name: 'B loan', principalInr: '1000000.00', annualRatePct: '8.500', emiInr: '10000.00',
      tenureMonths: 240, startCycle: '2026-01',
    }).returning())[0]!.id)
})
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close(); await closeDb() })

describe('POST /api/remittances', () => {
  it('creates a transfer and computes the effective rate', async () => {
    const res = await post(a, base())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      sentOn: '2026-10-01', jpySent: 100000, inrPaise: 5900000, feeJpy: 0, service: 'wise', purpose: 'family',
      fromAccountId: jpBank, toAccountId: inBank, loanId: null, notes: '',
    })
    expect(body.rate).toBe(effectiveRate(100000, 5900000))
  })

  it('refuses a fee greater than ¥ sent (400)', async () => {
    const res = await post(a, base({ jpySent: 1000, feeJpy: 1001 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('requires a loanId for loan_emi/loan_prepayment, and rejects one for other purposes (400)', async () => {
    const missing = await post(a, base({ purpose: 'loan_emi' }))
    expect(missing.status).toBe(400)
    const extra = await post(a, base({ purpose: 'family', loanId: loanA }))
    expect(extra.status).toBe(400)
    const ok = await post(a, base({ purpose: 'loan_emi', loanId: loanA }))
    expect(ok.status).toBe(201)
  })

  it("refuses another user's loan (400)", async () => {
    const res = await post(a, base({ purpose: 'loan_emi', loanId: loanB }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses an unknown loanId (400)', async () => {
    const res = await post(a, base({ purpose: 'loan_emi', loanId: '00000000-0000-0000-0000-000000000000' }))
    expect(res.status).toBe(400)
  })

  it('requires fromAccountId to be one of my Japan accounts', async () => {
    const wrongCountry = await post(a, base({ fromAccountId: inBank }))
    expect(wrongCountry.status).toBe(400)
    const foreign = await post(a, base({ fromAccountId: bJpBank }))
    expect(foreign.status).toBe(400)
  })

  it('requires toAccountId to be one of my India accounts', async () => {
    const wrongCountry = await post(a, base({ toAccountId: jpBank }))
    expect(wrongCountry.status).toBe(400)
  })

  it('allows omitting from/to accounts', async () => {
    const res = await post(a, base({ fromAccountId: undefined, toAccountId: undefined }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ fromAccountId: null, toAccountId: null })
  })
})

describe('GET/PATCH/DELETE /api/remittances/:id', () => {
  it('round-trips a single remittance and 404s for another user or an unknown id', async () => {
    const created = await (await post(a, base({ notes: 'trip' }))).json()
    const res = await get(a, `/api/remittances/${created.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ notes: 'trip' })

    expect((await get(b, `/api/remittances/${created.id}`)).status).toBe(404)
    expect((await get(a, '/api/remittances/00000000-0000-0000-0000-000000000000')).status).toBe(404)
  })

  it('merges a patch onto the stored row and re-validates the full set of rules', async () => {
    const created = await (await post(a, base({ jpySent: 10000, feeJpy: 100 }))).json()
    const res = await patch(a, created.id, { feeJpy: 20000 }) // now exceeds jpySent (unchanged at 10000)
    expect(res.status).toBe(400)

    const ok = await patch(a, created.id, { notes: 'edited' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ notes: 'edited', jpySent: 10000, feeJpy: 100 })
  })

  it("never patches or deletes another user's remittance (404)", async () => {
    const created = await (await post(a, base())).json()
    expect((await patch(b, created.id, { notes: 'hijack' })).status).toBe(404)
    expect((await call(b, 'DELETE', `/api/remittances/${created.id}`)).status).toBe(404)
  })

  it('allows an unchanged archived account on patch, but refuses switching to one that is archived', async () => {
    const toArchive = await createAccount(a, { name: 'To be archived', country: 'JP', type: 'bank' })
    const other = await createAccount(a, { name: 'Another JP', country: 'JP', type: 'bank' })
    const created = await (await post(a, base({ fromAccountId: toArchive }))).json()
    expect((await call(a, 'PATCH', `/api/accounts/${toArchive}`, { archived: true })).status).toBe(200)

    const unchanged = await patch(a, created.id, { notes: 'still fine' })
    expect(unchanged.status).toBe(200)

    expect((await call(a, 'PATCH', `/api/accounts/${other}`, { archived: true })).status).toBe(200)
    const switched = await patch(a, created.id, { fromAccountId: other })
    expect(switched.status).toBe(400)
  })

  it('deletes a remittance; a second delete 404s', async () => {
    const created = await (await post(a, base())).json()
    expect((await call(a, 'DELETE', `/api/remittances/${created.id}`)).status).toBe(204)
    expect((await get(a, `/api/remittances/${created.id}`)).status).toBe(404)
    expect((await call(a, 'DELETE', `/api/remittances/${created.id}`)).status).toBe(404)
  })
})

describe('GET /api/remittances (list + totals)', () => {
  it('filters by cycle and purpose, sorts sentOn desc, and totals honour the filter', async () => {
    await post(a, base({ sentOn: '2026-11-05', jpySent: 1000, inrPaise: 59000, purpose: 'family' }))
    const early = await (await post(a, base({ sentOn: '2026-11-10', jpySent: 2000, inrPaise: 118000, purpose: 'family' }))).json()
    const late = await (await post(a, base({ sentOn: '2026-11-20', jpySent: 3000, inrPaise: 177000, purpose: 'sip' }))).json()

    const all = await (await get(a, '/api/remittances?cycle=2026-11')).json()
    expect(all.items.map((i: { id: string }) => i.id).slice(0, 2)).toEqual([late.id, early.id])
    expect(all.totals).toMatchObject({ jpySent: 6000, inrPaise: 354000, count: 3 })
    expect(all.totals.avgRate).toBe(effectiveRate(6000, 354000))
    expect(all.totals.byPurpose).toEqual(
      expect.arrayContaining([
        { purpose: 'family', jpySent: 3000, inrPaise: 177000, count: 2 },
        { purpose: 'sip', jpySent: 3000, inrPaise: 177000, count: 1 },
      ]),
    )

    const filtered = await (await get(a, '/api/remittances?cycle=2026-11&purpose=sip')).json()
    expect(filtered.items).toHaveLength(1)
    expect(filtered.totals).toMatchObject({ jpySent: 3000, inrPaise: 177000, count: 1 })
  })

  it('returns an empty list with a null avgRate when nothing was sent in the cycle', async () => {
    const body = await (await get(a, '/api/remittances?cycle=2099-01')).json()
    expect(body.items).toEqual([])
    expect(body.totals).toMatchObject({ jpySent: 0, inrPaise: 0, count: 0, avgRate: null, byPurpose: [] })
  })

  it('shows nothing of another user’s transfers', async () => {
    const body = await (await get(b, '/api/remittances?cycle=2026-11')).json()
    expect(body.items).toEqual([])
  })

  it('rejects a bad cycle or purpose with 400', async () => {
    expect((await get(a, '/api/remittances?cycle=2026-13')).status).toBe(400)
    expect((await get(a, '/api/remittances?purpose=nope')).status).toBe(400)
  })
})

describe('GET /api/remittances/rates', () => {
  it('returns the last N transfers oldest→newest, with a 6-decimal planning rate', async () => {
    const c = await createTestUser('rem-rates')
    await call(c, 'PUT', '/api/me', { ...profile, planningRateJpyPerInr: '1.7' })
    const jp = await createAccount(c, { name: 'JP', country: 'JP', type: 'bank' })
    const inr = await createAccount(c, { name: 'IN', country: 'IN', type: 'bank' })
    const mk = (sentOn: string, jpySent: number, inrPaise: number) =>
      post(c, { sentOn, jpySent, inrPaise, service: 'wise', purpose: 'family', fromAccountId: jp, toAccountId: inr })
    await mk('2026-10-01', 1000, 59000)
    await mk('2026-10-05', 2000, 118000)
    await mk('2026-10-10', 3000, 177000)

    const res = await get(c, '/api/remittances/rates?limit=2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.planningRate).toBe('1.700000')
    expect(body.points.map((p: { sentOn: string }) => p.sentOn)).toEqual(['2026-10-05', '2026-10-10'])
    expect(body.points[0].rate).toBe(effectiveRate(2000, 118000))

    const all = await (await get(c, '/api/remittances/rates')).json()
    expect(all.points).toHaveLength(3)
    await deleteTestUser(c.id)
  })

  it('rejects an out-of-range limit (400)', async () => {
    expect((await get(a, '/api/remittances/rates?limit=0')).status).toBe(400)
    expect((await get(a, '/api/remittances/rates?limit=61')).status).toBe(400)
  })
})

describe('GET /api/loans', () => {
  it("lists my loans ordered by name, never another user's", async () => {
    const res = await get(a, '/api/loans')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: loanA, name: 'Home loan', closedAt: null }])
    expect((await (await get(b, '/api/loans')).json())).toEqual([{ id: loanB, name: 'B loan', closedAt: null }])
  })
})
