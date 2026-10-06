import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))
import { ApiRequestError, apiFetch, isClientError, retryUnlessClientError, setOnUnauthorized } from '../src/lib/api'

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('sends the bearer token and returns parsed JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await apiFetch('/api/health')).toEqual({ ok: true })
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    expect(headers.get('authorization')).toBe('Bearer tok-123')
  })

  it('turns the error envelope into ApiRequestError', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Bad input' } }), { status: 400 }))
    await expect(apiFetch('/api/me')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', message: 'Bad input' })
  })

  it('calls the unauthorized handler on 401 (expired session)', async () => {
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again' } }), { status: 401 }))
    await expect(apiFetch('/api/me')).rejects.toBeInstanceOf(ApiRequestError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})

// Fix round 2: a 4xx (bad input, unauthorized, not found, …) will never succeed by retrying it
// as-is — only a 5xx or a network error (not an ApiRequestError at all) should be retried.
describe('isClientError', () => {
  it('is true for any 4xx ApiRequestError', () => {
    expect(isClientError(new ApiRequestError(400, 'VALIDATION_FAILED', 'Bad input'))).toBe(true)
    expect(isClientError(new ApiRequestError(401, 'UNAUTHORIZED', 'Sign in again'))).toBe(true)
    expect(isClientError(new ApiRequestError(404, 'NOT_FOUND', 'Gone'))).toBe(true)
    expect(isClientError(new ApiRequestError(409, 'CONFLICT', 'Needs profile'))).toBe(true)
    expect(isClientError(new ApiRequestError(499, 'CLIENT_ERROR', 'Still 4xx'))).toBe(true)
  })
  it('is false for a 5xx ApiRequestError or a non-ApiRequestError error', () => {
    expect(isClientError(new ApiRequestError(500, 'INTERNAL', 'Server error'))).toBe(false)
    expect(isClientError(new ApiRequestError(503, 'UNAVAILABLE', 'Down'))).toBe(false)
    expect(isClientError(new TypeError('Failed to fetch'))).toBe(false) // a genuine network error
    expect(isClientError('not an error')).toBe(false)
  })
})

describe('retryUnlessClientError', () => {
  it('never retries a 4xx, regardless of how many attempts have already happened', () => {
    const e400 = new ApiRequestError(400, 'VALIDATION_FAILED', 'Bad input')
    expect(retryUnlessClientError(0, e400)).toBe(false)
    expect(retryUnlessClientError(1, e400)).toBe(false)
  })
  it('retries a 5xx or network error up to 3 times', () => {
    const e500 = new ApiRequestError(500, 'INTERNAL', 'Server error')
    expect(retryUnlessClientError(0, e500)).toBe(true)
    expect(retryUnlessClientError(2, e500)).toBe(true)
    expect(retryUnlessClientError(3, e500)).toBe(false)
  })
})
