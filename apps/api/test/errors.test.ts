import { describe, expect, it } from 'vitest'
import { toErrorResponse } from '../src/errors'

const pgErr = (code: string, message = 'x') => Object.assign(new Error(message), { code })
const wrapped = (inner: Error) => Object.assign(new Error('Failed query: select 1'), { cause: inner })

describe('toErrorResponse: database unavailable', () => {
  it.each([
    ['refused (local)', pgErr('ECONNREFUSED')],
    ['reset socket after a frozen function', pgErr('ECONNRESET')],
    ['postgres.js closed connection', pgErr('CONNECTION_CLOSED')],
    ['postgres.js connect timeout', pgErr('CONNECT_TIMEOUT')],
    ['DNS failure', pgErr('EAI_AGAIN')],
    ['host unreachable', pgErr('EHOSTUNREACH')],
    ['connection exception class 08', pgErr('08006')],
    ['too many connections', pgErr('53300')],
    ['admin shutdown', pgErr('57P01')],
    ['cannot connect now', pgErr('57P03')],
    ['pooler: paused or missing project', pgErr('XX000', 'Tenant or user not found')],
    ['wrapped by Drizzle', wrapped(pgErr('ECONNRESET'))],
  ])('%s → 503', (_label, err) => {
    const r = toErrorResponse(err)
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } })
  })

  it('tells the user how to recover, not to wait', () => {
    const r = toErrorResponse(pgErr('ECONNREFUSED')) as { body: { error: { message: string } } }
    expect(r.body.error.message).toMatch(/Supabase dashboard/)
  })

  it('keeps ordinary query errors as 500', () => {
    expect(toErrorResponse(wrapped(pgErr('23505', 'duplicate key'))).status).toBe(500)
    expect(toErrorResponse(pgErr('XX000', 'some other internal error')).status).toBe(500)
  })
})
