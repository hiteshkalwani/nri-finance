import { and, between, desc, eq, isNull, sql } from 'drizzle-orm'
import { RemittanceInput, type Remittance, type RemittancePatch, type RemittanceQuery, type RemittanceRates } from '@nri/contracts'
import { cycleBounds, cycleOf, decimalFromPaise, effectiveRate, paiseFromDecimal, sentByPurpose, todayIn } from '@nri/core'
import { accounts, loans, remittances, type Tx } from '@nri/db'
import { ApiError } from '../errors'

type Row = typeof remittances.$inferSelect

function toRemittance(r: Row): Remittance {
  const inrPaise = paiseFromDecimal(r.inrReceived)
  return {
    id: r.id,
    sentOn: r.sentOn,
    jpySent: r.jpySent,
    inrPaise,
    feeJpy: r.feeJpy,
    service: r.service as Remittance['service'],
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    purpose: r.purpose,
    loanId: r.loanId,
    notes: r.notes,
    rate: effectiveRate(r.jpySent, inrPaise),
  }
}

const invalid = (path: string, message: string) =>
  new ApiError(400, 'VALIDATION_FAILED', message, [{ path: [path], message }])

async function checkCountryAccount(tx: Tx, userId: string, id: string | null | undefined, country: 'JP' | 'IN', path: string) {
  if (!id) return
  const [acc] = await tx.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId), eq(accounts.country, country), isNull(accounts.archivedAt)))
  if (!acc) throw invalid(path, country === 'JP' ? 'That must be one of your Japan accounts' : 'That must be one of your India accounts')
}

async function checkLoan(tx: Tx, userId: string, id: string | null | undefined) {
  if (!id) return
  const [loan] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.id, id), eq(loans.userId, userId)))
  if (!loan) throw invalid('loanId', 'That loan does not exist')
}

export async function createRemittance(tx: Tx, userId: string, input: RemittanceInput): Promise<Remittance> {
  await checkCountryAccount(tx, userId, input.fromAccountId, 'JP', 'fromAccountId')
  await checkCountryAccount(tx, userId, input.toAccountId, 'IN', 'toAccountId')
  await checkLoan(tx, userId, input.loanId)
  const [row] = await tx.insert(remittances).values({
    userId,
    sentOn: input.sentOn,
    jpySent: input.jpySent,
    inrReceived: decimalFromPaise(input.inrPaise),
    feeJpy: input.feeJpy,
    service: input.service,
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
    purpose: input.purpose,
    loanId: input.loanId ?? null,
    notes: input.notes,
  }).returning()
  return toRemittance(row!)
}

export async function getRemittance(tx: Tx, userId: string, id: string): Promise<Remittance> {
  const [row] = await tx.select().from(remittances).where(and(eq(remittances.id, id), eq(remittances.userId, userId)))
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'That remittance no longer exists')
  return toRemittance(row)
}

/**
 * Merges the patch onto the stored row and validates the full `RemittanceInput` rules (loan link, fee
 * ≤ ¥ sent). An account/loan is only re-checked when it actually changes, so an account archived since
 * this remittance was recorded can stay on it (same rule as transactions' account check).
 */
export async function updateRemittance(tx: Tx, userId: string, id: string, patch: RemittancePatch): Promise<Remittance> {
  const [existing] = await tx.select().from(remittances).where(and(eq(remittances.id, id), eq(remittances.userId, userId)))
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'That remittance no longer exists')

  const merged = {
    sentOn: patch.sentOn ?? existing.sentOn,
    jpySent: patch.jpySent ?? existing.jpySent,
    inrPaise: patch.inrPaise ?? paiseFromDecimal(existing.inrReceived),
    feeJpy: patch.feeJpy ?? existing.feeJpy,
    service: patch.service ?? existing.service,
    fromAccountId: patch.fromAccountId !== undefined ? patch.fromAccountId : existing.fromAccountId,
    toAccountId: patch.toAccountId !== undefined ? patch.toAccountId : existing.toAccountId,
    purpose: patch.purpose ?? existing.purpose,
    loanId: patch.loanId !== undefined ? patch.loanId : existing.loanId,
    notes: patch.notes ?? existing.notes,
  }
  const parsed = RemittanceInput.safeParse(merged)
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body is invalid', parsed.error.issues)
  const input = parsed.data

  if (patch.fromAccountId !== undefined && patch.fromAccountId !== existing.fromAccountId) {
    await checkCountryAccount(tx, userId, input.fromAccountId, 'JP', 'fromAccountId')
  }
  if (patch.toAccountId !== undefined && patch.toAccountId !== existing.toAccountId) {
    await checkCountryAccount(tx, userId, input.toAccountId, 'IN', 'toAccountId')
  }
  if (patch.loanId !== undefined && patch.loanId !== existing.loanId) {
    await checkLoan(tx, userId, input.loanId)
  }

  const [row] = await tx.update(remittances).set({
    sentOn: input.sentOn,
    jpySent: input.jpySent,
    inrReceived: decimalFromPaise(input.inrPaise),
    feeJpy: input.feeJpy,
    service: input.service,
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
    purpose: input.purpose,
    loanId: input.loanId ?? null,
    notes: input.notes,
    updatedAt: sql`now()`,
  }).where(and(eq(remittances.id, id), eq(remittances.userId, userId))).returning()
  return toRemittance(row!)
}

export async function deleteRemittance(tx: Tx, userId: string, id: string) {
  const gone = await tx.delete(remittances).where(and(eq(remittances.id, id), eq(remittances.userId, userId))).returning({ id: remittances.id })
  if (!gone.length) throw new ApiError(404, 'NOT_FOUND', 'That remittance no longer exists')
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export async function listRemittances(tx: Tx, userId: string, q: RemittanceQuery, startDay: number, timezone: string) {
  const cycle = q.cycle ?? cycleOf(todayIn(timezone), startDay)
  const { start, end } = cycleBounds(cycle, startDay)
  const where = [eq(remittances.userId, userId), between(remittances.sentOn, start, end)]
  if (q.purpose) where.push(eq(remittances.purpose, q.purpose))

  const rows = await tx.select().from(remittances).where(and(...where))
    .orderBy(desc(remittances.sentOn), desc(remittances.createdAt))
  const items = rows.map(toRemittance)
  const jpySent = sum(items.map((i) => i.jpySent))
  const inrPaise = sum(items.map((i) => i.inrPaise))

  return {
    cycle,
    start,
    end,
    items,
    totals: {
      jpySent,
      inrPaise,
      feesJpy: sum(items.map((i) => i.feeJpy)),
      count: items.length,
      avgRate: items.length ? effectiveRate(jpySent, inrPaise) : null,
      byPurpose: sentByPurpose(items),
    },
  }
}

export async function listRates(tx: Tx, userId: string, limit: number): Promise<RemittanceRates['points']> {
  const rows = await tx.select({ sentOn: remittances.sentOn, jpySent: remittances.jpySent, inrReceived: remittances.inrReceived })
    .from(remittances)
    .where(eq(remittances.userId, userId))
    .orderBy(desc(remittances.sentOn), desc(remittances.createdAt))
    .limit(limit)
  return rows.reverse().map((r) => ({ sentOn: r.sentOn, rate: effectiveRate(r.jpySent, paiseFromDecimal(r.inrReceived)) }))
}
