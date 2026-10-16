import { z } from 'zod'
import { CycleString, PG_INT_MAX } from './common'

export const BudgetState = z.enum(['under', 'near', 'over'])
export type BudgetState = z.infer<typeof BudgetState>

/** DASH-9/BUD-1/2: one row per active category. Budget fields are null when the category has none set at this cycle. */
export const BudgetRow = z.object({
  categoryId: z.uuid(),
  name: z.string(),
  color: z.string(),
  budgetJpy: z.number().int().nullable(),
  effectiveFromCycle: CycleString.nullable(),
  spentJpy: z.number().int(),
  remainingJpy: z.number().int().nullable(),
  pct: z.number().nullable(),
  state: BudgetState.nullable(),
})
export type BudgetRow = z.infer<typeof BudgetRow>

export const Budgets = z.object({ cycle: CycleString, rows: z.array(BudgetRow) })
export type Budgets = z.infer<typeof Budgets>

const BudgetsPutItem = z.strictObject({
  categoryId: z.uuid(),
  // null removes the row at this cycle, so the earlier budget (if any) applies again.
  amountJpy: z.number().int().min(0).max(PG_INT_MAX).nullable(),
})

export const BudgetsPut = z
  .strictObject({ cycle: CycleString, items: z.array(BudgetsPutItem).min(1).max(500) })
  .refine((o) => new Set(o.items.map((i) => i.categoryId)).size === o.items.length, {
    message: 'Each category once',
    path: ['items'],
  })
export type BudgetsPut = z.infer<typeof BudgetsPut>
