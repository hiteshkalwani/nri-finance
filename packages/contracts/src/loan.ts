import { z } from 'zod'
import { CycleString } from './common'

const InrPaiseAmount = z.number().int().positive().max(99_999_999_999_999)
const LoanName = z.string().trim().min(1, 'Name is required').max(60)

/** numeric(6,3), capped at 99.999 (LOAN-1). */
export const AnnualRatePct = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,3})?$/, 'Expected a rate with up to 2 digits and 3 decimal places')
  .refine((s) => Number(s) <= 99.999, 'Rate must be at most 99.999')

const loanFields = {
  name: LoanName,
  principalPaise: InrPaiseAmount,
  annualRatePct: AnnualRatePct,
  emiPaise: InrPaiseAmount,
  tenureMonths: z.number().int().min(1).max(600),
  startCycle: CycleString,
}

export const LoanInput = z.strictObject(loanFields)
export type LoanInput = z.infer<typeof LoanInput>

export const LoanPatch = z
  .strictObject({ ...loanFields, closed: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export type LoanPatch = z.infer<typeof LoanPatch>

export const Loan = z.object({ id: z.uuid(), name: z.string(), closedAt: z.string().nullable() })
export type Loan = z.infer<typeof Loan>

export const LoanDetail = z.object({
  id: z.uuid(),
  name: z.string(),
  principalPaise: z.number().int(),
  annualRatePct: AnnualRatePct,
  emiPaise: z.number().int(),
  tenureMonths: z.number().int(),
  startCycle: CycleString,
  closedAt: z.string().nullable(),
})
export type LoanDetail = z.infer<typeof LoanDetail>

export const ScheduleRow = z.object({
  month: z.number().int(),
  cycle: CycleString,
  openingPaise: z.number().int(),
  interestPaise: z.number().int(),
  emiPaise: z.number().int(),
  extraPaise: z.number().int(),
  closingPaise: z.number().int(),
  actual: z.boolean(),
})
export type ScheduleRow = z.infer<typeof ScheduleRow>

const LoanTotals = z.object({
  payoffCycle: CycleString.nullable(),
  months: z.number().int(),
  totalInterestPaise: z.number().int(),
})

export const LoanSchedule = z.object({
  loan: LoanDetail,
  rows: z.array(ScheduleRow),
  plan: LoanTotals,
  projected: LoanTotals,
  interestSavedPaise: z.number().int(),
  outstandingPaise: z.number().int(),
})
export type LoanSchedule = z.infer<typeof LoanSchedule>

export const PlannedPrepaymentItem = z.strictObject({
  monthIndex: z.number().int().min(1),
  amountPaise: InrPaiseAmount,
})

export const PlannedPrepaymentsInput = z
  .strictObject({ items: z.array(PlannedPrepaymentItem) })
  .refine(
    (o) => new Set(o.items.map((i) => i.monthIndex)).size === o.items.length,
    { message: 'monthIndex must be unique', path: ['items'] },
  )
export type PlannedPrepaymentsInput = z.infer<typeof PlannedPrepaymentsInput>
