import { describe, expect, it } from 'vitest'
import { cycleBounds, cycleOf, formatIsoDate, todayIn } from '../src/index'

describe('cycleOf', () => {
  it('puts the 24th in the cycle closing that month', () => expect(cycleOf('2026-08-24')).toBe('2026-08'))
  it('puts the 25th in the next cycle', () => expect(cycleOf('2026-08-25')).toBe('2026-09'))
  it('rolls Dec 25 into January of the next year', () => expect(cycleOf('2026-12-25')).toBe('2027-01'))
  it('honours a custom start day', () => {
    expect(cycleOf('2026-09-05', 10)).toBe('2026-09')
    expect(cycleOf('2026-09-15', 10)).toBe('2026-10')
  })
  it('treats start day 1 as calendar-month cycles labeled by the next month', () =>
    expect(cycleOf('2026-09-05', 1)).toBe('2026-10'))
})

describe('cycleBounds', () => {
  it('returns 25th to 24th', () => expect(cycleBounds('2026-09')).toEqual({ start: '2026-08-25', end: '2026-09-24' }))
  it('crosses the year for January', () =>
    expect(cycleBounds('2027-01')).toEqual({ start: '2026-12-25', end: '2027-01-24' }))
  it('handles start day 1 (end = last day of previous month)', () =>
    expect(cycleBounds('2026-10', 1)).toEqual({ start: '2026-09-01', end: '2026-09-30' }))
  it('round-trips with cycleOf at both edges', () => {
    const { start, end } = cycleBounds('2026-03')
    expect(cycleOf(start)).toBe('2026-03')
    expect(cycleOf(end)).toBe('2026-03')
  })
})

describe('todayIn', () => {
  it('uses the local calendar date, not UTC', () => {
    const instant = new Date('2026-09-24T18:00:00Z') // 03:00 on the 25th in Tokyo
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-09-25')
    expect(todayIn('UTC', instant)).toBe('2026-09-24')
  })
})

describe('formatIsoDate', () => {
  it('normalises overflowing days', () => expect(formatIsoDate(2026, 10, 0)).toBe('2026-09-30'))
})
