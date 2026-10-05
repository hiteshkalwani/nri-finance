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

  it('keeps an unrecognized internal error code as 500', () => {
    // 23505 (unique violation) is deliberately NOT included here: it's now mapped to 409, see "constraint violations" below.
    expect(toErrorResponse(pgErr('XX000', 'some other internal error')).status).toBe(500)
  })
})

describe('constraint violations', () => {
  const wrapped = (code: string, constraint: string) =>
    Object.assign(new Error('Failed query: insert …'), { cause: Object.assign(new Error('violates'), { code, constraint_name: constraint }) })

  it('turns a foreign-key violation into 400, not 500', () => {
    const r = toErrorResponse(wrapped('23503', 'transactions_category_owner'))
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'That category does not exist' } })
  })
  it('turns a duplicate category name into 409 with a readable message', () => {
    const r = toErrorResponse(wrapped('23505', 'categories_user_name'))
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ error: { code: 'CONFLICT', message: 'A category with that name already exists' } })
  })
  it('falls back to a generic message for other constraints', () => {
    expect(toErrorResponse(wrapped('23503', 'something_else')).body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'A referenced record does not exist' },
    })
  })
})
