import type { ZodType } from 'zod'
import { supabase } from './supabase'

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
  }
}

let onUnauthorized: () => void = () => {}
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn }

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}, schema?: ZodType<T>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (data.session) headers.set('authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) onUnauthorized()
    const err = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `Request failed (${res.status})`, err?.details)
  }
  return schema ? schema.parse(body) : (body as T)
}

/** A 4xx response (bad input, unauthorized, not found, …) means the request itself is wrong — it will never succeed by retrying it as-is, unlike a 5xx or a network hiccup. */
export function isClientError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500
}

/**
 * vue-query `retry` option: up to 3 attempts, but never for a 4xx. 401 handling is unaffected —
 * `apiFetch` above calls `onUnauthorized()` (opens the sign-in dialog) on the very first 401,
 * before this is ever consulted, so skipping retries here only stops it firing redundantly on
 * attempts 2–4 of what was already a settled "sign in again."
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  return !isClientError(error) && failureCount < 3
}
