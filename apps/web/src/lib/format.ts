import { cycleBounds } from '@nri/core'

const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' })
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
