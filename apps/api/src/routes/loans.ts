import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { Loan } from '@nri/contracts'
import { loans } from '@nri/db'
import type { AppVars } from '../middleware/db'

export const loanRoutes = new Hono<{ Variables: AppVars }>().get('/', async (c) => {
  const rows = await c.var.db.select({ id: loans.id, name: loans.name, closedAt: loans.closedAt }).from(loans)
    .where(eq(loans.userId, c.var.userId))
    .orderBy(asc(loans.name))
  return c.json(rows.map((r) => Loan.parse(r)))
})
