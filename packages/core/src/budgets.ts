import type { Cycle } from './cycles'

export type CategoryBudget = { categoryId: string; amountJpy: number; effectiveFromCycle: Cycle }
export type BudgetState = 'under' | 'near' | 'over'
export type BudgetStatus = { remainingJpy: number; pct: number | null; state: BudgetState }
export type BudgetRow = { categoryId: string; budgetJpy: number; spentJpy: number } & BudgetStatus

/** BUD-1: latest budget row for the category with effective_from_cycle <= cycle; carried forward until changed. */
export function budgetFor(budgets: CategoryBudget[], categoryId: string, cycle: Cycle): number | null {
  let best: CategoryBudget | null = null
  for (const b of budgets) {
    if (b.categoryId !== categoryId || b.effectiveFromCycle > cycle) continue
    if (!best || b.effectiveFromCycle > best.effectiveFromCycle) best = b
  }
  return best ? best.amountJpy : null
}

/** BUD-2: near = 90–100% inclusive, over = >100%. pct is null (and state falls back to spent > 0) when the budget is 0. */
export function budgetStatus(budgetJpy: number, spentJpy: number): BudgetStatus {
  const remainingJpy = budgetJpy - spentJpy
  if (budgetJpy === 0) return { remainingJpy, pct: null, state: spentJpy > 0 ? 'over' : 'under' }
  const pct = Math.round((spentJpy * 1000) / budgetJpy) / 10
  const state: BudgetState = pct > 100 ? 'over' : pct >= 90 ? 'near' : 'under'
  return { remainingJpy, pct, state }
}

const STATE_RANK: Record<BudgetState, number> = { over: 0, near: 1, under: 2 }

/** DASH-9: one row per budgeted category for the cycle, over budget first, then near, then under; ties by pct desc. */
export function budgetRows(budgets: CategoryBudget[], spend: { categoryId: string; spentJpy: number }[], cycle: Cycle): BudgetRow[] {
  const spentBy = new Map(spend.map((s) => [s.categoryId, s.spentJpy]))
  const categoryIds = [...new Set(budgets.map((b) => b.categoryId))]
  const rows: BudgetRow[] = []
  for (const categoryId of categoryIds) {
    const budgetJpy = budgetFor(budgets, categoryId, cycle)
    if (budgetJpy === null) continue
    const spentJpy = spentBy.get(categoryId) ?? 0
    rows.push({ categoryId, budgetJpy, spentJpy, ...budgetStatus(budgetJpy, spentJpy) })
  }
  return rows.sort((x, y) => STATE_RANK[x.state] - STATE_RANK[y.state] || (y.pct ?? -Infinity) - (x.pct ?? -Infinity))
}
