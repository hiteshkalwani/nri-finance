export type IsoDate = string
export type Cycle = string

const pad = (n: number) => String(n).padStart(2, '0')

/** Builds YYYY-MM-DD from calendar parts; day 0 or overflow rolls like Date.UTC. */
export function formatIsoDate(y: number, m: number, d: number): IsoDate {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function cycleOf(date: IsoDate, startDay = 25): Cycle {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  let year = y
  let month = m
  if (d >= startDay) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return `${year}-${pad(month)}`
}

export function cycleBounds(cycle: Cycle, startDay = 25): { start: IsoDate; end: IsoDate } {
  const [y, m] = cycle.split('-').map(Number) as [number, number]
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  return { start: formatIsoDate(prevY, prevM, startDay), end: formatIsoDate(y, m, startDay - 1) }
}

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function previousCycle(cycle: Cycle): Cycle {
  const [y, m] = cycle.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}

export function nextCycle(cycle: Cycle): Cycle {
  const [y, m] = cycle.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}

/** Inclusive, oldest first; empty when `from` is after `to`. YYYY-MM strings compare correctly as text. */
export function cycleRange(from: Cycle, to: Cycle): Cycle[] {
  const out: Cycle[] = []
  for (let c = from; c <= to; c = nextCycle(c)) out.push(c)
  return out
}

export function lastCycles(end: Cycle, n: number): Cycle[] {
  let start = end
  for (let i = 1; i < n; i++) start = previousCycle(start)
  return cycleRange(start, end)
}
