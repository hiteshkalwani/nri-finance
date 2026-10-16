import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Budgets, BudgetsPut } from '../src'

const id1 = randomUUID()
const id2 = randomUUID()

describe('BudgetsPut', () => {
  it('accepts a positive amount, zero, and null (clears the cycle override)', () => {
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: 10_000 }] }).success).toBe(true)
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: 0 }] }).success).toBe(true)
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: null }] }).success).toBe(true)
  })

  it('rejects a negative amount and a non-integer amount', () => {
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: -1 }] }).success).toBe(false)
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: 1.5 }] }).success).toBe(false)
  })

  it('rejects a duplicate categoryId', () => {
    const r = BudgetsPut.safeParse({
      cycle: '2026-10',
      items: [{ categoryId: id1, amountJpy: 1 }, { categoryId: id1, amountJpy: 2 }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects a bad cycle and an empty items list', () => {
    expect(BudgetsPut.safeParse({ cycle: '2026-13', items: [{ categoryId: id1, amountJpy: 1 }] }).success).toBe(false)
    expect(BudgetsPut.safeParse({ cycle: '2026-10', items: [] }).success).toBe(false)
  })

  it('accepts several distinct categories', () => {
    expect(
      BudgetsPut.safeParse({ cycle: '2026-10', items: [{ categoryId: id1, amountJpy: 1 }, { categoryId: id2, amountJpy: null }] }).success,
    ).toBe(true)
  })
})

describe('Budgets', () => {
  it('parses a row with no budget set (all budget fields null) alongside a budgeted, over-state row', () => {
    const r = Budgets.safeParse({
      cycle: '2026-10',
      rows: [
        { categoryId: id1, name: 'Food', color: '#4caf50', budgetJpy: null, effectiveFromCycle: null, spentJpy: 500, remainingJpy: null, pct: null, state: null },
        { categoryId: id2, name: 'Rent', color: '#2196f3', budgetJpy: 10_000, effectiveFromCycle: '2026-01', spentJpy: 12_000, remainingJpy: -2_000, pct: 120, state: 'over' },
      ],
    })
    expect(r.success).toBe(true)
  })
})
