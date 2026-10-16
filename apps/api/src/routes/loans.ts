import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { Loan, LoanDetail, LoanInput, LoanPatch, LoanSchedule, PlannedPrepaymentsInput } from '@nri/contracts'
import { loans } from '@nri/db'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { assertId } from '../services/categories'
import { createLoan, getSchedule, patchLoan, replacePlannedPrepayments } from '../services/loans'
import { requireProfile } from '../services/profile'

export const loanRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const rows = await c.var.db.select({ id: loans.id, name: loans.name, closedAt: loans.closedAt }).from(loans)
      .where(eq(loans.userId, c.var.userId))
      .orderBy(asc(loans.name))
    return c.json(rows.map((r) => Loan.parse(r)))
  })
  .post('/', async (c) => {
    const input = await parseJson(c, LoanInput)
    return c.json(LoanDetail.parse(await createLoan(c.var.db, c.var.userId, input)), 201)
  })
  .patch('/:id', async (c) => {
    const id = assertId(c.req.param('id'), 'loan')
    const input = await parseJson(c, LoanPatch)
    return c.json(LoanDetail.parse(await patchLoan(c.var.db, c.var.userId, id, input)))
  })
  .get('/:id/schedule', async (c) => {
    const id = assertId(c.req.param('id'), 'loan')
    const profile = await requireProfile(c.var.db, c.var.userId)
    const schedule = await getSchedule(c.var.db, c.var.userId, id, profile.cycleStartDay, profile.timezone)
    return c.json(LoanSchedule.parse(schedule))
  })
  .put('/:id/planned-prepayments', async (c) => {
    const id = assertId(c.req.param('id'), 'loan')
    const input = await parseJson(c, PlannedPrepaymentsInput)
    await replacePlannedPrepayments(c.var.db, c.var.userId, id, input)
    return c.body(null, 204)
  })
