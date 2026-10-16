import { describe, expect, it } from 'vitest'
import type { BudgetRow } from '@nri/contracts'
import {
  budgetFieldsFrom, changedBudgetItems, hasInvalidBudget, isDirtyBudgets, quickAddHint, stateWord,
} from '../src/lib/budgetsForm'

function row(overrides: Partial<BudgetRow> & { categoryId: string }): BudgetRow {
  return {
    name: 'Dining out', color: '#f2c24b', budgetJpy: null, effectiveFromCycle: null,
    spentJpy: 0, remainingJpy: null, pct: null, state: null,
    ...overrides,
  }
}

describe('stateWord', () => {
  it('is null when no budget is set', () => {
    expect(stateWord(row({ categoryId: 'a' }))).toBeNull()
  })
  it('"Over by ￥x" when over budget', () => {
    expect(stateWord(row({ categoryId: 'a', budgetJpy: 15000, spentJpy: 18900, remainingJpy: -3900, pct: 126, state: 'over' }))).toBe('Over by ￥3,900')
  })
  it('"Near" when near budget', () => {
    expect(stateWord(row({ categoryId: 'a', budgetJpy: 12000, spentJpy: 11800, remainingJpy: 200, pct: 98.3, state: 'near' }))).toBe('Near')
  })
  it('"￥x left" when comfortably under budget', () => {
    expect(stateWord(row({ categoryId: 'a', budgetJpy: 10000, spentJpy: 6240, remainingJpy: 3760, pct: 62.4, state: 'under' }))).toBe('￥3,760 left')
  })
})

describe('quickAddHint', () => {
  it('is null when no budget is set', () => {
    expect(quickAddHint(row({ categoryId: 'a' }))).toBeNull()
  })
  it('"Over by ￥x" when over', () => {
    expect(quickAddHint(row({ categoryId: 'a', budgetJpy: 15000, spentJpy: 18900, remainingJpy: -3900, pct: 126, state: 'over' }))).toBe('Over by ￥3,900')
  })
  it('"￥x left this cycle" when under or near', () => {
    expect(quickAddHint(row({ categoryId: 'a', budgetJpy: 10000, spentJpy: 6240, remainingJpy: 3760, pct: 62.4, state: 'under' }))).toBe('￥3,760 left this cycle')
    expect(quickAddHint(row({ categoryId: 'a', budgetJpy: 12000, spentJpy: 11800, remainingJpy: 200, pct: 98.3, state: 'near' }))).toBe('￥200 left this cycle')
  })
})

describe('budgetFieldsFrom', () => {
  it('prefills blank for no budget, and the plain yen amount otherwise', () => {
    const fields = budgetFieldsFrom([row({ categoryId: 'a' }), row({ categoryId: 'b', budgetJpy: 85000, state: 'under', remainingJpy: 85000 })])
    expect(fields).toEqual([
      { categoryId: 'a', text: '', initial: '' },
      { categoryId: 'b', text: '85000', initial: '85000' },
    ])
  })
})

describe('changedBudgetItems', () => {
  it('skips fields whose parsed amount matches their initial value', () => {
    expect(changedBudgetItems([{ categoryId: 'a', text: '85000', initial: '85000' }])).toEqual([])
  })
  it('includes an edited amount', () => {
    expect(changedBudgetItems([{ categoryId: 'a', text: '90000', initial: '85000' }])).toEqual([{ categoryId: 'a', amountJpy: 90000 }])
  })
  it('a cleared field sends null (removes the budget)', () => {
    expect(changedBudgetItems([{ categoryId: 'a', text: '', initial: '85000' }])).toEqual([{ categoryId: 'a', amountJpy: null }])
  })
  it('skips an unparsable field', () => {
    expect(changedBudgetItems([{ categoryId: 'a', text: 'abc', initial: '85000' }])).toEqual([])
  })
})

describe('hasInvalidBudget / isDirtyBudgets', () => {
  it('flags an unparsable field as invalid', () => {
    expect(hasInvalidBudget([{ categoryId: 'a', text: 'abc', initial: '' }])).toBe(true)
    expect(hasInvalidBudget([{ categoryId: 'a', text: '1000', initial: '' }])).toBe(false)
  })
  it('is dirty only once a field differs by value from its initial text', () => {
    expect(isDirtyBudgets([{ categoryId: 'a', text: '1,000', initial: '1000' }])).toBe(false)
    expect(isDirtyBudgets([{ categoryId: 'a', text: '2000', initial: '1000' }])).toBe(true)
  })
})
