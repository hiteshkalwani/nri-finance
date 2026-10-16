import { z } from 'zod'
import { CycleString } from './common'

const InrPaiseAmount = z.number().int().positive().max(99_999_999_999_999)

/** Percent stored as numeric(5,2); `min`/`max` narrow it for a given field. */
const pctString = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Expected up to 3 digits and 2 decimal places')
    .refine((s) => Number(s) >= min && Number(s) <= max, `Must be between ${min} and ${max}`)

export const StepUpPct = pctString(0, 100)
export const ExpectedReturnPct = pctString(0, 100)
const AllocationPct = pctString(0.01, 100)
const Year = z.number().int().min(2000).max(2100)

export const SipAllocationInput = z.strictObject({
  fundName: z.string().trim().min(1, 'Fund name is required').max(60),
  pct: AllocationPct,
})

export const SipPlanInput = z
  .strictObject({
    startingMonthlyPaise: InrPaiseAmount,
    stepUpPct: StepUpPct,
    expectedReturnPct: ExpectedReturnPct,
    startYear: Year,
    endYear: Year,
    redirectEmiAfterPayoff: z.boolean(),
    allocations: z.array(SipAllocationInput).min(1),
  })
  .refine((o) => o.endYear >= o.startYear, { message: 'endYear must be on or after startYear', path: ['endYear'] })
  .refine(
    // SIP-2: compare in integer hundredths so float rounding never fakes a 100% total.
    (o) => o.allocations.reduce((s, a) => s + Math.round(Number(a.pct) * 100), 0) === 10_000,
    { message: 'Allocations must add up to exactly 100%', path: ['allocations'] },
  )
export type SipPlanInput = z.infer<typeof SipPlanInput>

export const SipPlan = z.object({
  startingMonthlyPaise: z.number().int(),
  stepUpPct: StepUpPct,
  expectedReturnPct: ExpectedReturnPct,
  startYear: z.number().int(),
  endYear: z.number().int(),
  redirectEmiAfterPayoff: z.boolean(),
  allocations: z.array(z.object({ fundName: z.string(), pct: AllocationPct })),
})
export type SipPlan = z.infer<typeof SipPlan>

export const SipYear = z.object({
  year: z.number().int(),
  monthlyPaise: z.number().int(),
  sipPaidPaise: z.number().int(),
  emiPaidPaise: z.number().int(),
  sipCorpusPaise: z.number().int(),
  emiCorpusPaise: z.number().int(),
})
export type SipYear = z.infer<typeof SipYear>

export const SipProjection = z.object({
  plan: SipPlan,
  years: z.array(SipYear),
  redirectFromCycle: CycleString.nullable(),
  actuals: z.array(z.object({ cycle: CycleString, paidPaise: z.number().int(), plannedPaise: z.number().int() })),
})
export type SipProjection = z.infer<typeof SipProjection>
