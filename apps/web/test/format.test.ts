import { expect, it } from 'vitest'
import { cycleLabel, rupees, yen } from '../src/lib/format'

it('formats yen and rupees', () => {
  expect(yen(670000)).toBe('￥670,000')
  expect(yen(-500)).toBe('-￥500')
  expect(rupees(123456)).toBe('₹1,234.56')
})

it('labels a cycle by its dates', () => {
  expect(cycleLabel('2026-10', 25)).toBe('25 Sep – 24 Oct 2026')
  expect(cycleLabel('2026-01', 25)).toBe('25 Dec 2025 – 24 Jan 2026')
})
