import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { LoanDetail, LoanInput, LoanPatch, LoanSchedule, PlannedPrepaymentsInput } from '@nri/contracts'
import {
  cycleOf, decimalFromPaise, loanOutcome, nextCycle, paiseFromDecimal, todayIn,
  type Cycle, type EmiRedirect, type LoanActual, type LoanTerms, type PlannedExtra,
} from '@nri/core'
import { loanPlannedPrepayments, loans, remittances, type Tx } from '@nri/db'
import { ApiError } from '../errors'

type LoanRow = typeof loans.$inferSelect

function toDetail(r: LoanRow): LoanDetail {
  return {
    id: r.id, name: r.name, principalPaise: paiseFromDecimal(r.principalInr), annualRatePct: r.annualRatePct,
    emiPaise: paiseFromDecimal(r.emiInr), tenureMonths: r.tenureMonths, startCycle: r.startCycle, closedAt: r.closedAt,
  }
}

function toTerms(r: LoanRow): LoanTerms {
  return {
    principalPaise: paiseFromDecimal(r.principalInr), annualRatePct: r.annualRatePct,
    emiPaise: paiseFromDecimal(r.emiInr), startCycle: r.startCycle,
  }
}

export async function getLoanRow(tx: Tx, userId: string, id: string): Promise<LoanRow> {
  const [row] = await tx.select().from(loans).where(and(eq(loans.id, id), eq(loans.userId, userId)))
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'That loan no longer exists')
  return row
}

export async function listOpenLoans(tx: Tx, userId: string): Promise<LoanRow[]> {
  return tx.select().from(loans).where(and(eq(loans.userId, userId), isNull(loans.closedAt))).orderBy(asc(loans.name))
}

export async function createLoan(tx: Tx, userId: string, input: LoanInput): Promise<LoanDetail> {
  const [row] = await tx.insert(loans).values({
    userId, name: input.name, principalInr: decimalFromPaise(input.principalPaise), annualRatePct: input.annualRatePct,
    emiInr: decimalFromPaise(input.emiPaise), tenureMonths: input.tenureMonths, startCycle: input.startCycle,
  }).returning()
  return toDetail(row!)
}

export async function patchLoan(tx: Tx, userId: string, id: string, patch: LoanPatch): Promise<LoanDetail> {
  const { closed, ...fields } = patch
  const set: Record<string, unknown> = { updatedAt: sql`now()` }
  if (fields.name !== undefined) set.name = fields.name
  if (fields.principalPaise !== undefined) set.principalInr = decimalFromPaise(fields.principalPaise)
  if (fields.annualRatePct !== undefined) set.annualRatePct = fields.annualRatePct
  if (fields.emiPaise !== undefined) set.emiInr = decimalFromPaise(fields.emiPaise)
  if (fields.tenureMonths !== undefined) set.tenureMonths = fields.tenureMonths
  if (fields.startCycle !== undefined) set.startCycle = fields.startCycle
  if (closed !== undefined) set.closedAt = closed ? sql`now()` : null

  const [row] = await tx.update(loans).set(set).where(and(eq(loans.id, id), eq(loans.userId, userId))).returning()
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'That loan no longer exists')
  return toDetail(row)
}

async function getPlannedExtras(tx: Tx, userId: string, loanId: string): Promise<PlannedExtra[]> {
  const rows = await tx.select({ monthIndex: loanPlannedPrepayments.monthIndex, amountInr: loanPlannedPrepayments.amountInr })
    .from(loanPlannedPrepayments).where(and(eq(loanPlannedPrepayments.loanId, loanId), eq(loanPlannedPrepayments.userId, userId)))
    .orderBy(asc(loanPlannedPrepayments.monthIndex))
  return rows.map((r) => ({ monthIndex: r.monthIndex, amountPaise: paiseFromDecimal(r.amountInr) }))
}

