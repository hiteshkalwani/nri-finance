import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { MeResponse, ProfileInput, type Profile } from '@nri/contracts'
import { profiles } from '@nri/db'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'

type Row = typeof profiles.$inferSelect
// numeric(12,6) comes back as "1.694915"; trim trailing zeros but keep at least one decimal digit.
const rateOut = (s: string) => s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '.0')
const toProfile = (r: Row): Profile => ({
  salaryJpy: r.salaryJpy,
  planningRateJpyPerInr: rateOut(r.planningRateJpyPerInr),
  cycleStartDay: r.cycleStartDay,
  timezone: r.timezone,
})

export const meRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const [row] = await c.var.db.select().from(profiles).where(eq(profiles.userId, c.var.userId))
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: row ? toProfile(row) : null }))
  })
  .put('/', async (c) => {
    const input = await parseJson(c, ProfileInput)
    const [row] = await c.var.db
      .insert(profiles)
      .values({ userId: c.var.userId, ...input })
      .onConflictDoUpdate({ target: profiles.userId, set: { ...input } })
      .returning()
    return c.json(MeResponse.parse({ userId: c.var.userId, email: c.var.email, profile: toProfile(row!) }))
  })
