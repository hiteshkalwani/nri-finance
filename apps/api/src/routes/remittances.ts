import { Hono } from 'hono'
import {
  Remittance, RemittanceInput, RemittanceList, RemittancePatch, RemittanceQuery, RemittanceRates, RemittanceRatesQuery,
} from '@nri/contracts'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { assertId } from '../services/categories'
import { createRemittance, deleteRemittance, getRemittance, listRates, listRemittances, updateRemittance } from '../services/remittances'
import { rateOut, requireProfile } from '../services/profile'

export const remittanceRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''))
    const q = RemittanceQuery.safeParse(raw)
    if (!q.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Query is invalid', q.error.issues)
    const body = await listRemittances(db, userId, q.data, profile.cycleStartDay, profile.timezone)
    return c.json(RemittanceList.parse(body))
  })
  // Registered before /:id so "rates" is never parsed as a remittance id.
  .get('/rates', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const q = RemittanceRatesQuery.safeParse(Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== '')))
    if (!q.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Query is invalid', q.error.issues)
    const points = await listRates(db, userId, q.data.limit)
    return c.json(RemittanceRates.parse({ planningRate: rateOut(profile.planningRateJpyPerInr), points }))
  })
  .get('/:id', async (c) =>
    c.json(Remittance.parse(await getRemittance(c.var.db, c.var.userId, assertId(c.req.param('id'), 'remittance')))))
  .post('/', async (c) => {
    const input = await parseJson(c, RemittanceInput)
    return c.json(Remittance.parse(await createRemittance(c.var.db, c.var.userId, input)), 201)
  })
  .patch('/:id', async (c) => {
    const id = assertId(c.req.param('id'), 'remittance')
    const input = await parseJson(c, RemittancePatch)
    return c.json(Remittance.parse(await updateRemittance(c.var.db, c.var.userId, id, input)))
  })
  .delete('/:id', async (c) => {
    await deleteRemittance(c.var.db, c.var.userId, assertId(c.req.param('id'), 'remittance'))
    return c.body(null, 204)
  })
