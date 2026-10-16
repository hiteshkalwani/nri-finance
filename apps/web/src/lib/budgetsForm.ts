import type { BudgetRow } from '@nri/contracts'
import { yen } from './format'
import { parseAmount } from './balancesForm'

/** Budgets page's per-row amount field: blank text means "no budget" (BUD-1). */
export type BudgetField = { categoryId: string; text: string; initial: string }

export function budgetFieldsFrom(rows: BudgetRow[]): BudgetField[] {
  return rows.map((r) => {
    const text = r.budgetJpy === null ? '' : String(r.budgetJpy)
    return { categoryId: r.categoryId, text, initial: text }
  })
}

/**
 * The budget row's state word (spec §2, never colour alone): "Over by ¥x" / "Near" / "¥x left" —
 * `null` for a category with no budget set at all (`state === null`), which shows no word.
 */
export function stateWord(row: Pick<BudgetRow, 'state' | 'remainingJpy'>): string | null {
  if (row.state === null || row.remainingJpy === null) return null
  if (row.state === 'over') return `Over by ${yen(-row.remainingJpy)}`
  if (row.state === 'near') return 'Near'
  return `${yen(row.remainingJpy)} left`
}

/**
 * Quick-add / ledger's shorter hint (BUD-2): just "¥x left this cycle" or "Over by ¥x" — `null`
 * when the category has no budget set.
 */
export function quickAddHint(row: Pick<BudgetRow, 'state' | 'remainingJpy'>): string | null {
  if (row.state === null || row.remainingJpy === null) return null
  return row.state === 'over' ? `Over by ${yen(-row.remainingJpy)}` : `${yen(row.remainingJpy)} left this cycle`
}

/** Only the fields whose parsed amount actually differs from its prefilled `initial` — blank → null removes the budget. */
export function changedBudgetItems(fields: BudgetField[]): { categoryId: string; amountJpy: number | null }[] {
  const out: { categoryId: string; amountJpy: number | null }[] = []
  for (const f of fields) {
    const parsed = parseAmount(f.text, 'JPY')
    if (parsed === 'invalid') continue
    if (parsed !== parseAmount(f.initial, 'JPY')) out.push({ categoryId: f.categoryId, amountJpy: parsed })
  }
  return out
}

export function hasInvalidBudget(fields: BudgetField[]): boolean {
  return fields.some((f) => parseAmount(f.text, 'JPY') === 'invalid')
}

export function isDirtyBudgets(fields: BudgetField[]): boolean {
  return fields.some((f) => parseAmount(f.text, 'JPY') !== parseAmount(f.initial, 'JPY'))
}
