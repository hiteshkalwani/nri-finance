import { expect, it } from 'vitest'
import { barData, donutData } from '../src/lib/charts'

const d = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 1, spentJpy: 2500, sentJpy: 0, feesJpy: 0, keptJpy: 0, savingsRatePct: 0,
  expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0,
  byCategory: [{ categoryId: 'a', name: 'Food', color: '#4caf50', spentJpy: 2000 }, { categoryId: 'b', name: 'Rent', color: '#2196f3', spentJpy: 500 }],
  byCycle: [{ cycle: '2026-09', spentJpy: 1000 }, { cycle: '2026-10', spentJpy: 2500 }],
}

it('builds the donut from categories with their colours', () => {
  expect(donutData(d)).toEqual({ labels: ['Food', 'Rent'], datasets: [{ data: [2000, 500], backgroundColor: ['#4caf50', '#2196f3'] }] })
})

it('builds the bar from cycles, highlighting the selected one', () => {
  const b = barData(d, '#1976d2', '#90caf9')
  expect(b.labels).toEqual(['Sep', 'Oct'])
  expect(b.datasets[0]!.data).toEqual([1000, 2500])
  expect(b.datasets[0]!.backgroundColor).toEqual(['#90caf9', '#1976d2'])
})
