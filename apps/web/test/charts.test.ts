import { expect, it } from 'vitest'
import { barData, donutData } from '../src/lib/charts'

const d = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 1, spentJpy: 2500, sentJpy: 0, feesJpy: 0, keptJpy: 0, savingsRatePct: 0,
  expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0,
  byCategory: [{ categoryId: 'a', name: 'Food', color: '#4caf50', spentJpy: 2000 }, { categoryId: 'b', name: 'Rent', color: '#2196f3', spentJpy: 500 }],
  byCycle: [{ cycle: '2026-09', spentJpy: 1000 }, { cycle: '2026-10', spentJpy: 2500 }],
}

const rows = [
  { categoryId: 'a', name: 'Food', color: '#4caf50', spentJpy: 2000, pct: 80 },
  { categoryId: null, name: 'Everything else', color: 'not-a-colour', spentJpy: 500, pct: 20 },
]

it('builds the donut from legend rows, falling back to the given colour for an invalid category colour', () => {
  expect(donutData(rows, '#999999')).toEqual({
    labels: ['Food', 'Everything else'],
    datasets: [{ data: [2000, 500], backgroundColor: ['#4caf50', '#999999'], borderWidth: 0 }],
  })
})

it('builds the bar from cycles, the selected cycle in the given primary colour and the rest at 35% opacity of it', () => {
  const b = barData(d, '#f0682e')
  expect(b.labels).toEqual(['Sep', 'Oct'])
  expect(b.datasets[0]!.data).toEqual([1000, 2500])
  expect(b.datasets[0]!.backgroundColor).toEqual(['#f0682e59', '#f0682e'])
})
