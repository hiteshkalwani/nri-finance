import { Hono } from 'hono'
import { SipPlan, SipPlanInput, SipProjection } from '@nri/contracts'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { requireProfile } from '../services/profile'
import { getProjection, getSipPlan, upsertSipPlan } from '../services/sip'

export const sipRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const plan = await getSipPlan(c.var.db, c.var.userId)
    return c.json(plan ? SipPlan.parse(plan) : null)
  })
  .put('/', async (c) => {
    const input = await parseJson(c, SipPlanInput)
    return c.json(SipPlan.parse(await upsertSipPlan(c.var.db, c.var.userId, input)))
  })
  .get('/projection', async (c) => {
    const profile = await requireProfile(c.var.db, c.var.userId)
    const projection = await getProjection(c.var.db, c.var.userId, profile.cycleStartDay, profile.timezone)
    return c.json(SipProjection.parse(projection))
  })
