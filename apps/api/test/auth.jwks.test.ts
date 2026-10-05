import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { Config } from '../src/config'
import { toErrorResponse } from '../src/errors'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'

// What tokens name as issuer. Unreachable from here, just as 127.0.0.1:54321 is unreachable inside the app container.
const publicUrl = 'http://supabase.public.invalid:54321'
let server: Server
let internalUrl: string
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let requested = ''

beforeAll(async () => {
  const pair = await generateKeyPair('ES256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  server = createServer((req, res) => {
    requested = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  internalUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const token = () =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('22222222-2222-2222-2222-222222222222')
    .setIssuer(`${publicUrl}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(privateKey)

async function call(config: Config) {
  const app = new Hono<{ Variables: AuthVars }>()
  app.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
  app.use('/api/*', authMiddleware(config))
  app.get('/api/whoami', (c) => c.json({ userId: c.var.userId }))
  return app.request('/api/whoami', { headers: { authorization: `Bearer ${await token()}` } })
}

it('fetches keys from the internal URL and still checks the public issuer', async () => {
  const res = await call({ supabaseUrl: publicUrl, authInternalUrl: internalUrl, databaseUrl: 'x' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ userId: '22222222-2222-2222-2222-222222222222' })
  expect(requested).toBe('/auth/v1/.well-known/jwks.json')
})

it('rejects a token whose issuer is not this project, even though the key verifies', async () => {
  const res = await call({ supabaseUrl: 'http://another.invalid:54321', authInternalUrl: internalUrl, databaseUrl: 'x' })
  expect(res.status).toBe(401)
})

it('answers 503 AUTH_UNAVAILABLE, not 401, when the key server is unreachable', async () => {
  const res = await call({ supabaseUrl: publicUrl, authInternalUrl: 'http://127.0.0.1:9', databaseUrl: 'x' })
  expect(res.status).toBe(503)
  expect((await res.json()).error.code).toBe('AUTH_UNAVAILABLE')
})

it('answers 503 when the key server returns an error page', async () => {
  const broken = createServer((_req, res) => { res.statusCode = 502; res.end('bad gateway') })
  await new Promise<void>((resolve) => broken.listen(0, '127.0.0.1', resolve))
  try {
    const res = await call({ supabaseUrl: publicUrl, authInternalUrl: `http://127.0.0.1:${(broken.address() as AddressInfo).port}`, databaseUrl: 'x' })
    expect(res.status).toBe(503)
  } finally {
    await new Promise<void>((resolve) => broken.close(() => resolve()))
  }
})
