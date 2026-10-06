import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { Account, AccountCreate, AccountList, AccountPatch, currencyFor } from '@nri/contracts'
import { accounts } from '@nri/db'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { assertId, assertUniqueName, getAccount, listAccounts } from '../services/accounts'

export const accountRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const includeArchived = c.req.query('include') === 'archived'
    const items = await listAccounts(c.var.db, c.var.userId, { includeArchived })
    return c.json(AccountList.parse({ items }))
  })
  .post('/', async (c) => {
    const input = await parseJson(c, AccountCreate)
    const userId = c.var.userId
    await assertUniqueName(c.var.db, userId, input.name)
    const [row] = await c.var.db
      .insert(accounts)
      .values({
        userId, name: input.name, country: input.country, currency: currencyFor(input.country), type: input.type,
        isEmergencyFund: input.isEmergencyFund ?? false,
      })
      .returning({ id: accounts.id })
    return c.json(Account.parse(await getAccount(c.var.db, userId, row!.id)), 201)
  })
  .patch('/:id', async (c) => {
    const id = assertId(c.req.param('id'))
    const input = await parseJson(c, AccountPatch)
    const userId = c.var.userId
    const existing = await getAccount(c.var.db, userId, id)

    const { archived, country, name, ...rest } = input
    if (country !== undefined && country !== existing.country && existing.hasBalances) {
      throw new ApiError(409, 'CONFLICT', 'This account has balances; add a new account instead')
    }
    if (name !== undefined || archived === false) {
      await assertUniqueName(c.var.db, userId, name ?? existing.name, id)
    }

    const set: Record<string, unknown> = { ...rest, updatedAt: sql`now()` }
    if (name !== undefined) set.name = name
    if (country !== undefined) { set.country = country; set.currency = currencyFor(country) }
    if (archived !== undefined) set.archivedAt = archived ? sql`now()` : null

    const updated = await c.var.db
      .update(accounts)
      .set(set)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning({ id: accounts.id })
    if (!updated.length) throw new ApiError(404, 'NOT_FOUND', 'That account no longer exists')
    return c.json(Account.parse(await getAccount(c.var.db, userId, updated[0]!.id)))
  })
