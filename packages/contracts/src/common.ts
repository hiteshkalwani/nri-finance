import { z } from 'zod'

export const ErrorCode = z.enum([
  'VALIDATION_FAILED', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'DATABASE_UNAVAILABLE', 'INTERNAL',
])
export type ErrorCode = z.infer<typeof ErrorCode>
export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
})
export type ErrorBody = z.infer<typeof ErrorBody>

export const CycleString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
export const IsoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
export const RateString = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Expected a rate with up to 6 decimals')
