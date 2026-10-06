import { expect, it } from 'vitest'
import { cycleLabel, dateHint, dateRangeLabel, rupees, yen } from '../src/lib/format'

it('formats yen and rupees', () => {
  expect(yen(670000)).toBe('￥670,000')
  expect(yen(-500)).toBe('-￥500')
  expect(rupees(123456)).toBe('₹1,234.56')
})

it('labels a cycle by its dates', () => {
  expect(cycleLabel('2026-10', 25)).toBe('25 Sep – 24 Oct 2026')
  expect(cycleLabel('2026-01', 25)).toBe('25 Dec 2025 – 24 Jan 2026')
})

it('labels a date range directly from two ISO dates (same year, and crossing a year boundary)', () => {
  expect(dateRangeLabel('2026-09-25', '2026-10-24')).toBe('25 Sep – 24 Oct 2026')
  expect(dateRangeLabel('2025-12-25', '2026-01-24')).toBe('25 Dec 2025 – 24 Jan 2026')
})

it('hints the quick-add date, "Today · " only when it matches today (spec §4.3)', () => {
  expect(dateHint('2026-10-05', '2026-10-05')).toBe('Today · Mon 5 Oct')
  expect(dateHint('2026-10-03', '2026-10-05')).toBe('Sat 3 Oct')
})
