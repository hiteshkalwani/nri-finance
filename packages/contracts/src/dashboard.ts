import { z } from 'zod'

export const Dashboard = z.object({
  cycle: z.string(),
  start: z.string(),
  end: z.string(),
  incomeJpy: z.number().int(),
  spentJpy: z.number().int(),
  sentJpy: z.number().int(),
  feesJpy: z.number().int(),
  keptJpy: z.number().int(),
  savingsRatePct: z.number().nullable(),
  expenseCount: z.number().int(),
  largestJpy: z.number().int(),
  needJpy: z.number().int(),
  wantJpy: z.number().int(),
  byCategory: z.array(z.object({ categoryId: z.uuid(), name: z.string(), color: z.string(), spentJpy: z.number().int() })),
  byCycle: z.array(z.object({ cycle: z.string(), spentJpy: z.number().int() })),
})
export type Dashboard = z.infer<typeof Dashboard>
