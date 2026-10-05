import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { Category, CategoryCreate, CategoryList, CategoryOrder, CategoryPatch } from '@nri/contracts'
import { categories } from '@nri/db'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { assertId, getCategory, listCategories, reorderCategories } from '../services/categories'

export const categoryRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => c.json(CategoryList.parse({ items: await listCategories(c.var.db, c.var.userId) })))
  .post('/', async (c) => {
    const input = await parseJson(c, CategoryCreate)
    const userId = c.var.userId
    const [row] = await c.var.db
      .insert(categories)
      .values({
        userId, ...input,
        icon: input.icon ?? null,
        sortOrder: sql`(select coalesce(max(sort_order) + 1, 0) from categories where user_id = ${userId})`,
      })
      .returning({ id: categories.id })
    return c.json(Category.parse(await getCategory(c.var.db, userId, row!.id)), 201)
  })
  .put('/order', async (c) => {
    const { ids } = await parseJson(c, CategoryOrder)
    await reorderCategories(c.var.db, c.var.userId, ids)
    return c.json(CategoryList.parse({ items: await listCategories(c.var.db, c.var.userId) }))
  })
  .patch('/:id', async (c) => {
    const id = assertId(c.req.param('id'))
    const input = await parseJson(c, CategoryPatch)
    const { archived, ...rest } = input
    const set = { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? sql`now()` : null }) }
    const updated = await c.var.db
      .update(categories)
      .set(set)
      .where(and(eq(categories.id, id), eq(categories.userId, c.var.userId)))
      .returning({ id: categories.id })
    if (!updated.length) throw new ApiError(404, 'NOT_FOUND', 'That category no longer exists')
    return c.json(Category.parse(await getCategory(c.var.db, c.var.userId, updated[0]!.id)))
  })
  .delete('/:id', async (c) => {
    const id = assertId(c.req.param('id'))
    const cat = await getCategory(c.var.db, c.var.userId, id)
    if (cat.inUse) throw new ApiError(409, 'CONFLICT', 'Category has transactions — archive it instead')
    await c.var.db.delete(categories).where(and(eq(categories.id, cat.id), eq(categories.userId, c.var.userId)))
    return c.body(null, 204)
  })
