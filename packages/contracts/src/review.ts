import { z } from 'zod'
import { BudgetRow } from './budgets'
import { CycleString } from './common'
import { TargetRow } from './targets'

export const HighlightTone = z.enum(['bad', 'warn', 'good'])
export const Highlight = z.object({ tone: HighlightTone, text: z.string() })
export type Highlight = z.infer<typeof Highlight>

/** REV-1: the 25th review screen — closed-cycle summary, targets vs actuals, budget alerts, and next steps. */
export const Review = z.object({
  cycle: CycleString,
  start: z.string(),
  end: z.string(),
  summary: z.object({
    incomeJpy: z.number().int(),
    spentJpy: z.number().int(),
    sentJpy: z.number().int(),
    keptJpy: z.number().int(),
    savingsRatePct: z.number().nullable(),
    receivedPaise: z.number().int(),
  }),
  targets: z.array(TargetRow),
  budgets: z.array(BudgetRow), // near/over categories only
  highlights: z.array(Highlight),
  balancesDone: z.boolean(),
  nextCycle: CycleString,
  nextTargetsSet: z.boolean(),
})
export type Review = z.infer<typeof Review>
