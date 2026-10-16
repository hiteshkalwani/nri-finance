import { describe, expect, it } from 'vitest'
import { amortize, loanOutcome, loanTotals, type LoanTerms } from '../src/loan'

// ₹10,00,000 at 12% p.a., EMI ₹22,244.45 → 60 months.
const loan: LoanTerms = { principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, startCycle: '2026-01' }

describe('amortize', () => {
  const rows = amortize(loan)
  it('month 1 is the start cycle; interest is rate/12 on the opening balance', () => {
    expect(rows[0]).toEqual({
      month: 1, cycle: '2026-01', openingPaise: 100_000_000, interestPaise: 1_000_000,
      emiPaise: 2_224_445, extraPaise: 0, closingPaise: 98_775_555, actual: false,
    })
    expect(rows[1]!.openingPaise).toBe(rows[0]!.closingPaise)
  })
  it('stops at payoff with a smaller last payment and never goes below 0', () => {
    expect(rows).toHaveLength(60)
    const last = rows.at(-1)!
    expect(last.cycle).toBe('2030-12')
    expect(last.closingPaise).toBe(0)
    expect(last.emiPaise).toBe(last.openingPaise + last.interestPaise)
    expect(rows.every((r) => r.closingPaise >= 0)).toBe(true)
  })
  it('an actual month replaces the plan (EMI and extra); planned extras apply elsewhere', () => {
    const r = amortize(loan, [{ cycle: '2026-02', emiPaise: 2_000_000, extraPaise: 0 }], [{ monthIndex: 2, amountPaise: 5_000_000 }, { monthIndex: 3, amountPaise: 1_000_000 }])
    expect(r[1]).toMatchObject({ emiPaise: 2_000_000, extraPaise: 0, actual: true })
    expect(r[2]).toMatchObject({ emiPaise: 2_224_445, extraPaise: 1_000_000, actual: false })
  })
  it('a big prepayment is capped at what is owed and ends the schedule', () => {
    const r = amortize(loan, [], [{ monthIndex: 2, amountPaise: 500_000_000 }])
    expect(r).toHaveLength(2)
    expect(r[1]!.closingPaise).toBe(0)
    expect(r[1]!.emiPaise + r[1]!.extraPaise).toBe(r[1]!.openingPaise + r[1]!.interestPaise)
  })
  it('0% loans work; an EMI below the interest never pays off', () => {
    expect(amortize({ ...loan, annualRatePct: '0.000', emiPaise: 25_000_000 })).toHaveLength(4)
    expect(loanTotals(amortize({ ...loan, emiPaise: 900_000 })).payoffCycle).toBeNull()
  })
})

describe('loanOutcome', () => {
  it('prepaying moves payoff earlier and reports interest saved', () => {
    const o = loanOutcome(loan, [{ cycle: '2026-01', emiPaise: 2_224_445, extraPaise: 20_000_000 }], [])
    expect(o.plan.payoffCycle).toBe('2030-12')
    expect(o.projected.payoffCycle! < o.plan.payoffCycle!).toBe(true)
    expect(o.interestSavedPaise).toBe(o.plan.totalInterestPaise - o.projected.totalInterestPaise)
    expect(o.interestSavedPaise).toBeGreaterThan(0)
  })
  it('with no actuals or extras, projected equals plan', () => {
    const o = loanOutcome(loan, [], [])
    expect(o.projected).toEqual(o.plan)
    expect(o.interestSavedPaise).toBe(0)
  })
})
