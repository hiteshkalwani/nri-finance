import { cycleBounds } from '@nri/core'

const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' })
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const yen = (n: number) => jpy.format(n)
export const rupees = (paise: number) => inr.format(paise / 100)

/** "25 Sep – 24 Oct 2026" for two ISO dates; the start year is shown only when it differs from the end year. */
export function dateRangeLabel(start: string, end: string): string {
  const part = (d: string) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; return { y, text: `${day} ${MONTHS[m - 1]}` } }
  const s = part(start)
  const e = part(end)
  return s.y === e.y ? `${s.text} – ${e.text} ${e.y}` : `${s.text} ${s.y} – ${e.text} ${e.y}`
}

/** "25 Sep – 24 Oct 2026"; the start year is shown only when it differs from the end year. */
export function cycleLabel(cycle: string, startDay: number): string {
  const { start, end } = cycleBounds(cycle, startDay)
  return dateRangeLabel(start, end)
}

/** "Oct 2026" for a cycle string "YYYY-MM" — the Accounts screen builds every cycle label client-side (controller ruling, spec §3). */
export function monthYearLabel(cycle: string): string {
  const [y, m] = cycle.split('-').map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${y}`
}

/**
 * Quick-add's amount-card date hint (spec §4.3): "Today · Mon 5 Oct" when `occurredOn` is `today`
 * (both already local calendar dates from `todayIn`), else just "Mon 5 Oct". Built from the date's
 * own y/m/d components (not `toISOString`, which reads back the UTC date) via a local-midnight
 * `Date`, used only to recover the weekday name.
 */
export function dateHint(occurredOn: string, today: string): string {
  const [y, m, d] = occurredOn.split('-').map(Number) as [number, number, number]
  const text = `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`
  return occurredOn === today ? `Today · ${text}` : text
}
