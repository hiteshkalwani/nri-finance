import { Hono } from 'hono'
import { Budgets, BudgetsPut, CycleString } from '@nri/contracts'
import { type Cycle, cycleOf, todayIn } from '@nri/core'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { requireProfile } from '../services/profile'
import { getBudgets, putBudgets } from '../services/budgets'

function parseCycle(param: string | undefined, startDay: number, timezone: string): Cycle {
  const parsed = param === undefined || param === '' ? null : CycleString.safeParse(param)
  if (parsed && !parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  return parsed?.data ?? cycleOf(todayIn(timezone), startDay)
}

export const budgetRoutes = new Hono<{ Variables: AppVars }>()
  .get('/', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const cycle = parseCycle(c.req.query('cycle'), profile.cycleStartDay, profile.timezone)
    return c.json(Budgets.parse(await getBudgets(db, userId, cycle, profile.cycleStartDay)))
  })
  .put('/', async (c) => {
    const { db, userId } = c.var
    const profile = await requireProfile(db, userId)
    const input = await parseJson(c, BudgetsPut)
    await putBudgets(db, userId, input)
    return c.json(Budgets.parse(await getBudgets(db, userId, input.cycle, profile.cycleStartDay)))
  })
