import { and, between, eq, sql } from 'drizzle-orm'
import type { SipPlan, SipPlanInput, SipProjection } from '@nri/contracts'
import {
  cycleBounds, cycleOf, decimalFromPaise, lastCycles, paiseFromDecimal, sipMonthlyFor, sipProjection, todayIn,
  type Cycle, type SipPlan as CoreSipPlan,
} from '@nri/core'
import { remittances, sipAllocations, sipPlans, type Tx } from '@nri/db'
import { ApiError } from '../errors'
import { sipRedirect } from './loans'

type PlanRow = typeof sipPlans.$inferSelect
type AllocRow = { fundName: string; pct: string }

function toSipPlan(row: PlanRow, allocations: AllocRow[]): SipPlan {
  return {
    startingMonthlyPaise: paiseFromDecimal(row.startingMonthlyInr), stepUpPct: row.stepUpPct,
    expectedReturnPct: row.expectedReturnPct, startYear: row.startYear, endYear: row.endYear,
    redirectEmiAfterPayoff: row.redirectEmiAfterPayoff, allocations,
  }
}

/** Core's sip functions take plain numbers for percents; the contract carries them as numeric(5,2) strings. */
function toCorePlan(plan: SipPlan): CoreSipPlan {
  return {
    startingMonthlyPaise: plan.startingMonthlyPaise, stepUpPct: Number(plan.stepUpPct),
    expectedReturnPct: Number(plan.expectedReturnPct), startYear: plan.startYear, endYear: plan.endYear,
    redirectEmiAfterPayoff: plan.redirectEmiAfterPayoff,
  }
}

export async function getSipPlan(tx: Tx, userId: string): Promise<SipPlan | null> {
  const [row] = await tx.select().from(sipPlans).where(eq(sipPlans.userId, userId))
  if (!row) return null
  const allocations = await tx.select({ fundName: sipAllocations.fundName, pct: sipAllocations.pct }).from(sipAllocations)
    .where(eq(sipAllocations.userId, userId))
  return toSipPlan(row, allocations)
}

async function requireSipPlan(tx: Tx, userId: string): Promise<SipPlan> {
  const plan = await getSipPlan(tx, userId)
  if (!plan) throw new ApiError(409, 'CONFLICT', 'Set up your SIP plan first')
  return plan
}

/** SIP-1/2. One plan per user (upsert); allocations are replaced wholesale. */
export async function upsertSipPlan(tx: Tx, userId: string, input: SipPlanInput): Promise<SipPlan> {
  const values = {
    startingMonthlyInr: decimalFromPaise(input.startingMonthlyPaise), stepUpPct: input.stepUpPct,
    expectedReturnPct: input.expectedReturnPct, startYear: input.startYear, endYear: input.endYear,
    redirectEmiAfterPayoff: input.redirectEmiAfterPayoff,
  }
  const [row] = await tx.insert(sipPlans).values({ userId, ...values })
    .onConflictDoUpdate({ target: sipPlans.userId, set: { ...values, updatedAt: sql`now()` } })
    .returning()
  await tx.delete(sipAllocations).where(and(eq(sipAllocations.userId, userId), eq(sipAllocations.planId, row!.id)))
  const allocations = input.allocations.length
    ? await tx.insert(sipAllocations).values(input.allocations.map((a) => ({ userId, planId: row!.id, fundName: a.fundName, pct: a.pct })))
      .returning({ fundName: sipAllocations.fundName, pct: sipAllocations.pct })
    : []
  return toSipPlan(row!, allocations)
}

/** SIP-3: ₹ received for 'sip' remittances, grouped by cycle, over the given cycle range. */
async function getSipActuals(tx: Tx, userId: string, startDay: number, cycles: Cycle[]): Promise<Map<Cycle, number>> {
  const { start } = cycleBounds(cycles[0]!, startDay)
  const { end } = cycleBounds(cycles.at(-1)!, startDay)
  const rows = await tx.select({ sentOn: remittances.sentOn, inrReceived: remittances.inrReceived }).from(remittances)
    .where(and(eq(remittances.userId, userId), eq(remittances.purpose, 'sip'), between(remittances.sentOn, start, end)))
  const by = new Map<Cycle, number>()
  for (const r of rows) {
    const cycle = cycleOf(r.sentOn, startDay)
    by.set(cycle, (by.get(cycle) ?? 0) + paiseFromDecimal(r.inrReceived))
  }
  return by
}

/** SIP-3/4. */
export async function getProjection(tx: Tx, userId: string, startDay: number, timezone: string): Promise<SipProjection> {
  const plan = await requireSipPlan(tx, userId)
  const core = toCorePlan(plan)
  const redirect = await sipRedirect(tx, userId, startDay, timezone)
  const years = sipProjection(core, redirect)
  const cycles = lastCycles(cycleOf(todayIn(timezone), startDay), 12)
  const paidByCycle = await getSipActuals(tx, userId, startDay, cycles)
  const actuals = cycles.map((cycle) => ({
    cycle, paidPaise: paidByCycle.get(cycle) ?? 0, plannedPaise: sipMonthlyFor(core, Number(cycle.slice(0, 4))),
  }))
  return { plan, years, redirectFromCycle: redirect?.fromCycle ?? null, actuals }
}

/** DASH-8. */
export async function dashboardSipSummary(
  tx: Tx, userId: string, startDay: number, timezone: string, paidThisCyclePaise: number,
): Promise<{ paidPaise: number; plannedPaise: number; projectedCorpusPaise: number } | null> {
  const plan = await getSipPlan(tx, userId)
  if (!plan) return null
  const core = toCorePlan(plan)
  const redirect = await sipRedirect(tx, userId, startDay, timezone)
  const last = sipProjection(core, redirect).at(-1)!
  const year = Number(cycleOf(todayIn(timezone), startDay).slice(0, 4))
  return { paidPaise: paidThisCyclePaise, plannedPaise: sipMonthlyFor(core, year), projectedCorpusPaise: last.sipCorpusPaise + last.emiCorpusPaise }
}
