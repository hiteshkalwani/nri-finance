import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { profiles } from '@nri/db'
import { ApiError } from '../src/errors'
import { json, testApp } from './helpers'

const { app, close } = testApp()
// A handler that writes, then fails: the whole request must leave nothing behind.
app.put('/api/_write-then-fail', async (c) => {
  await c.var.db.insert(profiles).values({ userId: c.var.userId, salaryJpy: 1, planningRateJpyPerInr: '1.7', cycleStartDay: 25 })
  throw new ApiError(400, 'VALIDATION_FAILED', 'fails after writing')
})
let u: TestUser

beforeAll(async () => { u = await createTestUser('rollback') })
afterAll(async () => { await deleteTestUser(u.id); await close() })

it('rolls back writes when the handler fails after writing', async () => {
  const res = await app.request('/api/_write-then-fail', json(u.accessToken, 'PUT', {}))
  expect(res.status).toBe(400)
  const me = await (await app.request('/api/me', json(u.accessToken, 'GET'))).json()
  expect(me.profile).toBeNull()
})
