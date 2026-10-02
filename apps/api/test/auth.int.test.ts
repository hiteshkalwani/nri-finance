import { afterAll, beforeAll, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { loadConfig } from '../src/config'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'

let user: TestUser
beforeAll(async () => { user = await createTestUser('auth') })
afterAll(async () => { await deleteTestUser(user.id) })

it('accepts a token issued by local Supabase Auth', async () => {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('/api/*', authMiddleware(loadConfig(process.env)))
  app.get('/api/whoami', (c) => c.json({ userId: c.var.userId }))
  const res = await app.request('/api/whoami', { headers: { authorization: `Bearer ${user.accessToken}` } })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ userId: user.id })
})

it('keeps public sign-up closed (AUTH-3)', async () => {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `stranger-${Date.now()}@example.test`, password: 'longenough123' }),
  })
  expect(res.status).toBe(422)
  expect((await res.json()).error_code).toBe('signup_disabled')
})
