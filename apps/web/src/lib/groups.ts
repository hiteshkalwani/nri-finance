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

/** Total pages for a server-paginated list (at least 1, even with zero rows, so a pager never reads 0 of 0). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * Whether a date-group's total on the ledger page should be marked "on this page" rather than
 * shown as a plain total. A group in the middle of a page is fully contained — every row for that
 * date is on this page, so its total is already the whole day. Only the first or last group on a
 * page could have more of the same date sitting on a neighbouring page (ascending or descending
 * sort, either edge), and only when there's more than one page for it to continue onto.
 */
export function isPartialPageGroup(groupIndex: number, groupCount: number, totalPages: number): boolean {
  return totalPages > 1 && (groupIndex === 0 || groupIndex === groupCount - 1)
}
