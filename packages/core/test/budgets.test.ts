import { describe, expect, it } from 'vitest'
import { budgetFor, budgetRows, budgetStatus, type CategoryBudget } from '../src/budgets'

const budgets: CategoryBudget[] = [
  { categoryId: 'dining', amountJpy: 10_000, effectiveFromCycle: '2026-01' },
  { categoryId: 'dining', amountJpy: 15_000, effectiveFromCycle: '2026-06' },
  { categoryId: 'groceries', amountJpy: 40_000, effectiveFromCycle: '2026-03' },
]

describe('budgetFor', () => {
  it('carries forward the latest row at or before the cycle', () => {
    expect(budgetFor(budgets, 'dining', '2026-06')).toBe(15_000)
    expect(budgetFor(budgets, 'dining', '2026-09')).toBe(15_000)
    expect(budgetFor(budgets, 'dining', '2026-05')).toBe(10_000)
  })
  it('is null before the category\'s first budget, or for an unbudgeted category', () => {
    expect(budgetFor(budgets, 'dining', '2025-12')).toBeNull()
    expect(budgetFor(budgets, 'transport', '2026-06')).toBeNull()
  })
})

describe('budgetStatus', () => {
  it('is under below 90%', () => {
    expect(budgetStatus(15_000, 13_000)).toEqual({ remainingJpy: 2_000, pct: 86.7, state: 'under' })
  })
  it('is near at the 90% boundary', () => {
    expect(budgetStatus(10_000, 9_000)).toEqual({ remainingJpy: 1_000, pct: 90, state: 'near' })
  })
  it('is near (not over) exactly at 100%', () => {
    expect(budgetStatus(10_000, 10_000)).toEqual({ remainingJpy: 0, pct: 100, state: 'near' })
  })
  it('is over just past 100%', () => {
    expect(budgetStatus(15_000, 15_015)).toEqual({ remainingJpy: -15, pct: 100.1, state: 'over' })
  })
  it('a zero budget is over once anything is spent, else under, with a null pct', () => {
    expect(budgetStatus(0, 500)).toEqual({ remainingJpy: -500, pct: null, state: 'over' })
    expect(budgetStatus(0, 0)).toEqual({ remainingJpy: 0, pct: null, state: 'under' })
  })
})

describe('budgetRows', () => {
  const spend = [
    { categoryId: 'dining', spentJpy: 18_900 }, // over, 126%
    { categoryId: 'groceries', spentJpy: 38_000 }, // near, 95%
    { categoryId: 'transport', spentJpy: 5_000 }, // no budget: excluded
  ]
  it('includes only budgeted categories, sorted over -> near -> under, then by pct desc', () => {
    const rows = budgetRows(budgets, spend, '2026-09')
    expect(rows.map((r) => r.categoryId)).toEqual(['dining', 'groceries'])
    expect(rows[0]).toMatchObject({ categoryId: 'dining', budgetJpy: 15_000, spentJpy: 18_900, state: 'over', pct: 126 })
    expect(rows[1]).toMatchObject({ categoryId: 'groceries', budgetJpy: 40_000, spentJpy: 38_000, state: 'near', pct: 95 })
  })
  it('defaults spend to 0 for a budgeted category with no spend rows', () => {
    const rows = budgetRows(budgets, [], '2026-09')
    expect(rows.every((r) => r.spentJpy === 0 && r.state === 'under')).toBe(true)
  })
})