/** LOAN-3. Replaces all planned extras for the loan; the request already runs inside one transaction (dbMiddleware). */
export async function replacePlannedPrepayments(tx: Tx, userId: string, loanId: string, input: PlannedPrepaymentsInput): Promise<void> {
  await getLoanRow(tx, userId, loanId) // 404 + ownership
  await tx.delete(loanPlannedPrepayments).where(and(eq(loanPlannedPrepayments.loanId, loanId), eq(loanPlannedPrepayments.userId, userId)))
  if (input.items.length) {
    await tx.insert(loanPlannedPrepayments).values(
      input.items.map((i) => ({ userId, loanId, monthIndex: i.monthIndex, amountInr: decimalFromPaise(i.amountPaise) })),
    )
  }
}

/** LOAN-3: EMI and prepayment remittances for this loan, grouped by cycle (a cycle may have both). */
async function getLoanActuals(tx: Tx, userId: string, loanId: string, startDay: number): Promise<LoanActual[]> {
  const rows = await tx.select({ sentOn: remittances.sentOn, inrReceived: remittances.inrReceived, purpose: remittances.purpose })
    .from(remittances)
    .where(and(eq(remittances.userId, userId), eq(remittances.loanId, loanId), inArray(remittances.purpose, ['loan_emi', 'loan_prepayment'])))
  const by = new Map<Cycle, LoanActual>()
  for (const r of rows) {
    const cycle = cycleOf(r.sentOn, startDay)
    const entry = by.get(cycle) ?? { cycle, emiPaise: 0, extraPaise: 0 }
    const paise = paiseFromDecimal(r.inrReceived)
    if (r.purpose === 'loan_emi') entry.emiPaise += paise
    else entry.extraPaise += paise
    by.set(cycle, entry)
  }
  return [...by.values()]
}

/** Today's outstanding balance from the projected schedule: principal before the loan starts, 0 after payoff. */
function outstandingFor(schedule: { cycle: Cycle; closingPaise: number }[], startCycle: Cycle, principalPaise: number, todayCycle: Cycle): number {
  if (!schedule.length || todayCycle < startCycle) return principalPaise
  if (todayCycle > schedule.at(-1)!.cycle) return 0
  return schedule.find((r) => r.cycle === todayCycle)?.closingPaise ?? 0
}

/** LOAN-2..4. */
export async function getSchedule(tx: Tx, userId: string, loanId: string, startDay: number, timezone: string): Promise<LoanSchedule> {
  const row = await getLoanRow(tx, userId, loanId)
  const terms = toTerms(row)
  const [actuals, planned] = await Promise.all([getLoanActuals(tx, userId, loanId, startDay), getPlannedExtras(tx, userId, loanId)])
  const { schedule, plan, projected, interestSavedPaise } = loanOutcome(terms, actuals, planned)
  const todayCycle = cycleOf(todayIn(timezone), startDay)
  const outstandingPaise = outstandingFor(schedule, terms.startCycle, terms.principalPaise, todayCycle)
  return { loan: toDetail(row), rows: schedule, plan, projected, interestSavedPaise, outstandingPaise }
}

/**
 * SIP-4 redirect source: the open loan with the latest projected payoff.
 * shortcut: with several open loans this picks one rather than combining their EMIs; fine while there's usually one loan.
 */
export async function sipRedirect(tx: Tx, userId: string, startDay: number, timezone: string): Promise<EmiRedirect | null> {
  const open = await listOpenLoans(tx, userId)
  let bestPayoff: Cycle | null = null
  let best: EmiRedirect | null = null
  for (const row of open) {
    const { projected } = await getSchedule(tx, userId, row.id, startDay, timezone)
    if (projected.payoffCycle && (!bestPayoff || projected.payoffCycle > bestPayoff)) {
      bestPayoff = projected.payoffCycle
      best = { fromCycle: nextCycle(projected.payoffCycle), emiPaise: paiseFromDecimal(row.emiInr) }
    }
  }
  return best
}

/** DASH-7. */
export async function dashboardLoanSummary(
  tx: Tx, userId: string, startDay: number, timezone: string,
): Promise<{ name: string; outstandingPaise: number; payoffCycle: Cycle | null } | null> {
  const [first] = await listOpenLoans(tx, userId)
  if (!first) return null
  const { outstandingPaise, projected } = await getSchedule(tx, userId, first.id, startDay, timezone)
  return { name: first.name, outstandingPaise, payoffCycle: projected.payoffCycle }
}
