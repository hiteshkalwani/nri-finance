import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'
import type { ErrorCode } from '@nri/contracts'

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON')
  }
  const r = schema.safeParse(raw)
  if (!r.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body is invalid', r.error.issues)
  return r.data
}

const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', '57P01', '57P03'])

export function toErrorResponse(err: unknown): { status: ContentfulStatusCode; body: object } {
  if (err instanceof ApiError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return { status: err.status, body: { error } }
  }
  const code = (err as { code?: string } | null)?.code ?? (err as { cause?: { code?: string } })?.cause?.code
  if (code && DB_DOWN_CODES.has(code)) {
    return {
      status: 503,
      body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is not reachable right now (it may be waking up). Try again in a minute.' } },
    }
  }
  console.error(err)
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server' } } }
}
