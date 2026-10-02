import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { json, testApp } from './helpers'

const { app, close } = testApp()
let a: TestUser
let b: TestUser
const profile = { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }

beforeAll(async () => { a = await createTestUser('me-a'); b = await createTestUser('me-b') })
afterAll(async () => { await deleteTestUser(a.id); await deleteTestUser(b.id); await close() })

describe('/api/me', () => {
  it('returns profile null before one is saved', async () => {
    const res = await app.request('/api/me', json(a.accessToken, 'GET'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: a.id, email: a.email, profile: null })
  })

  it('saves and returns the profile, rate kept exact', async () => {
    const put = await app.request('/api/me', json(a.accessToken, 'PUT', profile))
    expect(put.status).toBe(200)
    expect((await put.json()).profile).toEqual(profile)
    const again = await app.request('/api/me', json(a.accessToken, 'PUT', { ...profile, salaryJpy: 700000 }))
    expect((await again.json()).profile.salaryJpy).toBe(700000)
  })

  it('never shows one user’s profile to another', async () => {
    const res = await app.request('/api/me', json(b.accessToken, 'GET'))
    expect((await res.json()).profile).toBeNull()
  })

  it('rejects an invalid profile with 400 and does not write', async () => {
    const res = await app.request('/api/me', json(b.accessToken, 'PUT', { ...profile, cycleStartDay: 31 }))
    expect(res.status).toBe(400)
    expect((await (await app.request('/api/me', json(b.accessToken, 'GET'))).json()).profile).toBeNull()
  })
})
