import { describe, expect, it } from 'vitest'
import { SipPlanInput } from '../src'

const base = {
  startingMonthlyPaise: 10_000_000, stepUpPct: '10.00', expectedReturnPct: '12.00', startYear: 2026, endYear: 2036,
  redirectEmiAfterPayoff: true, allocations: [{ fundName: 'Index fund', pct: '60.00' }, { fundName: 'Debt fund', pct: '40.00' }],
}

describe('SipPlanInput', () => {
  it('accepts a valid plan whose allocations total 100', () => {
    expect(SipPlanInput.safeParse(base).success).toBe(true)
  })
  it('accepts a single allocation at 100', () => {
    expect(SipPlanInput.safeParse({ ...base, allocations: [{ fundName: 'Index fund', pct: '100.00' }] }).success).toBe(true)
  })
  it('rejects allocations that do not total exactly 100 (SIP-2)', () => {
    const under = SipPlanInput.safeParse({ ...base, allocations: [{ fundName: 'Index fund', pct: '59.99' }, { fundName: 'Debt fund', pct: '40.00' }] })
    expect(under.success).toBe(false)
    const over = SipPlanInput.safeParse({ ...base, allocations: [{ fundName: 'Index fund', pct: '60.01' }, { fundName: 'Debt fund', pct: '40.00' }] })
    expect(over.success).toBe(false)
  })
  it('rejects endYear before startYear', () => {
    expect(SipPlanInput.safeParse({ ...base, startYear: 2030, endYear: 2029 }).success).toBe(false)
    expect(SipPlanInput.safeParse({ ...base, startYear: 2030, endYear: 2030 }).success).toBe(true)
  })
  it('rejects a non-positive startingMonthlyPaise and an empty allocations list', () => {
    expect(SipPlanInput.safeParse({ ...base, startingMonthlyPaise: 0 }).success).toBe(false)
    expect(SipPlanInput.safeParse({ ...base, allocations: [] }).success).toBe(false)
  })
  it('rejects an out-of-range stepUpPct/expectedReturnPct and unknown keys', () => {
    expect(SipPlanInput.safeParse({ ...base, stepUpPct: '-1.00' }).success).toBe(false)
    expect(SipPlanInput.safeParse({ ...base, expectedReturnPct: '100.01' }).success).toBe(false)
    expect(SipPlanInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})
