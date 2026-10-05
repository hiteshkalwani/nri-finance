import type { Dashboard } from '@nri/contracts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function donutData(d: Dashboard) {
  return {
    labels: d.byCategory.map((c) => c.name),
    datasets: [{ data: d.byCategory.map((c) => c.spentJpy), backgroundColor: d.byCategory.map((c) => c.color) }],
  }
}

/** Bars labelled by the cycle's closing month; the selected cycle in `strong`, the rest in `soft`. */
export function barData(d: Dashboard, strong: string, soft: string) {
  return {
    labels: d.byCycle.map((c) => MONTHS[Number(c.cycle.slice(5)) - 1]!),
    datasets: [{ data: d.byCycle.map((c) => c.spentJpy), backgroundColor: d.byCycle.map((c) => (c.cycle === d.cycle ? strong : soft)) }],
  }
}
