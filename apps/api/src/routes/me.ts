import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { MeResponse, ProfileInput, type Profile } from '@nri/contracts'
import { profiles } from '@nri/db'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { rateOut } from '../services/profile'

type Row = typeof profiles.$inferSelect
const toProfile = (r: Row): Profile => ({
  salaryJpy: r.salaryJpy,
  planningRateJpyPerInr: rateOut(r.planningRateJpyPerInr),
  cycleStartDay: r.cycleStartDay,
  timezone: r.timezone,
  emergencyFundGoalJpy: r.emergencyFundGoalJpy,
})

export const meRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const [row] = await c.var.db.select().from(profiles).where(eq(profiles.userId, c.var.userId))
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: row ? toProfile(row) : null }))
  })
  .put('/', async (c) => {
    const { emergencyFundGoalJpy, ...rest } = await parseJson(c, ProfileInput)
    const set = emergencyFundGoalJpy === undefined ? rest : { ...rest, emergencyFundGoalJpy }
    const [row] = await c.var.db
      .insert(profiles)
      .values({ userId: c.var.userId, ...rest, emergencyFundGoalJpy: emergencyFundGoalJpy ?? null })
      .onConflictDoUpdate({ target: profiles.userId, set })
      .returning()
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: toProfile(row!) }))
  })
