import { and, asc, between, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Transaction, TransactionCreate, TransactionPatch, TransactionQuery } from '@nri/contracts'
import { cycleBounds, cycleOf, decimalFromPaise, jpyFromInrPaise, paiseFromDecimal } from '@nri/core'
import { accounts, categories, transactions, type Tx } from '@nri/db'
import { ApiError } from '../errors'
import { getProfileRow, requireProfile } from './profile'

type Row = typeof transactions.$inferSelect

export function toTransaction(r: Row, startDay: number): Transaction {
  return {
    id: r.id,
    occurredOn: r.occurredOn,
    cycle: cycleOf(r.occurredOn, startDay),
    categoryId: r.categoryId,
    accountId: r.accountId,
    description: r.description,
    amountJpy: r.amountJpy,
    enteredCurrency: r.enteredCurrency,
    amountInrPaise: r.amountInr === null ? null : paiseFromDecimal(r.amountInr),
    rateUsed: r.rateUsed,
    paymentMethod: r.paymentMethod,
    needWant: r.needWant,
    notes: r.notes,
  }
}

const invalid = (path: string, message: string) =>
  new ApiError(400, 'VALIDATION_FAILED', message, [{ path: [path], message }])

/** Drops the raw amount fields so `amountFields`'s derived values are the only ones written. */
function omitAmounts<T extends { amountJpy?: number; amountInrPaise?: number }>(input: T): Omit<T, 'amountJpy' | 'amountInrPaise'> {
  const rest = { ...input }
  delete rest.amountJpy
  delete rest.amountInrPaise
  return rest
}

async function checkCategory(tx: Tx, userId: string, id: string, mustBeActive: boolean) {
  const [c] = await tx.select({ archivedAt: categories.archivedAt }).from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
  if (!c) throw invalid('categoryId', 'That category does not exist')
  if (mustBeActive && c.archivedAt) throw invalid('categoryId', 'That category is archived')
}

async function checkAccount(tx: Tx, userId: string, id: string | null | undefined) {
  if (!id) return
  const [acc] = await tx.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.archivedAt)))
  if (!acc) throw invalid('accountId', 'That account does not exist')
}

/** ¥ as given, or ₹ converted at the current planning rate (TXN-4); stored, never recomputed later. */
async function amountFields(tx: Tx, userId: string, input: { amountJpy?: number; amountInrPaise?: number }) {
  if (input.amountJpy !== undefined) {
    return { amountJpy: input.amountJpy, enteredCurrency: 'JPY' as const, amountInr: null, rateUsed: null }
  }
  if (input.amountInrPaise === undefined) return {}
  const rate = (await requireProfile(tx, userId)).planningRateJpyPerInr
  const amountJpy = jpyFromInrPaise(input.amountInrPaise, rate)
  if (amountJpy < 1) throw invalid('amountInrPaise', 'That amount is less than ¥1 at the planning rate')
  return { amountJpy, enteredCurrency: 'INR' as const, amountInr: decimalFromPaise(input.amountInrPaise), rateUsed: rate }
}

async function startDayFor(tx: Tx, userId: string) {
  return (await getProfileRow(tx, userId))?.cycleStartDay ?? 25
}

export async function createTransaction(tx: Tx, userId: string, input: TransactionCreate): Promise<Transaction> {
  await checkCategory(tx, userId, input.categoryId, true)
  await checkAccount(tx, userId, input.accountId)
  const rest = omitAmounts(input)
  const [row] = await tx.insert(transactions)
    .values({ userId, ...rest, accountId: input.accountId ?? null, ...(await amountFields(tx, userId, input)) } as typeof transactions.$inferInsert)
    .returning()
  return toTransaction(row!, await startDayFor(tx, userId))
}

export async function updateTransaction(tx: Tx, userId: string, id: string, input: TransactionPatch): Promise<Transaction> {
  const [existing] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'That expense no longer exists')
  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) await checkCategory(tx, userId, input.categoryId, true)
  if (input.accountId !== undefined) await checkAccount(tx, userId, input.accountId)
  const rest = omitAmounts(input)
  const [row] = await tx.update(transactions)
    .set({ ...rest, ...(await amountFields(tx, userId, input)), updatedAt: sql`now()` })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning()
  return toTransaction(row!, await startDayFor(tx, userId))
}

export async function getTransaction(tx: Tx, userId: string, id: string): Promise<Transaction> {
  const [row] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'That expense no longer exists')
  return toTransaction(row, await startDayFor(tx, userId))
}

export async function deleteTransaction(tx: Tx, userId: string, id: string) {
  const gone = await tx.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId))).returning({ id: transactions.id })
  if (!gone.length) throw new ApiError(404, 'NOT_FOUND', 'That expense no longer exists')
}

/** ILIKE pattern that matches `q` literally (backslash is Postgres's default LIKE escape). */
const likeLiteral = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

const SORT = {
  occurredOn: transactions.occurredOn,
  amountJpy: transactions.amountJpy,
  category: categories.name,
  paymentMethod: transactions.paymentMethod,
  needWant: transactions.needWant,
  description: transactions.description,
} as const

export async function listTransactions(tx: Tx, userId: string, q: TransactionQuery) {
  const startDay = await startDayFor(tx, userId)
  const where: SQL[] = [eq(transactions.userId, userId)]
  if (q.cycle) {
    const { start, end } = cycleBounds(q.cycle, startDay)
    where.push(between(transactions.occurredOn, start, end))
  }
  if (q.categoryId) where.push(eq(transactions.categoryId, q.categoryId))
  if (q.paymentMethod) where.push(eq(transactions.paymentMethod, q.paymentMethod))
  if (q.needWant) where.push(eq(transactions.needWant, q.needWant))
  if (q.q) where.push(or(ilike(transactions.description, likeLiteral(q.q)), ilike(transactions.notes, likeLiteral(q.q)))!)
  const cond = and(...where)
  const direction = q.dir === 'asc' ? asc : desc

  const rows = await tx.select({ t: transactions }).from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(cond)
    .orderBy(direction(SORT[q.sort]), desc(transactions.createdAt), asc(transactions.id))
    .limit(q.pageSize).offset((q.page - 1) * q.pageSize)
  const [totals] = await tx.select({
    total: sql<number>`count(*)`.mapWith(Number),
    totalJpy: sql<number>`coalesce(sum(${transactions.amountJpy}), 0)`.mapWith(Number),
  }).from(transactions).where(cond)

  return { items: rows.map((r) => toTransaction(r.t, startDay)), total: totals!.total, page: q.page, pageSize: q.pageSize, totalJpy: totals!.totalJpy }
}
