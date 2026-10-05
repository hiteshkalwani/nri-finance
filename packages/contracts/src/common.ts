import { z } from 'zod'

export const ErrorCode = z.enum([
  'VALIDATION_FAILED', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'DATABASE_UNAVAILABLE', 'AUTH_UNAVAILABLE', 'INTERNAL',
])
export type ErrorCode = z.infer<typeof ErrorCode>
export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
})
export type ErrorBody = z.infer<typeof ErrorBody>

/** Postgres `integer` upper bound; yen and paise amounts must fit. */
export const PG_INT_MAX = 2_147_483_647

export const CycleString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')

/** A YYYY-MM-DD string that is also a real calendar date (rejects 2026-02-30). */
export const IsoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  }, 'Not a real calendar date')

/** ¥ per ₹, fits numeric(12,6) (at most 6 integer digits) and is greater than zero. */
export const RateString = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, 'Expected a rate with up to 6 digits before and 6 after the decimal point')
  .refine((s) => /[1-9]/.test(s), 'Rate must be greater than zero')

export const TimeZoneString = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, 'Unknown time zone')
