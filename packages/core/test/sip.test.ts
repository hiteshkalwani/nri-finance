import { describe, expect, it } from 'vitest'
import { sipMonthlyFor, sipProjection, type SipPlan } from '../src/sip'

const plan: SipPlan = {
  startingMonthlyPaise: 10_000_000, stepUpPct: 10, expectedReturnPct: 12, startYear: 2026, endYear: 2036, redirectEmiAfterPayoff: true,
}

describe('sipMonthlyFor', () => {
  it('steps up once a year, compounded', () => {
    expect(sipMonthlyFor(plan, 2026)).toBe(10_000_000)
    expect(sipMonthlyFor(plan, 2027)).toBe(11_000_000)
    expect(sipMonthlyFor(plan, 2028)).toBe(12_100_000)
  })
})

describe('sipProjection', () => {
  it('first year: 12 start-of-month payments at 1%/month', () => {
    const [y] = sipProjection({ ...plan, endYear: 2026 }, null)
    // ₹1,00,000 × ((1.01^12 − 1) / 0.01) × 1.01 = ₹12,80,932.80
    expect(y).toEqual({ year: 2026, monthlyPaise: 10_000_000, sipPaidPaise: 120_000_000, emiPaidPaise: 0, sipCorpusPaise: 128_093_280, emiCorpusPaise: 0 })
  })
  it('0% return just sums the payments', () => {
    const rows = sipProjection({ ...plan, expectedReturnPct: 0, endYear: 2027 }, null)
    expect(rows.at(-1)!.sipCorpusPaise).toBe(120_000_000 + 132_000_000)
  })
  it('redirects the EMI from the cycle after payoff, as its own corpus', () => {
    const rows = sipProjection(plan, { fromCycle: '2034-04', emiPaise: 4_200_000 })
    expect(rows.find((r) => r.year === 2033)!.emiPaidPaise).toBe(0)
    expect(rows.find((r) => r.year === 2034)!.emiPaidPaise).toBe(9 * 4_200_000)
    expect(rows.find((r) => r.year === 2035)!.emiPaidPaise).toBe(12 * 4_200_000)
    expect(rows.at(-1)!.emiCorpusPaise).toBeGreaterThan(0)
  })
  it('no redirect when the plan turns it off', () => {
    const rows = sipProjection({ ...plan, redirectEmiAfterPayoff: false }, { fromCycle: '2030-01', emiPaise: 4_200_000 })
    expect(rows.every((r) => r.emiPaidPaise === 0 && r.emiCorpusPaise === 0)).toBe(true)
  })
})
