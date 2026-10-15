import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import {
  accounts, balanceSnapshots, categories, categoryBudgets, createDb, cycleIncomes, loanPlannedPrepayments, loans,
  profiles, remittances, sipAllocations, sipPlans, transactions, withUser, type Tx,
} from '../src/index'

const { db, close } = createDb(process.env.DATABASE_URL!)

/** Drizzle wraps Postgres errors ("Failed query: …"); the database's own message is on `.cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const err = e as Error & { cause?: Error }
    return err.cause?.message ?? err.message
  }
  throw new Error('expected the query to fail')
}
let a: TestUser
let b: TestUser

beforeAll(async () => {
  a = await createTestUser('rls-a')
  b = await createTestUser('rls-b')
})
afterAll(async () => {
  await deleteTestUser(a.id)
  await deleteTestUser(b.id)
  await close()
})

describe('withUser + RLS', () => {
  it('runs as role authenticated with the caller as auth.uid()', async () => {
    const row = await withUser(db, { sub: a.id, role: 'authenticated' }, (tx) =>
      tx.execute(sql`select current_user as role, auth.uid() as uid`),
    )
    expect(row[0]).toMatchObject({ role: 'authenticated', uid: a.id })
  })

  it('lets a user read their own rows but never another user’s', async () => {
    await withUser(db, { sub: a.id }, (tx) =>
      tx.insert(categories).values({ userId: a.id, name: 'Groceries', color: '#4caf50' }),
    )
    const seenByA = await withUser(db, { sub: a.id }, (tx) => tx.select().from(categories))
    const seenByB = await withUser(db, { sub: b.id }, (tx) => tx.select().from(categories))
    expect(seenByA.map((c) => c.name)).toContain('Groceries')
    expect(seenByB).toHaveLength(0)
  })

  it('blocks writing a row owned by someone else', async () => {
    expect(
      await pgError(
        withUser(db, { sub: b.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'Sneaky', color: '#000' })),
      ),
    ).toMatch(/row-level security/)
  })

  it('blocks updating another user’s row (zero rows affected)', async () => {
    const updated = await withUser(db, { sub: b.id }, (tx) =>
      tx.update(categories).set({ name: 'Hijacked' }).where(eq(categories.userId, a.id)).returning(),
    )
    expect(updated).toHaveLength(0)
  })

  it('rejects a zero planning rate at the database level', async () => {
    expect(
      await pgError(
        withUser(db, { sub: a.id }, (tx) =>
          tx.insert(profiles).values({ userId: a.id, salaryJpy: 1, planningRateJpyPerInr: '0', cycleStartDay: 25 }),
        ),
      ),
    ).toMatch(/profiles_rate_positive/)
  })

  it('rejects a duplicate category name ignoring case', async () => {
    expect(
      await pgError(
        withUser(db, { sub: a.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'groceries', color: '#111' })),
      ),
    ).toMatch(/categories_user_name/)
  })

  it('lets a user set their own cycle income but never another user’s, and rejects a duplicate cycle', async () => {
    await withUser(db, { sub: a.id }, (tx) => tx.insert(cycleIncomes).values({ userId: a.id, cycle: '2026-10', incomeJpy: 700000 }))
    const seenByA = await withUser(db, { sub: a.id }, (tx) => tx.select().from(cycleIncomes))
    const seenByB = await withUser(db, { sub: b.id }, (tx) => tx.select().from(cycleIncomes))
    expect(seenByA.map((r) => r.cycle)).toContain('2026-10')
    expect(seenByB).toHaveLength(0)
    expect(
      await pgError(withUser(db, { sub: a.id }, (tx) => tx.insert(cycleIncomes).values({ userId: a.id, cycle: '2026-10', incomeJpy: 1 }))),
    ).toMatch(/cycle_incomes_cycle/)
  })
})

describe('same-owner foreign keys', () => {
  // Parents owned by A; B tries to point at them. RLS hides A's rows from B, but only these keys stop the link.
  let catA: string, accA: string, loanA: string, planA: string, catB: string
  beforeAll(async () => {
    await withUser(db, { sub: a.id }, async (tx) => {
      catA = (await tx.insert(categories).values({ userId: a.id, name: 'Owned by A', color: '#123456' }).returning())[0]!.id
      accA = (await tx.insert(accounts).values({ userId: a.id, name: 'A bank', country: 'JP', currency: 'JPY', type: 'bank' }).returning())[0]!.id
      loanA = (await tx.insert(loans).values({
        userId: a.id, name: 'A loan', principalInr: '1000000.00', annualRatePct: '8.500', emiInr: '10000.00', tenureMonths: 240, startCycle: '2026-10',
      }).returning())[0]!.id
      planA = (await tx.insert(sipPlans).values({
        userId: a.id, startingMonthlyInr: '5000.00', stepUpPct: '10.00', expectedReturnPct: '12.00', startYear: 2027, endYear: 2036,
      }).returning())[0]!.id
    })
    catB = await withUser(db, { sub: b.id }, async (tx) =>
      (await tx.insert(categories).values({ userId: b.id, name: 'Owned by B', color: '#654321' }).returning())[0]!.id)
  })

  const txn = (categoryId: string, accountId: string | null = null) => ({
    userId: b.id, occurredOn: '2026-10-01', categoryId, accountId, amountJpy: 100, paymentMethod: 'cash' as const, needWant: 'need' as const,
  })
  const remit = (over: Record<string, string | null>) => ({
    userId: b.id, sentOn: '2026-10-01', jpySent: 1000, inrReceived: '590.00', purpose: 'family' as const, ...over,
  })

  it('still lets a user link to their own rows', async () => {
    const [row] = await withUser(db, { sub: b.id }, (tx) => tx.insert(transactions).values(txn(catB)).returning())
    expect(row!.categoryId).toBe(catB)
  })

  it.each([
    ['transactions → category', 'transactions_category_owner', () => (tx: Tx) => tx.insert(transactions).values(txn(catA))],
    ['transactions → account', 'transactions_account_owner', () => (tx: Tx) => tx.insert(transactions).values(txn(catB, accA))],
    ['remittances → from account', 'remittances_from_account_owner', () => (tx: Tx) => tx.insert(remittances).values(remit({ fromAccountId: accA }))],
    ['remittances → to account', 'remittances_to_account_owner', () => (tx: Tx) => tx.insert(remittances).values(remit({ toAccountId: accA }))],
    ['remittances → loan', 'remittances_loan_owner', () => (tx: Tx) =>
      tx.insert(remittances).values({ ...remit({ loanId: loanA }), purpose: 'loan_emi' })],
    ['balance snapshot → account', 'balance_snapshots_account_owner', () => (tx: Tx) =>
      tx.insert(balanceSnapshots).values({ userId: b.id, accountId: accA, cycle: '2026-10', balanceJpy: 1, recordedOn: '2026-10-25' })],
    ['budget → category', 'category_budgets_category_owner', () => (tx: Tx) =>
      tx.insert(categoryBudgets).values({ userId: b.id, categoryId: catA, amountJpy: 1, effectiveFromCycle: '2026-10' })],
    ['planned prepayment → loan', 'loan_planned_prepayments_loan_owner', () => (tx: Tx) =>
      tx.insert(loanPlannedPrepayments).values({ userId: b.id, loanId: loanA, monthIndex: 1, amountInr: '1.00' })],
    ['SIP allocation → plan', 'sip_allocations_plan_owner', () => (tx: Tx) =>
      tx.insert(sipAllocations).values({ userId: b.id, planId: planA, fundName: 'x', pct: '100.00' })],
  ])('refuses %s owned by another user', async (_label, constraint, make) => {
    expect(await pgError(withUser(db, { sub: b.id }, (tx) => make()(tx)))).toMatch(
      new RegExp(`violates foreign key constraint "${constraint}"`),
    )
  })
})
