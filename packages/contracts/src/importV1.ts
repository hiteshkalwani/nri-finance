import { z } from 'zod'

const V1Transaction = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string(),
  description: z.string().default(''),
  amountJPY: z.number().nonnegative().default(0),
  amountINR: z.number().nonnegative().default(0),
  paymentMethod: z.string().default('Cash'),
  needWant: z.string().default('Need'),
  notes: z.string().default(''),
})

export const V1Document = z.object({
  settings: z.object({
    salaryJPY: z.number().nonnegative(),
    jpyPerInr: z.number().positive(),
    cycleStartDay: z.number().int().min(1).max(28).default(25),
    emergencyFundTargetJPY: z.number().nonnegative().default(0),
    homeLoan: z.object({
      principalINR: z.number().nonnegative(),
      annualRatePct: z.number().nonnegative(),
      emiINR: z.number().nonnegative(),
      tenureMonths: z.number().int().nonnegative(),
      startCycle: z.string().regex(/^\d{4}-\d{2}$/),
    }),
    sip: z.object({
      startingMonthlyINR: z.number().nonnegative(),
      annualStepUpPct: z.number(),
      estimatedReturnPct: z.number(),
      allocation: z.record(z.string(), z.number()),
    }),
  }),
  categories: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  transactions: z.array(V1Transaction),
  cycleTargets: z
    .array(
      z.object({
        cycle: z.string(),
        savingsTargetJPY: z.number().optional(),
        emergencyFundTargetJPY: z.number().optional(),
        loanPrepaymentTargetINR: z.number().optional(),
      }),
    )
    .default([]),
  homeLoanExtras: z.array(z.object({ monthIndex: z.number().int(), extraPrepaymentINR: z.number() })).default([]),
})
export type V1Document = z.infer<typeof V1Document>

export const ImportCounts = z.object({
  categories: z.number().int(),
  accounts: z.number().int(),
  transactions: z.number().int(),
  remittances: z.number().int(),
  loans: z.number().int(),
  plannedPrepayments: z.number().int(),
  sipPlans: z.number().int(),
  cycleTargets: z.number().int(),
})
export const ImportResult = z.object({ inserted: ImportCounts, skippedRows: z.array(z.string()) })
export type ImportResult = z.infer<typeof ImportResult>
