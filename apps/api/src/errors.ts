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

// Network-level failures (Node + postgres.js) that mean "can't reach the database at all".
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
])

function isDatabaseUnavailable(err: unknown): boolean {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    const code = (e as { code?: unknown } | null)?.code
    if (typeof code !== 'string') continue
    if (NETWORK_CODES.has(code)) return true
    if (code.startsWith('08') || code === '53300' || code.startsWith('57P')) return true // SQLSTATE connection/capacity/shutdown
    // Supavisor (the pooler) answers this for a paused or deleted project.
    if (code === 'XX000' && /tenant or user not found/i.test((e as Error).message)) return true
  }
  return false
}

// Readable messages for constraints a user can hit through the API; others get the generic one.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  transactions_category_owner: 'That category does not exist',
  transactions_account_owner: 'That account does not exist',
  categories_user_name: 'A category with that name already exists',
}

function pgConstraint(err: unknown): { code: string; constraint: string } | null {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    const code = (e as { code?: unknown } | null)?.code
    if (code === '23503' || code === '23505') {
      return { code, constraint: String((e as { constraint_name?: unknown }).constraint_name ?? '') }
    }
  }
  return null
}

export function toErrorResponse(err: unknown): { status: ContentfulStatusCode; body: object } {
  if (err instanceof ApiError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return { status: err.status, body: { error } }
  }
  const violation = pgConstraint(err)
  if (violation?.code === '23503') {
    const message = CONSTRAINT_MESSAGES[violation.constraint] ?? 'A referenced record does not exist'
    return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message, details: { constraint: violation.constraint } } } }
  }
  if (violation?.code === '23505') {
    const message = CONSTRAINT_MESSAGES[violation.constraint] ?? 'That already exists'
    return { status: 409, body: { error: { code: 'CONFLICT', message } } }
  }
  if (isDatabaseUnavailable(err)) {
    return {
      status: 503,
      body: {
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message:
            'The database is not reachable right now. If this lasts, open the Supabase dashboard — free projects pause after a week without use and need to be restored there.',
        },
      },
    }
  }
  console.error(err)
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server' } } }
}
