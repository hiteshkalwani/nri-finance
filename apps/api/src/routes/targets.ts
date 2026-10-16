import { Hono } from 'hono'
import { CycleString, Targets, TargetsPut } from '@nri/contracts'
import type { Cycle } from '@nri/core'
import { ApiError, parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { copyPreviousTargets, getTargets, putTargets } from '../services/targets'

function assertCycle(param: string): Cycle {
  const parsed = CycleString.safeParse(param)
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  return parsed.data
}

export const targetRoutes = new Hono<{ Variables: AppVars }>()
  .get('/:cycle', async (c) => {
    const cycle = assertCycle(c.req.param('cycle'))
    return c.json(Targets.parse(await getTargets(c.var.db, c.var.userId, cycle)))
  })
  .put('/:cycle', async (c) => {
    const cycle = assertCycle(c.req.param('cycle'))
    const input = await parseJson(c, TargetsPut)
    return c.json(Targets.parse(await putTargets(c.var.db, c.var.userId, cycle, input)))
  })
  .post('/:cycle/copy-previous', async (c) => {
    const cycle = assertCycle(c.req.param('cycle'))
    const overwrite = c.req.query('overwrite') === 'true'
    return c.json(Targets.parse(await copyPreviousTargets(c.var.db, c.var.userId, cycle, overwrite)))
  })
