import { describe, expect, it } from 'vitest'
import { Review } from '../src'

const base = {
  cycle: '2026-10',
  start: '2026-09-25',
  end: '2026-10-24',
  summary: { incomeJpy: 300_000, spentJpy: 100_000, sentJpy: 50_000, keptJpy: 150_000, savingsRatePct: 50, receivedPaise: 3_000_000 },
  targets: [{ key: 'savings', targetValue: 100_000, actualValue: 150_000, diff: 50_000, met: true }],
  budgets: [{ categoryId: '11111111-1111-4111-8111-111111111111', name: 'Dining', color: '#4caf50', budgetJpy: 10_000, effectiveFromCycle: '2026-01', spentJpy: 12_000, remainingJpy: -2_000, pct: 120, state: 'over' }],
  highlights: [{ tone: 'bad', text: 'Dining went over budget by ￥2,000 (120%).' }],
  balancesDone: true,
  nextCycle: '2026-11',
  nextTargetsSet: false,
}

describe('Review', () => {
  it('parses a full review response', () => {
    expect(Review.safeParse(base).success).toBe(true)
  })

  it('rejects an unknown target key or highlight tone', () => {
    expect(Review.safeParse({ ...base, targets: [{ ...base.targets[0], key: 'bogus' }] }).success).toBe(false)
    expect(Review.safeParse({ ...base, highlights: [{ tone: 'bogus', text: 'x' }] }).success).toBe(false)
  })

  it('rejects a bad cycle', () => {
    expect(Review.safeParse({ ...base, cycle: '2026-13' }).success).toBe(false)
  })
})
