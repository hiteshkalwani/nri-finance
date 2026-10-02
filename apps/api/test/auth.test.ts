import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'
import { toErrorResponse } from '../src/errors'

const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 's'.repeat(40), databaseUrl: 'x' }
const issuer = `${config.supabaseUrl}/auth/v1`

function app() {
  const a = new Hono<{ Variables: AuthVars }>()
  a.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
  a.use('/api/*', authMiddleware(config))
  a.get('/api/whoami', (c) => c.json({ userId: c.var.userId, email: c.var.email }))
  return a
}

async function token(over: { secret?: string; iss?: string; aud?: string; exp?: string; sub?: string } = {}) {
  return new SignJWT({ email: 'me@example.test', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(over.sub ?? '11111111-1111-1111-1111-111111111111')
    .setIssuer(over.iss ?? issuer)
    .setAudience(over.aud ?? 'authenticated')
    .setExpirationTime(over.exp ?? '5m')
    .sign(new TextEncoder().encode(over.secret ?? config.jwtSecret))
}

const call = async (auth?: string) => app().request('/api/whoami', { headers: auth ? { authorization: auth } : {} })

describe('authMiddleware', () => {
  it('accepts a valid token and exposes userId and email', async () => {
    const res = await call(`Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: '11111111-1111-1111-1111-111111111111', email: 'me@example.test' })
  })
  it('rejects a missing header', async () => expect((await call()).status).toBe(401))
  it('rejects a token signed with another project’s secret', async () =>
    expect((await call(`Bearer ${await token({ secret: 'z'.repeat(40) })}`)).status).toBe(401))
  it('rejects the wrong issuer', async () =>
    expect((await call(`Bearer ${await token({ iss: 'https://other.supabase.co/auth/v1' })}`)).status).toBe(401))
  it('rejects the wrong audience (e.g. anon)', async () =>
    expect((await call(`Bearer ${await token({ aud: 'anon' })}`)).status).toBe(401))
  it('rejects an expired token with a readable message', async () => {
    const res = await call(`Bearer ${await token({ exp: '-1m' })}`)
    expect(res.status).toBe(401)
    expect((await res.json()).error.message).toMatch(/sign in again/i)
  })
})
