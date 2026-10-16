import { describe, expect, it } from 'vitest'
import { allocationTotalPct, vsPlanWord } from '../src/lib/sipForm'

describe('vsPlanWord', () => {
  it('reads "short" with the bad class when under plan', () => {
    const r = vsPlanWord(1180000, 1200000)
    expect(r.cls).toBe('bad')
    expect(r.text).toBe('₹200.00 short')
    expect(r.pct).toBe(98)
  })
  it('reads "ahead" with the good class when over plan', () => {
    const r = vsPlanWord(1300000, 1200000)
    expect(r.cls).toBe('good')
    expect(r.text).toBe('₹1,000.00 ahead')
    expect(r.pct).toBe(100)
  })
  it('reads "On plan" with the muted class when exactly matching', () => {
    expect(vsPlanWord(1200000, 1200000)).toEqual({ text: 'On plan', cls: 'muted', pct: 100 })
  })
})

describe('allocationTotalPct', () => {
  it('sums percents exactly, avoiding float drift', () => {
    expect(allocationTotalPct([{ pct: '40' }, { pct: '30' }, { pct: '20' }, { pct: '10' }])).toBe(100)
    expect(allocationTotalPct([{ pct: '33.33' }, { pct: '33.33' }, { pct: '33.34' }])).toBe(100)
  })
  it('treats a blank row as 0', () => {
    expect(allocationTotalPct([{ pct: '60' }, { pct: '' }])).toBe(60)
  })
  it('is 0 for no allocations', () => {
    expect(allocationTotalPct([])).toBe(0)
  })
})
