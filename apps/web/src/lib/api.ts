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
