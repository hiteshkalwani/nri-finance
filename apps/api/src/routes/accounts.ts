import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { AccountList } from '@nri/contracts'
import { accounts } from '@nri/db'
import type { AppVars } from '../middleware/db'

/** Read-only for the expense form's account picker; managing accounts arrives in M2. */
export const accountRoutes = new Hono<{ Variables: AppVars }>().get('/', async (c) => {
  const items = await c.var.db
    .select({
      id: accounts.id, name: accounts.name, country: accounts.country, currency: accounts.currency,
      type: accounts.type, isEmergencyFund: accounts.isEmergencyFund,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, c.var.userId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.name))
  return c.json(AccountList.parse({ items }))
})
