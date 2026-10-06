import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { BalancesPut, BalancesResponse, CycleString, PG_INT_MAX } from '@nri/contracts'
import { balanceAt, type Cycle, cycleBounds, cycleOf, decimalFromPaise, todayIn } from '@nri/core'
import { balanceSnapshots, type Tx } from '@nri/db'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { rateOut, requireProfile } from '../services/profile'
import { loadNetWorthInputs, type NetWorthAccount } from '../services/snapshots'

// Display order within a cycle's rows: country (Japan first), then this type order, then name.
const TYPE_ORDER = ['bank', 'cash', 'fd', 'investment', 'card'] as const

function parseCycle(param: string | undefined, startDay: number, timezone: string): Cycle {
  const parsed = param === undefined || param === '' ? null : CycleString.safeParse(param)
  if (parsed && !parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  return parsed?.data ?? cycleOf(todayIn(timezone), startDay)
}

function sortRows(accounts: NetWorthAccount[]): NetWorthAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.country !== b.country) return a.country === 'JP' ? -1 : 1
    const ta = TYPE_ORDER.indexOf(a.type)
    const tb = TYPE_ORDER.indexOf(b.type)
    if (ta !== tb) return ta - tb
    return a.name.localeCompare(b.name)
  })
}

async function buildResponse(tx: Tx, userId: string, cycle: Cycle, startDay: number, timezone: string, rate: string) {
  const { accounts, snaps } = await loadNetWorthInputs(tx, userId, startDay, timezone)
  const active = sortRows(accounts.filter((a) => !a.archived))
  const rows = active.map((a) => {
    const b = balanceAt(snaps, a, cycle)
    return {
      accountId: a.id,
      name: a.name,
      country: a.country,
      currency: a.currency,
      type: a.type,
      isEmergencyFund: a.isEmergencyFund,
      amount: b ? b.amount : null,
      source: (b ? (b.carried ? 'carried' : 'this') : 'none') as 'this' | 'carried' | 'none',
      fromCycle: b ? b.fromCycle : null,
    }
  })
  const { start, end } = cycleBounds(cycle, startDay)
  return BalancesResponse.parse({ cycle, start, end, rate, rows })
}

export const balanceRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const cycle = parseCycle(c.req.query('cycle'), profile.cycleStartDay, profile.timezone)
    const body = await buildResponse(
      db, userId, cycle, profile.cycleStartDay, profile.timezone, rateOut(profile.planningRateJpyPerInr),
    )
    return c.json(body)
  })
  .put('/', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const input = await parseJson(c, BalancesPut)
    const { accounts } = await loadNetWorthInputs(db, userId, profile.cycleStartDay, profile.timezone)
    const active = new Map(accounts.filter((a) => !a.archived).map((a) => [a.id, a]))

    input.entries.forEach((e, i) => {
      const acc = active.get(e.accountId)
      if (!acc) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown or archived account', [{ path: ['entries', i, 'accountId'] }])
      }
      if (acc.country === 'JP' && e.amount > PG_INT_MAX) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Amount is too large', [{ path: ['entries', i, 'amount'] }])
      }
    })

    const recordedOn = todayIn(profile.timezone)
    for (const e of input.entries) {
      const acc = active.get(e.accountId)!
      const balanceJpy = acc.country === 'JP' ? e.amount : null
      const balanceInr = acc.country === 'IN' ? decimalFromPaise(e.amount) : null
      await db
        .insert(balanceSnapshots)
        .values({ userId, accountId: e.accountId, cycle: input.cycle, balanceJpy, balanceInr, recordedOn })
        .onConflictDoUpdate({
          target: [balanceSnapshots.accountId, balanceSnapshots.cycle],
          set: { balanceJpy, balanceInr, recordedOn, updatedAt: sql`now()` },
        })
    }

    const body = await buildResponse(
      db, userId, input.cycle, profile.cycleStartDay, profile.timezone, rateOut(profile.planningRateJpyPerInr),
    )
    return c.json(body)
  })
