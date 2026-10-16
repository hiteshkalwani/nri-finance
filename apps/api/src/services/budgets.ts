import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Budgets, BudgetsPut } from '@nri/contracts'
import { budgetRows, budgetStatus, type BudgetRow as CoreBudgetRow, cycleBounds, type Cycle } from '@nri/core'
import { categories, categoryBudgets, type Tx } from '@nri/db'
import { ApiError } from '../errors'

type CurrentBudget = { categoryId: string; amountJpy: number; effectiveFromCycle: Cycle }

/** BUD-1: the budget in effect at `cycle` for each category that has one — latest effective_from_cycle <= cycle. */
async function currentBudgets(tx: Tx, userId: string, cycle: Cycle): Promise<CurrentBudget[]> {
  const rows = await tx.execute<CurrentBudget>(sql`
    select distinct on (category_id) category_id as "categoryId", amount_jpy as "amountJpy", effective_from_cycle as "effectiveFromCycle"
    from category_budgets
    where user_id = ${userId} and effective_from_cycle <= ${cycle}
    order by category_id, effective_from_cycle desc`)
  return [...rows]
}

async function spendByCategory(tx: Tx, userId: string, cycle: Cycle, startDay: number): Promise<Map<string, number>> {
  const { start, end } = cycleBounds(cycle, startDay)
  const rows = await tx.execute<{ categoryId: string; spentJpy: number }>(sql`
    select category_id as "categoryId", sum(amount_jpy)::int as "spentJpy"
    from transactions
    where user_id = ${userId} and occurred_on between ${start} and ${end}
    group by category_id`)
  return new Map([...rows].map((r) => [r.categoryId, r.spentJpy]))
}

/** BUD-1/2: one row per active category, budgeted or not. */
export async function getBudgets(tx: Tx, userId: string, cycle: Cycle, startDay: number): Promise<Budgets> {
  const [cats, current, spend] = await Promise.all([
    tx.select({ id: categories.id, name: categories.name, color: categories.color }).from(categories)
      .where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
      .orderBy(categories.sortOrder, categories.name),
    currentBudgets(tx, userId, cycle),
    spendByCategory(tx, userId, cycle, startDay),
  ])
  const byCategory = new Map(current.map((b) => [b.categoryId, b]))
  const rows = cats.map((cat) => {
    const budget = byCategory.get(cat.id)
    const spentJpy = spend.get(cat.id) ?? 0
    if (!budget) {
      return { categoryId: cat.id, name: cat.name, color: cat.color, budgetJpy: null, effectiveFromCycle: null, spentJpy, remainingJpy: null, pct: null, state: null }
    }
    return {
      categoryId: cat.id, name: cat.name, color: cat.color, budgetJpy: budget.amountJpy, effectiveFromCycle: budget.effectiveFromCycle,
      spentJpy, ...budgetStatus(budget.amountJpy, spentJpy),
    }
  })
  return { cycle, rows }
}

export type BudgetAlert = CoreBudgetRow & { name: string; color: string; effectiveFromCycle: Cycle }

/** DASH-9/REV-1: budgeted categories that are near or over, over first (then by pct desc), with display fields. */
export async function budgetAlerts(tx: Tx, userId: string, cycle: Cycle, startDay: number): Promise<BudgetAlert[]> {
  const [cats, current, spend] = await Promise.all([
    tx.select({ id: categories.id, name: categories.name, color: categories.color }).from(categories).where(eq(categories.userId, userId)),
    currentBudgets(tx, userId, cycle),
    spendByCategory(tx, userId, cycle, startDay),
  ])
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const currentMap = new Map(current.map((b) => [b.categoryId, b]))
  const spendList = [...spend].map(([categoryId, spentJpy]) => ({ categoryId, spentJpy }))
  return budgetRows(current, spendList, cycle)
    .filter((r) => r.state !== 'under')
    .map((r) => ({
      ...r,
      effectiveFromCycle: currentMap.get(r.categoryId)!.effectiveFromCycle,
      name: catMap.get(r.categoryId)?.name ?? '',
      color: catMap.get(r.categoryId)?.color ?? '',
    }))
}

/** BUD-1: upsert the budget "from cycle" C, or remove it (null amount) so the earlier one applies again. */
export async function putBudgets(tx: Tx, userId: string, input: BudgetsPut): Promise<void> {
  const mine = new Set((await tx.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId))).map((r) => r.id))
  input.items.forEach((item, i) => {
    if (!mine.has(item.categoryId)) throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown category', [{ path: ['items', i, 'categoryId'] }])
  })
  for (const item of input.items) {
    if (item.amountJpy === null) {
      await tx.delete(categoryBudgets).where(
        and(eq(categoryBudgets.userId, userId), eq(categoryBudgets.categoryId, item.categoryId), eq(categoryBudgets.effectiveFromCycle, input.cycle)),
      )
    } else {
      await tx.insert(categoryBudgets).values({ userId, categoryId: item.categoryId, amountJpy: item.amountJpy, effectiveFromCycle: input.cycle })
        .onConflictDoUpdate({
          target: [categoryBudgets.categoryId, categoryBudgets.effectiveFromCycle],
          set: { amountJpy: item.amountJpy, updatedAt: sql`now()` },
        })
    }
  }
}
