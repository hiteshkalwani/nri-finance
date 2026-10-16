import { z } from 'zod'
import { CycleString } from './common'
import { RemittancePurposeTotal } from './remittances'

export const Dashboard = z.object({
  cycle: z.string(),
  start: z.string(),
  end: z.string(),
  incomeJpy: z.number().int(),
  salaryJpy: z.number().int(),
  incomeOverridden: z.boolean(),
  spentJpy: z.number().int(),
  sentJpy: z.number().int(),
  feesJpy: z.number().int(),
  receivedPaise: z.number().int(),
  keptJpy: z.number().int(),
  savingsRatePct: z.number().nullable(),
  expenseCount: z.number().int(),
  largestJpy: z.number().int(),
  needJpy: z.number().int(),
  wantJpy: z.number().int(),
  byCategory: z.array(z.object({ categoryId: z.uuid(), name: z.string(), color: z.string(), spentJpy: z.number().int() })),
  byCycle: z.array(z.object({ cycle: z.string(), spentJpy: z.number().int() })),
  sentByPurpose: z.array(RemittancePurposeTotal),
  // DASH-7/8: first open loan by name, and the SIP plan's standing this cycle; null when none is set up.
  loan: z.object({ name: z.string(), outstandingPaise: z.number().int(), payoffCycle: CycleString.nullable() }).nullable(),
  sip: z.object({ paidPaise: z.number().int(), plannedPaise: z.number().int(), projectedCorpusPaise: z.number().int() }).nullable(),
})
export type Dashboard = z.infer<typeof Dashboard>
