import { Hono } from 'hono'
import { and, between, eq, sql } from 'drizzle-orm'
import { CycleString, NetWorthResponse, NetWorthSpan } from '@nri/contracts'
import {
  balanceAt,
  changeSince,
  type Cycle,
  cycleBounds,
  cycleOf,
  cycleRange,
  emergencyFundAt,
  lastCycles,
  monthsCovered,
  netWorthAt,
  previousCycle,
  todayIn,
} from '@nri/core'
import { transactions } from '@nri/db'
import { ApiError } from '../errors'
import type { AppVars } from '../middleware/db'
import { rateOut, requireProfile } from '../services/profile'
import { loadNetWorthInputs } from '../services/snapshots'

function parseCycle(param: string | undefined, startDay: number, timezone: string): Cycle {
  const parsed = param === undefined || param === '' ? null : CycleString.safeParse(param)
  if (parsed && !parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  return parsed?.data ?? cycleOf(todayIn(timezone), startDay)
}

export const networthRoutes = new Hono<{ Variables: AppVars }>().get('/', async (c) => {
  const { db, userId } = c.var
  const profile = await requireProfile(db, userId)
  const cycle = parseCycle(c.req.query('cycle'), profile.cycleStartDay, profile.timezone)
  const spanParsed = NetWorthSpan.safeParse(c.req.query('span') ?? '12')
  if (!spanParsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'span must be 6, 12, or all', spanParsed.error.issues)
  const span = spanParsed.data
  const rate = rateOut(profile.planningRateJpyPerInr)

  const { accounts, snaps } = await loadNetWorthInputs(db, userId, profile.cycleStartDay, profile.timezone)
  const first = snaps.reduce<string | null>((m, s) => (m === null || s.cycle < m ? s.cycle : m), null)
  const window =
    span === 'all'
      ? first ? cycleRange(first, cycle) : []
      : lastCycles(cycle, Number(span)).filter((cy) => first !== null && cy >= first)

  const now = netWorthAt(accounts, snaps, cycle, rate)
  const prevCycle = previousCycle(cycle)
  const prev = first !== null && prevCycle >= first ? netWorthAt(accounts, snaps, prevCycle, rate).combinedJpy : null
  const { changeJpy, changePct } = changeSince(now.combinedJpy, prev)

  const series = window.map((cy) => ({ cycle: cy, combinedJpy: netWorthAt(accounts, snaps, cy, rate).combinedJpy }))

  const active = accounts.filter((a) => !a.archived)
  const accountRows = active.map((a) => {
    const b = balanceAt(snaps, a, cycle)
    const bPrev = balanceAt(snaps, a, prevCycle)
    return {
      accountId: a.id,
      amount: b ? b.amount : null,
      source: (b ? (b.carried ? 'carried' : 'this') : 'none') as 'this' | 'carried' | 'none',
      fromCycle: b ? b.fromCycle : null,
      changeAmount: b && bPrev ? b.amount - bPrev.amount : null,
    }
  })

  // Emergency fund: months covered = EF balance ÷ average spend of the up-to-3 cycles immediately
  // before `cycle`, counting only cycles on or after the cycle of the user's first expense.
  const efJpy = emergencyFundAt(accounts, snaps, cycle, rate)
  const [minRow] = await db
    .select({ minDate: sql<string | null>`min(${transactions.occurredOn})` })
    .from(transactions)
    .where(eq(transactions.userId, userId))
  const firstExpenseCycle = minRow?.minDate ? cycleOf(minRow.minDate, profile.cycleStartDay) : null
  const priorCycles = lastCycles(prevCycle, 3)
  const eligibleCycles = firstExpenseCycle ? priorCycles.filter((cy) => cy >= firstExpenseCycle) : []

  let priorSpendJpy: number[] = []
  if (eligibleCycles.length > 0) {
    const rangeStart = cycleBounds(eligibleCycles[0]!, profile.cycleStartDay).start
    const rangeEnd = cycleBounds(eligibleCycles[eligibleCycles.length - 1]!, profile.cycleStartDay).end
    const rows = await db
      .select({ occurredOn: transactions.occurredOn, amountJpy: transactions.amountJpy })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), between(transactions.occurredOn, rangeStart, rangeEnd)))
    const sums = new Map<string, number>()
    for (const r of rows) {
      const cy = cycleOf(r.occurredOn, profile.cycleStartDay)
      sums.set(cy, (sums.get(cy) ?? 0) + r.amountJpy)
    }
    priorSpendJpy = eligibleCycles.map((cy) => sums.get(cy) ?? 0)
  }
  const { monthsCovered: efMonthsCovered, avgSpendJpy } = monthsCovered(efJpy, priorSpendJpy)

  return c.json(
    NetWorthResponse.parse({
      rate,
      cycle,
      current: { japanJpy: now.japanJpy, indiaPaise: now.indiaPaise, combinedJpy: now.combinedJpy, changeJpy, changePct },
      assets: now.assets,
      liabilities: now.liabilities,
      series,
      accounts: accountRows,
      emergencyFund: { balanceJpy: efJpy, goalJpy: profile.emergencyFundGoalJpy, monthsCovered: efMonthsCovered, avgSpendJpy },
    }),
  )
})
