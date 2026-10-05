import { expect, it } from 'vitest'
import { groupByDate } from '../src/lib/groups'

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
