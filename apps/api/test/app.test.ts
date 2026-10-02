import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { createApp } from '../src/app'
import { parseJson, toErrorResponse } from '../src/errors'

const config = { supabaseUrl: 'http://localhost:54321', jwtSecret: 'x'.repeat(32), databaseUrl: 'postgres://unused' }
const app = createApp({ config, getDb: () => { throw new Error('no db in unit tests') } })

// parseJson is exercised on a bare app so these tests keep passing once auth guards /api/* (Task 9).
const echo = new Hono()
echo.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
echo.post('/echo', async (c) => c.json(await parseJson(c, z.object({ n: z.number() }))))

describe('api skeleton', () => {
  it('GET /api/health returns ok without auth', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown routes return the error envelope with 404', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No route for GET /nope' } })
  })

  it('a non-JSON body returns 400 VALIDATION_FAILED, not 500', async () => {
    const res = await echo.request('/echo', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('a body failing the schema returns 400 with zod issues', async () => {
    const res = await echo.request('/echo', {
      method: 'POST', body: JSON.stringify({ n: 'one' }), headers: { 'content-type': 'application/json' },
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details[0].path).toEqual(['n'])
  })
})
