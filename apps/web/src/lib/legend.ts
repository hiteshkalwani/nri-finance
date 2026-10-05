export type LegendInput = { categoryId: string; name: string; color: string; spentJpy: number }
export type LegendRow = { categoryId: string | null; name: string; color: string; spentJpy: number; pct: number }

/**
 * Spending-by-category legend rows with a one-decimal percentage of the total. Beyond `limit`
 * entries, the smallest tail is folded into a single "Everything else" row (keeps the donut/legend
 * readable on the dashboard) rather than listing every category.
 */
export function legendRows(byCategory: LegendInput[], limit = 9): LegendRow[] {
  const total = byCategory.reduce((sum, c) => sum + c.spentJpy, 0)
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v * 1000) / total) / 10)
  const row = (c: LegendInput): LegendRow => ({ categoryId: c.categoryId, name: c.name, color: c.color, spentJpy: c.spentJpy, pct: pct(c.spentJpy) })

  if (byCategory.length <= limit) return byCategory.map(row)

  const head = byCategory.slice(0, limit - 1).map(row)
  const restSum = byCategory.slice(limit - 1).reduce((sum, c) => sum + c.spentJpy, 0)
  head.push({ categoryId: null, name: 'Everything else', color: '#c9c3ba', spentJpy: restSum, pct: pct(restSum) })
  return head
}
