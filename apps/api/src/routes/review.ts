import { Hono } from 'hono'
import { CycleString, Review } from '@nri/contracts'
import type { Cycle } from '@nri/core'
import { ApiError } from '../errors'
import type { AppVars } from '../middleware/db'
import { rateOut, requireProfile } from '../services/profile'
import { getReview } from '../services/review'

function assertCycle(param: string): Cycle {
  const parsed = CycleString.safeParse(param)
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  return parsed.data
}

export const reviewRoutes = new Hono<{ Variables: AppVars }>().get('/:cycle', async (c) => {
  const { db, userId } = c.var
  const profile = await requireProfile(db, userId)
  const cycle = assertCycle(c.req.param('cycle'))
  const rate = rateOut(profile.planningRateJpyPerInr)
  return c.json(Review.parse(await getReview(db, userId, cycle, profile.cycleStartDay, profile.timezone, profile.salaryJpy, rate)))
})
