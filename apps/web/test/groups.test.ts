import { expect, it } from 'vitest'
import { groupByDate, isPartialPageGroup, pageCount } from '../src/lib/groups'

const r = (occurredOn: string, amountJpy: number, id = occurredOn + amountJpy) => ({ id, occurredOn, amountJpy })

it('groups consecutive rows by date, keeps order, totals each day on this page', () => {
  const g = groupByDate([r('2026-10-05', 1280), r('2026-10-05', 643), r('2026-10-04', 6820), r('2026-10-01', 85000)])
  expect(g.map((d) => [d.date, d.label, d.totalJpy, d.rows.length])).toEqual([
    ['2026-10-05', '5 Oct 2026', 1923, 2], ['2026-10-04', '4 Oct 2026', 6820, 1], ['2026-10-01', '1 Oct 2026', 85000, 1],
  ])
})

it('starts a new group when a date reappears later (ascending sorts, page joins)', () => {
  expect(groupByDate([r('2026-10-01', 1), r('2026-10-02', 2), r('2026-10-02', 3)]).map((d) => d.totalJpy)).toEqual([1, 5])
  expect(groupByDate([])).toEqual([])
})

it('counts pages, always at least 1 even with zero rows', () => {
  expect(pageCount(0, 50)).toBe(1)
  expect(pageCount(50, 50)).toBe(1)
  expect(pageCount(51, 50)).toBe(2)
  expect(pageCount(149, 50)).toBe(3)
})

it('marks a date group "on this page" only at a page edge, and only when there is more than one page', () => {
  // Single page: nothing can continue past it, whatever the group's position.
  expect(isPartialPageGroup(0, 3, 1)).toBe(false)
  expect(isPartialPageGroup(2, 3, 1)).toBe(false)
  // Multiple pages: the first and last groups on the page might continue onto a neighbour...
  expect(isPartialPageGroup(0, 3, 2)).toBe(true)
  expect(isPartialPageGroup(2, 3, 2)).toBe(true)
  // ...but a group fully in the middle of the page is already whole.
  expect(isPartialPageGroup(1, 3, 2)).toBe(false)
  // A single-group page: that one group is both first and last.
  expect(isPartialPageGroup(0, 1, 2)).toBe(true)
})
