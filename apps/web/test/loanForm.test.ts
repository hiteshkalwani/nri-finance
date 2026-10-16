import { describe, expect, it } from 'vitest'
import {
  cycleFromMonthIndex, filterScheduleRows, monthIndexFromCycle, payoffVsPlanText, plannedFromRows, yearlyRows,
} from '../src/lib/loanForm'

describe('monthIndexFromCycle / cycleFromMonthIndex', () => {
  it('month 1 is the start cycle itself', () => {
    expect(monthIndexFromCycle('2026-10', '2026-10')).toBe(1)
    expect(cycleFromMonthIndex(1, '2026-10')).toBe('2026-10')
  })
  it('round-trips across a year boundary', () => {
    expect(monthIndexFromCycle('2027-03', '2026-10')).toBe(6)
    expect(cycleFromMonthIndex(6, '2026-10')).toBe('2027-03')
  })
  it('round-trips an arbitrary cycle through both directions', () => {
    const startCycle = '2021-10'
    for (const cycle of ['2022-01', '2026-10', '2034-03', '2041-10']) {
      expect(cycleFromMonthIndex(monthIndexFromCycle(cycle, startCycle), startCycle)).toBe(cycle)
    }
  })
})

describe('payoffVsPlanText', () => {
  it('is null when either payoff never happens', () => {
    expect(payoffVsPlanText(null, '2041-10')).toBeNull()
    expect(payoffVsPlanText('2034-03', null)).toBeNull()
  })
  it('reads "earlier" with the good class when the projected payoff beats the plan', () => {
    const r = payoffVsPlanText('2034-03', '2041-10')
    expect(r!.cls).toBe('good')
    expect(r!.text).toBe('7 yrs 7 mo earlier than plan (Oct 2041)')
  })
  it('reads "later" with the bad class when the projected payoff trails the plan', () => {
    const r = payoffVsPlanText('2042-01', '2041-10')
    expect(r!.cls).toBe('bad')
    expect(r!.text).toBe('3 mo later than plan (Oct 2041)')
  })
  it('reads "On plan" when they match exactly', () => {
    expect(payoffVsPlanText('2041-10', '2041-10')).toEqual({ text: 'On plan (Oct 2041)', cls: 'muted' })
  })
})

const row = (month: number, cycle: string, extraPaise: number, actual: boolean) => ({
  month, cycle, openingPaise: 0, interestPaise: 0, emiPaise: 0, extraPaise, closingPaise: 0, actual,
})

describe('filterScheduleRows', () => {
  const rows = [row(1, '2026-09', 0, true), row(2, '2026-10', 0, false), row(3, '2026-11', 0, false)]
  it('upcoming keeps the current cycle and later', () => {
    expect(filterScheduleRows(rows, 'upcoming', '2026-10').map((r) => r.cycle)).toEqual(['2026-10', '2026-11'])
  })
  it('past keeps everything before the current cycle', () => {
    expect(filterScheduleRows(rows, 'past', '2026-10').map((r) => r.cycle)).toEqual(['2026-09'])
  })
  it('all keeps every row', () => {
    expect(filterScheduleRows(rows, 'all', '2026-10')).toHaveLength(3)
  })
})

describe('yearlyRows', () => {
  it('samples every 12th month plus the final row', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1, `2026-${String((i % 12) + 1).padStart(2, '0')}`, 0, false))
    expect(yearlyRows(rows).map((r) => r.month)).toEqual([1, 13, 25, 30])
  })
  it('does not duplicate the final row when it already lands on a year boundary', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i + 1, '2026-01', 0, false))
    expect(yearlyRows(rows).map((r) => r.month)).toEqual([1, 13, 25])
  })
})

describe('plannedFromRows', () => {
  it('reads planned extras back from the non-actual rows that carry one', () => {
    const rows = [row(1, '2026-09', 500000, true), row(2, '2026-10', 200000, false), row(3, '2026-11', 0, false)]
    expect(plannedFromRows(rows)).toEqual([{ cycle: '2026-10', amountPaise: 200000 }])
  })
})
