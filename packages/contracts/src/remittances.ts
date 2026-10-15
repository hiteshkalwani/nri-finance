import { z } from 'zod'
import { IsoDateString, PG_INT_MAX, RateString } from './common'

export const RemittancePurpose = z.enum(['family', 'india_savings', 'sip', 'loan_emi', 'loan_prepayment', 'other'])
export type RemittancePurpose = z.infer<typeof RemittancePurpose>
export const RemittanceService = z.enum(['wise', 'bank', 'other'])
export type RemittanceService = z.infer<typeof RemittanceService>

const JpyAmount = z.number().int().positive().max(PG_INT_MAX)
/** ₹ received, in paise; fits numeric(14,2) (12 integer digits before the decimal point). */
const InrPaiseAmount = z.number().int().positive().max(99_999_999_999_999)

const loanLinkedPurposes = new Set<RemittancePurpose>(['loan_emi', 'loan_prepayment'])
const loanRule = (o: { purpose: RemittancePurpose; loanId?: string | null }) => loanLinkedPurposes.has(o.purpose) === (o.loanId != null)
const loanIssue = { message: 'loanId is required for loan_emi/loan_prepayment, and only for those', path: ['loanId'] }
const feeRule = (o: { feeJpy: number; jpySent: number }) => o.feeJpy <= o.jpySent
const feeIssue = { message: 'Fee cannot exceed ¥ sent', path: ['feeJpy'] }

const fields = {
  sentOn: IsoDateString,
  jpySent: JpyAmount,
  inrPaise: InrPaiseAmount,
  feeJpy: z.number().int().min(0),
  service: RemittanceService,
  fromAccountId: z.uuid().nullish(),
  toAccountId: z.uuid().nullish(),
  purpose: RemittancePurpose,
  loanId: z.uuid().nullish(),
  notes: z.string().max(500),
}

export const RemittanceInput = z
  .strictObject({ ...fields, feeJpy: fields.feeJpy.default(0), notes: fields.notes.default('') })
  .refine(loanRule, loanIssue)
  .refine(feeRule, feeIssue)
export type RemittanceInput = z.infer<typeof RemittanceInput>

/**
 * Cross-field rules (loan link, fee ≤ ¥ sent) aren't re-checked here: this is a partial object and
 * full validation happens server-side after merging the patch onto the existing row.
 */
export const RemittancePatch = z
  .strictObject(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export type RemittancePatch = z.infer<typeof RemittancePatch>

export const Remittance = z.object({
  id: z.uuid(),
  sentOn: z.string(),
  jpySent: z.number().int(),
  inrPaise: z.number().int(),
  feeJpy: z.number().int(),
  service: RemittanceService,
  fromAccountId: z.uuid().nullable(),
  toAccountId: z.uuid().nullable(),
  purpose: RemittancePurpose,
  loanId: z.uuid().nullable(),
  notes: z.string(),
  rate: RateString,
})
export type Remittance = z.infer<typeof Remittance>

export const RemittancePurposeTotal = z.object({
  purpose: RemittancePurpose,
  jpySent: z.number().int(),
  inrPaise: z.number().int(),
  count: z.number().int(),
})
export type RemittancePurposeTotal = z.infer<typeof RemittancePurposeTotal>

export const RemittanceList = z.object({
  cycle: z.string(),
  start: z.string(),
  end: z.string(),
  items: z.array(Remittance),
  totals: z.object({
    jpySent: z.number().int(),
    inrPaise: z.number().int(),
    feesJpy: z.number().int(),
    count: z.number().int(),
    avgRate: RateString.nullable(),
    byPurpose: z.array(RemittancePurposeTotal),
  }),
})
export type RemittanceList = z.infer<typeof RemittanceList>

export const RemittanceRates = z.object({
  planningRate: RateString,
  points: z.array(z.object({ sentOn: z.string(), rate: RateString })),
})
export type RemittanceRates = z.infer<typeof RemittanceRates>

export const Loan = z.object({ id: z.uuid(), name: z.string(), closedAt: z.string().nullable() })
export type Loan = z.infer<typeof Loan>

export const CycleIncomeInput = z.strictObject({ incomeJpy: z.number().int().min(0).max(PG_INT_MAX).nullable() })
export type CycleIncomeInput = z.infer<typeof CycleIncomeInput>
