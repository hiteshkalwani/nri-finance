import { z } from 'zod'
import { BudgetRow } from './budgets'
import { CycleString } from './common'
import { RemittancePurposeTotal } from './remittances'
import { TargetRow } from './targets'

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
  // DASH-9: near/over categories, over first; rows capped at 5 for the card, counts are of the full list.
  budgets: z.object({ overCount: z.number().int(), nearCount: z.number().int(), rows: z.array(BudgetRow) }),
  // TGT-2: one row per target that was set for this cycle.
  targets: z.array(TargetRow),
})
export type Dashboard = z.infer<typeof Dashboard>
