import { expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { createDb } from '@nri/db'
import { createApp } from '../src/app'

it('returns 503 DATABASE_UNAVAILABLE when Postgres is unreachable', async () => {
  const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 's'.repeat(40), databaseUrl: 'postgres://u:p@127.0.0.1:1/x' }
  const { db, close } = createDb(config.databaseUrl)
  const app = createApp({ config, getDb: () => db })
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuer(`${config.supabaseUrl}/auth/v1`).setAudience('authenticated').setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.jwtSecret))
  const res = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
  expect(res.status).toBe(503)
  expect((await res.json()).error.code).toBe('DATABASE_UNAVAILABLE')
  await close()
})
