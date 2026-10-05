import { expect, it } from 'vitest'
import { legendRows } from '../src/lib/legend'

const c = (n: string, v: number) => ({ categoryId: n, name: n, color: '#000000', spentJpy: v })

it('adds one-decimal percentages of the total', () => {
  expect(legendRows([c('Rent', 85000), c('Food', 15000)]).map((x) => x.pct)).toEqual([85, 15])
  expect(legendRows([c('A', 1), c('B', 2)]).map((x) => x.pct)).toEqual([33.3, 66.7])
})

it('folds the tail into "Everything else" beyond the limit', () => {
  const rows = legendRows(Array.from({ length: 11 }, (_, i) => c(`C${i}`, 100 - i)), 9)
  expect(rows).toHaveLength(9)
  expect(rows[8]).toMatchObject({ categoryId: null, name: 'Everything else', spentJpy: 92 + 91 + 90 })
})
