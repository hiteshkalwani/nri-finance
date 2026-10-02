import { Hono } from 'hono'
import { ImportResult, V1Document } from '@nri/contracts'
import { parseJson } from '../errors'
import type { AppVars } from '../middleware/db'
import { importV1 } from '../services/importV1'

export const importRoutes = new Hono<{ Variables: AppVars }>().post('/v1', async (c) => {
  const doc = await parseJson(c, V1Document)
  return c.json(ImportResult.parse(await importV1(c.var.db, c.var.userId, doc)))
})
