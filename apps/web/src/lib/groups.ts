import { MONTHS } from './format'

export type DateGroup<T> = { date: string; label: string; totalJpy: number; rows: T[] }

/** "5 Oct 2026" for an ISO date like "2026-10-05". */
function labelFor(occurredOn: string): string {
  const [y, m, d] = occurredOn.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * Groups consecutive rows that share a date (the page's current sort order is kept, not
 * re-sorted), totalling each group's amountJpy. A date that reappears later — e.g. an ascending
 * sort, or two pages joined — starts a new group rather than merging into the earlier one.
 */
export function groupByDate<T extends { occurredOn: string; amountJpy: number }>(rows: T[]): DateGroup<T>[] {
  const groups: DateGroup<T>[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.date === row.occurredOn) {
      last.totalJpy += row.amountJpy
      last.rows.push(row)
    } else {
      groups.push({ date: row.occurredOn, label: labelFor(row.occurredOn), totalJpy: row.amountJpy, rows: [row] })
    }
  }
  return groups
}
