import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
const call = (u: TestUser, method: string, path: string, body?: unknown) => app.request(path, json(u.accessToken, method, body))
const profile = { salaryJpy: 300000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
const full = { savingsJpy: 300_000, emergencyFundJpy: 20_000, remittanceJpy: 100_000, prepaymentPaise: 500_000 }
const getT = (u: TestUser, cycle: string) => call(u, 'GET', `/api/targets/${cycle}`)
const putT = (u: TestUser, cycle: string, body: unknown) => call(u, 'PUT', `/api/targets/${cycle}`, body)
const copy = (u: TestUser, cycle: string, overwrite = false) =>
  call(u, 'POST', `/api/targets/${cycle}/copy-previous${overwrite ? '?overwrite=true' : ''}`)

beforeAll(async () => { a = await createTestUser('tgt-a'); b = await createTestUser('tgt-b'); await call(a, 'PUT', '/api/me', profile) })
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('GET /api/targets/:cycle', () => {
  it('is all null before anything is set', async () => {
    const res = await getT(a, '2026-10')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cycle: '2026-10', savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null })
  })

  it('rejects a bad cycle (400)', async () => {
    expect((await getT(a, '2026-13')).status).toBe(400)
  })
})

describe('PUT /api/targets/:cycle', () => {
  it('sets all four targets, and clearing with null round-trips (TGT-1)', async () => {
    const res = await putT(a, '2026-10', full)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cycle: '2026-10', ...full })
    expect(await (await getT(a, '2026-10')).json()).toEqual({ cycle: '2026-10', ...full })

    const cleared = { savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }
    await putT(a, '2026-10', cleared)
    expect(await (await getT(a, '2026-10')).json()).toEqual({ cycle: '2026-10', ...cleared })
    await putT(a, '2026-10', full) // restore for later tests
  })

  it('rejects a negative value and a missing key (400)', async () => {
    expect((await putT(a, '2026-10', { ...full, savingsJpy: -1 })).status).toBe(400)
    const partial = { emergencyFundJpy: full.emergencyFundJpy, remittanceJpy: full.remittanceJpy, prepaymentPaise: full.prepaymentPaise }
    expect((await putT(a, '2026-10', partial)).status).toBe(400)
  })

  it('never lets me see or change another user’s targets', async () => {
    expect(await (await getT(b, '2026-10')).json()).toMatchObject({ savingsJpy: null })
    await putT(b, '2026-10', { savingsJpy: 1, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null })
    expect(await (await getT(a, '2026-10')).json()).toMatchObject(full)
  })
})

describe('POST /api/targets/:cycle/copy-previous', () => {
  it('400s with a clear message when the previous cycle has none to copy', async () => {
    const res = await copy(a, '2026-01')
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/2025-12/)
  })

  it('copies the previous cycle’s targets; 409 if the target cycle already has some, unless overwrite=true', async () => {
    const ok = await copy(a, '2026-11')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ cycle: '2026-11', ...full })

    await putT(a, '2026-11', { savingsJpy: 1, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null })
    const conflict = await copy(a, '2026-11')
    expect(conflict.status).toBe(409)
    expect(await (await getT(a, '2026-11')).json()).toMatchObject({ savingsJpy: 1 })

    const overwritten = await copy(a, '2026-11', true)
    expect(overwritten.status).toBe(200)
    expect(await overwritten.json()).toEqual({ cycle: '2026-11', ...full })
  })
})
