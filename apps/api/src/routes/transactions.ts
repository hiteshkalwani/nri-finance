import { Hono } from 'hono'
import { Transaction, TransactionCreate, TransactionPage, TransactionPatch, TransactionQuery } from '@nri/contracts'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { assertId } from '../services/categories'
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from '../services/transactions'

export const transactionRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''))
    const q = TransactionQuery.safeParse(raw)
    if (!q.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Query is invalid', q.error.issues)
    return c.json(TransactionPage.parse(await listTransactions(c.var.db, c.var.userId, q.data)))
  })
  .get('/:id', async (c) =>
    c.json(Transaction.parse(await getTransaction(c.var.db, c.var.userId, assertId(c.req.param('id'), 'expense')))))
  .post('/', async (c) => {
    const input = await parseJson(c, TransactionCreate)
    return c.json(Transaction.parse(await createTransaction(c.var.db, c.var.userId, input)), 201)
  })
  .patch('/:id', async (c) => {
    const id = assertId(c.req.param('id'), 'expense')
    const input = await parseJson(c, TransactionPatch)
    return c.json(Transaction.parse(await updateTransaction(c.var.db, c.var.userId, id, input)))
  })
  .delete('/:id', async (c) => {
    await deleteTransaction(c.var.db, c.var.userId, assertId(c.req.param('id'), 'expense'))
    return c.body(null, 204)
  })
