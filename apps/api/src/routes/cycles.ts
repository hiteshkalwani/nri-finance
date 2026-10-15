import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { CycleIncome, CycleIncomeInput, CycleString } from '@nri/contracts'
import { cycleIncomes } from '@nri/db'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'

export const cycleRoutes = new Hono<{ Variables: AppVars }>().put('/:cycle/income', async (c) => {
  const parsedCycle = CycleString.safeParse(c.req.param('cycle'))
  if (!parsedCycle.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsedCycle.error.issues)
  const cycle = parsedCycle.data
  const input = await parseJson(c, CycleIncomeInput)
  const { db, userId } = c.var

  if (input.incomeJpy === null) {
    await db.delete(cycleIncomes).where(and(eq(cycleIncomes.userId, userId), eq(cycleIncomes.cycle, cycle)))
  } else {
    await db.insert(cycleIncomes).values({ userId, cycle, incomeJpy: input.incomeJpy })
      .onConflictDoUpdate({
        target: [cycleIncomes.userId, cycleIncomes.cycle],
        set: { incomeJpy: input.incomeJpy, updatedAt: sql`now()` },
      })
  }
  return c.json(CycleIncome.parse({ cycle, incomeJpy: input.incomeJpy }))
})
