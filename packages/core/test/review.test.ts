import { describe, expect, it } from 'vitest'
import { reviewHighlights, targetVsActual, type Actuals, type Targets } from '../src/review'

describe('targetVsActual', () => {
  const targets: Targets = { savingsJpy: 300_000, emergencyFundJpy: null, remittanceJpy: 100_000, prepaymentPaise: null }
  const actuals: Actuals = { keptJpy: 337_660, emergencyFundChangeJpy: 0, sentJpy: 90_000, prepaymentPaise: 0 }

  it('skips null targets and keeps one row per target that was set', () => {
    const rows = targetVsActual(targets, actuals)
    expect(rows.map((r) => r.key)).toEqual(['savings', 'remittance'])
  })
  it('met is true when actual >= target; diff = actual - target', () => {
    const rows = targetVsActual(targets, actuals)
    expect(rows[0]).toEqual({ key: 'savings', targetValue: 300_000, actualValue: 337_660, diff: 37_660, met: true })
    expect(rows[1]).toEqual({ key: 'remittance', targetValue: 100_000, actualValue: 90_000, diff: -10_000, met: false })
  })
  it('all four targets can be set at once', () => {
    const all: Targets = { savingsJpy: 1, emergencyFundJpy: 1, remittanceJpy: 1, prepaymentPaise: 1 }
    expect(targetVsActual(all, actuals).map((r) => r.key)).toEqual(['savings', 'emergencyFund', 'remittance', 'prepayment'])
  })
})

describe('reviewHighlights', () => {
  it('orders bad (over-budget) before warn (missed) before good (met), and caps at 5', () => {
    const overBudget = [{ categoryName: 'Dining out', overByJpy: 3_900, pct: 126 }]
    const targets = targetVsActual(
      { savingsJpy: 300_000, emergencyFundJpy: 20_000, remittanceJpy: null, prepaymentPaise: null },
      { keptJpy: 337_660, emergencyFundChangeJpy: 10_000, sentJpy: 0, prepaymentPaise: 0 },
    )
    const out = reviewHighlights(overBudget, targets)
    expect(out).toEqual([
      { tone: 'bad', text: 'Dining out went over budget by ￥3,900 (126%).' },
      { tone: 'warn', text: 'Emergency fund contribution ￥10,000 short of target.' },
      { tone: 'good', text: 'Kept ￥337,660 — ￥37,660 above the savings target.' },
    ])
  })
  it('a met non-savings target gets a plain "on target" line', () => {
    const targets = targetVsActual({ savingsJpy: null, emergencyFundJpy: null, remittanceJpy: 50_000, prepaymentPaise: null }, { keptJpy: 0, emergencyFundChangeJpy: 0, sentJpy: 50_000, prepaymentPaise: 0 })
    expect(reviewHighlights([], targets)).toEqual([{ tone: 'good', text: 'Remittance on target.' }])
  })
  it('caps the combined list at 5 entries', () => {
    const overBudget = Array.from({ length: 7 }, (_, i) => ({ categoryName: `Cat ${i}`, overByJpy: 100, pct: 110 }))
    expect(reviewHighlights(overBudget, [])).toHaveLength(5)
  })
})
