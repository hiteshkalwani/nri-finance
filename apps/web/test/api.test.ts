import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))
import { ApiRequestError, apiFetch, setOnUnauthorized } from '../src/lib/api'

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
