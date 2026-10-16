import type { ScheduleRow } from '@nri/core'
import { MONTHS } from './format'

/** monthIndex (amortize's month, 1 = startCycle) for a given "YYYY-MM" cycle. */
export function monthIndexFromCycle(cycle: string, startCycle: string): number {
  const [sy, sm] = startCycle.split('-').map(Number) as [number, number]
  const [cy, cm] = cycle.split('-').map(Number) as [number, number]
  return (cy - sy) * 12 + (cm - sm) + 1
}

/** The inverse of `monthIndexFromCycle`: the "YYYY-MM" cycle for a given monthIndex. */
export function cycleFromMonthIndex(monthIndex: number, startCycle: string): string {
  const [sy, sm] = startCycle.split('-').map(Number) as [number, number]
  const total = sm - 1 + (monthIndex - 1)
  const y = sy + Math.floor(total / 12)
  const m = (((total % 12) + 12) % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * LOAN-3: the planned prepayments already reflected in the projected schedule — a non-actual
 * row's `extraPaise` came from `amortize`'s own `plannedBy` lookup, so it equals what was last
 * PUT for that month (capped at what was owed, same edge case the plan dialog can't see either).
 * Reused to prefill "Plan a prepayment" without a second API call for the raw planned rows.
 */
export function plannedFromRows(rows: ScheduleRow[]): { cycle: string; amountPaise: number }[] {
  return rows.filter((r) => !r.actual && r.extraPaise > 0).map((r) => ({ cycle: r.cycle, amountPaise: r.extraPaise }))
}

export type ScheduleFilter = 'upcoming' | 'past' | 'all'

/** The Schedule table's Upcoming/Past/All segmented control (schedule is already sorted by cycle). */
export function filterScheduleRows(rows: ScheduleRow[], filter: ScheduleFilter, currentCycle: string): ScheduleRow[] {
  if (filter === 'upcoming') return rows.filter((r) => r.cycle >= currentCycle)
  if (filter === 'past') return rows.filter((r) => r.cycle < currentCycle)
  return rows
}

/** Every 12th row (loan-year boundaries) plus the final row, for a readable yearly chart/list instead of one point per month. */
export function yearlyRows(rows: ScheduleRow[]): ScheduleRow[] {
  const out = rows.filter((r) => (r.month - 1) % 12 === 0)
  const last = rows.at(-1)
  if (last && out.at(-1) !== last) out.push(last)
  return out
}

/**
 * LOAN-4's "n yrs m mo earlier/later than plan (Mon YYYY)" — never colour alone (spec §7), so the
 * word itself ("earlier"/"later") always ships with the text. `null` when either payoff never
 * happens (schedule hit the month cap) — there's nothing to compare.
 */
export function payoffVsPlanText(projectedCycle: string | null, planCycle: string | null): { text: string; cls: 'good' | 'bad' | 'muted' } | null {
  if (!projectedCycle || !planCycle) return null
  const [py, pm] = planCycle.split('-').map(Number) as [number, number]
  const monthLabel = `${MONTHS[pm - 1]} ${py}`
  const diffMonths = monthIndexFromCycle(planCycle, projectedCycle) - 1
  if (diffMonths === 0) return { text: `On plan (${monthLabel})`, cls: 'muted' }
  const earlier = diffMonths > 0
  const abs = Math.abs(diffMonths)
  const years = Math.floor(abs / 12)
  const months = abs % 12
  const parts = [years > 0 ? `${years} yr${years === 1 ? '' : 's'}` : null, months > 0 ? `${months} mo` : null].filter(Boolean)
  return { text: `${parts.join(' ')} ${earlier ? 'earlier' : 'later'} than plan (${monthLabel})`, cls: earlier ? 'good' : 'bad' }
}
