import { and, eq, sql } from 'drizzle-orm'
import type { Category } from '@nri/contracts'
import { categories, type Tx } from '@nri/db'
import { ApiError } from '../errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertId(id: string, what = 'category'): string {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', `That ${what} no longer exists`)
  return id
}

/** My categories with usage and the last payment method / need-want used (quick-add defaults). */
export async function listCategories(tx: Tx, userId: string, id?: string): Promise<Category[]> {
  const rows = await tx.execute<Category>(sql`
    select c.id, c.name, c.color, c.icon, c.sort_order as "sortOrder", c.archived_at is not null as archived,
      (exists (select 1 from transactions t where t.user_id = c.user_id and t.category_id = c.id)
        or exists (select 1 from category_budgets b where b.user_id = c.user_id and b.category_id = c.id)) as "inUse",
      l.payment_method as "lastPaymentMethod", l.need_want as "lastNeedWant"
    from categories c
    left join lateral (
      select t.payment_method, t.need_want from transactions t
      where t.user_id = c.user_id and t.category_id = c.id
      order by t.occurred_on desc, t.created_at desc limit 1
    ) l on true
    where c.user_id = ${userId} ${id ? sql`and c.id = ${id}` : sql``}
    order by c.sort_order, c.name`)
  return [...rows]
}

export async function getCategory(tx: Tx, userId: string, id: string): Promise<Category> {
  const [c] = await listCategories(tx, userId, id)
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'That category no longer exists')
  return c
}

export async function reorderCategories(tx: Tx, userId: string, ids: string[]) {
  const mine = (await tx.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId))).map((r) => r.id)
  const given = new Set(ids)
  if (given.size !== ids.length || ids.length !== mine.length || mine.some((id) => !given.has(id))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'ids must list each of your categories exactly once')
  }
  for (const [i, id] of ids.entries()) {
    await tx.update(categories).set({ sortOrder: i }).where(and(eq(categories.id, id), eq(categories.userId, userId)))
  }
}
